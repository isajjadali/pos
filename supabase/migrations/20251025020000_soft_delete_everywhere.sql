-- Soft-delete everywhere: no hard DELETE of business records.
-- Products already soft-deleted via delete_products_bulk (prior migration).

-- ---------- Categories: is_active ----------
alter table public.categories
  add column if not exists is_active boolean not null default true;

alter table public.categories drop constraint if exists categories_name_key;
drop index if exists categories_name_key;
create unique index if not exists categories_name_active_uidx
  on public.categories (lower(name))
  where is_active = true;

-- ---------- Vendors: unique name only among active ----------
drop index if exists vendors_name_unique;
create unique index if not exists vendors_name_active_uidx
  on public.vendors (lower(name))
  where is_active = true;

-- ---------- Profiles: soft-deactivate staff ----------
alter table public.profiles
  add column if not exists is_active boolean not null default true;

-- ---------- Vendor delete → soft deactivate (keep row + linked products) ----------
create or replace function public.delete_vendor_if_unused(p_vendor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  update public.vendors
  set is_active = false, updated_at = now()
  where id = p_vendor_id;

  if not found then
    raise exception 'Vendor not found';
  end if;

  return jsonb_build_object('deleted', true, 'soft', true);
end;
$$;

revoke all on function public.delete_vendor_if_unused(uuid) from public;
grant execute on function public.delete_vendor_if_unused(uuid) to authenticated;

-- ---------- Sale delete → cancel + restore stock (keep sale rows) ----------
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
  v_status text;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  select status into v_status from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale not found';
  end if;

  -- Already soft-deleted — idempotent
  if v_status = 'cancelled' then
    return jsonb_build_object('deleted', true, 'soft', true, 'lines_restored', 0, 'already_cancelled', true);
  end if;

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
          'Stock restored - sale soft-deleted (cancelled) by admin',
          auth.uid()
        );
        v_restored := v_restored + 1;
      end if;
    end if;
  end loop;

  update public.sales
  set status = 'cancelled'
  where id = p_sale_id;

  return jsonb_build_object('deleted', true, 'soft', true, 'lines_restored', v_restored);
end;
$$;

revoke all on function public.delete_sale_admin(uuid) from public;
grant execute on function public.delete_sale_admin(uuid) to authenticated;

-- ---------- Staff list includes is_active ----------
-- Return type changed (added is_active) — must drop first
drop function if exists public.list_staff_users();

create or replace function public.list_staff_users()
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  is_active boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  return query
  select
    u.id,
    u.email::text,
    p.full_name,
    coalesce(p.role, 'sales') as role,
    coalesce(p.is_active, true) as is_active,
    coalesce(p.created_at, u.created_at) as created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  order by coalesce(p.created_at, u.created_at) desc;
end;
$$;

revoke all on function public.list_staff_users() from public;
grant execute on function public.list_staff_users() to authenticated;
