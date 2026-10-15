import { requireSupabase } from "../lib/supabase.js";
import { createProduct } from "./products.js";
import { receiveStock } from "./inventory.js";
import { createVendor, listActiveVendorOptions } from "./vendors.js";
import { createCategory, listCategories } from "./categories.js";

export async function findProductMatch(row) {
  const sb = requireSupabase();
  const ext = row.external_product_id?.trim();
  const sku = row.sku?.trim();
  const barcode = row.barcode?.trim();
  if (ext) {
    const { data } = await sb.from("products").select("*").eq("external_product_id", ext).maybeSingle();
    if (data) return data;
  }
  if (sku) {
    const { data } = await sb.from("products").select("*").eq("sku", sku).maybeSingle();
    if (data) return data;
  }
  if (barcode) {
    const { data } = await sb.from("products").select("*").eq("barcode", barcode).maybeSingle();
    if (data) return data;
  }
  return null;
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
  const name = String(mapped.name ?? "").trim();
  if (!name) throw new Error("Product name required");

  const qty = Math.max(0, Math.floor(Number(mapped.quantity) || 0));
  const purchase = Number(mapped.purchase_price) || 0;
  const sale = Number(mapped.selling_price) || 0;

  const existing = await findProductMatch(mapped);
  if (existing) {
    if (behavior === "skip") return { action: "skipped", productId: existing.id };
    if (behavior === "add_stock" && qty > 0) {
      await receiveStock({
        productId: existing.id,
        quantity: qty,
        unitCost: purchase || existing.weighted_avg_cost,
        vendorId: existing.vendor_id,
        notes: "CSV import stock add",
      });
      return { action: "stock_added", productId: existing.id };
    }
    if (behavior === "update_info") {
      const sb = requireSupabase();
      await sb
        .from("products")
        .update({
          name,
          selling_price: sale || existing.selling_price,
          weighted_avg_cost: purchase || existing.weighted_avg_cost,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      return { action: "updated", productId: existing.id };
    }
    return { action: "duplicate", productId: existing.id };
  }

  const vendorId = await ensureVendor(mapped.vendor);
  const categoryId = await ensureCategory(mapped.category);

  const id = await createProduct({
    name,
    external_product_id: mapped.external_product_id,
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

export async function recordImportJob({ filename, total, success, failed }) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("import_jobs")
    .insert({
      filename,
      status: failed > 0 ? "partial" : "completed",
      total_rows: total,
      successful_rows: success,
      failed_rows: failed,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
