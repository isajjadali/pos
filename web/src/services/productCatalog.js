import { useProductCacheStore, refreshProductCatalog } from "../stores/productCache.js";

export { refreshProductCatalog, clearProductCatalog } from "../stores/productCache.js";

export function searchProductsCached(term, limit = 20) {
  return useProductCacheStore().searchForPos(term, limit);
}

export function findProductByCodeCached(code) {
  return useProductCacheStore().findByScanCode(code);
}

export function isProductCatalogReady() {
  return useProductCacheStore().ready;
}
