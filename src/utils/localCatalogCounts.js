import { toRaw } from "vue";
import { useProductCacheStore } from "../stores/productCache.js";

/**
 * Count products per category/vendor from the local catalog.
 * Uses toRaw() so we don't pay Vue Proxy overhead on large catalogs.
 */
export function countProductsByField(field) {
  const raw = toRaw(useProductCacheStore().products) || [];
  const map = Object.create(null);
  for (let i = 0; i < raw.length; i++) {
    const id = raw[i]?.[field];
    if (!id) continue;
    map[id] = (map[id] || 0) + 1;
  }
  return map;
}
