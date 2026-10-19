-- Title-case existing catalog text; admin delete sale/vendor; next product ID helper

-- ---------- Title-case existing data (Postgres initcap ≈ Title Case) ----------
update public.vendors
set name = initcap(trim(name)),
    contact_person = nullif(initcap(trim(coalesce(contact_person, ''))), ''),
    updated_at = now()
where name is not null;

update public.products
set name = initcap(trim(name)),
    updated_at = now()
where name is not null;

update public.categories
set name = initcap(trim(name))
where name is not null;

-- ---------- Next shop product ID: PREFIX-N (unique) ----------
create or replace function public.next_external_product_id(p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_max int := 0;
  v_n int;
  v_id text;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;

  v_prefix := upper(trim(coalesce(p_prefix, '')));
  if v_prefix = '' then
    v_prefix := 'XX';
  end if;
  -- keep only letters/digits
  v_prefix := regexp_replace(v_prefix, '[^A-Z0-9]', '', 'g');
  if v_prefix = '' then
    v_prefix := 'XX';
  end if;

  select coalesce(max((regexp_match(external_product_id, '^' || v_prefix || '-([0-9]+)$'))[1]::int), 0)
    into v_max
  from public.products
  where external_product_id ~ ('^' || v_prefix || '-[0-9]+$');

  v_n := v_max + 1;
  loop
    v_id := v_prefix || '-' || v_n::text;
    exit when not exists (
      select 1 from public.products where external_product_id = v_id
    );
    v_n := v_n + 1;
  end loop;

  return v_id;
end;
$$;

revoke all on function public.next_external_product_id(text) from public;
grant execute on function public.next_external_product_id(text) to authenticated;

-- ---------- Delete vendor only if no products reference it ----------
create or replace function public.delete_vendor_if_unused(p_vendor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  select count(*)::int into v_count
  from public.products
  where vendor_id = p_vendor_id;

  if v_count > 0 then
    raise exception 'Cannot delete vendor: % product(s) still linked. Reassign or delete those products first.', v_count;
  end if;

  update public.stock_receipts
  set vendor_id = null
  where vendor_id = p_vendor_id;

  delete from public.vendors where id = p_vendor_id;
  if not found then
    raise exception 'Vendor not found';
  end if;

  return jsonb_build_object('deleted', true);
end;
$$;

revoke all on function public.delete_vendor_if_unused(uuid) from public;
grant execute on function public.delete_vendor_if_unused(uuid) to authenticated;

-- ---------- Admin delete sale + restore stock ----------
create or replace function public.delete_sale_admin(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_prev int;
  v_new int;
  v_restored int := 0;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  if not exists (select 1 from public.sales where id = p_sale_id) then
    raise exception 'Sale not found';
  end if;

  for v_item in
    select id, product_id, quantity, unit_cost
    from public.sale_items
    where sale_id = p_sale_id
  loop
    if v_item.product_id is not null then
      select current_stock into v_prev
      from public.products
      where id = v_item.product_id
      for update;

      if found then
        v_new := coalesce(v_prev, 0) + greatest(coalesce(v_item.quantity, 0), 0);
        update public.products
        set current_stock = v_new, updated_at = now()
        where id = v_item.product_id;

        insert into public.stock_movements (
          product_id, movement_type, quantity_change, previous_quantity, new_quantity,
          unit_cost, reference_type, reference_id, notes, created_by
        ) values (
          v_item.product_id, 'sale_void', greatest(coalesce(v_item.quantity, 0), 0),
          v_prev, v_new,
          v_item.unit_cost, 'sale', p_sale_id,
          'Stock restored — sale deleted by admin',
          auth.uid()
        );
        v_restored := v_restored + 1;
      end if;
    end if;
  end loop;

  -- allocations cascade from sale_items; sale_items cascade from sales
  delete from public.sales where id = p_sale_id;

  return jsonb_build_object('deleted', true, 'lines_restored', v_restored);
end;
$$;

revoke all on function public.delete_sale_admin(uuid) from public;
grant execute on function public.delete_sale_admin(uuid) to authenticated;

-- Bulk delete sales
create or replace function public.delete_sales_bulk(p_sale_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_ok int := 0;
  v_fail jsonb := '[]'::jsonb;
  v_res jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  if p_sale_ids is null then
    return jsonb_build_object('deleted', 0, 'failed', '[]'::jsonb);
  end if;

  foreach v_id in array p_sale_ids loop
    begin
      v_res := public.delete_sale_admin(v_id);
      v_ok := v_ok + 1;
    exception when others then
      v_fail := v_fail || jsonb_build_array(jsonb_build_object('id', v_id, 'error', SQLERRM));
    end;
  end loop;

  return jsonb_build_object('deleted', v_ok, 'failed', v_fail);
end;
$$;

revoke all on function public.delete_sales_bulk(uuid[]) from public;
grant execute on function public.delete_sales_bulk(uuid[]) to authenticated;
