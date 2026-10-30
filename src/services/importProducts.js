import { requireSupabase } from "../lib/supabase.js";
import { createProduct, nextExternalProductId } from "./products.js";
import { receiveStock } from "./inventory.js";
import { createVendor, listActiveVendorOptions } from "./vendors.js";
import { createCategory, listCategories } from "./categories.js";
import { toTitleCase } from "../utils/titleCase.js";
import { syncCachesAfterWrite } from "../utils/cacheSync.js";

const MATCH_SELECT =
  "id, name, external_product_id, sku, barcode, current_stock, is_active, vendor_id, weighted_avg_cost, updated_at";

function nameVendorKey(name, vendorId) {
  return `${String(name ?? "")
    .trim()
    .toLowerCase()}\0${String(vendorId ?? "")}`;
}

export async function findProductMatch(row) {
  const sb = requireSupabase();
  const ext = row.external_product_id?.trim();
  const sku = row.sku?.trim();
  const barcode = row.barcode?.trim();
  if (ext) {
    const { data } = await sb
      .from("products")
      .select(MATCH_SELECT)
      .eq("external_product_id", ext)
      .maybeSingle();
    if (data) return data;
  }
  if (sku) {
    const { data } = await sb.from("products").select(MATCH_SELECT).eq("sku", sku).maybeSingle();
    if (data) return data;
  }
  if (barcode) {
    const { data } = await sb
      .from("products")
      .select(MATCH_SELECT)
      .eq("barcode", barcode)
      .maybeSingle();
    if (data) return data;
  }

  const name = String(row.name ?? "").trim();
  const vendorName = String(row.vendor ?? "").trim();
  if (name && vendorName) {
    const vendors = await listActiveVendorOptions();
    const vendor = vendors.find((v) => v.name.toLowerCase() === vendorName.toLowerCase());
    if (vendor) {
      const { data, error } = await sb
        .from("products")
        .select(MATCH_SELECT)
        .eq("vendor_id", vendor.id)
        .ilike("name", name)
        .order("is_active", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      if (data?.[0]) return data[0];
    }
  }
  return null;
}

async function fetchProductsByField(field, values) {
  const unique = [...new Set((values || []).map((v) => String(v ?? "").trim()).filter(Boolean))];
  if (!unique.length) return [];
  const sb = requireSupabase();
  const out = [];
  const chunkSize = 200;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data, error } = await sb.from("products").select(MATCH_SELECT).in(field, chunk);
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}

async function fetchProductsByVendorIds(vendorIds) {
  const unique = [...new Set((vendorIds || []).filter(Boolean).map(String))];
  if (!unique.length) return [];
  const sb = requireSupabase();
  const out = [];
  const chunkSize = 100;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data, error } = await sb.from("products").select(MATCH_SELECT).in("vendor_id", chunk);
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}

/**
 * Match import draft rows to existing DB products.
 * Priority: product id → sku → barcode → name+vendor.
 * @returns {Promise<Map<number, { id: string, name: string, current_stock: number, matchBy: string }>>}
 */
export async function matchExistingImportProducts(rows) {
  const list = rows || [];
  const byExt = new Map();
  const bySku = new Map();
  const byBarcode = new Map();
  const byNameVendor = new Map();

  const vendors = await listActiveVendorOptions();
  const vendorIdByName = new Map(
    vendors.map((v) => [String(v.name).trim().toLowerCase(), v.id])
  );

  const vendorIdsNeeded = [
    ...new Set(
      list
        .map((r) => vendorIdByName.get(String(r.vendor ?? "").trim().toLowerCase()))
        .filter(Boolean)
    ),
  ];

  const [extRows, skuRows, barcodeRows, vendorProducts] = await Promise.all([
    fetchProductsByField(
      "external_product_id",
      list.map((r) => r.external_product_id)
    ),
    fetchProductsByField(
      "sku",
      list.map((r) => r.sku)
    ),
    fetchProductsByField(
      "barcode",
      list.map((r) => r.barcode)
    ),
    fetchProductsByVendorIds(vendorIdsNeeded),
  ]);

  for (const p of extRows) {
    const k = String(p.external_product_id ?? "").trim().toLowerCase();
    if (k) byExt.set(k, p);
  }
  for (const p of skuRows) {
    const k = String(p.sku ?? "").trim().toLowerCase();
    if (k) bySku.set(k, p);
  }
  for (const p of barcodeRows) {
    const k = String(p.barcode ?? "").trim().toLowerCase();
    if (k) byBarcode.set(k, p);
  }
  // Prefer active + newer when duplicate name+vendor rows exist
  const sortedVendorProducts = [...vendorProducts].sort((a, b) => {
    const aActive = a.is_active !== false ? 1 : 0;
    const bActive = b.is_active !== false ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
  });
  for (const p of sortedVendorProducts) {
    const k = nameVendorKey(p.name, p.vendor_id);
    if (!byNameVendor.has(k)) byNameVendor.set(k, p);
  }

  const matches = new Map();
  list.forEach((row, index) => {
    const ext = String(row.external_product_id ?? "").trim().toLowerCase();
    const sku = String(row.sku ?? "").trim().toLowerCase();
    const barcode = String(row.barcode ?? "").trim().toLowerCase();
    const vendorId = vendorIdByName.get(String(row.vendor ?? "").trim().toLowerCase());
    let hit = null;
    let matchBy = "";
    if (ext && byExt.has(ext)) {
      hit = byExt.get(ext);
      matchBy = "product id";
    } else if (sku && bySku.has(sku)) {
      hit = bySku.get(sku);
      matchBy = "sku";
    } else if (barcode && byBarcode.has(barcode)) {
      hit = byBarcode.get(barcode);
      matchBy = "barcode";
    } else if (vendorId) {
      const nv = byNameVendor.get(nameVendorKey(row.name, vendorId));
      if (nv) {
        hit = nv;
        matchBy = "name + vendor";
      }
    }
    if (hit) {
      matches.set(index, {
        id: hit.id,
        name: hit.name,
        current_stock: Number(hit.current_stock) || 0,
        matchBy,
        is_active: hit.is_active !== false,
      });
    }
  });
  return matches;
}

async function ensureVendor(name) {
  if (!name?.trim()) return null;
  const vendors = await listActiveVendorOptions();
  const found = vendors.find((v) => v.name.toLowerCase() === name.trim().toLowerCase());
  if (found) return found.id;
  const created = await createVendor({ name: name.trim() });
  return created.id;
}

async function ensureCategory(name) {
  if (!name?.trim()) return null;
  const cats = await listCategories();
  const found = cats.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  if (found) return found.id;
  const created = await createCategory(name.trim());
  return created.id;
}

/**
 * behavior: create | add_stock | update_info | skip
 */
export async function importRow(mapped, behavior) {
  const name = toTitleCase(mapped.name);
  if (!name) throw new Error("Product name required");

  const qty = Math.max(0, Math.floor(Number(mapped.quantity) || 0));
  const purchase = Number(mapped.purchase_price) || 0;
  const sale = Number(mapped.selling_price) || 0;

  const existing = await findProductMatch(mapped);
  if (existing) {
    if (behavior === "skip") return { action: "skipped", productId: existing.id };
    if (behavior === "add_stock" && qty > 0) {
      // New inventory batch at CSV purchase cost — does not rewrite old batch costs.
      await receiveStock({
        productId: existing.id,
        quantity: qty,
        unitCost: purchase || existing.weighted_avg_cost,
        vendorId: existing.vendor_id,
        notes: "CSV import stock add",
      });
      if (sale > 0) {
        const sb = requireSupabase();
        await sb
          .from("products")
          .update({
            selling_price: sale,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }
      return { action: "stock_added", productId: existing.id };
    }
    if (behavior === "update_info") {
      const sb = requireSupabase();
      const nextSale = sale || existing.selling_price;
      await sb
        .from("products")
        .update({
          name,
          selling_price: nextSale,
          piece_selling_price: nextSale,
          pack_selling_price: nextSale,
          // Do not overwrite weighted_avg_cost — that would reprice historical stock.
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      return { action: "updated", productId: existing.id };
    }
    return { action: "duplicate", productId: existing.id };
  }

  const vendorName = toTitleCase(mapped.vendor);
  const vendorId = await ensureVendor(vendorName);
  const categoryId = await ensureCategory(mapped.category);

  let externalId = String(mapped.external_product_id ?? "").trim() || null;
  if (!externalId && vendorName) {
    externalId = await nextExternalProductId(vendorName);
  }

  const id = await createProduct({
    name,
    external_product_id: externalId,
    vendor_name: vendorName,
    sku: mapped.sku,
    barcode: mapped.barcode,
    vendor_id: vendorId,
    category_id: categoryId,
    selling_price: sale,
    purchase_price: purchase,
    initial_qty: qty,
  });
  return { action: "created", productId: id };
}

const BULK_CHUNK_SIZE = 200;

function importJsonNumber(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Import many rows in few RPC calls (server-side loop, one HTTP request per chunk).
 */
export async function importProductsBulk(mappedRows, behavior, { onProgress } = {}) {
  const sb = requireSupabase();
  const allResults = [];
  let totalSuccess = 0;
  let totalFailed = 0;

  for (let offset = 0; offset < mappedRows.length; offset += BULK_CHUNK_SIZE) {
    const chunk = mappedRows.slice(offset, offset + BULK_CHUNK_SIZE);
    const payload = chunk.map((row) => ({
      name: toTitleCase(row.name),
      external_product_id: row.external_product_id ?? "",
      sku: row.sku ?? "",
      barcode: row.barcode ?? "",
      vendor: toTitleCase(row.vendor),
      category: toTitleCase(row.category),
      quantity: importJsonNumber(row.quantity),
      selling_price: importJsonNumber(row.selling_price),
      purchase_price: importJsonNumber(row.purchase_price),
    }));

    const { data, error } = await sb.rpc("import_products_bulk", {
      p_rows: payload,
      p_duplicate_behavior: behavior,
    });
    if (error) throw error;

    const results = data?.results ?? [];
    const summary = data?.summary ?? {};
    for (const r of results) {
      const status = r.action === "error" ? `error: ${r.error}` : r.action;
      allResults.push({
        name: r.name,
        status,
        rowIndex: r.row_index,
        action: r.action,
        product_id: r.product_id || null,
        qty: Number(r.qty) || 0,
        purchase: Number(r.purchase) || 0,
        sale: Number(r.sale) || 0,
        before: r.before || null,
      });
    }
    totalSuccess += summary.success ?? 0;
    totalFailed += summary.failed ?? 0;

    if (onProgress) {
      onProgress({
        done: Math.min(offset + chunk.length, mappedRows.length),
        total: mappedRows.length,
      });
    }
  }

  await syncCachesAfterWrite();

  return {
    results: allResults,
    success: totalSuccess,
    failed: totalFailed,
    total: mappedRows.length,
  };
}

export async function recordImportJob({
  filename,
  total,
  success,
  failed,
  behavior = "add_stock",
  actions = [],
} = {}) {
  const sb = requireSupabase();
  const undoActions = (actions || [])
    .filter((a) => a && a.product_id && ["created", "stock_added", "updated"].includes(a.action))
    .map((a) => ({
      action: a.action,
      product_id: a.product_id,
      name: a.name || "",
      qty: Number(a.qty) || 0,
      purchase: Number(a.purchase) || 0,
      sale: Number(a.sale) || 0,
      before: a.before || null,
    }));

  const { data, error } = await sb
    .from("import_jobs")
    .insert({
      filename,
      status: failed > 0 ? "partial" : "completed",
      total_rows: total,
      successful_rows: success,
      failed_rows: failed,
      details: {
        behavior,
        actions: undoActions,
      },
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Latest import that can still be undone (most recent completed/partial with undo payload). */
export async function getLastUndoableImportJob() {
  const sb = requireSupabase();
  // Fetch a few recent jobs — only those with stored undo actions are usable
  const { data, error } = await sb
    .from("import_jobs")
    .select("id, filename, status, total_rows, successful_rows, failed_rows, details, created_at, undone_at")
    .in("status", ["completed", "partial"])
    .is("undone_at", null)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  const jobs = data ?? [];
  return (
    jobs.find((j) => Array.isArray(j.details?.actions) && j.details.actions.length > 0) || null
  );
}

export async function undoImportJob(jobId) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("undo_import_job", { p_job_id: jobId });
  if (error) throw error;
  await syncCachesAfterWrite();
  return data;
}
