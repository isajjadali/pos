alter table public.app_settings
  add column if not exists receipt_header text,
  add column if not exists receipt_paper_width integer not null default 300 check (receipt_paper_width between 240 and 400),
  add column if not exists receipt_font_size integer not null default 13 check (receipt_font_size between 10 and 18),
  add column if not exists receipt_show_change boolean not null default true,
  add column if not exists receipt_show_payment boolean not null default true;
