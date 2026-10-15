-- One cart line per product per order; merge existing duplicates

do $$
declare
  r record;
  v_keep_id uuid;
  v_total_qty integer;
begin
  for r in
    select pos_order_id, product_id
    from public.pos_order_items
    group by pos_order_id, product_id
    having count(*) > 1
  loop
    select sum(quantity)::int into v_total_qty
    from public.pos_order_items
    where pos_order_id = r.pos_order_id and product_id = r.product_id;

    select id into v_keep_id
    from public.pos_order_items
    where pos_order_id = r.pos_order_id and product_id = r.product_id
    order by created_at
    limit 1;

    delete from public.pos_order_items
    where pos_order_id = r.pos_order_id
      and product_id = r.product_id
      and id <> v_keep_id;

    update public.pos_order_items
    set quantity = v_total_qty,
        line_total = v_total_qty * unit_selling_price
    where id = v_keep_id;
  end loop;
end $$;

create unique index if not exists pos_order_items_order_product_unique
  on public.pos_order_items (pos_order_id, product_id);
