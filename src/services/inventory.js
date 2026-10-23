import { requireSupabase } from "../lib/supabase.js";
import { onlineOrOfflineWrite, onlineOrOfflineRead } from "./offlineGuard.js";
import {
  offlineReceiveStock,
  offlineAdjustStock,
  offlineSetProductStock,
} from "./adminOfflineApply.js";
import { useProductCacheStore } from "../stores/productCache.js";
import { syncProductCatalogAfterWrite } from "../utils/cacheSync.js";
import { toRaw } from "vue";

export async function listStockMovements({ productId = null, page = 1, pageSize = 30 } = {}) {
  return onlineOrOfflineRead(
    async () => {
      const sb = requireSupabase();
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      let q = sb
        .from("stock_movements")
        .select("*, products(name, barcode)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (productId) q = q.eq("product_id", productId);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0 };
    },
    () => ({ rows: [], total: 0 })
  );
}

export async function receiveStock(
  { productId, quantity, unitCost, vendorId, notes },
  { sync = true } = {}
) {
  const data = await onlineOrOfflineWrite(async () => {
    const sb = requireSupabase();
    const { data, error } = await sb.rpc("receive_stock", {
      p_product_id: productId,
      p_quantity: Math.floor(Number(quantity)),
      p_unit_cost: Number(unitCost) || 0,
      p_vendor_id: vendorId || null,
      p_notes: notes || null,
    });
    if (error) throw error;
    return data;
  }, () => offlineReceiveStock({ productId, quantity, unitCost, vendorId, notes }));
  if (sync) await syncProductCatalogAfterWrite();
  return data;
}

export async function adjustStock(
  { productId, quantityChange, movementType, notes },
  { sync = true } = {}
) {
  await onlineOrOfflineWrite(async () => {
    const sb = requireSupabase();
    const { error } = await sb.rpc("adjust_stock", {
      p_product_id: productId,
      p_quantity_change: Math.floor(Number(quantityChange)),
      p_movement_type: movementType,
      p_notes: notes || null,
    });
    if (error) throw error;
  }, () => offlineAdjustStock({ productId, quantityChange, movementType, notes }));
  if (sync) await syncProductCatalogAfterWrite();
}

/** Set on-hand quantity to an exact value (records stock_movements correction). */
export async function setProductStock(productId, newQuantity, notes, { sync = true } = {}) {
  const target = await onlineOrOfflineWrite(async () => {
    const sb = requireSupabase();
    const { data: row, error: fetchError } = await sb
      .from("products")
      .select("current_stock")
      .eq("id", productId)
      .single();
    if (fetchError) throw fetchError;
    const prev = Math.floor(Number(row.current_stock) || 0);
    const next = Math.max(0, Math.floor(Number(newQuantity) || 0));
    const delta = next - prev;
    if (delta === 0) return next;
    const { error } = await sb.rpc("adjust_stock", {
      p_product_id: productId,
      p_quantity_change: delta,
      p_movement_type: "correction",
      p_notes: notes || "Stock updated from Products",
    });
    if (error) throw error;
    return next;
  }, () => offlineSetProductStock(productId, newQuantity, notes));
  if (sync) await syncProductCatalogAfterWrite();
  return target;
}

function listLowStockLocal() {
  const products = toRaw(useProductCacheStore().products) || [];
  return products
    .filter(
      (p) =>
        p.is_active !== false &&
        Number(p.current_stock) <= Number(p.low_stock_threshold ?? 5)
    )
    .sort((a, b) => Number(a.current_stock) - Number(b.current_stock))
    .slice(0, 50);
}

export async function listLowStockProducts() {
  return onlineOrOfflineRead(async () => {
    const sb = requireSupabase();
    const { data, error } = await sb
      .from("products")
      .select("id, name, barcode, current_stock, low_stock_threshold, selling_price")
      .eq("is_active", true)
      .eq("is_low_stock", true)
      .order("current_stock")
      .limit(50);
    if (error) throw error;
    return data ?? [];
  }, listLowStockLocal);
}
