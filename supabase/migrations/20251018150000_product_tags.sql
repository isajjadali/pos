-- Free-form product tags (e.g. "missing") for vendor follow-up and catalog filters.

alter table public.products
  add column if not exists tags text[] not null default '{}';

create index if not exists products_tags_gin on public.products using gin (tags);

comment on column public.products.tags is 'Lowercase labels for filtering (missing, pending vendor, etc.)';

create or replace function public.list_product_tags()
returns table (name text, product_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select t as name, count(*)::bigint as product_count
  from public.products p
  cross join lateral unnest(p.tags) as t
  where cardinality(p.tags) > 0
  group by t
  order by t;
$$;

grant execute on function public.list_product_tags() to authenticated;
