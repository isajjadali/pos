-- Ensure Realtime delivers INSERT payloads for order bell
alter table public.shopify_order_events replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.shopify_order_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
