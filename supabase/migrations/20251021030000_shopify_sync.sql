-- Shopify product link + sync log + settings (token stays in Edge secrets)

alter table public.products
  add column if not exists shopify_variant_id text null,
  add column if not exists shopify_inventory_item_id text null,
  add column if not exists shopify_product_id text null,
  add column if not exists shopify_last_synced_at timestamptz null;

create index if not exists products_shopify_inventory_item_id_idx
  on public.products (shopify_inventory_item_id)
  where shopify_inventory_item_id is not null;

create index if not exists products_barcode_lower_idx
  on public.products (lower(barcode))
  where barcode is not null and barcode <> '';

alter table public.app_settings
  add column if not exists shopify_enabled boolean not null default false,
  add column if not exists shopify_shop_domain text null,
  add column if not exists shopify_location_id text null;

comment on column public.app_settings.shopify_enabled is
  'When true, POS sales push inventory adjusts to Shopify (Edge secrets required).';
comment on column public.app_settings.shopify_shop_domain is
  'Shopify shop subdomain, e.g. my-store.myshopify.com (or my-store)';
comment on column public.app_settings.shopify_location_id is
  'Shopify Location GID or numeric id for inventory sync';

create table if not exists public.shopify_sync_log (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('outbound', 'inbound')),
  kind text not null,
  product_id uuid null references public.products (id) on delete set null,
  inventory_item_id text null,
  qty_delta integer null,
  external_ref text null,
  notes text null,
  created_at timestamptz not null default now()
);

create index if not exists shopify_sync_log_outbound_recent_idx
  on public.shopify_sync_log (inventory_item_id, qty_delta, created_at desc)
  where direction = 'outbound' and kind = 'inventory_adjust';

alter table public.shopify_sync_log enable row level security;

drop policy if exists "shopify_sync_log select admin" on public.shopify_sync_log;
create policy "shopify_sync_log select admin" on public.shopify_sync_log
  for select using (public.is_admin());

-- Service role / edge writes; authenticated admins can insert via RPC if needed later
drop policy if exists "shopify_sync_log insert admin" on public.shopify_sync_log;
create policy "shopify_sync_log insert admin" on public.shopify_sync_log
  for insert with check (public.is_admin());
