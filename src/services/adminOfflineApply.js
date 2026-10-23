import { toRaw } from "vue";
import { useProductCacheStore } from "../stores/productCache.js";
import { useMetaCacheStore } from "../stores/metaCache.js";
import { useAdminOutboxStore } from "../stores/adminOutbox.js";
import { newLocalId } from "./offlineGuard.js";
import { toTitleCase } from "../utils/titleCase.js";
import { normalizeProductUnitFields } from "../utils/saleUnits.js";
import { notifyProductCatalogUpdated } from "../utils/catalogSync.js";

function enqueue(type, payload, label) {
  return useAdminOutboxStore().enqueue({ type, payload, label });
}

export function offlineCreateVendor(payload) {
  const id = newLocalId("localv");
  const row = {
    id,
    name: toTitleCase(payload.name),
    contact_person: payload.contact_person?.trim() ? toTitleCase(payload.contact_person) : null,
    phone: payload.phone?.trim() || null,
    address: payload.address?.trim() || null,
    notes: payload.notes?.trim() || null,
    is_active: payload.is_active !== false,
    updated_at: new Date().toISOString(),
    _offline: true,
  };
  if (!row.name) throw new Error("Vendor name is required");
  useMetaCacheStore().upsertVendor(row);
  enqueue("vendor.create", { localId: id, row }, `Vendor: ${row.name}`);
  return row;
}

export function offlineUpdateVendor(id, payload) {
  const row = {
    name: toTitleCase(payload.name),
    contact_person: payload.contact_person?.trim() ? toTitleCase(payload.contact_person) : null,
    phone: payload.phone?.trim() || null,
    address: payload.address?.trim() || null,
    notes: payload.notes?.trim() || null,
    is_active: Boolean(payload.is_active),
    updated_at: new Date().toISOString(),
  };
  if (!row.name) throw new Error("Vendor name is required");
  useMetaCacheStore().upsertVendor({ id, ...row });
  enqueue("vendor.update", { id, row }, `Vendor update: ${row.name}`);
  return { id, ...row };
}

export function offlineDeleteVendor(id) {
  const meta = useMetaCacheStore();
  const products = toRaw(useProductCacheStore().products) || [];
  const linked = products.reduce((n, p) => n + (p.vendor_id === id ? 1 : 0), 0);
  if (linked > 0) throw new Error(`Cannot delete: ${linked} product(s) still use this vendor`);
  const name = meta.vendors.find((v) => v.id === id)?.name || id;
  meta.removeVendor(id);
  enqueue("vendor.delete", { id }, `Vendor delete: ${name}`);
  return { ok: true, deleted: true };
}

export function offlineCreateCategory(name) {
  const trimmed = toTitleCase(name);
  if (!trimmed) throw new Error("Category name is required");
  const id = newLocalId("localc");
  const row = { id, name: trimmed, _offline: true };
  useMetaCacheStore().upsertCategory(row);
  enqueue("category.create", { localId: id, name: trimmed }, `Category: ${trimmed}`);
  return row;
}

export function offlineUpdateCategory(id, { name } = {}) {
  const trimmed = toTitleCase(name);
  if (!trimmed) throw new Error("Category name is required");
  useMetaCacheStore().upsertCategory({ id, name: trimmed });
  enqueue("category.update", { id, name: trimmed }, `Category update: ${trimmed}`);
  return { id, name: trimmed };
}

export function offlineDeleteCategory(id) {
  const products = toRaw(useProductCacheStore().products) || [];
  const linked = products.reduce((n, p) => n + (p.category_id === id ? 1 : 0), 0);
  if (linked > 0) throw new Error(`Cannot delete: ${linked} product(s) still use this category`);
  const name = useMetaCacheStore().categories.find((c) => c.id === id)?.name || id;
  useMetaCacheStore().removeCategory(id);
  enqueue("category.delete", { id }, `Category delete: ${name}`);
  return { ok: true };
}

export function offlineCreateProduct(payload) {
  const cache = useProductCacheStore();
  const meta = useMetaCacheStore();
  const units = normalizeProductUnitFields(payload);
  let externalId = String(payload.external_product_id ?? "").trim() || null;
  if (!externalId) {
    const vendorName =
      payload.vendor_name ||
      meta.vendors.find((v) => v.id === payload.vendor_id)?.name ||
      "XX";
    externalId = cache.nextLocalExternalId(vendorName);
  }
  const id = newLocalId("local");
  const qty = Math.max(0, Math.floor(Number(payload.initial_qty) || 0));
  const cost = Number(payload.purchase_price) || 0;
  const row = {
    id,
    name: toTitleCase(payload.name),
    external_product_id: externalId,
    sku: payload.sku?.trim() || null,
    barcode: payload.barcode?.trim() || null,
    category_id: payload.category_id || null,
    vendor_id: payload.vendor_id || null,
    selling_price: units.selling_price,
    weighted_avg_cost: cost,
    current_stock: qty,
    low_stock_threshold: Math.max(0, Math.floor(Number(payload.low_stock_threshold) || 5)),
    is_active: true,
    pieces_per_pack: units.pieces_per_pack,
    pieces_per_box: units.pieces_per_box,
    piece_selling_price: units.piece_selling_price,
    pack_selling_price: units.pack_selling_price,
    box_selling_price: units.box_selling_price,
    default_sale_unit: units.default_sale_unit,
    updated_at: new Date().toISOString(),
    tags: payload.tags || [],
    _offline: true,
  };
  if (!row.name) throw new Error("Product name is required");
  cache.upsertProduct(row);
  notifyProductCatalogUpdated();
  enqueue(
    "product.create",
    {
      localId: id,
      payload: {
        ...payload,
        external_product_id: externalId,
        name: row.name,
        vendor_id: row.vendor_id,
        category_id: row.category_id,
      },
    },
    `Product: ${row.name}`
  );
  return id;
}

export function offlineUpdateProduct(id, payload) {
  const cache = useProductCacheStore();
  const units = normalizeProductUnitFields(payload);
  const cost = Number(payload.weighted_avg_cost);
  const partial = {
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
  if (payload.tags !== undefined) partial.tags = payload.tags;
  if (!partial.name) throw new Error("Product name is required");
  cache.patchProduct(id, partial);
  notifyProductCatalogUpdated();
  enqueue("product.update", { id, payload }, `Product update: ${partial.name}`);
  return { id, ...partial };
}

export function offlineDeactivateProduct(id) {
  const cache = useProductCacheStore();
  cache.patchProduct(id, { is_active: false, updated_at: new Date().toISOString() });
  notifyProductCatalogUpdated();
  enqueue("product.deactivate", { id }, "Deactivate product");
  return cache.products.find((p) => p.id === id);
}

export function offlineDeleteProductsBulk(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  useProductCacheStore().removeProducts(unique);
  notifyProductCatalogUpdated();
  enqueue("product.deleteBulk", { ids: unique }, `Delete ${unique.length} product(s)`);
  return { deleted: unique.length, failed: [] };
}

export function offlineDeactivateProductsBulk(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const cache = useProductCacheStore();
  for (const id of unique) {
    cache.patchProduct(id, { is_active: false, updated_at: new Date().toISOString() });
  }
  notifyProductCatalogUpdated();
  enqueue("product.deactivateBulk", { ids: unique }, `Deactivate ${unique.length} product(s)`);
  return unique.length;
}

export function offlineReactivateProductsBulk(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const cache = useProductCacheStore();
  for (const id of unique) {
    cache.patchProduct(id, { is_active: true, updated_at: new Date().toISOString() });
  }
  notifyProductCatalogUpdated();
  enqueue("product.reactivateBulk", { ids: unique }, `Reactivate ${unique.length} product(s)`);
  return unique.length;
}

export function offlineReceiveStock({ productId, quantity, unitCost, vendorId, notes }) {
  const qty = Math.floor(Number(quantity));
  const cost = Number(unitCost) || 0;
  const cache = useProductCacheStore();
  const p = cache.products.find((x) => x.id === productId);
  if (!p) throw new Error("Product not found in local catalog");
  const prevQty = Math.floor(Number(p.current_stock) || 0);
  const prevCost = Number(p.weighted_avg_cost) || 0;
  const nextQty = prevQty + qty;
  const nextCost =
    nextQty > 0 ? (prevQty * prevCost + qty * cost) / nextQty : cost;
  cache.patchProduct(productId, {
    current_stock: nextQty,
    weighted_avg_cost: nextCost,
    updated_at: new Date().toISOString(),
  });
  notifyProductCatalogUpdated();
  enqueue(
    "inventory.receive",
    { productId, quantity: qty, unitCost: cost, vendorId: vendorId || null, notes: notes || null },
    `Receive stock ×${qty}`
  );
  return { ok: true };
}

export function offlineAdjustStock({ productId, quantityChange, movementType, notes }) {
  const delta = Math.floor(Number(quantityChange));
  useProductCacheStore().applyStockDelta(productId, delta);
  notifyProductCatalogUpdated();
  enqueue(
    "inventory.adjust",
    {
      productId,
      quantityChange: delta,
      movementType: movementType || "adjustment",
      notes: notes || null,
    },
    `Adjust stock ${delta >= 0 ? "+" : ""}${delta}`
  );
}

export function offlineSetProductStock(productId, newQuantity, notes) {
  const cache = useProductCacheStore();
  const p = cache.products.find((x) => x.id === productId);
  if (!p) throw new Error("Product not found in local catalog");
  const prev = Math.floor(Number(p.current_stock) || 0);
  const target = Math.max(0, Math.floor(Number(newQuantity) || 0));
  const delta = target - prev;
  if (delta === 0) return target;
  offlineAdjustStock({
    productId,
    quantityChange: delta,
    movementType: "correction",
    notes: notes || "Stock updated from Products",
  });
  return target;
}

export function offlineBulkUpdateSellingPrices(updates) {
  const cache = useProductCacheStore();
  for (const u of updates || []) {
    if (!u?.id) continue;
    cache.patchProduct(u.id, {
      selling_price: Number(u.selling_price),
      piece_selling_price: u.piece_selling_price != null ? Number(u.piece_selling_price) : undefined,
      pack_selling_price: u.pack_selling_price != null ? Number(u.pack_selling_price) : undefined,
      box_selling_price: u.box_selling_price != null ? Number(u.box_selling_price) : undefined,
      updated_at: new Date().toISOString(),
    });
  }
  notifyProductCatalogUpdated();
  enqueue("product.bulkPrices", { updates }, `Price update ×${(updates || []).length}`);
  return { updated: (updates || []).length };
}
