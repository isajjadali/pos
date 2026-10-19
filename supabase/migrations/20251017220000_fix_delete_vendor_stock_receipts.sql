-- Vendor delete: products block delete; stock_receipts keep history with vendor_id cleared.

create or replace function public.delete_vendor_if_unused(p_vendor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  select count(*)::int into v_count
  from public.products
  where vendor_id = p_vendor_id;

  if v_count > 0 then
    raise exception 'Cannot delete vendor: % product(s) still linked. Reassign or delete those products first.', v_count;
  end if;

  update public.stock_receipts
  set vendor_id = null
  where vendor_id = p_vendor_id;

  delete from public.vendors where id = p_vendor_id;
  if not found then
    raise exception 'Vendor not found';
  end if;

  return jsonb_build_object('deleted', true);
end;
$$;
