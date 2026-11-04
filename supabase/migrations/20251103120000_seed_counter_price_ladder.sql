-- Seed Jewellery / Hair Pins & Poonies counter price-ladder SKUs (idempotent by barcode).

create or replace function public._seed_counter_price_ladder_sku(
  p_category_name text,
  p_name text,
  p_barcode text,
  p_selling numeric,
  p_purchase numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat uuid;
  v_id uuid;
  v_qty integer := 9999;
  v_cost numeric(12,4) := greatest(coalesce(p_purchase, 0), 0);
  v_sell numeric(12,2) := greatest(coalesce(p_selling, 0), 0);
begin
  if exists (
    select 1 from public.products
    where barcode = p_barcode and coalesce(is_active, true)
  ) then
    return;
  end if;

  select id into v_cat
  from public.categories
  where lower(trim(name)) = lower(trim(p_category_name))
  order by case when is_active is not false then 0 else 1 end
  limit 1;

  if v_cat is null then
    insert into public.categories (name, is_active)
    values (trim(p_category_name), true)
    returning id into v_cat;
  end if;

  insert into public.products (
    name, sku, barcode, category_id, vendor_id,
    selling_price, weighted_avg_cost, current_stock, unprinted_barcode_qty,
    low_stock_threshold, is_active,
    pieces_per_pack, pieces_per_box,
    piece_selling_price, pack_selling_price, box_selling_price, default_sale_unit
  ) values (
    trim(p_name), p_barcode, p_barcode, v_cat, null,
    v_sell, v_cost, v_qty, 1,
    0, true,
    1, null,
    v_sell, v_sell, null, 'piece'
  ) returning id into v_id;

  insert into public.inventory_batches (product_id, initial_quantity, remaining_quantity, unit_purchase_cost)
  values (v_id, v_qty, v_qty, v_cost);

  insert into public.stock_movements (
    product_id, movement_type, quantity_change, previous_quantity, new_quantity,
    unit_cost, reference_type, reference_id, notes, created_by
  ) values (
    v_id, 'initial_stock', v_qty, 0, v_qty, v_cost, 'product', v_id,
    'Counter price ladder seed', null
  );
end;
$$;

do $$
begin
  -- Jewellery: purchase = selling - 100 (min 0)
  perform public._seed_counter_price_ladder_sku('Jewellery', 'Jewellery (100)', 'JW100', 100, 0);
  perform public._seed_counter_price_ladder_sku('Jewellery', 'Jewellery (180)', 'JW180', 180, 80);
  perform public._seed_counter_price_ladder_sku('Jewellery', 'Jewellery (190)', 'JW190', 190, 90);
  perform public._seed_counter_price_ladder_sku('Jewellery', 'Jewellery (200)', 'JW200', 200, 100);
  perform public._seed_counter_price_ladder_sku('Jewellery', 'Jewellery (250)', 'JW250', 250, 150);
  perform public._seed_counter_price_ladder_sku('Jewellery', 'Jewellery (300)', 'JW300', 300, 200);
  perform public._seed_counter_price_ladder_sku('Jewellery', 'Jewellery (350)', 'JW350', 350, 250);
  perform public._seed_counter_price_ladder_sku('Jewellery', 'Jewellery (380)', 'JW380', 380, 280);

  -- Hair Pins & Poonies: 80→40 special; else selling - 100
  perform public._seed_counter_price_ladder_sku('Hair Pins & Poonies', 'Hair Pins & Poonies (80)', 'HP80', 80, 40);
  perform public._seed_counter_price_ladder_sku('Hair Pins & Poonies', 'Hair Pins & Poonies (120)', 'HP120', 120, 20);
  perform public._seed_counter_price_ladder_sku('Hair Pins & Poonies', 'Hair Pins & Poonies (150)', 'HP150', 150, 50);
  perform public._seed_counter_price_ladder_sku('Hair Pins & Poonies', 'Hair Pins & Poonies (200)', 'HP200', 200, 100);
  perform public._seed_counter_price_ladder_sku('Hair Pins & Poonies', 'Hair Pins & Poonies (250)', 'HP250', 250, 150);
  perform public._seed_counter_price_ladder_sku('Hair Pins & Poonies', 'Hair Pins & Poonies (300)', 'HP300', 300, 200);
end;
$$;

drop function public._seed_counter_price_ladder_sku(text, text, text, numeric, numeric);
