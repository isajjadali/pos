-- Staff directory: auth.users + public.profiles (role / full_name)

create or replace function public.list_staff_users()
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  return query
  select
    u.id,
    u.email::text,
    p.full_name,
    coalesce(p.role, 'sales') as role,
    coalesce(p.created_at, u.created_at) as created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  order by coalesce(p.created_at, u.created_at) desc;
end;
$$;

create or replace function public.admin_update_staff_user(
  p_user_id uuid,
  p_full_name text default null,
  p_role text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if p_user_id is null then
    raise exception 'User id required';
  end if;
  if p_role is not null and p_role not in ('admin', 'sales') then
    raise exception 'Invalid role';
  end if;
  if p_user_id = auth.uid() and p_role is not null and p_role <> 'admin' then
    raise exception 'You cannot remove your own admin access';
  end if;

  insert into public.profiles (id, role, full_name)
  values (
    p_user_id,
    coalesce(p_role, 'sales'),
    nullif(trim(coalesce(p_full_name, '')), '')
  )
  on conflict (id) do update set
    full_name = case
      when p_full_name is null then public.profiles.full_name
      else nullif(trim(p_full_name), '')
    end,
    role = coalesce(p_role, public.profiles.role),
    updated_at = now();
end;
$$;

revoke all on function public.list_staff_users() from public;
revoke all on function public.admin_update_staff_user(uuid, text, text) from public;
grant execute on function public.list_staff_users() to authenticated;
grant execute on function public.admin_update_staff_user(uuid, text, text) to authenticated;
