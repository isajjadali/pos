-- Resolve vendor IDs for Products advanced filters (catalog keyword + product count).

create or replace function public.resolve_product_filter_vendor_ids(
  p_catalog_keyword text default null,
  p_count_op text default null,
  p_count_n integer default null
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kw text := nullif(trim(coalesce(p_catalog_keyword, '')), '');
  v_op text := lower(nullif(trim(coalesce(p_count_op, '')), ''));
  v_n integer := p_count_n;
  v_ids uuid[];
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;

  if v_op is not null and v_op not in ('lt', 'lte', 'eq', 'gte', 'gt') then
    raise exception 'Invalid count operator';
  end if;

  if v_kw is null and (v_op is null or v_n is null) then
    return null;
  end if;

  with counts as (
    select p.vendor_id, count(*)::integer as cnt
    from public.products p
    where p.vendor_id is not null
    group by p.vendor_id
  ),
  catalog_hits as (
    select distinct p.vendor_id
    from public.products p
    where v_kw is not null
      and p.vendor_id is not null
      and (
        p.name ilike '%' || v_kw || '%'
        or coalesce(p.sku, '') ilike '%' || v_kw || '%'
        or coalesce(p.barcode, '') ilike '%' || v_kw || '%'
      )
  )
  select coalesce(array_agg(c.vendor_id), '{}'::uuid[])
  into v_ids
  from counts c
  where
    (v_kw is null or c.vendor_id in (select vendor_id from catalog_hits))
    and (
      v_op is null
      or v_n is null
      or case v_op
        when 'lt' then c.cnt < v_n
        when 'lte' then c.cnt <= v_n
        when 'eq' then c.cnt = v_n
        when 'gte' then c.cnt >= v_n
        when 'gt' then c.cnt > v_n
        else true
      end
    );

  return coalesce(v_ids, '{}'::uuid[]);
end;
$$;

revoke all on function public.resolve_product_filter_vendor_ids(text, text, integer) from public;
grant execute on function public.resolve_product_filter_vendor_ids(text, text, integer) to authenticated;
