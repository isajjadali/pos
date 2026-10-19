-- Fix sale delete: restore FIFO batches + safe stock coalesce

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
    select id, product_id, quantity, unit_cost
    from public.sale_items
    where sale_id = p_sale_id
  loop
    if v_item.product_id is not null then
      select coalesce(current_stock, 0) into v_prev
      from public.products
      where id = v_item.product_id
      for update;

      if found then
        v_new := v_prev + greatest(coalesce(v_item.quantity, 0), 0);
        update public.products
        set current_stock = v_new, updated_at = now()
        where id = v_item.product_id;

        insert into public.stock_movements (
          product_id, movement_type, quantity_change, previous_quantity, new_quantity,
          unit_cost, reference_type, reference_id, notes, created_by
        ) values (
          v_item.product_id,
          'sale_void',
          greatest(coalesce(v_item.quantity, 0), 0),
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
