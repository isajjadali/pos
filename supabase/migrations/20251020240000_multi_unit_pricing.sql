-- Multi-unit pricing: stock stays in pieces; sell as piece / pack / box

alter table public.products
  add column if not exists pieces_per_pack integer not null default 1
    check (pieces_per_pack >= 1),
  add column if not exists pieces_per_box integer null
    check (pieces_per_box is null or pieces_per_box >= 1),
  add column if not exists piece_selling_price numeric(12,2) not null default 0
    check (piece_selling_price >= 0),
  add column if not exists pack_selling_price numeric(12,2) not null default 0
    check (pack_selling_price >= 0),
  add column if not exists box_selling_price numeric(12,2) null
    check (box_selling_price is null or box_selling_price >= 0),
  add column if not exists default_sale_unit text not null default 'piece'
    check (default_sale_unit in ('piece', 'pack', 'box'));

-- Backfill unit prices from existing catalog selling_price
update public.products
set
  piece_selling_price = selling_price,
  pack_selling_price = selling_price,
  pieces_per_pack = greatest(coalesce(pieces_per_pack, 1), 1),
  default_sale_unit = coalesce(nullif(default_sale_unit, ''), 'piece');

alter table public.sale_items
  add column if not exists sale_unit text not null default 'piece'
    check (sale_unit in ('piece', 'pack', 'box')),
  add column if not exists pieces_per_unit integer not null default 1
    check (pieces_per_unit >= 1);

-- Checkout: deduct quantity * pieces_per_unit from stock
create or replace function public.complete_sale_from_cart(
  p_items jsonb,
  p_discount_amount numeric default 0,
  p_amount_received numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_ref text;
  v_row jsonb;
  v_i integer;
  v_len integer;
  v_product_id uuid;
  v_qty integer;
  v_unit_price numeric(12,2);
  v_line_total numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2);
  v_total numeric(12,2);
  v_unit_cost numeric(12,4);
  v_prev integer;
  v_new integer;
  v_sale_item_id uuid;
  v_name text;
  v_sale_unit text;
  v_pieces_per_unit integer;
  v_stock_qty integer;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  v_len := jsonb_array_length(p_items);
  for v_i in 0 .. v_len - 1 loop
    v_row := p_items -> v_i;
    v_qty := greatest(coalesce((v_row ->> 'quantity')::integer, 0), 0);
    v_unit_price := greatest(coalesce((v_row ->> 'unit_selling_price')::numeric, 0), 0);
    if v_qty <= 0 then
      raise exception 'Invalid quantity on line %', v_i + 1;
    end if;
    v_subtotal := v_subtotal + (v_qty * v_unit_price);
  end loop;

  v_discount := greatest(coalesce(p_discount_amount, 0), 0);
  v_total := greatest(v_subtotal - v_discount, 0);
  v_ref := public.next_sale_reference();

  insert into sales (
    sale_reference, status, subtotal, discount_amount, total_amount,
    payment_method, amount_received, change_due, created_by, completed_at
  ) values (
    v_ref, 'completed', v_subtotal, v_discount, v_total,
    'cash', p_amount_received,
    greatest(coalesce(p_amount_received, 0) - v_total, 0),
    auth.uid(), now()
  ) returning id into v_sale_id;

  for v_i in 0 .. v_len - 1 loop
    v_row := p_items -> v_i;
    v_product_id := (v_row ->> 'product_id')::uuid;
    v_qty := (v_row ->> 'quantity')::integer;
    v_unit_price := (v_row ->> 'unit_selling_price')::numeric;
    v_line_total := v_qty * v_unit_price;
    v_sale_unit := lower(coalesce(nullif(trim(v_row ->> 'sale_unit'), ''), 'piece'));
    if v_sale_unit not in ('piece', 'pack', 'box') then
      v_sale_unit := 'piece';
    end if;
    v_pieces_per_unit := greatest(coalesce((v_row ->> 'pieces_per_unit')::integer, 1), 1);
    v_stock_qty := v_qty * v_pieces_per_unit;

    select current_stock, name into v_prev, v_name
    from products where id = v_product_id for update;
    if not found then
      raise exception 'Product not found';
    end if;
    if v_prev < v_stock_qty then
      raise exception 'Insufficient stock for % (need % pcs, have %)', v_name, v_stock_qty, v_prev;
    end if;

    v_unit_cost := public.allocate_fifo_cost(v_product_id, v_stock_qty);
    v_new := v_prev - v_stock_qty;

    update products set current_stock = v_new, updated_at = now() where id = v_product_id;

    insert into sale_items (
      sale_id, product_id, product_name_snapshot, sku_snapshot, barcode_snapshot,
      quantity, unit_selling_price, unit_cost, line_total, sale_unit, pieces_per_unit
    )
    select
      v_sale_id, p.id, p.name, p.sku, p.barcode,
      v_qty, v_unit_price, v_unit_cost, v_line_total, v_sale_unit, v_pieces_per_unit
    from products p where p.id = v_product_id
    returning id into v_sale_item_id;

    insert into stock_movements (
      product_id, movement_type, quantity_change, previous_quantity, new_quantity,
      unit_cost, reference_type, reference_id, created_by
    ) values (
      v_product_id, 'sale', -v_stock_qty, v_prev, v_new,
      v_unit_cost, 'sale', v_sale_id, auth.uid()
    );
  end loop;

  return v_sale_id;
end;
$$;

revoke all on function public.complete_sale_from_cart(jsonb, numeric, numeric) from public;
grant execute on function public.complete_sale_from_cart(jsonb, numeric, numeric) to authenticated;

-- Drop prior 10-arg overload so RPC name is unambiguous
drop function if exists public.create_product_with_initial_stock(
  text, text, text, text, uuid, uuid, numeric, numeric, integer, integer
);

-- Create product with multi-unit fields (extra args at end keep old callers working)
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
  p_low_stock_threshold integer default 5,
  p_pieces_per_pack integer default 1,
  p_pieces_per_box integer default null,
  p_piece_selling_price numeric default null,
  p_pack_selling_price numeric default null,
  p_box_selling_price numeric default null,
  p_default_sale_unit text default 'piece'
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
  v_pack integer;
  v_box integer;
  v_piece_price numeric(12,2);
  v_pack_price numeric(12,2);
  v_box_price numeric(12,2);
  v_unit text;
  v_sell numeric(12,2);
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'Not authenticated'; end if;
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'Product name is required'; end if;

  v_qty := greatest(coalesce(p_initial_qty, 0), 0);
  v_cost := greatest(coalesce(p_purchase_price, 0), 0);
  v_barcode := nullif(trim(coalesce(p_barcode, '')), '');
  if v_barcode is null then v_barcode := public.generate_internal_barcode(); end if;

  v_pack := greatest(coalesce(p_pieces_per_pack, 1), 1);
  v_box := nullif(greatest(coalesce(p_pieces_per_box, 0), 0), 0);
  v_piece_price := greatest(coalesce(p_piece_selling_price, p_selling_price, 0), 0);
  v_pack_price := greatest(coalesce(p_pack_selling_price, p_selling_price, v_piece_price), 0);
  v_box_price := case when v_box is null then null else greatest(coalesce(p_box_selling_price, 0), 0) end;
  v_unit := lower(coalesce(nullif(trim(p_default_sale_unit), ''), 'piece'));
  if v_unit not in ('piece', 'pack', 'box') then v_unit := 'piece'; end if;
  if v_unit = 'box' and v_box is null then v_unit := 'piece'; end if;

  v_sell := case v_unit
    when 'pack' then v_pack_price
    when 'box' then coalesce(v_box_price, v_pack_price)
    else v_piece_price
  end;

  insert into public.products (
    name, external_product_id, sku, barcode, category_id, vendor_id,
    selling_price, weighted_avg_cost, current_stock, unprinted_barcode_qty,
    low_stock_threshold, is_active,
    pieces_per_pack, pieces_per_box,
    piece_selling_price, pack_selling_price, box_selling_price, default_sale_unit
  ) values (
    trim(p_name), nullif(trim(coalesce(p_external_product_id, '')), ''),
    nullif(trim(coalesce(p_sku, '')), ''), v_barcode, p_category_id, p_vendor_id,
    v_sell, v_cost, v_qty, v_qty,
    greatest(coalesce(p_low_stock_threshold, 5), 0), true,
    v_pack, v_box,
    v_piece_price, v_pack_price, v_box_price, v_unit
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

revoke all on function public.create_product_with_initial_stock from public;
grant execute on function public.create_product_with_initial_stock to authenticated;

-- Price groups: update selling_price + matching default-unit price column
create or replace function public.bulk_update_selling_prices(p_updates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_row jsonb;
  v_id uuid;
  v_price numeric;
  v_unit text;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if p_updates is null or jsonb_typeof(p_updates) is distinct from 'array' then
    raise exception 'p_updates must be a JSON array';
  end if;

  for v_row in select value from jsonb_array_elements(p_updates)
  loop
    begin
      v_id := (v_row ->> 'id')::uuid;
    exception
      when others then
        continue;
    end;
    if v_id is null then
      continue;
    end if;
    v_price := greatest(coalesce((v_row ->> 'selling_price')::numeric, 0), 0);

    select default_sale_unit into v_unit from public.products where id = v_id;
    if not found then
      continue;
    end if;

    update public.products
    set
      selling_price = v_price,
      piece_selling_price = case when coalesce(v_unit, 'piece') = 'piece' then v_price else piece_selling_price end,
      pack_selling_price = case when coalesce(v_unit, 'piece') = 'pack' then v_price else pack_selling_price end,
      box_selling_price = case when coalesce(v_unit, 'piece') = 'box' then v_price else box_selling_price end,
      updated_at = now()
    where id = v_id;

    if found then
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('updated', v_updated);
end;
$$;

revoke all on function public.bulk_update_selling_prices(jsonb) from public;
grant execute on function public.bulk_update_selling_prices(jsonb) to authenticated;
