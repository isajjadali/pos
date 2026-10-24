-- Product "delete" is soft-delete only: is_active = false.
-- Barcode / SKU / stock history are preserved (no hard DELETE from products).

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
  v_updated integer;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    return jsonb_build_object('deleted', 0, 'failed', '[]'::jsonb);
  end if;

  foreach v_id in array p_product_ids loop
    begin
      select name into v_name from public.products where id = v_id;
      if v_name is null then
        v_failed := v_failed || jsonb_build_array(
          jsonb_build_object('id', v_id, 'error', 'Product not found')
        );
        continue;
      end if;

      -- Soft delete only — never touch barcode / sku / stock / batches
      update public.products
      set is_active = false, updated_at = now()
      where id = v_id;

      get diagnostics v_updated = row_count;
      if v_updated > 0 then
        v_deleted := v_deleted + 1;
      end if;

    exception when others then
      v_failed := v_failed || jsonb_build_array(
        jsonb_build_object('id', v_id, 'name', v_name, 'error', sqlerrm)
      );
    end;
  end loop;

  return jsonb_build_object('deleted', v_deleted, 'failed', v_failed);
end;
$$;

revoke all on function public.delete_products_bulk(uuid[]) from public;
grant execute on function public.delete_products_bulk(uuid[]) to authenticated;
