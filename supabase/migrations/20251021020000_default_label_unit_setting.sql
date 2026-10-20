-- App-wide preferred sale / label unit (POS, barcode print, price groups).

alter table public.app_settings
  add column if not exists default_label_unit text not null default 'pack'
    check (default_label_unit in ('piece', 'pack', 'box'));

comment on column public.app_settings.default_label_unit is
  'Preferred unit for POS cart, barcode labels, and price-group primary price: piece | pack | box. Falls back per product if that unit is not configured.';
