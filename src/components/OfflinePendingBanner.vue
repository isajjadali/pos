<script setup>
import { storeToRefs } from "pinia";
import { NAlert, NButton, useMessage } from "naive-ui";
import { useOnlineStatus } from "../composables/useOnlineStatus.js";
import { useAdminOutboxStore } from "../stores/adminOutbox.js";
import { useOfflineSalesStore } from "../stores/offlineSales.js";
import { drainAllOfflineQueues } from "../services/adminOutboxSync.js";

defineProps({
  /** Show admin mutation details (products/vendors/etc.) */
  showAdmin: { type: Boolean, default: true },
  /** Show POS sale outbox details */
  showSales: { type: Boolean, default: false },
});

const message = useMessage();
const { online } = useOnlineStatus();
const admin = useAdminOutboxStore();
const sales = useOfflineSalesStore();
const { pendingCount: adminPending, failedCount: adminFailed, pendingEntries: adminEntries, syncing: adminSyncing } =
  storeToRefs(admin);
const { pendingCount: salesPending, failedCount: salesFailed } = storeToRefs(sales);

admin.hydrate();
sales.hydrate();

async function syncNow() {
  const result = await drainAllOfflineQueues();
  if (result?.synced) message.success(`Synced ${result.synced} change(s)`);
  else if (result?.failed) message.warning(`${result.failed} change(s) failed`);
  else if (!online.value) message.warning("Still offline");
  else message.info("Nothing to sync");
}
</script>

<template>
  <div v-if="!online || (showAdmin && adminPending) || (showSales && salesPending)" class="offline-banners">
    <NAlert v-if="!online" type="warning" style="margin-bottom: 12px" :bordered="false">
      Offline — edits are saved on this device and will sync when you are back online.
    </NAlert>
    <NAlert
      v-if="(showAdmin && adminPending) || (showSales && salesPending)"
      :type="(showAdmin && adminFailed) || (showSales && salesFailed) ? 'error' : 'info'"
      style="margin-bottom: 12px"
      :bordered="false"
    >
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px">
        <span>
          <template v-if="showAdmin && adminPending">Pending admin sync: {{ adminPending }}</template>
          <template v-if="showAdmin && adminPending && showSales && salesPending"> · </template>
          <template v-if="showSales && salesPending">Pending sales: {{ salesPending }}</template>
        </span>
        <NButton size="tiny" type="primary" :loading="adminSyncing" :disabled="!online" @click="syncNow">
          Sync now
        </NButton>
      </div>
      <div
        v-if="showAdmin && adminFailed"
        style="margin-top: 8px; font-size: 12px"
      >
        <div v-for="e in adminEntries.filter((x) => x.status === 'failed')" :key="e.id" style="margin-top: 4px">
          {{ e.label || e.type }} — {{ e.lastError }}
          <NButton size="tiny" secondary style="margin-left: 6px" @click="admin.markPending(e.id); syncNow()">
            Retry
          </NButton>
          <NButton size="tiny" quaternary type="error" @click="admin.discard(e.id)">Discard</NButton>
        </div>
      </div>
    </NAlert>
  </div>
</template>
