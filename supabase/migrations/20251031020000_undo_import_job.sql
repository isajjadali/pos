-- Persist undo payload on import_jobs + RPC to revert last import safely.

alter table public.import_jobs
  add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.import_jobs
  add column if not exists undone_at timestamptz;

comment on column public.import_jobs.details is
  'Undo payload: { behavior, actions: [{ action, product_id, qty, before? }] }';

-- Enrich bulk import results for undo (qty / before snapshot / product_id).
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
  v_before_name text;
  v_before_sale numeric(12,2);
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
  if not public.is_admin() then
    raise exception 'Admin only';
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
    v_vendor_id := null;
    v_before_name := null;
    v_before_sale := null;

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

      if v_vendor_name is not null then
        select id into v_vendor_id from vendors where lower(name) = lower(v_vendor_name) limit 1;
      end if;

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
      if v_match_id is null and v_vendor_id is not null then
        select id into v_match_id
        from products
        where vendor_id = v_vendor_id
          and lower(name) = lower(v_name)
        order by is_active desc nulls last, updated_at desc nulls last
        limit 1;
      end if;

      if v_match_id is not null then
        v_product_id := v_match_id;
        select vendor_id, weighted_avg_cost, name, selling_price
        into v_existing_vendor_id, v_existing_cost, v_before_name, v_before_sale
        from products where id = v_match_id;

        if v_behavior = 'skip' then
          v_action := 'skipped';
        elsif v_behavior = 'add_stock' and v_qty > 0 then
          perform public.receive_stock(
            v_match_id,
            v_qty,
            coalesce(nullif(v_purchase, 0), v_existing_cost),
            coalesce(v_vendor_id, v_existing_vendor_id),
            'CSV bulk import stock add'
          );
          if v_sale > 0 then
            update products set
              selling_price = v_sale,
              piece_selling_price = coalesce(piece_selling_price, v_sale),
              pack_selling_price = coalesce(pack_selling_price, v_sale),
              updated_at = now()
            where id = v_match_id
              and selling_price is distinct from v_sale;
          end if;
          v_action := 'stock_added';
        elsif v_behavior = 'update_info' then
          update products set
            name = v_name,
            selling_price = case when v_sale > 0 then v_sale else selling_price end,
            piece_selling_price = case
              when v_sale > 0 then coalesce(piece_selling_price, v_sale)
              else piece_selling_price
            end,
            pack_selling_price = case
              when v_sale > 0 then coalesce(pack_selling_price, v_sale)
              else pack_selling_price
            end,
            updated_at = now()
          where id = v_match_id;
          v_action := 'updated';
        else
          v_action := 'duplicate';
        end if;
      else
        if v_vendor_name is not null and v_vendor_id is null then
          insert into vendors (name) values (v_vendor_name) returning id into v_vendor_id;
        end if;

        v_category_id := null;
        if v_category_name is not null then
          select id into v_category_id from categories where lower(name) = lower(v_category_name) limit 1;
          if v_category_id is null then
            insert into categories (name) values (v_category_name) returning id into v_category_id;
          end if;
        end if;

        if v_ext is null and v_vendor_name is not null then
          v_ext := public.next_external_product_id(public.vendor_initials_prefix(v_vendor_name));
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
          'product_id', v_product_id,
          'qty', v_qty,
          'purchase', v_purchase,
          'sale', v_sale,
          'before', case
            when v_action = 'updated' then jsonb_build_object(
              'name', v_before_name,
              'selling_price', v_before_sale
            )
            when v_action = 'stock_added' and v_sale > 0 then jsonb_build_object(
              'selling_price', v_before_sale
            )
            else null
          end
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

create or replace function public.undo_import_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.import_jobs%rowtype;
  v_actions jsonb;
  v_item jsonb;
  v_action text;
  v_product_id uuid;
  v_qty integer;
  v_prev integer;
  v_revert integer;
  v_undone integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_i integer;
  v_len integer;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  select * into v_job from public.import_jobs where id = p_job_id for update;
  if not found then
    raise exception 'Import job not found';
  end if;
  if v_job.undone_at is not null or v_job.status = 'undone' then
    raise exception 'This import was already undone';
  end if;

  -- Only the latest non-undone job may be reverted
  if exists (
    select 1
    from public.import_jobs j
    where j.undone_at is null
      and j.status in ('completed', 'partial')
      and j.created_at > v_job.created_at
  ) then
    raise exception 'Only the most recent import can be undone';
  end if;

  v_actions := coalesce(v_job.details -> 'actions', '[]'::jsonb);
  if jsonb_typeof(v_actions) <> 'array' then
    raise exception 'Import job has no undo details (older import)';
  end if;

  v_len := jsonb_array_length(v_actions);
  -- Reverse order so stock/create undos nest cleanly
  for v_i in reverse v_len - 1 .. 0 loop
    v_item := v_actions -> v_i;
    v_action := v_item ->> 'action';
    begin
      v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
      v_qty := greatest(coalesce((v_item ->> 'qty')::integer, 0), 0);

      if v_product_id is null or v_action in ('skipped', 'duplicate', 'error') then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if v_action = 'created' then
        update public.products
        set is_active = false, updated_at = now()
        where id = v_product_id;
        v_undone := v_undone + 1;

      elsif v_action = 'stock_added' then
        if v_qty > 0 then
          select coalesce(current_stock, 0) into v_prev
          from public.products where id = v_product_id for update;
          if not found then
            v_skipped := v_skipped + 1;
            continue;
          end if;
          v_revert := least(v_qty, v_prev);
          if v_revert > 0 then
            perform public.adjust_stock(
              v_product_id,
              -v_revert,
              'import_undo',
              'Undo CSV import stock add'
            );
          end if;
        end if;
        if v_item ? 'before' and (v_item -> 'before') ? 'selling_price' then
          update public.products
          set
            selling_price = coalesce((v_item -> 'before' ->> 'selling_price')::numeric, selling_price),
            updated_at = now()
          where id = v_product_id;
        end if;
        v_undone := v_undone + 1;

      elsif v_action = 'updated' then
        if v_item ? 'before' then
          update public.products
          set
            name = coalesce(v_item -> 'before' ->> 'name', name),
            selling_price = coalesce(
              (v_item -> 'before' ->> 'selling_price')::numeric,
              selling_price
            ),
            updated_at = now()
          where id = v_product_id;
        end if;
        v_undone := v_undone + 1;

      else
        v_skipped := v_skipped + 1;
      end if;

    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object(
          'name', coalesce(v_item ->> 'name', '?'),
          'action', v_action,
          'error', sqlerrm
        )
      );
    end;
  end loop;

  update public.import_jobs
  set status = 'undone', undone_at = now()
  where id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'undone', v_undone,
    'skipped', v_skipped,
    'failed', v_failed,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.undo_import_job(uuid) from public;
grant execute on function public.undo_import_job(uuid) to authenticated;
