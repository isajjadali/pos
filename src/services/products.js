import { requireSupabase } from "../lib/supabase.js";
import { refreshProductCatalog } from "./productCatalog.js";
import { toTitleCase, vendorInitialsPrefix } from "../utils/titleCase.js";
import { isProductTagsDbReady, setProductTags, TAGS_MIGRATION_HINT } from "./productTags.js";

async function syncCatalog() {
  try {
    await refreshProductCatalog();
  } catch {
    /* catalog will refresh on next login */
  }
}

const PRODUCT_SORT_COLUMNS = new Set([
  "external_product_id",
  "name",
  "barcode",
  "current_stock",
  "weighted_avg_cost",
  "selling_price",
  "is_active",
  "updated_at",
]);

export async function listProducts({
  search = "",
  vendorId = null,
  categoryId = null,
  lowStockOnly = false,
  activeOnly = false,
  tag = null,
  page = 1,
  pageSize = 20,
  sortKey = null,
  sortOrder = null,
} = {}) {
  const sb = requireSupabase();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const ascending = sortOrder === "ascend";

  let query = sb.from("products").select("*, vendors(name), categories(name)", { count: "exact" });

  if (sortKey === "vendor") {
    query = query.order("name", { ascending, foreignTable: "vendors" });
  } else if (sortKey === "external_product_id") {
    // Natural order: AR-10, AR-11, … AR-100 (not lexicographic AR-10, AR-100, AR-11)
    query = query.order("external_product_id_sort", { ascending, nullsFirst: false });
  } else if (sortKey && PRODUCT_SORT_COLUMNS.has(sortKey)) {
    query = query.order(sortKey, { ascending });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  query = query.range(from, to);

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
  const tagNorm = String(tag ?? "").trim().toLowerCase();
  if (tagNorm) {
    if (!(await isProductTagsDbReady())) {
      throw new Error(TAGS_MIGRATION_HINT);
    }
    query = query.contains("tags", [tagNorm]);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/** Next unique shop code for a vendor prefix, e.g. AR-12 */
export async function nextExternalProductId(prefixOrVendorName) {
  const sb = requireSupabase();
  const prefix = vendorInitialsPrefix(prefixOrVendorName);
  const { data, error } = await sb.rpc("next_external_product_id", { p_prefix: prefix });
  if (error) throw error;
  return data;
}

/** Bump shop code suffix, e.g. HT-12 → HT-13 */
export function incrementShopProductId(id) {
  const m = String(id ?? "").match(/^(.+?)-(\d+)$/);
  if (!m) return `${id}-2`;
  return `${m[1]}-${parseInt(m[2], 10) + 1}`;
}

/**
 * Preview auto/custom product IDs for a bulk draft (does not write to DB).
 * @param {string} vendorName
 * @param {Array<{ external_product_id?: string, name: string }>} rows
 */
export async function previewBulkExternalProductIds(vendorName, rows) {
  const used = new Set();
  const out = [];
  let nextAuto = null;

  for (const row of rows) {
    const custom = String(row.external_product_id ?? "").trim();
    if (custom) {
      const key = custom.toLowerCase();
      if (used.has(key)) throw new Error(`Duplicate product ID in list: ${custom}`);
      used.add(key);
      out.push({ ...row, resolved_external_product_id: custom, id_source: "custom" });
      continue;
    }
    if (!String(vendorName ?? "").trim()) {
      throw new Error("Select a vendor for auto-generated product IDs");
    }
    if (!nextAuto) nextAuto = await nextExternalProductId(vendorName);
    let candidate = nextAuto;
    while (used.has(candidate.toLowerCase())) {
      candidate = incrementShopProductId(candidate);
    }
    used.add(candidate.toLowerCase());
    out.push({ ...row, resolved_external_product_id: candidate, id_source: "auto" });
    nextAuto = incrementShopProductId(candidate);
  }
  return out;
}

/** Create many products in order (same rules as createProduct per row). */
export async function createProductsBulk(rows, { vendorId, vendorName, categoryId } = {}) {
  const created = [];
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const id = await createProduct({
        name: row.name,
        external_product_id: row.id_source === "custom" ? row.resolved_external_product_id : "",
        vendor_id: vendorId,
        vendor_name: vendorName,
        category_id: categoryId || null,
        selling_price: row.selling_price,
        purchase_price: row.purchase_price,
        initial_qty: row.initial_qty,
      });
      created.push({ index: i, productId: id, name: row.name });
    } catch (e) {
      errors.push({ index: i, name: row.name, message: e.message || "Create failed" });
    }
  }
  return { created, errors };
}

export async function createProduct(payload) {
  const sb = requireSupabase();
  let externalId = String(payload.external_product_id ?? "").trim() || null;
  if (!externalId && payload.vendor_name) {
    externalId = await nextExternalProductId(payload.vendor_name);
  } else if (!externalId && payload.vendor_id) {
    const { data: v } = await sb.from("vendors").select("name").eq("id", payload.vendor_id).maybeSingle();
    if (v?.name) externalId = await nextExternalProductId(v.name);
  }
  const { data, error } = await sb.rpc("create_product_with_initial_stock", {
    p_name: toTitleCase(payload.name),
    p_external_product_id: externalId,
    p_sku: payload.sku?.trim() || null,
    p_barcode: payload.barcode?.trim() || null,
    p_category_id: payload.category_id || null,
    p_vendor_id: payload.vendor_id || null,
    p_selling_price: Number(payload.selling_price) || 0,
    p_purchase_price: Number(payload.purchase_price) || 0,
    p_initial_qty: Math.max(0, Math.floor(Number(payload.initial_qty) || 0)),
    p_low_stock_threshold: Math.max(0, Math.floor(Number(payload.low_stock_threshold) || 5)),
  });
  if (error) throw error;
  const productId = data;
  if (payload.tags) {
    await setProductTags(productId, payload.tags);
  }
  await syncCatalog();
  return productId;
}

export async function updateProduct(id, payload) {
  const sb = requireSupabase();
  const selling = Number(payload.selling_price);
  const cost = Number(payload.weighted_avg_cost);
  const row = {
    name: toTitleCase(payload.name),
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
  if (payload.tags !== undefined) {
    await setProductTags(id, payload.tags);
  }
  await syncCatalog();
  return data;
}

/**
 * Bulk-update products (same fields as bulk create: ID, name, qty, purchase, sale).
 * Optional vendorId / categoryId override every row when set.
 * @param {Array<{
 *   id: string,
 *   name: string,
 *   external_product_id?: string,
 *   current_stock?: number,
 *   stock_at_open?: number,
 *   purchase_price?: number,
 *   selling_price?: number,
 *   sku?: string,
 *   barcode?: string,
 *   vendor_id?: string|null,
 *   category_id?: string|null,
 *   low_stock_threshold?: number,
 *   is_active?: boolean,
 * }>} rows
 */
export async function updateProductsBulk(rows, { vendorId = undefined, categoryId = undefined } = {}) {
  const { setProductStock } = await import("./inventory.js");
  const updated = [];
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = toTitleCase(row.name);
    if (!row.id) {
      errors.push({ index: i, name: name || "—", message: "Missing product id" });
      continue;
    }
    if (!String(name ?? "").trim()) {
      errors.push({ index: i, name: "—", message: "Product name is required" });
      continue;
    }
    try {
      const sb = requireSupabase();
      const selling = Number(row.selling_price);
      const cost = Number(row.purchase_price ?? row.weighted_avg_cost);
      const payload = {
        name,
        external_product_id: String(row.external_product_id ?? "").trim() || null,
        sku: row.sku?.trim?.() ? row.sku.trim() : row.sku || null,
        barcode: row.barcode?.trim?.() ? row.barcode.trim() : row.barcode || null,
        category_id:
          categoryId !== undefined && categoryId !== null
            ? categoryId
            : row.category_id || null,
        vendor_id:
          vendorId !== undefined && vendorId !== null ? vendorId : row.vendor_id || null,
        selling_price: Number.isFinite(selling) ? selling : 0,
        weighted_avg_cost: Number.isFinite(cost) ? cost : 0,
        low_stock_threshold: Math.max(0, Math.floor(Number(row.low_stock_threshold) || 5)),
        is_active: row.is_active !== false,
        updated_at: new Date().toISOString(),
      };
      const { error } = await sb.from("products").update(payload).eq("id", row.id);
      if (error) throw error;

      const stockNow = Math.max(0, Math.floor(Number(row.current_stock) || 0));
      const stockWas = Math.max(0, Math.floor(Number(row.stock_at_open) || 0));
      if (stockNow !== stockWas) {
        await setProductStock(row.id, stockNow, "Stock updated from bulk edit");
      }
      updated.push({ index: i, productId: row.id, name });
    } catch (e) {
      errors.push({ index: i, name: name || "—", message: e.message || "Update failed" });
    }
  }

  if (updated.length) await syncCatalog();
  return { updated, errors };
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
  await syncCatalog();
  return data;
}

export async function deleteProductsBulk(ids) {
  const sb = requireSupabase();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return { deleted: 0, failed: [] };
  const { data, error } = await sb.rpc("delete_products_bulk", {
    p_product_ids: unique,
  });
  if (error) throw error;
  await syncCatalog();
  return {
    deleted: data?.deleted ?? 0,
    failed: data?.failed ?? [],
  };
}

export async function deactivateProductsBulk(ids) {
  const sb = requireSupabase();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return 0;
  const { data, error } = await sb.rpc("deactivate_products_bulk", {
    p_product_ids: unique,
  });
  if (error) throw error;
  await syncCatalog();
  return data ?? 0;
}
