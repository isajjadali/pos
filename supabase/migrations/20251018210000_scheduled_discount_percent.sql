-- Percentage option for scheduled sale discounts (percent wins when both set).

alter table public.scheduled_sale_discounts
  add column if not exists discount_percent numeric(5,2) not null default 0
  check (discount_percent >= 0 and discount_percent <= 100);

comment on column public.scheduled_sale_discounts.discount_percent is
  'When > 0, POS uses percent of subtotal; otherwise discount_amount (PKR). If both set, percent applies.';
