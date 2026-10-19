import { requireSupabase } from "../lib/supabase.js";
import { formatProductTagLabel, normalizeProductTags } from "../utils/productTags.js";

export const TAGS_MIGRATION_HINT =
  "Product tags are not on the database yet. Apply migration supabase/migrations/20251018150000_product_tags.sql (e.g. supabase db push), then reload the app.";

let tagsDbReadyCache;

export function isTagsSchemaError(error) {
  const msg = String(error?.message || error || "");
  return /tags.*schema cache|could not find the 'tags' column/i.test(msg);
}

/** Whether `products.tags` exists (migration 20251018150000 applied). */
export async function isProductTagsDbReady() {
  if (tagsDbReadyCache !== undefined) return tagsDbReadyCache;
  const sb = requireSupabase();
  const { error } = await sb.from("products").select("tags").limit(1).maybeSingle();
  if (!error) {
    tagsDbReadyCache = true;
    return true;
  }
  if (isTagsSchemaError(error)) {
    tagsDbReadyCache = false;
    return false;
  }
  tagsDbReadyCache = false;
  return false;
}

export async function listProductTagOptions() {
  if (!(await isProductTagsDbReady())) return [];
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("list_product_tags");
  if (error) {
    if (isTagsSchemaError(error)) return [];
    throw error;
  }
  return (data ?? []).map((row) => ({
    label: `${formatProductTagLabel(row.name)} (${row.product_count})`,
    value: row.name,
    count: Number(row.product_count) || 0,
  }));
}

export async function setProductTags(productId, tags) {
  if (!(await isProductTagsDbReady())) {
    const normalized = normalizeProductTags(tags);
    if (normalized.length) throw new Error(TAGS_MIGRATION_HINT);
    return [];
  }
  const sb = requireSupabase();
  const normalized = normalizeProductTags(tags);
  const { error } = await sb.from("products").update({ tags: normalized }).eq("id", productId);
  if (error) {
    if (isTagsSchemaError(error)) throw new Error(TAGS_MIGRATION_HINT);
    throw error;
  }
  return normalized;
}
