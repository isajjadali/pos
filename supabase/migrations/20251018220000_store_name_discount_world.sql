-- Rebrand default store name: Discount World by WABz

alter table public.app_settings
  alter column store_name set default 'Discount World by WABz';

update public.app_settings
set store_name = 'Discount World by WABz',
    updated_at = now()
where store_name = 'Dollar World by WABz';
