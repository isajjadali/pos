-- Target scheduled discounts: all products | by unit price (≤/≥) | specific products.

alter table public.scheduled_sale_discounts
  add column if not exists product_scope text not null default 'all',
  add column if not exists price_op text,
  add column if not exists price_threshold numeric(12, 2),
  add column if not exists product_ids uuid[] not null default '{}';

alter table public.scheduled_sale_discounts
  drop constraint if exists scheduled_sale_discounts_product_scope_check;

alter table public.scheduled_sale_discounts
  add constraint scheduled_sale_discounts_product_scope_check
  check (product_scope in ('all', 'by_price', 'specific'));

alter table public.scheduled_sale_discounts
  drop constraint if exists scheduled_sale_discounts_price_op_check;

alter table public.scheduled_sale_discounts
  add constraint scheduled_sale_discounts_price_op_check
  check (price_op is null or price_op in ('lte', 'gte'));

alter table public.scheduled_sale_discounts
  drop constraint if exists scheduled_sale_discounts_price_threshold_check;

alter table public.scheduled_sale_discounts
  add constraint scheduled_sale_discounts_price_threshold_check
  check (price_threshold is null or price_threshold >= 0);

alter table public.scheduled_sale_discounts
  drop constraint if exists scheduled_sale_discounts_targeting_consistency;

alter table public.scheduled_sale_discounts
  add constraint scheduled_sale_discounts_targeting_consistency
  check (
    (
      product_scope = 'all'
      and (price_op is null)
      and (price_threshold is null)
    )
    or (
      product_scope = 'by_price'
      and price_op in ('lte', 'gte')
      and price_threshold is not null
      and price_threshold >= 0
    )
    or (
      product_scope = 'specific'
      and coalesce(cardinality(product_ids), 0) >= 1
      and (price_op is null)
      and (price_threshold is null)
    )
  );

comment on column public.scheduled_sale_discounts.product_scope is
  'all = whole cart; by_price = lines matching price_op+threshold; specific = product_ids only';
comment on column public.scheduled_sale_discounts.price_op is
  'lte = unit sale price ≤ threshold; gte = unit sale price ≥ threshold';
comment on column public.scheduled_sale_discounts.product_ids is
  'Product UUIDs when product_scope = specific';
