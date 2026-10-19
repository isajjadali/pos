alter table public.app_settings
  add column if not exists pos_auto_collapse_sidebar boolean not null default true;
