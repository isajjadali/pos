import { requireSupabase } from "../lib/supabase.js";
import { refreshProductCatalog } from "./productCatalog.js";

const LIST_FIELDS =
  "id, name, external_product_id, selling_price, weighted_avg_cost, current_stock, vendor_id, is_active";

/** Money key for grouping (2 decimal places). */
export function priceGroupKey(price) {
  const n = Math.round((Number(price) || 0) * 100) / 100;
  return n.toFixed(2);
}

export async function listProductsForPriceGroups({ activeOnly = true } = {}) {
  const sb = requireSupabase();
  let q = sb
    .from("products")
    .select(LIST_FIELDS)
    .order("weighted_avg_cost", { ascending: true });
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/**
 * Bulk set selling prices.
 * @param {Array<{ id: string, selling_price: number }>} updates
 */
export async function bulkUpdateSellingPrices(updates) {
  const sb = requireSupabase();
  const payload = (updates ?? [])
    .filter((u) => u?.id)
    .map((u) => ({
      id: u.id,
      selling_price: Math.max(0, Number(u.selling_price) || 0),
    }));
  if (!payload.length) return { updated: 0 };

  const chunkSize = 200;
  let updated = 0;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { data, error } = await sb.rpc("bulk_update_selling_prices", { p_updates: chunk });
    if (error) throw error;
    updated += Number(data?.updated) || 0;
  }
  await refreshProductCatalog().catch(() => {});
  return { updated };
}
