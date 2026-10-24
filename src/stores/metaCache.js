import { defineStore } from "pinia";
import { ref } from "vue";
import { requireSupabase, supabaseConfigured } from "../lib/supabase.js";
import { getEffectiveOnline } from "../services/offlineGuard.js";

const VENDOR_KEY = "dw_vendors_cache_v1";
const CATEGORY_KEY = "dw_categories_cache_v1";

function loadJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

export const useMetaCacheStore = defineStore("metaCache", () => {
  const vendors = ref([]);
  const categories = ref([]);
  const syncedAt = ref(null);

  function hydrateFromStorage() {
    const v = loadJson(VENDOR_KEY);
    const c = loadJson(CATEGORY_KEY);
    if (Array.isArray(v?.rows)) vendors.value = v.rows;
    if (Array.isArray(c?.rows)) categories.value = c.rows;
    syncedAt.value = v?.syncedAt || c?.syncedAt || null;
  }

  function persistVendors() {
    saveJson(VENDOR_KEY, { rows: vendors.value, syncedAt: syncedAt.value });
  }

  function persistCategories() {
    saveJson(CATEGORY_KEY, { rows: categories.value, syncedAt: syncedAt.value });
  }

  async function refresh({ force = false } = {}) {
    if (!supabaseConfigured) return;
    if (!force && !getEffectiveOnline()) return;
    const sb = requireSupabase();
    const localVendors = vendors.value.filter((x) => String(x.id).startsWith("local"));
    const localCats = categories.value.filter((x) => String(x.id).startsWith("local"));

    const [{ data: vRows, error: vErr }, { data: cRows, error: cErr }] = await Promise.all([
      sb.from("vendors").select("*").order("name"),
      sb.from("categories").select("id, name, is_active, created_at").order("name"),
    ]);
    if (vErr) throw vErr;
    if (cErr) throw cErr;

    const serverV = vRows ?? [];
    const serverC = cRows ?? [];
    const serverVIds = new Set(serverV.map((x) => x.id));
    const serverCIds = new Set(serverC.map((x) => x.id));

    vendors.value = [
      ...serverV,
      ...localVendors.filter((x) => !serverVIds.has(x.id)),
    ];
    categories.value = [
      ...serverC,
      ...localCats.filter((x) => !serverCIds.has(x.id)),
    ];
    syncedAt.value = new Date().toISOString();
    persistVendors();
    persistCategories();
  }

  function setVendors(rows) {
    const localPending = vendors.value.filter((x) => String(x.id).startsWith("local"));
    const server = Array.isArray(rows) ? rows : [];
    const serverIds = new Set(server.map((x) => x.id));
    vendors.value = [...server, ...localPending.filter((x) => !serverIds.has(x.id))];
    syncedAt.value = new Date().toISOString();
    persistVendors();
  }

  function setCategories(rows) {
    const localPending = categories.value.filter((x) => String(x.id).startsWith("local"));
    const server = Array.isArray(rows) ? rows : [];
    const serverIds = new Set(server.map((x) => x.id));
    categories.value = [...server, ...localPending.filter((x) => !serverIds.has(x.id))];
    syncedAt.value = new Date().toISOString();
    persistCategories();
  }

  function upsertVendor(row) {
    const idx = vendors.value.findIndex((v) => v.id === row.id);
    if (idx === -1) vendors.value.push(row);
    else vendors.value[idx] = { ...vendors.value[idx], ...row };
    persistVendors();
  }

  function removeVendor(id) {
    vendors.value = vendors.value.filter((v) => v.id !== id);
    persistVendors();
  }

  function replaceVendorId(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    const idx = vendors.value.findIndex((v) => v.id === oldId);
    if (idx !== -1) {
      vendors.value[idx] = { ...vendors.value[idx], id: newId };
      persistVendors();
    }
  }

  function upsertCategory(row) {
    const idx = categories.value.findIndex((c) => c.id === row.id);
    if (idx === -1) categories.value.push(row);
    else categories.value[idx] = { ...categories.value[idx], ...row };
    persistCategories();
  }

  function removeCategory(id) {
    categories.value = categories.value.filter((c) => c.id !== id);
    persistCategories();
  }

  function replaceCategoryId(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    const idx = categories.value.findIndex((c) => c.id === oldId);
    if (idx === -1) return;
    categories.value[idx] = { ...categories.value[idx], id: newId };
    persistCategories();
  }

  function clear() {
    vendors.value = [];
    categories.value = [];
    syncedAt.value = null;
    localStorage.removeItem(VENDOR_KEY);
    localStorage.removeItem(CATEGORY_KEY);
  }

  return {
    vendors,
    categories,
    syncedAt,
    hydrateFromStorage,
    refresh,
    setVendors,
    setCategories,
    upsertVendor,
    removeVendor,
    replaceVendorId,
    upsertCategory,
    removeCategory,
    replaceCategoryId,
    clear,
  };
});

export async function refreshMetaCache({ force = false } = {}) {
  const store = useMetaCacheStore();
  await store.refresh({ force });
}
