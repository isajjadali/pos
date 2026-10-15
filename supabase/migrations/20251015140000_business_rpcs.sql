-- Phases 3–5: stock, sales, barcode reconciliation

create or replace function public.next_sale_reference()
returns text language sql as $$
  select 'S' || to_char(now(), 'YYYYMMDD') || '-' || lpad((floor(random() * 99999))::int::text, 5, '0');
$$;

create or replace function public.next_pos_reference()
returns text language sql as $$
  select 'O' || to_char(now(), 'YYYYMMDD') || '-' || lpad((floor(random() * 99999))::int::text, 5, '0');
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

create or replace function public.allocate_fifo_cost(p_product_id uuid, p_qty integer)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer := p_qty;
  v_total_cost numeric := 0;
  r record;
  v_take integer;
begin
  for r in
    select id, remaining_quantity, unit_purchase_cost
    from inventory_batches
    where product_id = p_product_id and remaining_quantity > 0
    order by created_at asc
    for update
  loop
    exit when v_remaining <= 0;
    v_take := least(r.remaining_quantity, v_remaining);
    update inventory_batches set remaining_quantity = remaining_quantity - v_take where id = r.id;
    v_total_cost := v_total_cost + (v_take * r.unit_purchase_cost);
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    select weighted_avg_cost into v_total_cost from products where id = p_product_id;
    return coalesce(v_total_cost, 0);
  end if;

  return v_total_cost / p_qty;
end;
$$;

create or replace function public.complete_pos_sale(
  p_pos_order_id uuid,
  p_discount_amount numeric default 0,
  p_amount_received numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_sale_id uuid;
  v_ref text;
  v_item record;
  v_unit_cost numeric(12,4);
  v_prev integer;
  v_new integer;
  v_sale_item_id uuid;
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'Not authenticated'; end if;

  select * into v_order from pos_orders where id = p_pos_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status = 'completed' then raise exception 'Order already completed'; end if;
  if v_order.status = 'cancelled' then raise exception 'Order cancelled'; end if;

  v_ref := public.next_sale_reference();

  insert into sales (
    sale_reference, status, subtotal, discount_amount, total_amount,
    payment_method, amount_received, change_due, created_by, completed_at
  ) values (
    v_ref, 'completed', v_order.subtotal, coalesce(p_discount_amount, 0), v_order.total_amount - coalesce(p_discount_amount, 0),
    'cash', p_amount_received, greatest(p_amount_received - (v_order.total_amount - coalesce(p_discount_amount, 0)), 0),
    auth.uid(), now()
  ) returning id into v_sale_id;

  for v_item in
    select * from pos_order_items where pos_order_id = p_pos_order_id
  loop
    select current_stock into v_prev from products where id = v_item.product_id for update;
    if v_prev < v_item.quantity then
      raise exception 'Insufficient stock for product %', v_item.product_id;
    end if;

    v_unit_cost := public.allocate_fifo_cost(v_item.product_id, v_item.quantity);
    v_new := v_prev - v_item.quantity;

    update products set current_stock = v_new, updated_at = now() where id = v_item.product_id;

    insert into sale_items (
      sale_id, product_id, product_name_snapshot, sku_snapshot, barcode_snapshot,
      quantity, unit_selling_price, unit_cost, line_total
    )
    select
      v_sale_id, p.id, p.name, p.sku, p.barcode,
      v_item.quantity, v_item.unit_selling_price, v_unit_cost, v_item.line_total
    from products p where p.id = v_item.product_id
    returning id into v_sale_item_id;

    insert into stock_movements (
      product_id, movement_type, quantity_change, previous_quantity, new_quantity,
      unit_cost, reference_type, reference_id, created_by
    ) values (
      v_item.product_id, 'sale', -v_item.quantity, v_prev, v_new,
      v_unit_cost, 'sale', v_sale_id, auth.uid()
    );
  end loop;

  update pos_orders set status = 'completed', discount_amount = coalesce(p_discount_amount, 0),
    total_amount = subtotal - coalesce(p_discount_amount, 0), updated_at = now()
  where id = p_pos_order_id;

  return v_sale_id;
end;
$$;

create or replace function public.reconcile_barcode_print(
  p_product_id uuid,
  p_print_mode text,
  p_requested_quantity integer,
  p_reconciled_quantity integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_pending integer;
  v_product record;
  v_to_deduct integer;
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'Not authenticated'; end if;
  if p_reconciled_quantity < 0 then raise exception 'Invalid reconciled quantity'; end if;

  select * into v_product from products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;

  v_pending := v_product.unprinted_barcode_qty;

  if p_print_mode = 'unprinted' then
    v_to_deduct := least(p_reconciled_quantity, v_pending);
  elsif p_print_mode = 'current_stock' then
    v_to_deduct := least(p_reconciled_quantity, v_pending);
  else
    v_to_deduct := least(p_reconciled_quantity, v_pending);
  end if;

  update products set
    unprinted_barcode_qty = greatest(unprinted_barcode_qty - v_to_deduct, 0),
    updated_at = now()
  where id = p_product_id;

  insert into barcode_print_jobs (status, print_mode, created_by)
  values ('reconciled', p_print_mode, auth.uid())
  returning id into v_job_id;

  insert into barcode_print_job_items (barcode_print_job_id, product_id, requested_quantity, reconciled_quantity)
  values (p_job_id, p_product_id, p_requested_quantity, p_reconciled_quantity);

  return v_job_id;
end;
$$;

grant execute on function public.receive_stock to authenticated;
grant execute on function public.adjust_stock to authenticated;
grant execute on function public.complete_pos_sale to authenticated;
grant execute on function public.reconcile_barcode_print to authenticated;
