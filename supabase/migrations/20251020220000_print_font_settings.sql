-- Receipt font family + barcode label font family / size scale (% of auto layout)
alter table public.app_settings
  add column if not exists receipt_font_family text not null default 'consolas',
  add column if not exists label_font_family text not null default 'arial',
  add column if not exists label_font_size integer not null default 100
    check (label_font_size between 70 and 140);

comment on column public.app_settings.receipt_font_family is
  'CSS font key for receipt preview / browser print (consolas = previous default)';
comment on column public.app_settings.label_font_family is
  'Preview font key for barcode labels (arial = previous default; Zebra still uses scalable font 0)';
comment on column public.app_settings.label_font_size is
  'Percent scale for auto-computed label text sizes (100 = previous layout)';
