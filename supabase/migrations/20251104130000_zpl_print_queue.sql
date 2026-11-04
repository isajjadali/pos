-- Cloud → shop-PC label print queue (ZPL spool). Reconcile/unprinted qty stays on barcode_print_jobs.

create table if not exists public.print_stations (
  id text primary key,
  name text not null,
  host_name text,
  printer_name text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.zpl_print_queue (
  id uuid primary key default gen_random_uuid(),
  zpl text not null,
  label_count integer not null default 1 check (label_count > 0),
  status text not null default 'pending'
    check (status in ('pending', 'printing', 'printed', 'failed')),
  error text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  printed_at timestamptz,
  station_id text references public.print_stations (id) on delete set null
);

create index if not exists zpl_print_queue_pending_created_idx
  on public.zpl_print_queue (created_at)
  where status = 'pending';

create index if not exists zpl_print_queue_created_by_idx
  on public.zpl_print_queue (created_by, created_at desc);

alter table public.print_stations enable row level security;
alter table public.zpl_print_queue enable row level security;

-- Browser: read stations (online?), enqueue jobs, watch own job status
drop policy if exists "authenticated read print_stations" on public.print_stations;
create policy "authenticated read print_stations"
  on public.print_stations for select
  to authenticated
  using (true);

drop policy if exists "authenticated insert zpl_print_queue" on public.zpl_print_queue;
create policy "authenticated insert zpl_print_queue"
  on public.zpl_print_queue for insert
  to authenticated
  with check (auth.uid() = created_by);

drop policy if exists "authenticated read own zpl_print_queue" on public.zpl_print_queue;
create policy "authenticated read own zpl_print_queue"
  on public.zpl_print_queue for select
  to authenticated
  using (auth.uid() = created_by);

-- Shop agent (service role) bypasses RLS; claim RPC is security definer for clarity

create or replace function public.claim_zpl_print_job(p_station_id text)
returns public.zpl_print_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.zpl_print_queue;
begin
  if p_station_id is null or length(trim(p_station_id)) = 0 then
    raise exception 'station id required';
  end if;

  select q.*
  into job
  from public.zpl_print_queue q
  where q.status = 'pending'
  order by q.created_at asc
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.zpl_print_queue
  set
    status = 'printing',
    claimed_at = now(),
    station_id = p_station_id,
    error = null
  where id = job.id
  returning * into job;

  return job;
end;
$$;

revoke all on function public.claim_zpl_print_job(text) from public;
grant execute on function public.claim_zpl_print_job(text) to service_role;

create or replace function public.upsert_print_station(
  p_id text,
  p_name text,
  p_host_name text default null,
  p_printer_name text default null
)
returns public.print_stations
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.print_stations;
begin
  insert into public.print_stations (id, name, host_name, printer_name, last_seen_at)
  values (
    p_id,
    coalesce(nullif(trim(p_name), ''), p_id),
    p_host_name,
    p_printer_name,
    now()
  )
  on conflict (id) do update
  set
    name = excluded.name,
    host_name = coalesce(excluded.host_name, print_stations.host_name),
    printer_name = coalesce(excluded.printer_name, print_stations.printer_name),
    last_seen_at = now()
  returning * into row;

  return row;
end;
$$;

revoke all on function public.upsert_print_station(text, text, text, text) from public;
grant execute on function public.upsert_print_station(text, text, text, text) to service_role;
