import { requireSupabase } from "../lib/supabase.js";

export async function listProducts({
  search = "",
  vendorId = null,
  categoryId = null,
  lowStockOnly = false,
  activeOnly = false,
  page = 1,
  pageSize = 20,
} = {}) {
  const sb = requireSupabase();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = sb
    .from("products")
    .select(
      "*, vendors(name), categories(name)",
      { count: "exact" }
    )
    .order("updated_at", { ascending: false })
    .range(from, to);

  const term = search.trim();
  if (term) {
    query = query.or(
      `name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%,external_product_id.ilike.%${term}%`
    );
  }
  if (vendorId) query = query.eq("vendor_id", vendorId);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (activeOnly) query = query.eq("is_active", true);
  if (lowStockOnly) query = query.eq("is_low_stock", true);

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function createProduct(payload) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("create_product_with_initial_stock", {
    p_name: payload.name,
    p_external_product_id: payload.external_product_id || null,
    p_sku: payload.sku || null,
    p_barcode: payload.barcode || null,
    p_category_id: payload.category_id || null,
    p_vendor_id: payload.vendor_id || null,
    p_selling_price: Number(payload.selling_price) || 0,
    p_purchase_price: Number(payload.purchase_price) || 0,
    p_initial_qty: Math.max(0, Math.floor(Number(payload.initial_qty) || 0)),
    p_low_stock_threshold: Math.max(0, Math.floor(Number(payload.low_stock_threshold) || 5)),
  });
  if (error) throw error;
  return data;
}

export async function updateProduct(id, payload) {
  const sb = requireSupabase();
  const selling = Number(payload.selling_price);
  const cost = Number(payload.weighted_avg_cost);
  const row = {
    name: String(payload.name ?? "").trim(),
    external_product_id: payload.external_product_id?.trim() || null,
    sku: payload.sku?.trim() || null,
    barcode: payload.barcode?.trim() || null,
    category_id: payload.category_id || null,
    vendor_id: payload.vendor_id || null,
    selling_price: Number.isFinite(selling) ? selling : 0,
    weighted_avg_cost: Number.isFinite(cost) ? cost : 0,
    low_stock_threshold: Math.max(0, Math.floor(Number(payload.low_stock_threshold) || 5)),
    is_active: Boolean(payload.is_active),
    updated_at: new Date().toISOString(),
  };
  if (!row.name) throw new Error("Product name is required");
  const { data, error } = await sb.from("products").update(row).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deactivateProduct(id) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("products")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
