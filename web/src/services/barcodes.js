import { requireSupabase } from "../lib/supabase.js";

export async function listProductsForPrinting({ search = "" } = {}) {
  const sb = requireSupabase();
  let q = sb
    .from("products")
    .select(
      "id, name, barcode, sku, external_product_id, selling_price, current_stock, unprinted_barcode_qty"
    )
    .eq("is_active", true)
    .order("name");
  if (search.trim()) {
    q = q.or(`name.ilike.%${search.trim()}%,barcode.ilike.%${search.trim()}%`);
  }
  // Client paginates / filters in the barcode print UI
  const { data, error } = await q.limit(2000);
  if (error) throw error;
  return data ?? [];
}

export async function reconcilePrint(productId, printMode, requestedQty, reconciledQty) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("reconcile_barcode_print", {
    p_product_id: productId,
    p_print_mode: printMode,
    p_requested_quantity: requestedQty,
    p_reconciled_quantity: reconciledQty,
  });
  if (error) throw error;
  return data;
}

export async function listPrintJobs(limit = 30) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("barcode_print_jobs")
    .select("*, barcode_print_job_items(*, products(name))")
    .order("requested_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
