-- Admin bulk update of product selling prices (Price Groups workspace).

create or replace function public.bulk_update_selling_prices(p_updates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_row jsonb;
  v_id uuid;
  v_price numeric;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if p_updates is null or jsonb_typeof(p_updates) is distinct from 'array' then
    raise exception 'p_updates must be a JSON array';
  end if;

  for v_row in select value from jsonb_array_elements(p_updates)
  loop
    begin
      v_id := (v_row ->> 'id')::uuid;
    exception
      when others then
        continue;
    end;
    if v_id is null then
      continue;
    end if;
    v_price := greatest(coalesce((v_row ->> 'selling_price')::numeric, 0), 0);

    update public.products
    set
      selling_price = v_price,
      updated_at = now()
    where id = v_id;

    if found then
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('updated', v_updated);
end;
$$;

revoke all on function public.bulk_update_selling_prices(jsonb) from public;
grant execute on function public.bulk_update_selling_prices(jsonb) to authenticated;

comment on function public.bulk_update_selling_prices(jsonb) is
  'Admin: set selling_price for many products. Payload [{id, selling_price}, ...]';
