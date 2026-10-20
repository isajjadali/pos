-- Price Groups: apply draft price to primary sell unit (pack when configured),
-- keep piece/pack/box columns + catalog selling_price in sync.

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
  v_target text;
  v_pack integer;
  v_box integer;
  v_default text;
  v_piece numeric;
  v_pack_price numeric;
  v_box_price numeric;
  v_catalog numeric;
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

    select
      greatest(coalesce(pieces_per_pack, 1), 1),
      pieces_per_box,
      coalesce(nullif(trim(default_sale_unit), ''), 'piece'),
      coalesce(piece_selling_price, selling_price, 0),
      coalesce(pack_selling_price, selling_price, 0),
      box_selling_price
    into v_pack, v_box, v_default, v_piece, v_pack_price, v_box_price
    from public.products
    where id = v_id;

    if not found then
      continue;
    end if;

    v_target := lower(coalesce(nullif(trim(v_row ->> 'target_unit'), ''), ''));
    if v_target not in ('piece', 'pack', 'box') then
      -- Same rule as POS default: pack when pack size > 1
      if v_pack > 1 then
        v_target := 'pack';
      elsif v_default = 'box' and v_box is not null and v_box > 0 then
        v_target := 'box';
      else
        v_target := 'piece';
      end if;
    end if;

    if v_target = 'pack' and v_pack <= 1 then
      v_target := 'piece';
    end if;
    if v_target = 'box' and (v_box is null or v_box <= 0) then
      v_target := case when v_pack > 1 then 'pack' else 'piece' end;
    end if;

    if v_target = 'pack' then
      v_pack_price := v_price;
      v_default := 'pack';
    elsif v_target = 'box' then
      v_box_price := v_price;
      v_default := 'box';
    else
      v_piece := v_price;
      if v_pack <= 1 then
        v_default := 'piece';
      end if;
    end if;

    -- Catalog / label price follows default_sale_unit after update
    if v_default = 'pack' then
      v_catalog := v_pack_price;
    elsif v_default = 'box' and v_box_price is not null then
      v_catalog := v_box_price;
    else
      v_catalog := v_piece;
      v_default := 'piece';
    end if;

    update public.products
    set
      selling_price = v_catalog,
      piece_selling_price = v_piece,
      pack_selling_price = v_pack_price,
      box_selling_price = v_box_price,
      default_sale_unit = v_default,
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
  'Admin: set primary unit sale price. Payload [{id, selling_price, target_unit?}, ...]. Pack products update pack_selling_price; piece-only update piece. Catalog selling_price follows default_sale_unit.';
