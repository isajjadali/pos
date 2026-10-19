import { useProductCacheStore } from "../stores/productCache.js";
import { usePosCartStore } from "../stores/posCart.js";

/** Fired after in-memory product catalog changes (refresh, import, sale delete, etc.). */
export const PRODUCT_CATALOG_UPDATED = "dw-product-catalog-updated";

/** Keep open POS carts and other listeners in sync with the latest catalog. */
export function notifyProductCatalogUpdated() {
  try {
    const productCache = useProductCacheStore();
    const posCart = usePosCartStore();
    posCart.syncLineStockFromCatalog((id) => productCache.products.find((p) => p.id === id));
  } catch {
    /* Pinia may not be ready during early boot */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PRODUCT_CATALOG_UPDATED));
  }
}
