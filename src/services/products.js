import { requireSupabase } from "../lib/supabase.js";
import { toTitleCase, vendorInitialsPrefix } from "../utils/titleCase.js";
import { applyTimestampFilter, resolveDateRange } from "../utils/dateRange.js";
import { isProductTagsDbReady, setProductTags, TAGS_MIGRATION_HINT } from "./productTags.js";
import { normalizeProductUnitFields } from "../utils/saleUnits.js";
import { onlineOrOfflineWrite, onlineOrOfflineRead } from "./offlineGuard.js";
import { listProductsLocal } from "./listProductsLocal.js";
import {
  offlineCreateProduct,
  offlineUpdateProduct,
  offlineDeactivateProduct,
  offlineDeleteProductsBulk,
  offlineDeactivateProductsBulk,
  offlineReactivateProductsBulk,
} from "./adminOfflineApply.js";
import { useProductCacheStore } from "../stores/productCache.js";
import { useMetaCacheStore } from "../stores/metaCache.js";
import { syncProductCatalogAfterWrite } from "../utils/cacheSync.js";
import { asyncPool } from "../utils/asyncPool.js";
import { postgrestIlikeOr } from "../utils/textSearch.js";

async function syncCatalog() {
  await syncProductCatalogAfterWrite();
}

const BULK_WRITE_CONCURRENCY = 12;

const BULK_EDIT_FETCH_PAGE = 200;

/**
 * Full catalog for bulk-edit-all — fetched in small pages to avoid timeouts.
 * @param {{ activeOnly?: boolean, pageSize?: number, onBatch?: (chunk: object[], meta: { loaded: number, done: boolean }) => void }} opts
 */
export async function fetchAllProductsForBulkEdit({
  activeOnly = true,
  pageSize = BULK_EDIT_FETCH_PAGE,
  onBatch = null,
} = {}) {
  const size = Math.max(50, Math.min(Number(pageSize) || BULK_EDIT_FETCH_PAGE, 500));

  // No short read-timeout: multi-page fetch of 500+ rows often exceeds the
  // default 1.5s and was falsely flipping sticky "Offline" on the Products page.
  return onlineOrOfflineRead(
    async () => {
      const sb = requireSupabase();
      const all = [];
      let from = 0;
      for (;;) {
        let q = sb
          .from("products")
          .select(
            "id, name, external_product_id, sku, barcode, current_stock, weighted_avg_cost, selling_price, pieces_per_pack, pieces_per_box, piece_selling_price, pack_selling_price, box_selling_price, default_sale_unit, vendor_id, category_id, low_stock_threshold, is_active"
          )
          .order("name")
          .range(from, from + size - 1);
        if (activeOnly) q = q.eq("is_active", true);
        const { data, error } = await q;
        if (error) throw error;
        const chunk = data ?? [];
        all.push(...chunk);
        const done = chunk.length < size;
        if (typeof onBatch === "function" && chunk.length) {
          onBatch(chunk, { loaded: all.length, done });
        }
        if (done) break;
        from += size;
      }
      if (typeof onBatch === "function" && !all.length) {
        onBatch([], { loaded: 0, done: true });
      }
      return all;
    },
    () => {
      const cached = useProductCacheStore().products || [];
      const list = (activeOnly ? cached.filter((p) => p.is_active !== false) : cached).slice();
      if (typeof onBatch === "function") {
        for (let i = 0; i < list.length; i += size) {
          const chunk = list.slice(i, i + size);
          onBatch(chunk, {
            loaded: Math.min(i + chunk.length, list.length),
            done: i + chunk.length >= list.length,
          });
        }
        if (!list.length) onBatch([], { loaded: 0, done: true });
      }
      return list;
    },
    { timeoutMs: 0 }
  );
}

const PRODUCT_SORT_COLUMNS = new Set([
  "external_product_id",
  "name",
  "barcode",
  "current_stock",
  "weighted_avg_cost",
  "selling_price",
  "is_active",
  "created_at",
  "updated_at",
]);

export async function listProducts(opts = {}) {
  return onlineOrOfflineRead(
    () => listProductsOnline(opts),
    () => listProductsLocal(opts)
  );
}

function normalizeFilterIds(ids, single) {
  const fromArr = Array.isArray(ids) ? ids : [];
  const fromSingle = single != null && single !== "" ? [single] : [];
  return [...new Set([...fromArr, ...fromSingle].filter(Boolean).map(String))];
}

function normalizeFilterTags(tags, tag) {
  const fromArr = Array.isArray(tags) ? tags : [];
  const fromSingle = tag != null && tag !== "" ? [tag] : [];
  return [
    ...new Set(
      [...fromArr, ...fromSingle]
        .map((t) => String(t ?? "").trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

async function listProductsOnline({
  search = "",
  vendorId = null,
  vendorIds = null,
  categoryId = null,
  categoryIds = null,
  lowStockOnly = false,
  activeOnly = false,
  tag = null,
  tags = null,
  unitFilter = "all",
  createdRangePreset = "all",
  createdFrom = null,
  createdTo = null,
  page = 1,
  pageSize = 20,
  sortKey = null,
  sortOrder = null,
} = {}) {
  const sb = requireSupabase();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const ascending = sortOrder === "ascend";
  const vendorList = normalizeFilterIds(vendorIds, vendorId);
  const categoryList = normalizeFilterIds(categoryIds, categoryId);
  const tagList = normalizeFilterTags(tags, tag);
  const createdRange = resolveDateRange(createdRangePreset, createdFrom, createdTo);

  let query = sb.from("products").select("*, vendors(name), categories(name)", { count: "exact" });
  query = applyTimestampFilter(query, "created_at", createdRange);

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
    const orFilter = postgrestIlikeOr(
      ["name", "sku", "barcode", "external_product_id"],
      term
    );
    if (orFilter) query = query.or(orFilter);
  }
  if (vendorList.length === 1) query = query.eq("vendor_id", vendorList[0]);
  else if (vendorList.length > 1) query = query.in("vendor_id", vendorList);
  if (categoryList.length === 1) query = query.eq("category_id", categoryList[0]);
  else if (categoryList.length > 1) query = query.in("category_id", categoryList);
  if (activeOnly) query = query.eq("is_active", true);
  if (lowStockOnly) query = query.eq("is_low_stock", true);
  const uf = String(unitFilter || "all");
  if (uf === "pack") query = query.gt("pieces_per_pack", 1);
  else if (uf === "box") query = query.not("pieces_per_box", "is", null);
  else if (uf === "piece") query = query.eq("pieces_per_pack", 1).is("pieces_per_box", null);
  else if (uf === "multi") query = query.or("pieces_per_pack.gt.1,pieces_per_box.not.is.null");
  if (tagList.length) {
    if (!(await isProductTagsDbReady())) {
      throw new Error(TAGS_MIGRATION_HINT);
    }
    // Any selected tag (OR) — overlaps, not contains-all
    if (tagList.length === 1) query = query.contains("tags", [tagList[0]]);
    else query = query.overlaps("tags", tagList);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/** Next unique shop code for a vendor prefix, e.g. AR-12 */
export async function nextExternalProductId(prefixOrVendorName) {
  return onlineOrOfflineRead(
    async () => {
      const sb = requireSupabase();
      const prefix = vendorInitialsPrefix(prefixOrVendorName);
      const { data, error } = await sb.rpc("next_external_product_id", { p_prefix: prefix });
      if (error) throw error;
      return data;
    },
    () => useProductCacheStore().nextLocalExternalId(prefixOrVendorName)
  );
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
  // Parallel batches (not sequential 1-by-1) — each row still needs create RPC + optional stock.
  await asyncPool(rows, BULK_WRITE_CONCURRENCY, async (row, i) => {
    try {
      const pack = Math.max(1, Math.floor(Number(row.pieces_per_pack) || 1));
      const sale = Number(row.selling_price) || 0;
      const id = await createProduct(
        {
          name: row.name,
          external_product_id: row.id_source === "custom" ? row.resolved_external_product_id : "",
          vendor_id: vendorId,
          vendor_name: vendorName,
          category_id: categoryId || null,
          selling_price: sale,
          purchase_price: row.purchase_price,
          initial_qty: row.initial_qty,
          pieces_per_pack: pack,
          pieces_per_box: row.pieces_per_box,
          piece_selling_price: row.piece_selling_price ?? sale,
          pack_selling_price: row.pack_selling_price ?? sale,
          box_selling_price: row.box_selling_price,
          default_sale_unit: row.default_sale_unit || (pack > 1 ? "pack" : "piece"),
        },
        { sync: false }
      );
      created.push({ index: i, productId: id, name: row.name });
    } catch (e) {
      errors.push({ index: i, name: row.name, message: e.message || "Create failed" });
    }
  });
  created.sort((a, b) => a.index - b.index);
  errors.sort((a, b) => a.index - b.index);
  if (created.length) await syncCatalog();
  return { created, errors };
}

async function createProductOnline(payload) {
  const sb = requireSupabase();
  let externalId = String(payload.external_product_id ?? "").trim() || null;
  if (!externalId && payload.vendor_name) {
    externalId = await nextExternalProductId(payload.vendor_name);
  } else if (!externalId && payload.vendor_id) {
    const meta = useMetaCacheStore();
    const cachedName = meta.vendors.find((v) => v.id === payload.vendor_id)?.name;
    if (cachedName) {
      externalId = await nextExternalProductId(cachedName);
    } else {
      const { data: v } = await sb.from("vendors").select("name").eq("id", payload.vendor_id).maybeSingle();
      if (v?.name) externalId = await nextExternalProductId(v.name);
    }
  }
  const units = normalizeProductUnitFields(payload);
  const { data, error } = await sb.rpc("create_product_with_initial_stock", {
    p_name: toTitleCase(payload.name),
    p_external_product_id: externalId,
    p_sku: payload.sku?.trim() || null,
    p_barcode: payload.barcode?.trim() || null,
    p_category_id: payload.category_id || null,
    p_vendor_id: payload.vendor_id || null,
    p_selling_price: units.selling_price,
    p_purchase_price: Number(payload.purchase_price) || 0,
    p_initial_qty: Math.max(0, Math.floor(Number(payload.initial_qty) || 0)),
    p_low_stock_threshold: Math.max(0, Math.floor(Number(payload.low_stock_threshold) || 5)),
    p_pieces_per_pack: units.pieces_per_pack,
    p_pieces_per_box: units.pieces_per_box,
    p_piece_selling_price: units.piece_selling_price,
    p_pack_selling_price: units.pack_selling_price,
    p_box_selling_price: units.box_selling_price,
    p_default_sale_unit: units.default_sale_unit,
  });
  if (error) throw error;
  const productId = data;
  if (payload.tags) {
    await setProductTags(productId, payload.tags);
  }
  return productId;
}

export async function createProduct(payload, { sync = true, forceOnline = false } = {}) {
  const productId = forceOnline
    ? await createProductOnline(payload)
    : await onlineOrOfflineWrite(
        () => createProductOnline(payload),
        () => offlineCreateProduct(payload)
      );
  if (sync) await syncCatalog();
  return productId;
}

async function updateProductOnline(id, payload) {
  const sb = requireSupabase();
  const units = normalizeProductUnitFields(payload);
  const cost = Number(payload.weighted_avg_cost);
  const row = {
    name: toTitleCase(payload.name),
    external_product_id: payload.external_product_id?.trim() || null,
    sku: payload.sku?.trim() || null,
    barcode: payload.barcode?.trim() || null,
    category_id: payload.category_id || null,
    vendor_id: payload.vendor_id || null,
    selling_price: units.selling_price,
    pieces_per_pack: units.pieces_per_pack,
    pieces_per_box: units.pieces_per_box,
    piece_selling_price: units.piece_selling_price,
    pack_selling_price: units.pack_selling_price,
    box_selling_price: units.box_selling_price,
    default_sale_unit: units.default_sale_unit,
    weighted_avg_cost: Number.isFinite(cost) ? cost : 0,
    low_stock_threshold: Math.max(0, Math.floor(Number(payload.low_stock_threshold) || 5)),
    is_active: Boolean(payload.is_active),
    updated_at: new Date().toISOString(),
  };
  if (payload.shopify_price !== undefined) {
    const sp = payload.shopify_price;
    row.shopify_price =
      sp == null || sp === "" ? null : Number.isFinite(Number(sp)) ? Number(sp) : null;
  }
  if (!row.name) throw new Error("Product name is required");
  const { data, error } = await sb.from("products").update(row).eq("id", id).select().single();
  if (error) throw error;
  if (payload.tags !== undefined) {
    await setProductTags(id, payload.tags);
  }
  return data;
}

export async function updateProduct(id, payload, { sync = true, forceOnline = false } = {}) {
  const data = forceOnline
    ? await updateProductOnline(id, payload)
    : await onlineOrOfflineWrite(
        () => updateProductOnline(id, payload),
        () => offlineUpdateProduct(id, payload)
      );
  if (sync) await syncCatalog();
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

  // Parallel batches — product update + optional stock adjust per row, capped concurrency.
  await asyncPool(rows, BULK_WRITE_CONCURRENCY, async (row, i) => {
    const name = toTitleCase(row.name);
    if (!row.id) {
      errors.push({ index: i, name: name || "—", message: "Missing product id" });
      return;
    }
    if (!String(name ?? "").trim()) {
      errors.push({ index: i, name: "—", message: "Product name is required" });
      return;
    }
    try {
      const units = normalizeProductUnitFields(row);
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
        selling_price: units.selling_price,
        pieces_per_pack: units.pieces_per_pack,
        pieces_per_box: units.pieces_per_box,
        piece_selling_price: units.piece_selling_price,
        pack_selling_price: units.pack_selling_price,
        box_selling_price: units.box_selling_price,
        default_sale_unit: units.default_sale_unit,
        weighted_avg_cost: Number.isFinite(cost) ? cost : 0,
        low_stock_threshold: Math.max(0, Math.floor(Number(row.low_stock_threshold) || 5)),
        is_active: row.is_active !== false,
      };
      await updateProduct(row.id, payload, { sync: false });

      const stockNow = Math.max(0, Math.floor(Number(row.current_stock) || 0));
      const stockWas = Math.max(0, Math.floor(Number(row.stock_at_open) || 0));
      if (stockNow !== stockWas) {
        await setProductStock(row.id, stockNow, "Stock updated from bulk edit", { sync: false });
      }
      updated.push({ index: i, productId: row.id, name });
    } catch (e) {
      errors.push({ index: i, name: name || "—", message: e.message || "Update failed" });
    }
  });

  updated.sort((a, b) => a.index - b.index);
  errors.sort((a, b) => a.index - b.index);
  if (updated.length) await syncCatalog();
  return { updated, errors };
}

export async function deactivateProduct(id) {
  const data = await onlineOrOfflineWrite(
    async () => {
      const sb = requireSupabase();
      const { data, error } = await sb
        .from("products")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    () => offlineDeactivateProduct(id)
  );
  await syncCatalog();
  return data;
}

/**
 * Soft-delete products (is_active = false). Barcode / stock / history kept.
 * RPC name is historical; server no longer hard-deletes rows.
 */
export async function deleteProductsBulk(ids) {
  const result = await onlineOrOfflineWrite(
    async () => {
      const sb = requireSupabase();
      const unique = [...new Set(ids.filter(Boolean))];
      if (!unique.length) return { deleted: 0, failed: [] };
      const { data, error } = await sb.rpc("delete_products_bulk", {
        p_product_ids: unique,
      });
      if (error) throw error;
      return {
        deleted: data?.deleted ?? 0,
        failed: data?.failed ?? [],
      };
    },
    () => offlineDeleteProductsBulk(ids)
  );
  await syncCatalog();
  return result;
}

export async function deactivateProductsBulk(ids) {
  const result = await onlineOrOfflineWrite(
    async () => {
      const sb = requireSupabase();
      const unique = [...new Set(ids.filter(Boolean))];
      if (!unique.length) return 0;
      const { data, error } = await sb.rpc("deactivate_products_bulk", {
        p_product_ids: unique,
      });
      if (error) throw error;
      return data ?? 0;
    },
    () => offlineDeactivateProductsBulk(ids)
  );
  await syncCatalog();
  return result;
}

export async function reactivateProductsBulk(ids) {
  const result = await onlineOrOfflineWrite(
    async () => {
      const sb = requireSupabase();
      const unique = [...new Set(ids.filter(Boolean))];
      if (!unique.length) return 0;
      const { error, count } = await sb
        .from("products")
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .in("id", unique);
      if (error) throw error;
      return count ?? unique.length;
    },
    () => offlineReactivateProductsBulk(ids)
  );
  await syncCatalog();
  return result;
}

/** Snapshot product rows before permanent delete (for session undo restore). */
export async function snapshotProductsForUndo(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return [];

  return onlineOrOfflineRead(
    async () => {
      const sb = requireSupabase();
      const { data, error } = await sb.from("products").select("*").in("id", unique);
      if (error) throw error;
      return data ?? [];
    },
    () => {
      const cache = useProductCacheStore();
      const set = new Set(unique.map(String));
      return (cache.products || []).filter((p) => set.has(String(p.id))).map((p) => ({ ...p }));
    }
  );
}

/**
 * Recreate products from pre-delete snapshots (new ids). Restores catalog + stock qty,
 * not historical stock movements.
 */
export async function restoreProductsFromSnapshots(snapshots) {
  const rows = Array.isArray(snapshots) ? snapshots.filter((r) => r?.name) : [];
  if (!rows.length) return { restored: 0, errors: [] };

  const created = [];
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const sale = Number(row.selling_price) || 0;
      const pack = Math.max(1, Math.floor(Number(row.pieces_per_pack) || 1));
      await createProduct(
        {
          name: row.name,
          external_product_id: row.external_product_id || "",
          sku: row.sku,
          barcode: row.barcode,
          vendor_id: row.vendor_id || null,
          category_id: row.category_id || null,
          selling_price: sale,
          purchase_price: Number(row.weighted_avg_cost) || Number(row.purchase_price) || 0,
          initial_qty: Math.max(0, Math.floor(Number(row.current_stock) || 0)),
          low_stock_threshold: Math.max(0, Math.floor(Number(row.low_stock_threshold) || 5)),
          pieces_per_pack: pack,
          pieces_per_box: row.pieces_per_box,
          piece_selling_price: row.piece_selling_price ?? sale,
          pack_selling_price: row.pack_selling_price ?? sale,
          box_selling_price: row.box_selling_price,
          default_sale_unit: row.default_sale_unit || (pack > 1 ? "pack" : "piece"),
          tags: row.tags,
        },
        { sync: false }
      );
      created.push(row.name);
    } catch (e) {
      errors.push({ name: row.name || "—", message: e?.message || "Restore failed" });
    }
  }
  await syncCatalog();
  return { restored: created.length, errors };
}
