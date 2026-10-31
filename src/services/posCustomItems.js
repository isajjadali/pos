import { requireSupabase } from "../lib/supabase.js";
import { createProduct } from "./products.js";
import { toTitleCase } from "../utils/titleCase.js";
import { sanitizeCustomItemName } from "../utils/posCustomItemHistory.js";

const SELECT_COLS =
  "id, name, name_normalized, last_unit_price, times_sold, qty_sold, amount_sold, first_sold_at, last_sold_at, status, promoted_product_id, created_at, updated_at";

/**
 * Active custom items for POS autocomplete (newest first).
 * @param {{ limit?: number }} [opts]
 */
export async function listActiveCustomItemsForPos({ limit = 80 } = {}) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("pos_custom_items")
    .select("id, name, last_unit_price, last_sold_at, times_sold")
    .eq("status", "active")
    .order("last_sold_at", { ascending: false, nullsFirst: false })
    .limit(Math.max(1, Math.min(200, Number(limit) || 80)));
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    unit_selling_price: Math.max(0, Number(r.last_unit_price) || 0),
    usedAt: r.last_sold_at ? Date.parse(r.last_sold_at) || 0 : 0,
    times_sold: Number(r.times_sold) || 0,
  }));
}

/**
 * Admin listing with optional filters (client may further filter).
 * @param {{ status?: string | null, search?: string, limit?: number }} [opts]
 */
export async function listPosCustomItems({ status = null, search = "", limit = 500 } = {}) {
  const sb = requireSupabase();
  let query = sb
    .from("pos_custom_items")
    .select(SELECT_COLS)
    .order("last_sold_at", { ascending: false, nullsFirst: false })
    .limit(Math.max(1, Math.min(2000, Number(limit) || 500)));

  if (status && status !== "all") {
    query = query.eq("status", status);
  }
  const q = String(search || "").trim();
  if (q) {
    query = query.ilike("name", `%${q.replace(/%/g, "\\%")}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function archivePosCustomItem(id) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("pos_custom_items")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(SELECT_COLS)
    .single();
  if (error) throw error;
  return data;
}

export async function reactivatePosCustomItem(id) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("pos_custom_items")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("promoted_product_id", null)
    .select(SELECT_COLS)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Create a real catalog product from a custom item and mark it promoted.
 * @param {object} customRow
 * @param {{ name?: string, selling_price?: number, vendor_id?: string | null, category_id?: string | null, initial_qty?: number, purchase_price?: number }} payload
 */
export async function promotePosCustomItemToProduct(customRow, payload = {}) {
  if (!customRow?.id) throw new Error("Custom item required");
  if (customRow.status === "promoted" && customRow.promoted_product_id) {
    throw new Error("Already promoted to a product");
  }

  const name = toTitleCase(sanitizeCustomItemName(payload.name ?? customRow.name));
  if (!name) throw new Error("Product name is required");
  const selling_price = Math.max(
    0,
    Number(payload.selling_price ?? customRow.last_unit_price) || 0
  );

  const productId = await createProduct(
    {
      name,
      selling_price,
      piece_selling_price: selling_price,
      purchase_price: Math.max(0, Number(payload.purchase_price) || 0),
      initial_qty: Math.max(0, Math.floor(Number(payload.initial_qty) || 0)),
      vendor_id: payload.vendor_id || null,
      category_id: payload.category_id || null,
      is_active: true,
      low_stock_threshold: 5,
    },
    { sync: true }
  );

  const sb = requireSupabase();
  const { data, error } = await sb
    .from("pos_custom_items")
    .update({
      status: "promoted",
      promoted_product_id: productId,
      name,
      name_normalized: name.toLowerCase(),
      last_unit_price: selling_price,
      updated_at: new Date().toISOString(),
    })
    .eq("id", customRow.id)
    .select(SELECT_COLS)
    .single();
  if (error) throw error;
  return { productId, customItem: data };
}
