import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { requireSupabase, supabaseConfigured } from "../lib/supabase.js";
import { notifyProductCatalogUpdated } from "../utils/catalogSync.js";
import { vendorInitialsPrefix } from "../utils/titleCase.js";
import { getEffectiveOnline } from "../services/offlineGuard.js";
import { matchesSearchFields } from "../utils/textSearch.js";

const STORAGE_KEY = "dw_product_catalog_v2";

const POS_FIELDS =
  "id, name, barcode, sku, external_product_id, selling_price, current_stock, is_active, weighted_avg_cost, vendor_id, category_id, created_at, updated_at, pieces_per_pack, pieces_per_box, piece_selling_price, pack_selling_price, box_selling_price, default_sale_unit";

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.products)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveToStorage(products, syncedAt) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ products, syncedAt, version: 1 })
    );
  } catch {
    /* quota — memory cache still works */
  }
}

function applyStoragePayload(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed?.products)) return false;
    return parsed;
  } catch {
    return false;
  }
}

export const useProductCacheStore = defineStore("productCache", () => {
  const products = ref([]);
  const syncedAt = ref(null);
  const loading = ref(false);
  const error = ref("");

  const ready = computed(() => products.value.length > 0);

  const activeProducts = computed(() => products.value.filter((p) => p.is_active));

  function hydrateFromStorage() {
    const saved = loadFromStorage();
    if (saved?.products?.length) {
      products.value = saved.products;
      syncedAt.value = saved.syncedAt ?? null;
    }
  }

  async function refresh({ force = false } = {}) {
    if (!supabaseConfigured) return;
    // Never hang the UI trying to refresh catalog while offline
    // (force=true after a successful server write — sticky-offline must not skip sync)
    if (!force && !getEffectiveOnline()) return;
    loading.value = true;
    error.value = "";
    try {
      const pendingLocal = products.value.filter((p) => String(p.id).startsWith("local_"));
      const sb = requireSupabase();
      const all = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error: err } = await sb
          .from("products")
          .select(POS_FIELDS)
          .order("name")
          .range(from, from + pageSize - 1);
        if (err) throw err;
        const chunk = data ?? [];
        all.push(...chunk);
        if (chunk.length < pageSize) break;
        from += pageSize;
      }
      const serverIds = new Set(all.map((p) => p.id));
      products.value = [
        ...all,
        ...pendingLocal.filter((p) => !serverIds.has(p.id)),
      ];
      syncedAt.value = new Date().toISOString();
      saveToStorage(products.value, syncedAt.value);
    } catch (e) {
      error.value = e.message || "Failed to load products";
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function clear() {
    products.value = [];
    syncedAt.value = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  function patchProduct(id, partial) {
    const idx = products.value.findIndex((p) => p.id === id);
    if (idx === -1) return;
    products.value[idx] = { ...products.value[idx], ...partial };
    saveToStorage(products.value, syncedAt.value);
  }

  function applyStockDelta(productId, deltaQty) {
    const p = products.value.find((x) => x.id === productId);
    if (!p) return;
    p.current_stock = Math.max(0, Number(p.current_stock) + deltaQty);
    saveToStorage(products.value, syncedAt.value);
  }

  function upsertProduct(row) {
    if (!row?.id) return;
    const idx = products.value.findIndex((p) => p.id === row.id);
    if (idx === -1) products.value.push({ ...row });
    else products.value[idx] = { ...products.value[idx], ...row };
    saveToStorage(products.value, syncedAt.value);
  }

  function removeProducts(ids) {
    const set = new Set((ids || []).filter(Boolean));
    if (!set.size) return;
    products.value = products.value.filter((p) => !set.has(p.id));
    saveToStorage(products.value, syncedAt.value);
  }

  function replaceProductId(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    const idx = products.value.findIndex((p) => p.id === oldId);
    if (idx === -1) return;
    products.value[idx] = { ...products.value[idx], id: newId };
    saveToStorage(products.value, syncedAt.value);
  }

  function nextLocalExternalId(prefixOrVendorName) {
    const prefix = vendorInitialsPrefix(prefixOrVendorName);
    let max = 0;
    const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`, "i");
    for (const p of products.value) {
      const m = String(p.external_product_id || "").match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix}-${max + 1}`;
  }

  function searchForPos(term, limit = 30) {
    const q = String(term ?? "").trim();
    if (!q) return [];
    return activeProducts.value
      .filter((p) =>
        matchesSearchFields([p.name, p.barcode, p.sku, p.external_product_id], q)
      )
      .slice(0, limit);
  }

  function findByScanCode(code) {
    const term = String(code ?? "").trim();
    if (!term) return null;
    const lower = term.toLowerCase();
    return (
      activeProducts.value.find(
        (p) =>
          p.barcode === term ||
          p.sku === term ||
          p.external_product_id === term ||
          (p.barcode && p.barcode.toLowerCase() === lower) ||
          (p.sku && p.sku.toLowerCase() === lower) ||
          (p.external_product_id && p.external_product_id.toLowerCase() === lower)
      ) ?? null
    );
  }

  return {
    products,
    syncedAt,
    loading,
    error,
    ready,
    activeProducts,
    hydrateFromStorage,
    refresh,
    clear,
    patchProduct,
    applyStockDelta,
    upsertProduct,
    removeProducts,
    replaceProductId,
    nextLocalExternalId,
    searchForPos,
    findByScanCode,
  };
});

/** Call after login or when catalog may have changed on server. */
export async function refreshProductCatalog({ force = false } = {}) {
  const store = useProductCacheStore();
  await store.refresh({ force });
  notifyProductCatalogUpdated();
}

export function clearProductCatalog() {
  useProductCacheStore().clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    const parsed = applyStoragePayload(e.newValue);
    if (!parsed) return;
    const store = useProductCacheStore();
    store.products = parsed.products;
    store.syncedAt = parsed.syncedAt ?? null;
    notifyProductCatalogUpdated();
  });
}
