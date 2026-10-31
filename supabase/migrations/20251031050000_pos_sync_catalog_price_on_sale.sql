-- When cashier overrides line price and completes sale, optionally write that
-- unit price back to the product catalog (sync_catalog_price on the cart line).

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
  v_product_id_text text;
  v_sync_price boolean;
  v_piece numeric(12,2);
  v_pack numeric(12,2);
  v_box numeric(12,2);
  v_default text;
  v_ppp integer;
  v_ppb integer;
  v_catalog_sale numeric(12,2);
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
    v_product_id_text := nullif(trim(coalesce(v_row ->> 'product_id', '')), '');
    if v_product_id_text is null then
      v_name := nullif(trim(coalesce(
        v_row ->> 'product_name',
        v_row ->> 'product_name_snapshot',
        ''
      )), '');
      if v_name is null then
        raise exception 'Custom line % needs a product name', v_i + 1;
      end if;
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
    v_product_id_text := nullif(trim(coalesce(v_row ->> 'product_id', '')), '');
    v_qty := (v_row ->> 'quantity')::integer;
    v_unit_price := (v_row ->> 'unit_selling_price')::numeric;
    v_line_total := v_qty * v_unit_price;
    v_sale_unit := lower(coalesce(nullif(trim(v_row ->> 'sale_unit'), ''), 'piece'));
    if v_sale_unit not in ('piece', 'pack', 'box') then
      v_sale_unit := 'piece';
    end if;
    v_pieces_per_unit := greatest(coalesce((v_row ->> 'pieces_per_unit')::integer, 1), 1);
    v_stock_qty := v_qty * v_pieces_per_unit;
    v_sync_price := coalesce((v_row ->> 'sync_catalog_price')::boolean, false)
      or lower(coalesce(v_row ->> 'sync_catalog_price', '')) in ('1', 'true', 't', 'yes');

    if v_product_id_text is null then
      v_name := nullif(trim(coalesce(
        v_row ->> 'product_name',
        v_row ->> 'product_name_snapshot',
        ''
      )), '');
      insert into sale_items (
        sale_id, product_id, product_name_snapshot, sku_snapshot, barcode_snapshot,
        quantity, unit_selling_price, unit_cost, line_total, sale_unit, pieces_per_unit
      ) values (
        v_sale_id, null, v_name, null, null,
        v_qty, v_unit_price, 0, v_line_total, v_sale_unit, v_pieces_per_unit
      );
      continue;
    end if;

    v_product_id := v_product_id_text::uuid;

    select
      current_stock,
      name,
      coalesce(piece_selling_price, selling_price, 0),
      coalesce(pack_selling_price, selling_price, 0),
      box_selling_price,
      coalesce(nullif(trim(default_sale_unit), ''), 'piece'),
      greatest(coalesce(pieces_per_pack, 1), 1),
      pieces_per_box
    into
      v_prev, v_name, v_piece, v_pack, v_box, v_default, v_ppp, v_ppb
    from products
    where id = v_product_id
    for update;
    if not found then
      raise exception 'Product not found';
    end if;
    if v_prev < v_stock_qty then
      raise exception 'Insufficient stock for % (need % pcs, have %)', v_name, v_stock_qty, v_prev;
    end if;

    v_unit_cost := public.allocate_fifo_cost(v_product_id, v_stock_qty);
    v_new := v_prev - v_stock_qty;

    update products set current_stock = v_new, updated_at = now() where id = v_product_id;

    if v_sync_price then
      if v_sale_unit = 'pack' then
        v_pack := greatest(v_unit_price, 0);
      elsif v_sale_unit = 'box' then
        v_box := greatest(v_unit_price, 0);
      else
        v_piece := greatest(v_unit_price, 0);
      end if;

      if v_default = 'pack' then
        v_catalog_sale := v_pack;
      elsif v_default = 'box' and v_box is not null then
        v_catalog_sale := v_box;
      else
        v_catalog_sale := v_piece;
      end if;

      update products set
        piece_selling_price = v_piece,
        pack_selling_price = v_pack,
        box_selling_price = case when v_ppb is not null then v_box else null end,
        selling_price = greatest(coalesce(v_catalog_sale, 0), 0),
        updated_at = now()
      where id = v_product_id;
    end if;

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
