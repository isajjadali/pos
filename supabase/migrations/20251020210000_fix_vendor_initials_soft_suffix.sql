-- Soft suffixes (Traders, Shop, …) only drop when ≥2 core words remain.
-- Fixes "Hashmi Traders" → HT (was HA from "Hashmi" alone).

create or replace function public.vendor_initials_prefix(p_vendor_name text)
returns text
language plpgsql
immutable
as $$
declare
  v_stop text[] := array['and', 'of', 'the', 'by', '&', 'co', 'ltd', 'llc'];
  v_suffix text[] := array[
    'international', 'traders', 'trading', 'company', 'shop', 'store', 'market'
  ];
  v_parts text[];
  v_raw text[] := '{}';
  v_core text[] := '{}';
  v_tokens text[];
  v_word text;
  v_i int;
  v_n int;
  v_out text := '';
begin
  v_parts := regexp_split_to_array(
    btrim(regexp_replace(coalesce(p_vendor_name, ''), '[^a-zA-Z0-9\s]', ' ', 'g')),
    '\s+'
  );

  foreach v_word in array v_parts loop
    if v_word is null or v_word = '' then
      continue;
    end if;
    if lower(v_word) = any (v_stop) then
      continue;
    end if;
    v_raw := array_append(v_raw, v_word);
  end loop;

  if coalesce(array_length(v_raw, 1), 0) = 0 then
    return 'XX';
  end if;

  foreach v_word in array v_raw loop
    if not (lower(v_word) = any (v_suffix)) then
      v_core := array_append(v_core, v_word);
    end if;
  end loop;

  -- Need ≥2 solid words before dropping soft suffixes
  if coalesce(array_length(v_core, 1), 0) >= 2 then
    v_tokens := v_core;
  else
    v_tokens := v_raw;
  end if;

  if array_length(v_tokens, 1) = 1 then
    return upper(substr(v_tokens[1], 1, 2));
  end if;

  if array_length(v_tokens, 1) >= 3 then
    v_n := 3;
  else
    v_n := 2;
  end if;

  for v_i in 1 .. least(v_n, array_length(v_tokens, 1)) loop
    v_out := v_out || upper(substr(v_tokens[v_i], 1, 1));
  end loop;

  return v_out;
end;
$$;
