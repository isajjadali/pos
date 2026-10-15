import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { requireSupabase, supabaseConfigured } from "../lib/supabase.js";

const STORAGE_KEY = "dw_product_catalog_v1";

const POS_FIELDS =
  "id, name, barcode, sku, external_product_id, selling_price, current_stock, is_active, weighted_avg_cost, vendor_id, category_id, updated_at";

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

  async function refresh() {
    if (!supabaseConfigured) return;
    loading.value = true;
    error.value = "";
    try {
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
      products.value = all;
      syncedAt.value = new Date().toISOString();
      saveToStorage(all, syncedAt.value);
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

  function searchForPos(term, limit = 20) {
    const q = String(term ?? "").trim().toLowerCase();
    if (!q) return [];
    return activeProducts.value
      .filter((p) => {
        const name = (p.name ?? "").toLowerCase();
        const barcode = (p.barcode ?? "").toLowerCase();
        const sku = (p.sku ?? "").toLowerCase();
        const ext = (p.external_product_id ?? "").toLowerCase();
        return name.includes(q) || barcode.includes(q) || sku.includes(q) || ext.includes(q);
      })
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
    searchForPos,
    findByScanCode,
  };
});

/** Call after login or when catalog may have changed on server. */
export async function refreshProductCatalog() {
  const store = useProductCacheStore();
  await store.refresh();
}

export function clearProductCatalog() {
  useProductCacheStore().clear();
}
