import { onConnectivityChange } from "../composables/useOnlineStatus.js";
import { getEffectiveOnline, clearForcedOffline } from "./offlineGuard.js";
import { isHardSyncError, isLikelyNetworkError } from "./offlineSaleOutbox.js";
import { applyRemapToPayload, rememberIdRemap } from "./adminOutbox.js";
import { useAdminOutboxStore } from "../stores/adminOutbox.js";
import { useProductCacheStore } from "../stores/productCache.js";
import { useMetaCacheStore } from "../stores/metaCache.js";
import { supabaseConfigured, requireSupabase } from "../lib/supabase.js";
import { drainOfflineSaleOutbox } from "./offlineSaleSync.js";
import { syncCachesAfterWrite } from "../utils/cacheSync.js";
import { getIsOnline } from "../composables/useOnlineStatus.js";

let started = false;
let drainPromise = null;

async function execMutation(entry) {
  const type = entry.type;
  const payload = applyRemapToPayload(entry.payload || {});
  const sb = requireSupabase();
  const products = useProductCacheStore();
  const meta = useMetaCacheStore();

  switch (type) {
    case "vendor.create": {
      const row = { ...payload.row };
      delete row.id;
      delete row._offline;
      const { data, error } = await sb.from("vendors").insert(row).select().single();
      if (error) throw error;
      rememberIdRemap(payload.localId, data.id);
      meta.replaceVendorId(payload.localId, data.id);
      return;
    }
    case "vendor.update": {
      const { error } = await sb.from("vendors").update(payload.row).eq("id", payload.id);
      if (error) throw error;
      return;
    }
    case "vendor.delete": {
      const { data, error } = await sb.rpc("delete_vendor_if_unused", { p_vendor_id: payload.id });
      if (error) throw error;
      return data;
    }
    case "category.create": {
      const { data, error } = await sb
        .from("categories")
        .insert({ name: payload.name })
        .select()
        .single();
      if (error) throw error;
      rememberIdRemap(payload.localId, data.id);
      meta.replaceCategoryId(payload.localId, data.id);
      return;
    }
    case "category.update": {
      const { error } = await sb
        .from("categories")
        .update({ name: payload.name })
        .eq("id", payload.id);
      if (error) throw error;
      return;
    }
    case "category.delete": {
      const { error } = await sb
        .from("categories")
        .update({ is_active: false })
        .eq("id", payload.id);
      if (error) throw error;
      return;
    }
    case "product.create": {
      const { createProduct } = await import("./products.js");
      const id = await createProduct(payload.payload, { forceOnline: true, sync: false });
      rememberIdRemap(payload.localId, id);
      products.replaceProductId(payload.localId, id);
      return;
    }
    case "product.update": {
      const { updateProduct } = await import("./products.js");
      await updateProduct(payload.id, payload.payload, { forceOnline: true, sync: false });
      return;
    }
    case "product.deactivate": {
      const { error } = await sb
        .from("products")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", payload.id);
      if (error) throw error;
      return;
    }
    case "product.deleteBulk": {
      const { data, error } = await sb.rpc("delete_products_bulk", {
        p_product_ids: payload.ids,
      });
      if (error) throw error;
      return data;
    }
    case "product.deactivateBulk": {
      const { data, error } = await sb.rpc("deactivate_products_bulk", {
        p_product_ids: payload.ids,
      });
      if (error) throw error;
      return data;
    }
    case "product.reactivateBulk": {
      const unique = [...new Set((payload.ids || []).filter(Boolean))];
      if (!unique.length) return 0;
      const { error, count } = await sb
        .from("products")
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .in("id", unique);
      if (error) throw error;
      return count ?? unique.length;
    }
    case "product.bulkPrices": {
      const { bulkUpdateSellingPricesOnline } = await import("./priceGroups.js");
      await bulkUpdateSellingPricesOnline(payload.updates);
      return;
    }
    case "inventory.receive": {
      const { error } = await sb.rpc("receive_stock", {
        p_product_id: payload.productId,
        p_quantity: payload.quantity,
        p_unit_cost: payload.unitCost,
        p_vendor_id: payload.vendorId,
        p_notes: payload.notes,
      });
      if (error) throw error;
      return;
    }
    case "inventory.adjust": {
      const { error } = await sb.rpc("adjust_stock", {
        p_product_id: payload.productId,
        p_quantity_change: payload.quantityChange,
        p_movement_type: payload.movementType,
        p_notes: payload.notes,
      });
      if (error) throw error;
      return;
    }
    case "settings.update": {
      const currentId = payload.id;
      if (currentId) {
        const { error } = await sb.from("app_settings").update(payload.row).eq("id", currentId);
        if (error) throw error;
      } else {
        const { data: existing } = await sb.from("app_settings").select("id").limit(1).maybeSingle();
        if (existing?.id) {
          const { error } = await sb.from("app_settings").update(payload.row).eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await sb.from("app_settings").insert(payload.row);
          if (error) throw error;
        }
      }
      return;
    }
    default:
      throw new Error(`Unknown offline mutation: ${type}`);
  }
}

async function drainOnce() {
  if (!supabaseConfigured) return { synced: 0, failed: 0 };
  if (getIsOnline()) clearForcedOffline();
  if (!getEffectiveOnline()) return { synced: 0, failed: 0 };
  const store = useAdminOutboxStore();
  store.hydrate();
  if (store.syncing) return drainPromise;
  store.syncing = true;
  store.lastSyncError = "";
  let synced = 0;
  let failed = 0;
  try {
    const queue = store.entries.filter((e) => e.status === "pending" || e.status === "failed");
    for (const entry of queue) {
      if (!getEffectiveOnline()) break;
      store.patch(entry.id, { status: "syncing", lastError: null });
      try {
        await execMutation(entry);
        store.discard(entry.id);
        synced += 1;
      } catch (err) {
        const msg = err?.message || String(err);
        if (isLikelyNetworkError(err)) {
          store.patch(entry.id, { status: "pending", lastError: msg });
          store.lastSyncError = msg;
          break;
        }
        if (isHardSyncError(err)) {
          store.patch(entry.id, { status: "failed", lastError: msg });
          failed += 1;
          continue;
        }
        store.patch(entry.id, { status: "pending", lastError: msg });
        store.lastSyncError = msg;
        break;
      }
    }
    if (synced > 0) {
      await syncCachesAfterWrite();
    }
  } finally {
    store.syncing = false;
    store.hydrate();
  }
  return { synced, failed };
}

export function drainAdminOutbox() {
  if (drainPromise) return drainPromise;
  drainPromise = drainOnce().finally(() => {
    drainPromise = null;
  });
  return drainPromise;
}

export async function drainAllOfflineQueues() {
  const admin = await drainAdminOutbox();
  const sales = await drainOfflineSaleOutbox();
  return {
    synced: (admin?.synced || 0) + (sales?.synced || 0),
    failed: (admin?.failed || 0) + (sales?.failed || 0),
  };
}

export function startAdminOutboxSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  const store = useAdminOutboxStore();
  store.hydrate();

  onConnectivityChange((online) => {
    if (online) drainAllOfflineQueues();
  });
  window.addEventListener("focus", () => {
    if (getEffectiveOnline()) drainAllOfflineQueues();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && getEffectiveOnline()) {
      drainAllOfflineQueues();
    }
  });

  if (getEffectiveOnline() && store.pendingCount > 0) {
    drainAdminOutbox();
  }
}
