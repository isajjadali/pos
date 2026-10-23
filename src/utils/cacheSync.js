import { clearForcedOffline } from "../services/offlineGuard.js";
import { refreshProductCatalog } from "../stores/productCache.js";
import { refreshMetaCache } from "../stores/metaCache.js";

/**
 * After a successful server write: clear sticky-offline and force-refresh caches
 * so list UIs don't keep serving stale local data until a full page reload.
 */
export async function syncProductCatalogAfterWrite() {
  clearForcedOffline();
  try {
    await refreshProductCatalog({ force: true });
  } catch {
    /* next login / manual refresh */
  }
}

export async function syncMetaCacheAfterWrite() {
  clearForcedOffline();
  try {
    await refreshMetaCache({ force: true });
  } catch {
    /* next login / manual refresh */
  }
}

export async function syncCachesAfterWrite() {
  clearForcedOffline();
  await Promise.all([
    refreshProductCatalog({ force: true }).catch(() => {}),
    refreshMetaCache({ force: true }).catch(() => {}),
  ]);
}
