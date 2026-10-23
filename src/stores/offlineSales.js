import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  listOutboxEntries,
  enqueueOfflineSale,
  updateOutboxEntry,
  removeOutboxEntry,
} from "../services/offlineSaleOutbox.js";

export const useOfflineSalesStore = defineStore("offlineSales", () => {
  const entries = ref([]);
  const syncing = ref(false);
  const lastSyncError = ref("");

  const pendingEntries = computed(() =>
    entries.value.filter((e) => e.status === "pending" || e.status === "syncing" || e.status === "failed")
  );
  const pendingCount = computed(() => pendingEntries.value.length);
  const failedCount = computed(() => entries.value.filter((e) => e.status === "failed").length);

  function hydrate() {
    entries.value = listOutboxEntries();
  }

  function enqueue(entry) {
    enqueueOfflineSale(entry);
    hydrate();
    return entry;
  }

  function patch(clientSaleId, patchObj) {
    updateOutboxEntry(clientSaleId, patchObj);
    hydrate();
  }

  function discard(clientSaleId) {
    removeOutboxEntry(clientSaleId);
    hydrate();
  }

  function markPending(clientSaleId) {
    patch(clientSaleId, { status: "pending", lastError: null });
  }

  return {
    entries,
    syncing,
    lastSyncError,
    pendingEntries,
    pendingCount,
    failedCount,
    hydrate,
    enqueue,
    patch,
    discard,
    markPending,
  };
});
