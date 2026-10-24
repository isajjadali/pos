import { requireSupabase } from "../lib/supabase.js";
import { toTitleCase } from "../utils/titleCase.js";
import { DEFAULT_STORE_CATEGORIES } from "../config/defaultCategories.js";
import { onlineOrOfflineWrite, onlineOrOfflineRead, shouldReadOffline } from "./offlineGuard.js";
import {
  offlineCreateCategory,
  offlineUpdateCategory,
  offlineDeleteCategory,
} from "./adminOfflineApply.js";
import { useMetaCacheStore } from "../stores/metaCache.js";
import { countProductsByField } from "../utils/localCatalogCounts.js";
import { syncMetaCacheAfterWrite } from "../utils/cacheSync.js";

function listCategoriesLocal({ activeOnly = true } = {}) {
  return useMetaCacheStore()
    .categories.filter((c) => !activeOnly || c.is_active !== false)
    .map((c) => ({ id: c.id, name: c.name, is_active: c.is_active !== false }));
}

function listCategoriesWithCountsLocal() {
  const countMap = countProductsByField("category_id");
  return useMetaCacheStore().categories.map((c) => ({
    id: c.id,
    name: c.name,
    created_at: c.created_at ?? null,
    is_active: c.is_active !== false,
    product_count: countMap[c.id] || 0,
  }));
}

/** Active categories for product forms / pickers. */
export async function listCategories() {
  return onlineOrOfflineRead(async () => {
    const sb = requireSupabase();
    const { data, error } = await sb
      .from("categories")
      .select("id, name, created_at, is_active")
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    useMetaCacheStore().setCategories(data ?? []);
    return data ?? [];
  }, () => listCategoriesLocal({ activeOnly: true }));
}

/**
 * Categories with product counts (Categories admin page) — includes inactive.
 */
export async function listCategoriesWithCounts() {
  return onlineOrOfflineRead(async () => {
    const sb = requireSupabase();
    const { data, error } = await sb
      .from("categories")
      .select("id, name, created_at, is_active, products(count)")
      .order("name");
    if (error) throw error;
    const rows = (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      created_at: row.created_at,
      is_active: row.is_active !== false,
      product_count: Number(row.products?.[0]?.count ?? 0),
    }));
    useMetaCacheStore().setCategories(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        created_at: r.created_at,
        is_active: r.is_active,
      }))
    );
    return rows;
  }, listCategoriesWithCountsLocal);
}

export async function createCategory(name) {
  return onlineOrOfflineWrite(async () => {
    const trimmed = toTitleCase(name);
    if (!trimmed) throw new Error("Category name is required");
    const sb = requireSupabase();
    const { data, error } = await sb
      .from("categories")
      .insert({ name: trimmed, is_active: true })
      .select()
      .single();
    if (error) throw error;
    useMetaCacheStore().upsertCategory(data);
    return data;
  }, () => offlineCreateCategory(name));
}

export async function updateCategory(id, { name } = {}) {
  return onlineOrOfflineWrite(async () => {
    if (!id) throw new Error("Category id required");
    const trimmed = toTitleCase(name);
    if (!trimmed) throw new Error("Category name is required");
    const sb = requireSupabase();
    const { data, error } = await sb
      .from("categories")
      .update({ name: trimmed })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    useMetaCacheStore().upsertCategory(data);
    return data;
  }, () => offlineUpdateCategory(id, { name }));
}

/** Soft-delete category (is_active = false). Linked products keep category_id. */
export async function deleteCategory(id) {
  return onlineOrOfflineWrite(async () => {
    if (!id) throw new Error("Category id required");
    const sb = requireSupabase();
    const { data, error } = await sb
      .from("categories")
      .update({ is_active: false })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    useMetaCacheStore().upsertCategory({ ...data, is_active: false });
    return { ok: true, soft: true };
  }, () => offlineDeleteCategory(id));
}

/**
 * Insert default store categories that are not already present (case-insensitive).
 * @returns {{ added: number, skipped: number }}
 */
export async function ensureDefaultCategories() {
  if (shouldReadOffline()) {
    let added = 0;
    let skipped = 0;
    const existing = await listCategories();
    const have = new Set(existing.map((c) => String(c.name || "").trim().toLowerCase()));
    for (const raw of DEFAULT_STORE_CATEGORIES) {
      const name = String(raw || "").trim();
      if (!name) continue;
      if (have.has(name.toLowerCase())) {
        skipped += 1;
        continue;
      }
      await createCategory(name);
      have.add(name.toLowerCase());
      added += 1;
    }
    return { added, skipped };
  }
  const sb = requireSupabase();
  const existing = await listCategories();
  const have = new Set(existing.map((c) => String(c.name || "").trim().toLowerCase()));
  let added = 0;
  let skipped = 0;
  for (const raw of DEFAULT_STORE_CATEGORIES) {
    const name = String(raw || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (have.has(key)) {
      skipped += 1;
      continue;
    }
    const { error } = await sb.from("categories").insert({ name: toTitleCase(name) });
    if (error) {
      if (String(error.message || "").toLowerCase().includes("duplicate")) {
        skipped += 1;
        continue;
      }
      throw error;
    }
    have.add(key);
    added += 1;
  }
  await syncMetaCacheAfterWrite();
  return { added, skipped };
}
