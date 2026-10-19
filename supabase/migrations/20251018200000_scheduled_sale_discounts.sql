-- Date-range sale discounts: auto-apply on POS during the window (cashier may remove per sale).

create table if not exists public.scheduled_sale_discounts (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  discount_amount numeric(12,2) not null check (discount_amount >= 0),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_sale_discounts_active_dates
  on public.scheduled_sale_discounts (is_active, start_date, end_date);

alter table public.scheduled_sale_discounts enable row level security;

create policy "scheduled_sale_discounts select authenticated"
  on public.scheduled_sale_discounts for select
  using (auth.role() = 'authenticated');

create policy "scheduled_sale_discounts insert admin"
  on public.scheduled_sale_discounts for insert
  with check (public.is_admin());

create policy "scheduled_sale_discounts update admin"
  on public.scheduled_sale_discounts for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "scheduled_sale_discounts delete admin"
  on public.scheduled_sale_discounts for delete
  using (public.is_admin());

comment on table public.scheduled_sale_discounts is
  'Fixed PKR discount applied automatically on POS for sales between start_date and end_date (inclusive).';
