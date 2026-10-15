import { requireSupabase } from "../lib/supabase.js";

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
