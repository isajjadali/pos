-- Fix typo: p_job_id -> v_job_id in reconcile_barcode_print

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
  values (v_job_id, p_product_id, p_requested_quantity, p_reconciled_quantity);

  return v_job_id;
end;
$$;
