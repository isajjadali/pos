import { requireSupabase } from "../lib/supabase.js";
import { onlineOrOfflineWrite, onlineOrOfflineRead } from "./offlineGuard.js";
import { offlineBulkUpdateSellingPrices } from "./adminOfflineApply.js";
import { useProductCacheStore } from "../stores/productCache.js";
import { syncProductCatalogAfterWrite } from "../utils/cacheSync.js";
import { toRaw } from "vue";

const LIST_FIELDS =
  "id, name, external_product_id, selling_price, weighted_avg_cost, current_stock, vendor_id, is_active, pieces_per_pack, pieces_per_box, piece_selling_price, pack_selling_price, box_selling_price, default_sale_unit, created_at";

/** Money key for grouping (2 decimal places). */
export function priceGroupKey(price) {
  const n = Math.round((Number(price) || 0) * 100) / 100;
  return n.toFixed(2);
}

function listProductsForPriceGroupsLocal({ activeOnly = true } = {}) {
  let rows = toRaw(useProductCacheStore().products) || [];
  if (activeOnly) rows = rows.filter((p) => p.is_active !== false);
  return [...rows].sort(
    (a, b) => Number(a.weighted_avg_cost || 0) - Number(b.weighted_avg_cost || 0)
  );
}

export async function listProductsForPriceGroups(opts = {}) {
  return onlineOrOfflineRead(
    async () => {
      const { activeOnly = true } = opts;
      const sb = requireSupabase();
      let q = sb
        .from("products")
        .select(LIST_FIELDS)
        .order("weighted_avg_cost", { ascending: true });
      if (activeOnly) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    () => listProductsForPriceGroupsLocal(opts)
  );
}

/**
 * Bulk set selling prices (primary unit + catalog selling_price).
 * @param {Array<{ id: string, selling_price: number, target_unit?: 'piece'|'pack'|'box' }>} updates
 */
export async function bulkUpdateSellingPrices(updates) {
  const result = await onlineOrOfflineWrite(
    () => bulkUpdateSellingPricesOnline(updates),
    () => offlineBulkUpdateSellingPrices(updates),
    { timeoutMs: 30000 }
  );
  await syncProductCatalogAfterWrite();
  return result;
}

export async function bulkUpdateSellingPricesOnline(updates) {
  const sb = requireSupabase();
  const payload = (updates ?? [])
    .filter((u) => u?.id)
    .map((u) => {
      const row = {
        id: u.id,
        selling_price: Math.max(0, Number(u.selling_price) || 0),
      };
      const unit = String(u.target_unit || "").toLowerCase();
      if (unit === "piece" || unit === "pack" || unit === "box") {
        row.target_unit = unit;
      }
      return row;
    });
  if (!payload.length) return { updated: 0 };

  const chunkSize = 200;
  let updated = 0;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { data, error } = await sb.rpc("bulk_update_selling_prices", { p_updates: chunk });
    if (error) throw error;
    updated += Number(data?.updated) || 0;
  }
  return { updated };
}
