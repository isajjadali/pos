-- Fix audit_row_change: never touch NEW/OLD columns that may not exist on the
-- firing table (e.g. NEW.status on products → "record new has no field status").
-- Use jsonb field access instead.

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_action text;
  v_entity_id text;
  v_summary text;
  v_before jsonb;
  v_after jsonb;
  v_name text;
  v_old_active text;
  v_new_active text;
begin
  select * into v_actor from public._audit_actor_snapshot();

  if TG_OP = 'INSERT' then
    v_action := 'create';
    v_before := null;
    v_after := to_jsonb(NEW);
    v_entity_id := v_after->>'id';
  elsif TG_OP = 'UPDATE' then
    v_action := 'update';
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_entity_id := coalesce(v_after->>'id', v_before->>'id');

    -- Products: ignore inventory-only churn (sales / receive update stock often)
    if TG_TABLE_NAME = 'products' then
      if v_after->>'name' is not distinct from v_before->>'name'
         and v_after->>'sku' is not distinct from v_before->>'sku'
         and v_after->>'barcode' is not distinct from v_before->>'barcode'
         and v_after->>'external_product_id' is not distinct from v_before->>'external_product_id'
         and v_after->>'category_id' is not distinct from v_before->>'category_id'
         and v_after->>'vendor_id' is not distinct from v_before->>'vendor_id'
         and v_after->>'selling_price' is not distinct from v_before->>'selling_price'
         and v_after->>'is_active' is not distinct from v_before->>'is_active'
         and v_after->>'low_stock_threshold' is not distinct from v_before->>'low_stock_threshold'
         and v_after->>'pieces_per_pack' is not distinct from v_before->>'pieces_per_pack'
         and v_after->>'pieces_per_box' is not distinct from v_before->>'pieces_per_box'
         and v_after->>'piece_selling_price' is not distinct from v_before->>'piece_selling_price'
         and v_after->>'pack_selling_price' is not distinct from v_before->>'pack_selling_price'
         and v_after->>'box_selling_price' is not distinct from v_before->>'box_selling_price'
         and v_after->>'default_sale_unit' is not distinct from v_before->>'default_sale_unit'
         and v_after->'tags' is not distinct from v_before->'tags'
      then
        return NEW;
      end if;
    end if;

    -- Soft-delete / reactivate (tables with is_active)
    if TG_TABLE_NAME in ('products', 'vendors', 'categories', 'profiles') then
      v_old_active := v_before->>'is_active';
      v_new_active := v_after->>'is_active';
      if v_new_active is distinct from v_old_active then
        if v_new_active in ('false', 'f') then
          v_action := 'soft_delete';
        elsif v_new_active in ('true', 't') then
          v_action := 'reactivate';
        end if;
      end if;
    end if;

    -- Sale cancel
    if TG_TABLE_NAME = 'sales'
       and (v_after->>'status') is distinct from (v_before->>'status')
       and (v_after->>'status') = 'cancelled'
    then
      v_action := 'cancel';
    end if;
  elsif TG_OP = 'DELETE' then
    v_action := 'delete';
    v_before := to_jsonb(OLD);
    v_after := null;
    v_entity_id := v_before->>'id';
  else
    return null;
  end if;

  v_name := coalesce(
    v_after->>'name',
    v_before->>'name',
    v_after->>'sale_reference',
    v_before->>'sale_reference',
    v_after->>'full_name',
    v_before->>'full_name',
    v_after->>'store_name',
    v_before->>'store_name',
    v_after->>'movement_type',
    v_before->>'movement_type',
    v_entity_id
  );

  v_summary := initcap(replace(v_action, '_', ' '))
    || ' '
    || replace(TG_TABLE_NAME, '_', ' ')
    || case when v_name is not null and v_name <> '' then ': ' || left(v_name, 120) else '' end;

  insert into public.audit_logs (
    actor_id, actor_email, actor_name,
    action, entity_type, entity_id, summary,
    before_data, after_data, meta
  ) values (
    v_actor.actor_id, v_actor.actor_email, v_actor.actor_name,
    v_action, TG_TABLE_NAME, v_entity_id, v_summary,
    v_before, v_after,
    jsonb_build_object('op', TG_OP, 'table', TG_TABLE_NAME)
  );

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;
