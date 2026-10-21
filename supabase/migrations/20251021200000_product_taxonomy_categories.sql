-- Product category taxonomy (deep tree) + stable id link on local categories.

create table if not exists public.taxonomy_nodes (
  id uuid primary key default gen_random_uuid(),
  taxonomy_gid text not null unique,
  name text not null,
  full_name text not null,
  parent_gid text,
  level integer not null default 0,
  search_text text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists taxonomy_nodes_level_idx
  on public.taxonomy_nodes (level);
create index if not exists taxonomy_nodes_parent_gid_idx
  on public.taxonomy_nodes (parent_gid);
create index if not exists taxonomy_nodes_full_name_idx
  on public.taxonomy_nodes (full_name);

alter table public.categories
  add column if not exists taxonomy_gid text;

create unique index if not exists categories_taxonomy_gid_uidx
  on public.categories (taxonomy_gid)
  where taxonomy_gid is not null;

alter table public.taxonomy_nodes enable row level security;

drop policy if exists "authenticated read taxonomy" on public.taxonomy_nodes;
create policy "authenticated read taxonomy"
  on public.taxonomy_nodes
  for select
  using (auth.role() = 'authenticated');

-- Writes only via service role / seed script (no authenticated insert policy).

comment on table public.taxonomy_nodes is
  'Product taxonomy nodes (seeded). Used for category suggestions.';
comment on column public.categories.taxonomy_gid is
  'Optional link to taxonomy_nodes.taxonomy_gid when category came from taxonomy.';
