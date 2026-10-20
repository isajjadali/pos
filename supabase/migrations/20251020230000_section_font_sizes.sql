-- Per-section font sizes for barcode labels (% of auto layout) and receipts (px)
alter table public.app_settings
  add column if not exists label_title_font_size integer not null default 100
    check (label_title_font_size between 70 and 140),
  add column if not exists label_name_font_size integer not null default 100
    check (label_name_font_size between 70 and 140),
  add column if not exists label_barcode_font_size integer not null default 100
    check (label_barcode_font_size between 70 and 140),
  add column if not exists label_price_font_size integer not null default 100
    check (label_price_font_size between 70 and 140),
  add column if not exists receipt_title_font_size integer not null default 17
    check (receipt_title_font_size between 10 and 28),
  add column if not exists receipt_footer_font_size integer not null default 12
    check (receipt_footer_font_size between 8 and 18);

comment on column public.app_settings.label_title_font_size is
  'Store title text scale % (100 = previous auto layout)';
comment on column public.app_settings.label_name_font_size is
  'Product name text scale %';
comment on column public.app_settings.label_barcode_font_size is
  'Barcode HRI text (+ bar height) scale %';
comment on column public.app_settings.label_price_font_size is
  'Price text scale %';
comment on column public.app_settings.receipt_title_font_size is
  'Receipt store title size in px (17 ≈ previous fs+4 at default 13)';
comment on column public.app_settings.receipt_footer_font_size is
  'Receipt footer size in px (12 ≈ previous fs-1 at default 13)';
