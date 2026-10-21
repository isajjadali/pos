import { requireSupabase } from "../lib/supabase.js";
import { toTitleCase } from "../utils/titleCase.js";
import { DEFAULT_STORE_CATEGORIES } from "../config/defaultCategories.js";

export async function listCategories() {
  const sb = requireSupabase();
  const { data, error } = await sb.from("categories").select("id, name").order("name");
  if (error) throw error;
  return data ?? [];
}

/**
 * Categories with product counts (Categories admin page).
 */
export async function listCategoriesWithCounts() {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("categories")
    .select("id, name, products(count)")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    product_count: Number(row.products?.[0]?.count ?? 0),
  }));
}

export async function createCategory(name) {
  const trimmed = toTitleCase(name);
  if (!trimmed) throw new Error("Category name is required");
  const sb = requireSupabase();
  const { data, error } = await sb.from("categories").insert({ name: trimmed }).select().single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id, { name } = {}) {
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
  return data;
}

export async function deleteCategory(id) {
  if (!id) throw new Error("Category id required");
  const sb = requireSupabase();
  const { count, error: cErr } = await sb
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);
  if (cErr) throw cErr;
  if ((count ?? 0) > 0) {
    throw new Error(`Cannot delete: ${count} product(s) still use this category`);
  }
  const { error } = await sb.from("categories").delete().eq("id", id);
  if (error) throw error;
  return { ok: true };
}

/**
 * Insert default store categories that are not already present (case-insensitive).
 * @returns {{ added: number, skipped: number }}
 */
export async function ensureDefaultCategories() {
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
    const { error } = await sb.from("categories").insert({ name });
    if (error) {
      // Unique race / already exists
      if (/duplicate|unique/i.test(error.message || "")) {
        skipped += 1;
        continue;
      }
      throw error;
    }
    have.add(key);
    added += 1;
  }
  return { added, skipped };
}
