-- Sale delete must restore pieces (qty * pieces_per_unit), not just sale-unit qty.
-- Pack/box sales were deducting N pieces but void only put back 1 pack/unit.

create or replace function public.delete_sale_admin(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_alloc record;
  v_prev int;
  v_new int;
  v_restored int := 0;
  v_pieces int;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  if not exists (select 1 from public.sales where id = p_sale_id) then
    raise exception 'Sale not found';
  end if;

  -- Put FIFO batch qty back before removing sale rows
  for v_alloc in
    select sca.inventory_batch_id, sca.quantity
    from public.sale_cost_allocations sca
    inner join public.sale_items si on si.id = sca.sale_item_id
    where si.sale_id = p_sale_id
      and sca.inventory_batch_id is not null
      and sca.quantity > 0
  loop
    update public.inventory_batches
    set remaining_quantity = remaining_quantity + v_alloc.quantity
    where id = v_alloc.inventory_batch_id;
  end loop;

  for v_item in
    select
      id,
      product_id,
      quantity,
      unit_cost,
      greatest(coalesce(pieces_per_unit, 1), 1) as pieces_per_unit
    from public.sale_items
    where sale_id = p_sale_id
  loop
    if v_item.product_id is not null then
      v_pieces := greatest(coalesce(v_item.quantity, 0), 0) * v_item.pieces_per_unit;

      select coalesce(current_stock, 0) into v_prev
      from public.products
      where id = v_item.product_id
      for update;

      if found then
        v_new := v_prev + v_pieces;
        update public.products
        set current_stock = v_new, updated_at = now()
        where id = v_item.product_id;

        insert into public.stock_movements (
          product_id, movement_type, quantity_change, previous_quantity, new_quantity,
          unit_cost, reference_type, reference_id, notes, created_by
        ) values (
          v_item.product_id,
          'sale_void',
          v_pieces,
          v_prev,
          v_new,
          coalesce(v_item.unit_cost, 0),
          'sale',
          p_sale_id,
          'Stock restored - sale deleted by admin',
          auth.uid()
        );
        v_restored := v_restored + 1;
      end if;
    end if;
  end loop;

  delete from public.sales where id = p_sale_id;

  return jsonb_build_object('deleted', true, 'lines_restored', v_restored);
end;
$$;

revoke all on function public.delete_sale_admin(uuid) from public;
grant execute on function public.delete_sale_admin(uuid) to authenticated;

-- One-time repair: stock still short after pack/box sales were deleted (void under-restored).
do $$
declare
  r record;
  v_prev int;
  v_new int;
  v_add int;
begin
  for r in
    select
      p.id as product_id,
      -(
        coalesce(sum(case when sm.movement_type = 'sale' then sm.quantity_change else 0 end), 0)
        + coalesce(sum(case when sm.movement_type = 'sale_void' then sm.quantity_change else 0 end), 0)
      ) as shortfall
    from public.stock_movements sm
    join public.products p on p.id = sm.product_id
    group by p.id
    having (
      coalesce(sum(case when sm.movement_type = 'sale' then sm.quantity_change else 0 end), 0)
      + coalesce(sum(case when sm.movement_type = 'sale_void' then sm.quantity_change else 0 end), 0)
    ) < 0
  loop
    v_add := r.shortfall;
    if v_add <= 0 then
      continue;
    end if;

    select coalesce(current_stock, 0) into v_prev
    from public.products
    where id = r.product_id
    for update;

    v_new := v_prev + v_add;
    update public.products
    set current_stock = v_new, updated_at = now()
    where id = r.product_id;

    insert into public.stock_movements (
      product_id, movement_type, quantity_change, previous_quantity, new_quantity,
      notes
    ) values (
      r.product_id,
      'correction',
      v_add,
      v_prev,
      v_new,
      'Repair: restore pieces lost when multi-unit sale delete under-credited stock'
    );
  end loop;
end;
$$;
