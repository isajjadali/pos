-- Bulk permanent product delete (clears dependent rows that block FK)

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
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;

  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    return jsonb_build_object('deleted', 0, 'failed', '[]'::jsonb);
  end if;

  foreach v_id in array p_product_ids loop
    begin
      select name into v_name from products where id = v_id;
      if v_name is null then
        v_failed := v_failed || jsonb_build_array(
          jsonb_build_object('id', v_id, 'error', 'Product not found')
        );
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
      v_failed := v_failed || jsonb_build_array(
        jsonb_build_object('id', v_id, 'name', v_name, 'error', sqlerrm)
      );
    end;
  end loop;

  return jsonb_build_object('deleted', v_deleted, 'failed', v_failed);
end;
$$;

create or replace function public.deactivate_products_bulk(p_product_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;
  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    return 0;
  end if;
  update public.products
  set is_active = false, updated_at = now()
  where id = any (p_product_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.delete_products_bulk(uuid[]) from public;
grant execute on function public.delete_products_bulk(uuid[]) to authenticated;
revoke all on function public.deactivate_products_bulk(uuid[]) from public;
grant execute on function public.deactivate_products_bulk(uuid[]) to authenticated;
