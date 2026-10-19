import { requireSupabase } from "../lib/supabase.js";
import { refreshProductCatalog } from "./productCatalog.js";

export async function listStockMovements({ productId = null, page = 1, pageSize = 30 } = {}) {
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
}

export async function receiveStock({ productId, quantity, unitCost, vendorId, notes }) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("receive_stock", {
    p_product_id: productId,
    p_quantity: Math.floor(Number(quantity)),
    p_unit_cost: Number(unitCost) || 0,
    p_vendor_id: vendorId || null,
    p_notes: notes || null,
  });
  if (error) throw error;
  await refreshProductCatalog().catch(() => {});
  return data;
}

export async function adjustStock({ productId, quantityChange, movementType, notes }) {
  const sb = requireSupabase();
  const { error } = await sb.rpc("adjust_stock", {
    p_product_id: productId,
    p_quantity_change: Math.floor(Number(quantityChange)),
    p_movement_type: movementType,
    p_notes: notes || null,
  });
  if (error) throw error;
  await refreshProductCatalog().catch(() => {});
}

/** Set on-hand quantity to an exact value (records stock_movements correction). */
export async function setProductStock(productId, newQuantity, notes) {
  const sb = requireSupabase();
  const { data: row, error: fetchError } = await sb
    .from("products")
    .select("current_stock")
    .eq("id", productId)
    .single();
  if (fetchError) throw fetchError;
  const prev = Math.floor(Number(row.current_stock) || 0);
  const target = Math.max(0, Math.floor(Number(newQuantity) || 0));
  const delta = target - prev;
  if (delta === 0) return target;
  await adjustStock({
    productId,
    quantityChange: delta,
    movementType: "correction",
    notes: notes || "Stock updated from Products",
  });
  return target;
}

export async function listLowStockProducts() {
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
}
