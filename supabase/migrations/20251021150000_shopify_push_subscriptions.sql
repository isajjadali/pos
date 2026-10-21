-- Web Push subscriptions for Shopify order desktop notifications

create table if not exists public.shopify_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shopify_push_subscriptions_user_id_idx
  on public.shopify_push_subscriptions (user_id);

alter table public.shopify_push_subscriptions enable row level security;

drop policy if exists "shopify_push select own or admin" on public.shopify_push_subscriptions;
create policy "shopify_push select own or admin" on public.shopify_push_subscriptions
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "shopify_push insert admin" on public.shopify_push_subscriptions;
create policy "shopify_push insert admin" on public.shopify_push_subscriptions
  for insert with check (public.is_admin());

drop policy if exists "shopify_push update admin" on public.shopify_push_subscriptions;
create policy "shopify_push update admin" on public.shopify_push_subscriptions
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "shopify_push delete admin" on public.shopify_push_subscriptions;
create policy "shopify_push delete admin" on public.shopify_push_subscriptions
  for delete using (public.is_admin());
