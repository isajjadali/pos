-- Phase 2: atomic product creation with initial stock + movement ledger

create or replace function public.generate_internal_barcode()
returns text
language sql
stable
as $$
  select 'DW' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
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
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;

  if p_name is null or trim(p_name) = '' then
    raise exception 'Product name is required';
  end if;

  v_qty := greatest(coalesce(p_initial_qty, 0), 0);
  v_cost := greatest(coalesce(p_purchase_price, 0), 0);
  v_barcode := nullif(trim(coalesce(p_barcode, '')), '');
  if v_barcode is null then
    v_barcode := public.generate_internal_barcode();
  end if;

  insert into public.products (
    name,
    external_product_id,
    sku,
    barcode,
    category_id,
    vendor_id,
    selling_price,
    weighted_avg_cost,
    current_stock,
    unprinted_barcode_qty,
    low_stock_threshold,
    is_active
  )
  values (
    trim(p_name),
    nullif(trim(coalesce(p_external_product_id, '')), ''),
    nullif(trim(coalesce(p_sku, '')), ''),
    v_barcode,
    p_category_id,
    p_vendor_id,
    greatest(coalesce(p_selling_price, 0), 0),
    v_cost,
    v_qty,
    v_qty,
    greatest(coalesce(p_low_stock_threshold, 5), 0),
    true
  )
  returning id into v_id;

  if v_qty > 0 then
    insert into public.inventory_batches (
      product_id,
      initial_quantity,
      remaining_quantity,
      unit_purchase_cost
    )
    values (v_id, v_qty, v_qty, v_cost);

    insert into public.stock_movements (
      product_id,
      movement_type,
      quantity_change,
      previous_quantity,
      new_quantity,
      unit_cost,
      reference_type,
      reference_id,
      notes,
      created_by
    )
    values (
      v_id,
      'initial_stock',
      v_qty,
      0,
      v_qty,
      v_cost,
      'product',
      v_id,
      'Initial stock on product create',
      auth.uid()
    );
  end if;

  return v_id;
end;
$$;

revoke all on function public.create_product_with_initial_stock from public;
grant execute on function public.create_product_with_initial_stock to authenticated;
