-- CSV rows often have blank sale price / optional numbers (empty string, not null)

create or replace function public.import_products_bulk(
  p_rows jsonb,
  p_duplicate_behavior text default 'add_stock'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_i integer;
  v_len integer;
  v_name text;
  v_qty integer;
  v_purchase numeric(12,4);
  v_sale numeric(12,4);
  v_ext text;
  v_sku text;
  v_barcode text;
  v_vendor_name text;
  v_category_name text;
  v_vendor_id uuid;
  v_category_id uuid;
  v_product_id uuid;
  v_match_id uuid;
  v_existing_vendor_id uuid;
  v_existing_cost numeric(12,4);
  v_action text;
  v_results jsonb := '[]'::jsonb;
  v_success integer := 0;
  v_failed integer := 0;
  v_behavior text;
  v_raw text;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  v_behavior := coalesce(nullif(trim(p_duplicate_behavior), ''), 'add_stock');
  if v_behavior not in ('add_stock', 'update_info', 'skip') then
    raise exception 'Invalid duplicate behavior: %', v_behavior;
  end if;

  v_len := jsonb_array_length(p_rows);

  for v_i in 0 .. v_len - 1 loop
    v_row := p_rows -> v_i;
    v_action := null;
    v_product_id := null;

    begin
      v_name := trim(coalesce(v_row ->> 'name', ''));
      if v_name = '' then
        raise exception 'Product name required';
      end if;

      v_raw := trim(coalesce(v_row ->> 'quantity', ''));
      v_qty := greatest(coalesce(nullif(v_raw, '')::integer, 0), 0);

      v_raw := trim(coalesce(v_row ->> 'purchase_price', ''));
      v_purchase := greatest(coalesce(nullif(v_raw, '')::numeric, 0), 0);

      v_raw := trim(coalesce(v_row ->> 'selling_price', ''));
      v_sale := greatest(coalesce(nullif(v_raw, '')::numeric, 0), 0);

      v_ext := nullif(trim(coalesce(v_row ->> 'external_product_id', '')), '');
      v_sku := nullif(trim(coalesce(v_row ->> 'sku', '')), '');
      v_barcode := nullif(trim(coalesce(v_row ->> 'barcode', '')), '');
      v_vendor_name := nullif(trim(coalesce(v_row ->> 'vendor', '')), '');
      v_category_name := nullif(trim(coalesce(v_row ->> 'category', '')), '');

      v_match_id := null;
      if v_ext is not null then
        select id into v_match_id from products where external_product_id = v_ext limit 1;
      end if;
      if v_match_id is null and v_sku is not null then
        select id into v_match_id from products where sku = v_sku limit 1;
      end if;
      if v_match_id is null and v_barcode is not null then
        select id into v_match_id from products where barcode = v_barcode limit 1;
      end if;

      if v_match_id is not null then
        v_product_id := v_match_id;
        select vendor_id, weighted_avg_cost
        into v_existing_vendor_id, v_existing_cost
        from products where id = v_match_id;

        if v_behavior = 'skip' then
          v_action := 'skipped';
        elsif v_behavior = 'add_stock' and v_qty > 0 then
          perform public.receive_stock(
            v_match_id,
            v_qty,
            coalesce(nullif(v_purchase, 0), v_existing_cost),
            v_existing_vendor_id,
            'CSV bulk import stock add'
          );
          v_action := 'stock_added';
        elsif v_behavior = 'update_info' then
          update products set
            name = v_name,
            selling_price = case when v_sale > 0 then v_sale else selling_price end,
            weighted_avg_cost = case when v_purchase > 0 then v_purchase else weighted_avg_cost end,
            updated_at = now()
          where id = v_match_id;
          v_action := 'updated';
        else
          v_action := 'duplicate';
        end if;
      else
        v_vendor_id := null;
        if v_vendor_name is not null then
          select id into v_vendor_id from vendors where lower(name) = lower(v_vendor_name) limit 1;
          if v_vendor_id is null then
            insert into vendors (name) values (v_vendor_name) returning id into v_vendor_id;
          end if;
        end if;

        v_category_id := null;
        if v_category_name is not null then
          select id into v_category_id from categories where lower(name) = lower(v_category_name) limit 1;
          if v_category_id is null then
            insert into categories (name) values (v_category_name) returning id into v_category_id;
          end if;
        end if;

        v_product_id := public.create_product_with_initial_stock(
          v_name,
          v_ext,
          v_sku,
          v_barcode,
          v_category_id,
          v_vendor_id,
          v_sale,
          v_purchase,
          v_qty,
          5
        );
        v_action := 'created';
      end if;

      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'row_index', v_i,
          'name', v_name,
          'action', v_action,
          'product_id', v_product_id
        )
      );
      v_success := v_success + 1;

    exception when others then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'row_index', v_i,
          'name', coalesce(v_name, '?'),
          'action', 'error',
          'error', sqlerrm
        )
      );
    end;
  end loop;

  return jsonb_build_object(
    'results', v_results,
    'summary', jsonb_build_object(
      'total', v_len,
      'success', v_success,
      'failed', v_failed
    )
  );
end;
$$;
