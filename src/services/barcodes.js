import { requireSupabase } from "../lib/supabase.js";
import { syncProductCatalogAfterWrite } from "../utils/cacheSync.js";
import { postgrestIlikeOr } from "../utils/textSearch.js";

export async function listProductsForPrinting({ search = "" } = {}) {
  const sb = requireSupabase();
  let q = sb
    .from("products")
    .select(
      "id, name, barcode, sku, external_product_id, selling_price, current_stock, unprinted_barcode_qty, created_at, pieces_per_pack, pieces_per_box, piece_selling_price, pack_selling_price, box_selling_price, default_sale_unit"
    )
    .eq("is_active", true)
    .order("name");
  const orFilter = postgrestIlikeOr(["name", "barcode", "sku", "external_product_id"], search);
  if (orFilter) q = q.or(orFilter);
  // Client paginates / filters in the barcode print UI
  const { data, error } = await q.limit(2000);
  if (error) throw error;
  return data ?? [];
}

export async function reconcilePrint(productId, printMode, requestedQty, reconciledQty, { sync = false } = {}) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("reconcile_barcode_print", {
    p_product_id: productId,
    p_print_mode: printMode,
    p_requested_quantity: requestedQty,
    p_reconciled_quantity: reconciledQty,
  });
  if (error) throw error;
  if (sync) await syncProductCatalogAfterWrite();
  return data;
}

/** After a multi-product print batch — one catalog sync for unprinted qty. */
export async function syncCatalogAfterPrintBatch() {
  await syncProductCatalogAfterWrite();
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
