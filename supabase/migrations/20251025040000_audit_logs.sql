-- Full audit trail: who changed what, when.
-- Row triggers on core business tables + insert_audit_log() for app-level events.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  actor_email text,
  actor_name text,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text,
  before_data jsonb,
  after_data jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_id_idx on public.audit_logs (actor_id);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_action_idx on public.audit_logs (action);

alter table public.audit_logs enable row level security;

drop policy if exists "admin read audit_logs" on public.audit_logs;
create policy "admin read audit_logs"
  on public.audit_logs for select
  using (public.is_admin());

-- No direct client inserts/updates/deletes — triggers + security definer only
revoke all on table public.audit_logs from public;
grant select on table public.audit_logs to authenticated;

create or replace function public._audit_actor_snapshot()
returns table (actor_id uuid, actor_email text, actor_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return query select null::uuid, null::text, null::text;
    return;
  end if;
  return query
  select
    v_uid,
    (select u.email::text from auth.users u where u.id = v_uid),
    (select p.full_name from public.profiles p where p.id = v_uid);
end;
$$;

create or replace function public.insert_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_summary text default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_actor record;
begin
  if auth.role() is distinct from 'authenticated' and auth.role() is distinct from 'service_role' then
    raise exception 'Not authenticated';
  end if;

  select * into v_actor from public._audit_actor_snapshot();

  insert into public.audit_logs (
    actor_id, actor_email, actor_name,
    action, entity_type, entity_id, summary,
    before_data, after_data, meta
  ) values (
    v_actor.actor_id, v_actor.actor_email, v_actor.actor_name,
    trim(p_action), trim(p_entity_type), nullif(trim(coalesce(p_entity_id, '')), ''),
    nullif(trim(coalesce(p_summary, '')), ''),
    p_before, p_after, coalesce(p_meta, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.insert_audit_log from public;
grant execute on function public.insert_audit_log to authenticated;

-- Generic row change logger
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
begin
  select * into v_actor from public._audit_actor_snapshot();

  if TG_OP = 'INSERT' then
    v_action := 'create';
    v_before := null;
    v_after := to_jsonb(NEW);
    v_entity_id := coalesce(NEW.id::text, null);
  elsif TG_OP = 'UPDATE' then
    v_action := 'update';
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_entity_id := coalesce(NEW.id::text, OLD.id::text);

    -- Products: ignore inventory-only churn (sales / receive update stock often)
    if TG_TABLE_NAME = 'products' then
      if NEW.name is not distinct from OLD.name
         and NEW.sku is not distinct from OLD.sku
         and NEW.barcode is not distinct from OLD.barcode
         and NEW.external_product_id is not distinct from OLD.external_product_id
         and NEW.category_id is not distinct from OLD.category_id
         and NEW.vendor_id is not distinct from OLD.vendor_id
         and NEW.selling_price is not distinct from OLD.selling_price
         and NEW.is_active is not distinct from OLD.is_active
         and NEW.low_stock_threshold is not distinct from OLD.low_stock_threshold
         and NEW.pieces_per_pack is not distinct from OLD.pieces_per_pack
         and NEW.pieces_per_box is not distinct from OLD.pieces_per_box
         and NEW.piece_selling_price is not distinct from OLD.piece_selling_price
         and NEW.pack_selling_price is not distinct from OLD.pack_selling_price
         and NEW.box_selling_price is not distinct from OLD.box_selling_price
         and NEW.default_sale_unit is not distinct from OLD.default_sale_unit
         and NEW.tags is not distinct from OLD.tags
      then
        return NEW;
      end if;
      if NEW.is_active is distinct from OLD.is_active and NEW.is_active = false then
        v_action := 'soft_delete';
      elsif NEW.is_active is distinct from OLD.is_active and NEW.is_active = true then
        v_action := 'reactivate';
      end if;
    end if;

    if TG_TABLE_NAME = 'vendors' and NEW.is_active is distinct from OLD.is_active then
      if NEW.is_active = false then v_action := 'soft_delete';
      else v_action := 'reactivate';
      end if;
    end if;

    if TG_TABLE_NAME = 'categories' and NEW.is_active is distinct from OLD.is_active then
      if NEW.is_active = false then v_action := 'soft_delete';
      else v_action := 'reactivate';
      end if;
    end if;

    if TG_TABLE_NAME = 'profiles' and NEW.is_active is distinct from OLD.is_active then
      if NEW.is_active = false then v_action := 'soft_delete';
      else v_action := 'reactivate';
      end if;
    end if;

    if TG_TABLE_NAME = 'sales' and NEW.status is distinct from OLD.status and NEW.status = 'cancelled' then
      v_action := 'cancel';
    end if;
  elsif TG_OP = 'DELETE' then
    v_action := 'delete';
    v_before := to_jsonb(OLD);
    v_after := null;
    v_entity_id := coalesce(OLD.id::text, null);
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

-- Attach triggers (drop first for idempotency)
drop trigger if exists audit_products on public.products;
create trigger audit_products
  after insert or update or delete on public.products
  for each row execute function public.audit_row_change();

drop trigger if exists audit_vendors on public.vendors;
create trigger audit_vendors
  after insert or update or delete on public.vendors
  for each row execute function public.audit_row_change();

drop trigger if exists audit_categories on public.categories;
create trigger audit_categories
  after insert or update or delete on public.categories
  for each row execute function public.audit_row_change();

drop trigger if exists audit_sales on public.sales;
create trigger audit_sales
  after insert or update or delete on public.sales
  for each row execute function public.audit_row_change();

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change();

drop trigger if exists audit_app_settings on public.app_settings;
create trigger audit_app_settings
  after insert or update or delete on public.app_settings
  for each row execute function public.audit_row_change();

drop trigger if exists audit_scheduled_sale_discounts on public.scheduled_sale_discounts;
create trigger audit_scheduled_sale_discounts
  after insert or update or delete on public.scheduled_sale_discounts
  for each row execute function public.audit_row_change();

drop trigger if exists audit_stock_movements on public.stock_movements;
create trigger audit_stock_movements
  after insert on public.stock_movements
  for each row execute function public.audit_row_change();
