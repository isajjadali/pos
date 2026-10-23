import { onConnectivityChange, getIsOnline } from "../composables/useOnlineStatus.js";
import { getEffectiveOnline, isLocalId, clearForcedOffline } from "./offlineGuard.js";
import { completeSaleFromCartOnline } from "./pos.js";
import { isHardSyncError, isLikelyNetworkError } from "./offlineSaleOutbox.js";
import { applyRemapToPayload } from "./adminOutbox.js";
import { useOfflineSalesStore } from "../stores/offlineSales.js";
import { syncProductCatalogAfterWrite } from "../utils/cacheSync.js";
import { supabaseConfigured } from "../lib/supabase.js";

let started = false;
let drainPromise = null;

function remapSaleLines(lines) {
  const remapped = applyRemapToPayload(lines || []);
  return Array.isArray(remapped) ? remapped : [];
}

function linesStillHaveLocalIds(lines) {
  return (lines || []).some((l) => isLocalId(l?.product_id));
}

async function drainOnce() {
  if (!supabaseConfigured) return { synced: 0, failed: 0 };
  // Sticky-offline can block drain while the browser is actually online
  if (getIsOnline()) clearForcedOffline();
  if (!getEffectiveOnline()) return { synced: 0, failed: 0 };

  // Products created offline must sync (and remap) before sales that reference them
  try {
    const { drainAdminOutbox } = await import("./adminOutboxSync.js");
    await drainAdminOutbox();
  } catch {
    /* admin drain optional if already running */
  }

  const store = useOfflineSalesStore();
  store.hydrate();
  if (store.syncing) return drainPromise;
  store.syncing = true;
  store.lastSyncError = "";
  let synced = 0;
  let failed = 0;
  let deferred = 0;
  try {
    const queue = store.entries.filter((e) => e.status === "pending" || e.status === "failed");
    for (const entry of queue) {
      if (!getEffectiveOnline()) break;
      store.patch(entry.clientSaleId, { status: "syncing", lastError: null });
      try {
        const lines = remapSaleLines(entry.lines);
        if (linesStillHaveLocalIds(lines)) {
          store.patch(entry.clientSaleId, {
            status: "pending",
            lastError: "Waiting for offline product(s) to sync first",
            lines,
          });
          deferred += 1;
          continue;
        }
        // Persist remapped ids so retries don't keep local_ uuids
        if (JSON.stringify(lines) !== JSON.stringify(entry.lines)) {
          store.patch(entry.clientSaleId, { lines });
        }
        await completeSaleFromCartOnline(lines, {
          discount: entry.discount,
          amountReceived: entry.amountReceived,
        });
        store.discard(entry.clientSaleId);
        synced += 1;
      } catch (err) {
        const msg = err?.message || String(err);
        // UUID errors usually mean a local_ id slipped through — keep pending, not failed
        if (/invalid input syntax for type uuid/i.test(msg) || /local_/i.test(msg)) {
          store.patch(entry.clientSaleId, {
            status: "pending",
            lastError: "Waiting for offline product(s) to sync first",
          });
          deferred += 1;
          continue;
        }
        if (isLikelyNetworkError(err)) {
          store.patch(entry.clientSaleId, { status: "pending", lastError: msg });
          store.lastSyncError = msg;
          break;
        }
        if (isHardSyncError(err)) {
          store.patch(entry.clientSaleId, { status: "failed", lastError: msg });
          failed += 1;
          continue;
        }
        store.patch(entry.clientSaleId, { status: "pending", lastError: msg });
        store.lastSyncError = msg;
        break;
      }
    }
    if (synced > 0) {
      await syncProductCatalogAfterWrite();
    }
  } finally {
    store.syncing = false;
    store.hydrate();
  }
  return { synced, failed, deferred };
}

export function drainOfflineSaleOutbox() {
  if (drainPromise) return drainPromise;
  drainPromise = drainOnce().finally(() => {
    drainPromise = null;
  });
  return drainPromise;
}

/** Call once after Pinia is ready (e.g. from main.js). */
export function startOfflineSaleSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  const store = useOfflineSalesStore();
  store.hydrate();

  const kick = () => {
    import("./adminOutboxSync.js")
      .then((m) => m.drainAllOfflineQueues())
      .catch(() => drainOfflineSaleOutbox());
  };

  onConnectivityChange((online) => {
    if (online) kick();
  });
  window.addEventListener("focus", () => {
    if (getEffectiveOnline()) kick();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && getEffectiveOnline()) kick();
  });

  if (getEffectiveOnline() && store.pendingCount > 0) {
    kick();
  }
}
