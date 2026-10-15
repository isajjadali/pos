-- Checkout cart in one RPC (no draft pos_order rows in DB)

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

    select current_stock, name into v_prev, v_name
    from products where id = v_product_id for update;
    if not found then
      raise exception 'Product not found';
    end if;
    if v_prev < v_qty then
      raise exception 'Insufficient stock for %', v_name;
    end if;

    v_unit_cost := public.allocate_fifo_cost(v_product_id, v_qty);
    v_new := v_prev - v_qty;

    update products set current_stock = v_new, updated_at = now() where id = v_product_id;

    insert into sale_items (
      sale_id, product_id, product_name_snapshot, sku_snapshot, barcode_snapshot,
      quantity, unit_selling_price, unit_cost, line_total
    )
    select
      v_sale_id, p.id, p.name, p.sku, p.barcode,
      v_qty, v_unit_price, v_unit_cost, v_line_total
    from products p where p.id = v_product_id
    returning id into v_sale_item_id;

    insert into stock_movements (
      product_id, movement_type, quantity_change, previous_quantity, new_quantity,
      unit_cost, reference_type, reference_id, created_by
    ) values (
      v_product_id, 'sale', -v_qty, v_prev, v_new,
      v_unit_cost, 'sale', v_sale_id, auth.uid()
    );
  end loop;

  return v_sale_id;
end;
$$;

revoke all on function public.complete_sale_from_cart(jsonb, numeric, numeric) from public;
grant execute on function public.complete_sale_from_cart(jsonb, numeric, numeric) to authenticated;
