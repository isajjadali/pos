import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  listAdminOutbox,
  enqueueAdminMutation,
  updateAdminMutation,
  removeAdminMutation,
} from "../services/adminOutbox.js";

export const useAdminOutboxStore = defineStore("adminOutbox", () => {
  const entries = ref([]);
  const syncing = ref(false);
  const lastSyncError = ref("");

  const pendingEntries = computed(() =>
    entries.value.filter((e) => e.status === "pending" || e.status === "syncing" || e.status === "failed")
  );
  const pendingCount = computed(() => pendingEntries.value.length);
  const failedCount = computed(() => entries.value.filter((e) => e.status === "failed").length);

  function hydrate() {
    entries.value = listAdminOutbox();
  }

  function enqueue(entry) {
    const row = enqueueAdminMutation(entry);
    hydrate();
    return row;
  }

  function patch(id, patchObj) {
    updateAdminMutation(id, patchObj);
    hydrate();
  }

  function discard(id) {
    removeAdminMutation(id);
    hydrate();
  }

  function markPending(id) {
    patch(id, { status: "pending", lastError: null });
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
