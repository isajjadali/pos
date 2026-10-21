-- Shopify Hub Lite: order events, price cache, media log

alter table public.products
  add column if not exists shopify_price numeric(12, 2) null;

comment on column public.products.shopify_price is
  'Cached Shopify online variant price (PKR). Source of truth is Shopify; never overwrites POS sell prices.';

create table if not exists public.shopify_order_events (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text not null,
  order_name text null,
  total_amount numeric(12, 2) null,
  currency text null,
  customer_name text null,
  financial_status text null,
  fulfillment_status text null,
  payload jsonb null,
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (shopify_order_id)
);

create index if not exists shopify_order_events_created_at_idx
  on public.shopify_order_events (created_at desc);

create index if not exists shopify_order_events_unread_idx
  on public.shopify_order_events (created_at desc)
  where read_at is null;

alter table public.shopify_order_events enable row level security;

drop policy if exists "shopify_order_events select admin" on public.shopify_order_events;
create policy "shopify_order_events select admin" on public.shopify_order_events
  for select using (public.is_admin());

drop policy if exists "shopify_order_events update admin" on public.shopify_order_events;
create policy "shopify_order_events update admin" on public.shopify_order_events
  for update using (public.is_admin()) with check (public.is_admin());

-- Inserts come from Edge (service role); no insert policy for anon/authenticated

create table if not exists public.shopify_media_log (
  id uuid primary key default gen_random_uuid(),
  product_id uuid null references public.products (id) on delete set null,
  filename text not null,
  status text not null check (status in ('ok', 'error', 'skipped')),
  notes text null,
  created_at timestamptz not null default now()
);

create index if not exists shopify_media_log_created_at_idx
  on public.shopify_media_log (created_at desc);

alter table public.shopify_media_log enable row level security;

drop policy if exists "shopify_media_log select admin" on public.shopify_media_log;
create policy "shopify_media_log select admin" on public.shopify_media_log
  for select using (public.is_admin());

drop policy if exists "shopify_media_log insert admin" on public.shopify_media_log;
create policy "shopify_media_log insert admin" on public.shopify_media_log
  for insert with check (public.is_admin());

-- Realtime for in-app order bell
do $$
begin
  alter publication supabase_realtime add table public.shopify_order_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
