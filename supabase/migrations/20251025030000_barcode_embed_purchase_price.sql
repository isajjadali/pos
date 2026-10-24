-- New auto barcodes: DW{purchasePrice}C{random10}
-- Example: purchase 270 → DW270C43C441C6A2
-- Only used when creating products with empty barcode; existing barcodes untouched.

drop function if exists public.generate_internal_barcode();
drop function if exists public.generate_internal_barcode(numeric);

create or replace function public.generate_internal_barcode(p_purchase_price numeric default 0)
returns text
language sql
volatile
as $$
  select
    'DW'
    || greatest(floor(coalesce(p_purchase_price, 0))::bigint, 0)::text
    || 'C'
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;

-- Patch create_product: pass purchase cost into barcode generator (body otherwise unchanged)
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
  if v_barcode is null then
    v_barcode := public.generate_internal_barcode(v_cost);
  end if;

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
revoke all on function public.generate_internal_barcode(numeric) from public;
grant execute on function public.generate_internal_barcode(numeric) to authenticated;
