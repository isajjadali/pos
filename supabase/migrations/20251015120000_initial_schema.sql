-- Dollar World by WABz — initial schema (apply in Supabase SQL editor or CLI)

create extension if not exists "pgcrypto";

-- Settings (single-row pattern)
create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  store_name text not null default 'Dollar World by WABz',
  currency_code text not null default 'PKR',
  default_low_stock_threshold integer not null default 5,
  receipt_footer text,
  label_width_mm numeric(6,2) default 50,
  label_height_mm numeric(6,2) default 30,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (store_name)
select 'Dollar World by WABz'
where not exists (select 1 from public.app_settings);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text,
  phone text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vendors_name_unique on public.vendors (lower(name));

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  external_product_id text,
  name text not null,
  sku text,
  barcode text,
  category_id uuid references public.categories(id),
  vendor_id uuid references public.vendors(id),
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  weighted_avg_cost numeric(12,4) not null default 0 check (weighted_avg_cost >= 0),
  current_stock integer not null default 0 check (current_stock >= 0),
  unprinted_barcode_qty integer not null default 0 check (unprinted_barcode_qty >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  image_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists products_sku_unique on public.products (sku) where sku is not null;
create unique index if not exists products_barcode_unique on public.products (barcode) where barcode is not null;
create index if not exists products_name_idx on public.products using gin (to_tsvector('simple', name));

create table if not exists public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references public.vendors(id),
  receipt_reference text,
  purchase_date date default current_date,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_receipt_items (
  id uuid primary key default gen_random_uuid(),
  stock_receipt_id uuid not null references public.stock_receipts(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_purchase_cost numeric(12,4) not null check (unit_purchase_cost >= 0)
);

create table if not exists public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  stock_receipt_item_id uuid references public.stock_receipt_items(id),
  initial_quantity integer not null check (initial_quantity > 0),
  remaining_quantity integer not null check (remaining_quantity >= 0),
  unit_purchase_cost numeric(12,4) not null check (unit_purchase_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  movement_type text not null,
  quantity_change integer not null,
  previous_quantity integer not null,
  new_quantity integer not null,
  unit_cost numeric(12,4),
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.pos_orders (
  id uuid primary key default gen_random_uuid(),
  order_reference text not null,
  status text not null default 'active' check (status in ('active', 'on_hold', 'completed', 'cancelled')),
  customer_name text,
  subtotal numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pos_orders_reference_unique on public.pos_orders (order_reference);

create table if not exists public.pos_order_items (
  id uuid primary key default gen_random_uuid(),
  pos_order_id uuid not null references public.pos_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_selling_price numeric(12,2) not null,
  line_total numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_reference text not null unique,
  status text not null default 'completed' check (status in ('completed', 'cancelled')),
  subtotal numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  payment_method text not null default 'cash',
  amount_received numeric(12,2),
  change_due numeric(12,2),
  created_by uuid references auth.users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id),
  product_name_snapshot text not null,
  sku_snapshot text,
  barcode_snapshot text,
  quantity integer not null check (quantity > 0),
  unit_selling_price numeric(12,2) not null,
  unit_cost numeric(12,4) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  line_total numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sale_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  sale_item_id uuid not null references public.sale_items(id) on delete cascade,
  inventory_batch_id uuid references public.inventory_batches(id),
  quantity integer not null check (quantity > 0),
  unit_cost numeric(12,4) not null
);

create table if not exists public.barcode_print_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending',
  print_mode text not null,
  requested_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  notes text
);

create table if not exists public.barcode_print_job_items (
  id uuid primary key default gen_random_uuid(),
  barcode_print_job_id uuid not null references public.barcode_print_jobs(id) on delete cascade,
  product_id uuid not null references public.products(id),
  requested_quantity integer not null check (requested_quantity > 0),
  reconciled_quantity integer not null default 0 check (reconciled_quantity >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  status text not null default 'pending',
  total_rows integer not null default 0,
  successful_rows integer not null default 0,
  failed_rows integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- RLS
alter table public.app_settings enable row level security;
alter table public.categories enable row level security;
alter table public.vendors enable row level security;
alter table public.products enable row level security;
alter table public.stock_receipts enable row level security;
alter table public.stock_receipt_items enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.stock_movements enable row level security;
alter table public.pos_orders enable row level security;
alter table public.pos_order_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_cost_allocations enable row level security;
alter table public.barcode_print_jobs enable row level security;
alter table public.barcode_print_job_items enable row level security;
alter table public.import_jobs enable row level security;

create policy "authenticated read write" on public.app_settings for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.categories for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.vendors for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.products for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.stock_receipts for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.stock_receipt_items for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.inventory_batches for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.stock_movements for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.pos_orders for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.pos_order_items for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.sales for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.sale_items for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.sale_cost_allocations for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.barcode_print_jobs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.barcode_print_job_items for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read write" on public.import_jobs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Atomic sale completion to be added in Phase 5 (RPC stub comment)
-- create or replace function public.complete_sale(...) returns uuid language plpgsql security definer as $$ ... $$;
