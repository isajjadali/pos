-- Natural sort key for Product IDs like AR-10, AR-11, AR-100 (not lexicographic AR-10, AR-100, AR-11).
create or replace function public.external_product_id_sort_key(t text)
returns text
language sql
immutable
as $$
  select case
    when t is null or btrim(t) = '' then null
    when t ~ '^(.*)-([0-9]+)$' then
      lower((regexp_match(t, '^(.*)-([0-9]+)$'))[1])
      || '-'
      || lpad((regexp_match(t, '^(.*)-([0-9]+)$'))[2], 12, '0')
    else lower(t)
  end;
$$;

alter table public.products
  add column if not exists external_product_id_sort text
  generated always as (public.external_product_id_sort_key(external_product_id)) stored;

create index if not exists products_external_product_id_sort_idx
  on public.products (external_product_id_sort);
