import { requireSupabase } from "../lib/supabase.js";
import { findProductByCodeCached, isProductCatalogReady, searchProductsCached } from "./productCatalog.js";

export async function listOpenOrders() {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("pos_orders")
    .select("*")
    .in("status", ["active", "on_hold"])
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createOrder() {
  const sb = requireSupabase();
  const ref = `O${Date.now()}`;
  const { data, error } = await sb
    .from("pos_orders")
    .insert({
      order_reference: ref,
      status: "active",
      subtotal: 0,
      total_amount: 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getOrder(orderId) {
  const sb = requireSupabase();
  const { data: order, error } = await sb.from("pos_orders").select("*").eq("id", orderId).single();
  if (error) throw error;
  const { data: items, error: ie } = await sb
    .from("pos_order_items")
    .select("*, products(name, barcode, sku, current_stock, selling_price)")
    .eq("pos_order_id", orderId);
  if (ie) throw ie;
  return { order, items: items ?? [] };
}

export async function recalcOrderTotals(orderId) {
  const sb = requireSupabase();
  const { items, order } = await getOrder(orderId);
  const subtotal = items.reduce((s, i) => s + Number(i.line_total), 0);
  const discount = Number(order.discount_amount) || 0;
  const { error } = await sb
    .from("pos_orders")
    .update({
      subtotal,
      total_amount: Math.max(subtotal - discount, 0),
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (error) throw error;
  return subtotal - discount;
}

export async function setOrderStatus(orderId, status) {
  const sb = requireSupabase();
  const { error } = await sb
    .from("pos_orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", orderId);
  if (error) throw error;
}

export async function cancelOrder(orderId) {
  return setOrderStatus(orderId, "cancelled");
}

export async function addProductToOrder(orderId, product, addQty = 1) {
  const sb = requireSupabase();
  const delta = Math.max(1, Math.floor(Number(addQty) || 1));
  const { data: rows, error: fetchError } = await sb
    .from("pos_order_items")
    .select("*")
    .eq("pos_order_id", orderId)
    .eq("product_id", product.id)
    .order("created_at", { ascending: true });
  if (fetchError) throw fetchError;

  const list = rows ?? [];
  if (list.length > 0) {
    const primary = list[0];
    const mergedExtra = list.slice(1).reduce((s, i) => s + Number(i.quantity), 0);
    if (list.length > 1) {
      const dupIds = list.slice(1).map((i) => i.id);
      const { error: delError } = await sb.from("pos_order_items").delete().in("id", dupIds);
      if (delError) throw delError;
    }
    const qty = Number(primary.quantity) + mergedExtra + delta;
    const unit = Number(primary.unit_selling_price);
    const { error } = await sb
      .from("pos_order_items")
      .update({ quantity: qty, line_total: qty * unit })
      .eq("id", primary.id);
    if (error) throw error;
  } else {
    const price = Number(product.selling_price) || 0;
    const { error } = await sb.from("pos_order_items").insert({
      pos_order_id: orderId,
      product_id: product.id,
      quantity: delta,
      unit_selling_price: price,
      line_total: price * delta,
    });
    if (error) throw error;
  }
  await recalcOrderTotals(orderId);
}

export async function updateOrderItemQty(itemId, orderId, quantity) {
  const sb = requireSupabase();
  const { data: item, error } = await sb.from("pos_order_items").select("*").eq("id", itemId).single();
  if (error) throw error;
  const qty = Math.max(1, Math.floor(quantity));
  const { error: ue } = await sb
    .from("pos_order_items")
    .update({ quantity: qty, line_total: qty * Number(item.unit_selling_price) })
    .eq("id", itemId);
  if (ue) throw ue;
  await recalcOrderTotals(orderId);
}

export async function removeOrderItem(itemId, orderId) {
  const sb = requireSupabase();
  const { error } = await sb.from("pos_order_items").delete().eq("id", itemId);
  if (error) throw error;
  await recalcOrderTotals(orderId);
}

export async function findProductByBarcode(barcode) {
  const term = String(barcode ?? "").trim();
  if (!term) return null;
  if (isProductCatalogReady()) {
    return findProductByCodeCached(term);
  }
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("products")
    .select("id, name, barcode, sku, external_product_id, selling_price, current_stock")
    .eq("is_active", true)
    .or(`barcode.eq.${term},sku.eq.${term},external_product_id.eq.${term}`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function searchProductsForPos(term) {
  const q = String(term ?? "").trim();
  if (!q) return [];
  if (isProductCatalogReady()) {
    return searchProductsCached(q);
  }
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("products")
    .select("id, name, barcode, sku, selling_price, current_stock")
    .eq("is_active", true)
    .or(
      `name.ilike.%${q}%,barcode.ilike.%${q}%,sku.ilike.%${q}%,external_product_id.ilike.%${q}%`
    )
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

/** Instant search when catalog is loaded (no await). */
export function searchProductsForPosLocal(term) {
  if (!isProductCatalogReady()) return null;
  return searchProductsCached(term);
}

export async function setOrderDiscount(orderId, discount) {
  const sb = requireSupabase();
  const { order, items } = await getOrder(orderId);
  const subtotal = items.reduce((s, i) => s + Number(i.line_total), 0);
  const d = Math.max(0, Number(discount) || 0);
  const { error } = await sb
    .from("pos_orders")
    .update({
      discount_amount: d,
      subtotal,
      total_amount: Math.max(subtotal - d, 0),
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (error) throw error;
}

export async function completeSale(orderId, { discount = 0, amountReceived = 0 }) {
  await setOrderDiscount(orderId, discount);
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("complete_pos_sale", {
    p_pos_order_id: orderId,
    p_discount_amount: Number(discount) || 0,
    p_amount_received: Number(amountReceived) || 0,
  });
  if (error) throw error;
  return data;
}

/** Single API call at checkout — cart lives in browser until then. */
export async function completeSaleFromCart(lines, { discount = 0, amountReceived = 0 }) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("complete_sale_from_cart", {
    p_items: lines,
    p_discount_amount: Number(discount) || 0,
    p_amount_received: Number(amountReceived) || 0,
  });
  if (error) throw error;
  return data;
}
