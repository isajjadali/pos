alter table public.products
  add column if not exists is_low_stock boolean
  generated always as (current_stock <= low_stock_threshold) stored;

create index if not exists products_is_low_stock_idx on public.products (is_low_stock) where is_active = true;
