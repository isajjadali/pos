-- Staff roles: admin | sales

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'sales' check (role in ('admin', 'sales')),
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'sales'
  );
$$;

-- Backfill existing auth users as admin (shop owner setup)
insert into public.profiles (id, role)
select id, 'admin' from auth.users
on conflict (id) do nothing;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'sales')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

create policy "profiles read own" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "profiles admin update" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Products: everyone reads; only admin mutates
drop policy if exists "authenticated read write" on public.products;

create policy "products select authenticated" on public.products
  for select to authenticated using (true);

create policy "products insert admin" on public.products
  for insert to authenticated with check (public.is_admin());

create policy "products update admin" on public.products
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "products delete admin" on public.products
  for delete to authenticated using (public.is_admin());

-- Settings: admin only
drop policy if exists "authenticated read write" on public.app_settings;

create policy "settings select authenticated" on public.app_settings
  for select to authenticated using (true);

create policy "settings insert admin" on public.app_settings
  for insert to authenticated with check (public.is_admin());

create policy "settings update admin" on public.app_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "settings delete admin" on public.app_settings
  for delete to authenticated using (public.is_admin());

-- Guard destructive RPCs
create or replace function public.delete_products_bulk(p_product_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_deleted integer := 0;
  v_failed jsonb := '[]'::jsonb;
  v_name text;
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'Not authenticated'; end if;
  if not public.is_admin() then raise exception 'Admin only'; end if;
  -- body unchanged from prior migration - abbreviated: call existing logic
  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    return jsonb_build_object('deleted', 0, 'failed', '[]'::jsonb);
  end if;
  foreach v_id in array p_product_ids loop
    begin
      select name into v_name from products where id = v_id;
      if v_name is null then
        v_failed := v_failed || jsonb_build_array(jsonb_build_object('id', v_id, 'error', 'Product not found'));
        continue;
      end if;
      delete from public.barcode_print_job_items where product_id = v_id;
      delete from public.pos_order_items where product_id = v_id;
      delete from public.stock_movements where product_id = v_id;
      delete from public.inventory_batches where product_id = v_id;
      delete from public.stock_receipt_items where product_id = v_id;
      update public.sale_items set product_id = null where product_id = v_id;
      delete from public.products where id = v_id;
      v_deleted := v_deleted + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('id', v_id, 'name', v_name, 'error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('deleted', v_deleted, 'failed', v_failed);
end;
$$;

create or replace function public.receive_stock(
  p_product_id uuid,
  p_quantity integer,
  p_unit_cost numeric,
  p_vendor_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev integer;
  v_new integer;
  v_old_cost numeric(12,4);
  v_new_avg numeric(12,4);
  v_receipt_id uuid;
  v_item_id uuid;
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'Not authenticated'; end if;
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;

  select current_stock, weighted_avg_cost into v_prev, v_old_cost
  from products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;

  v_new := v_prev + p_quantity;
  if v_prev + p_quantity = 0 then
    v_new_avg := p_unit_cost;
  else
    v_new_avg := ((v_prev * v_old_cost) + (p_quantity * p_unit_cost)) / v_new;
  end if;

  insert into stock_receipts (vendor_id, notes, created_by)
  values (p_vendor_id, p_notes, auth.uid())
  returning id into v_receipt_id;

  insert into stock_receipt_items (stock_receipt_id, product_id, quantity, unit_purchase_cost)
  values (v_receipt_id, p_product_id, p_quantity, p_unit_cost)
  returning id into v_item_id;

  insert into inventory_batches (product_id, stock_receipt_item_id, initial_quantity, remaining_quantity, unit_purchase_cost)
  values (p_product_id, v_item_id, p_quantity, p_quantity, p_unit_cost);

  update products set
    current_stock = v_new,
    unprinted_barcode_qty = unprinted_barcode_qty + p_quantity,
    weighted_avg_cost = v_new_avg,
    vendor_id = coalesce(p_vendor_id, vendor_id),
    updated_at = now()
  where id = p_product_id;

  insert into stock_movements (
    product_id, movement_type, quantity_change, previous_quantity, new_quantity,
    unit_cost, reference_type, reference_id, notes, created_by
  ) values (
    p_product_id, 'stock_receipt', p_quantity, v_prev, v_new,
    p_unit_cost, 'stock_receipt', v_receipt_id, p_notes, auth.uid()
  );

  return v_receipt_id;
end;
$$;

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_quantity_change integer,
  p_movement_type text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev integer;
  v_new integer;
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'Not authenticated'; end if;
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_quantity_change = 0 then raise exception 'No change'; end if;

  select current_stock into v_prev from products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;

  v_new := v_prev + p_quantity_change;
  if v_new < 0 then raise exception 'Insufficient stock'; end if;

  update products set current_stock = v_new, updated_at = now() where id = p_product_id;

  insert into stock_movements (
    product_id, movement_type, quantity_change, previous_quantity, new_quantity,
    notes, created_by
  ) values (
    p_product_id, coalesce(p_movement_type, 'adjustment'), p_quantity_change, v_prev, v_new,
    p_notes, auth.uid()
  );
end;
$$;

create or replace function public.create_product_with_initial_stock(
  p_name text,
  p_external_product_id text default null,
  p_sku text default null,
  p_barcode text default null,
  p_category_id uuid default null,
  p_vendor_id uuid default null,
  p_selling_price numeric default 0,
  p_purchase_price numeric default 0,
  p_initial_qty integer default 0,
  p_low_stock_threshold integer default 5
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_barcode text;
  v_qty integer;
  v_cost numeric(12,4);
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'Not authenticated'; end if;
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'Product name is required'; end if;

  v_qty := greatest(coalesce(p_initial_qty, 0), 0);
  v_cost := greatest(coalesce(p_purchase_price, 0), 0);
  v_barcode := nullif(trim(coalesce(p_barcode, '')), '');
  if v_barcode is null then v_barcode := public.generate_internal_barcode(); end if;

  insert into public.products (
    name, external_product_id, sku, barcode, category_id, vendor_id,
    selling_price, weighted_avg_cost, current_stock, unprinted_barcode_qty,
    low_stock_threshold, is_active
  ) values (
    trim(p_name), nullif(trim(coalesce(p_external_product_id, '')), ''),
    nullif(trim(coalesce(p_sku, '')), ''), v_barcode, p_category_id, p_vendor_id,
    greatest(coalesce(p_selling_price, 0), 0), v_cost, v_qty, v_qty,
    greatest(coalesce(p_low_stock_threshold, 5), 0), true
  ) returning id into v_id;

  if v_qty > 0 then
    insert into public.inventory_batches (product_id, initial_quantity, remaining_quantity, unit_purchase_cost)
    values (v_id, v_qty, v_qty, v_cost);
    insert into public.stock_movements (
      product_id, movement_type, quantity_change, previous_quantity, new_quantity,
      unit_cost, reference_type, reference_id, notes, created_by
    ) values (
      v_id, 'initial_stock', v_qty, 0, v_qty, v_cost, 'product', v_id, 'Initial stock on product create', auth.uid()
    );
  end if;
  return v_id;
end;
$$;

