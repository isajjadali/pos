<script setup>
import { ref, onMounted, h, computed, watch } from "vue";
import { NButton, NDataTable, NModal, NSpace, useMessage, useDialog } from "naive-ui";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
import CreatedDateFilter from "../components/CreatedDateFilter.vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import ReceiptPreview from "../components/ReceiptPreview.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { listSales, getSale, saleGrossProfit, deleteSale, deleteSalesBulk } from "../services/sales.js";
import { formatPkr } from "../utils/format.js";
import { dateRangeFilterActive } from "../utils/dateRange.js";
import { getSettings } from "../services/settings.js";
import { printReceipt } from "../utils/receiptPrint.js";
import { usePermissions } from "../composables/usePermissions.js";
import { rowNumberColumn, createdAtColumn, paginationTotalPrefix } from "../utils/tableColumns.js";
import { useRouteQuerySync, routeQuery } from "../composables/useRouteQuerySync.js";

const message = useMessage();
const dialog = useDialog();
const { canDeleteSales } = usePermissions();

const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const detailOpen = ref(false);
const detail = ref(null);
const receiptSettings = ref({});
const receiptPrinting = ref(false);
const checkedRowKeys = ref([]);
const createdRangePreset = ref("all");
const createdFrom = ref(null);
const createdTo = ref(null);
const hasActiveFilters = computed(() =>
  dateRangeFilterActive(createdRangePreset.value, createdFrom.value, createdTo.value)
);

function clearFilters() {
  createdRangePreset.value = "all";
  createdFrom.value = null;
  createdTo.value = null;
  page.value = 1;
}

let loadFromQuery = () => {};
const { routeSyncing } = useRouteQuerySync(
  {
    page: routeQuery.positiveInt(page, 1),
    pageSize: routeQuery.positiveInt(pageSize, 20),
  },
  { onApplied: () => loadFromQuery() }
);

const columns = computed(() => {
  const cols = [rowNumberColumn(page, pageSize)];
  if (canDeleteSales.value) cols.push({ type: "selection" });
  cols.push(
    { title: "Reference", key: "sale_reference" },
    createdAtColumn({ key: "completed_at", title: "Created", width: 168 }),
    { title: "Total", key: "total_amount", render: (r) => formatPkr(r.total_amount) },
    { title: "Payment", key: "payment_method" },
    {
      title: "",
      key: "open",
      width: canDeleteSales.value ? 160 : 90,
      render: (row) =>
        h(NSpace, { size: 4 }, () => {
          const btns = [
            h(NButton, { size: "small", onClick: () => openSale(row.id) }, () => "View"),
          ];
          if (canDeleteSales.value) {
            btns.push(
              h(
                NButton,
                { size: "small", type: "error", onClick: () => confirmDeleteOne(row) },
                () => "Delete"
              )
            );
          }
          return btns;
        }),
    }
  );
  return cols;
});

async function loadSettings() {
  if (!supabaseConfigured) return;
  const s = await getSettings();
  if (s) receiptSettings.value = s;
}

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    const res = await listSales({
      page: page.value,
      pageSize: pageSize.value,
      createdRangePreset: createdRangePreset.value,
      createdFrom: createdFrom.value,
      createdTo: createdTo.value,
    });
    rows.value = res.rows;
    total.value = res.total;
    await loadSettings();
  } catch (e) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function openSale(id) {
  detail.value = await getSale(id);
  await loadSettings();
  detailOpen.value = true;
}

function confirmDeleteOne(row) {
  dialog.warning({
    title: "Cancel sale?",
    content: `${row.sale_reference} — soft-delete (status cancelled). Stock restored; sale record kept.`,
    positiveText: "Cancel sale",
    negativeText: "Back",
    onPositiveClick: async () => {
      try {
        await deleteSale(row.id);
        message.success("Sale cancelled, stock restored");
        if (detail.value?.sale?.id === row.id) detailOpen.value = false;
        checkedRowKeys.value = checkedRowKeys.value.filter((id) => id !== row.id);
        await load();
      } catch (e) {
        message.error(e.message || "Delete failed");
      }
    },
  });
}

function confirmDeleteSelected() {
  const ids = checkedRowKeys.value;
  if (!ids.length) return message.warning("Select sales first");
  dialog.warning({
    title: "Cancel selected sales?",
    content: `${ids.length} sale(s) — soft-delete (cancelled). Stock restored; records kept.`,
    positiveText: "Cancel sales",
    negativeText: "Back",
    onPositiveClick: async () => {
      try {
        const res = await deleteSalesBulk(ids);
        message.success(`Cancelled ${res.deleted} sale(s)`);
        if (res.failed?.length) message.warning(`${res.failed.length} failed`);
        checkedRowKeys.value = [];
        detailOpen.value = false;
        await load();
      } catch (e) {
        message.error(e.message || "Delete failed");
      }
    },
  });
}

async function printSaleReceipt() {
  if (!detail.value) return;
  receiptPrinting.value = true;
  try {
    const res = await printReceipt(detail.value.sale, detail.value.items, receiptSettings.value);
    if (res.warning) message.warning(res.warning);
    else message.success(`Receipt sent to ${res.printerName || "printer"}`);
  } catch (e) {
    message.error(e.message || "Receipt print failed");
  } finally {
    receiptPrinting.value = false;
  }
}

function onPageChange(p) {
  page.value = p;
}

function onPageSizeChange(s) {
  pageSize.value = s;
  page.value = 1;
}

watch([page, pageSize], () => {
  checkedRowKeys.value = [];
  if (routeSyncing.value) return;
  load();
});

watch([createdRangePreset, createdFrom, createdTo], () => {
  if (routeSyncing.value) return;
  checkedRowKeys.value = [];
  page.value = 1;
  load();
});

loadFromQuery = load;

onMounted(load);
</script>

<template>
  <div>
    <h1 style="margin-top: 0">Sales history</h1>
    <SupabaseRequiredAlert />
    <NSpace class="app-filter-stack" style="margin-bottom: 12px" align="center" wrap>
      <CreatedDateFilter
        v-model:preset="createdRangePreset"
        v-model:from="createdFrom"
        v-model:to="createdTo"
        label="Sale date"
      />
      <NButton
        v-if="canDeleteSales"
        type="error"
        :disabled="!checkedRowKeys.length"
        @click="confirmDeleteSelected"
      >
        Delete selected{{ checkedRowKeys.length ? ` (${checkedRowKeys.length})` : "" }}
      </NButton>
      <ClearFiltersButton v-if="hasActiveFilters" :disabled="false" @clear="clearFilters" />
    </NSpace>
    <NDataTable
      v-model:checked-row-keys="checkedRowKeys"
      :row-key="(r) => r.id"
      :loading="loading"
      :columns="columns"
      :data="rows"
      :scroll-x="900"
      :remote="true"
      :pagination="{
        page,
        pageSize,
        itemCount: total,
        showSizePicker: true,
        pageSizes: [20, 50, 100],
        prefix: paginationTotalPrefix,
        onUpdatePage: onPageChange,
        onUpdatePageSize: onPageSizeChange,
      }"
    />
    <NModal v-model:show="detailOpen" preset="card" title="Sale & receipt" style="width: min(920px, 96vw)">
      <template v-if="detail">
        <NSpace align="start" :size="20" wrap item-style="flex: 1; min-width: 280px">
          <div style="flex: 1; min-width: 200px">
            <p><strong>{{ detail.sale.sale_reference }}</strong></p>
            <p>Total: {{ formatPkr(detail.sale.total_amount) }}</p>
            <p>Gross profit: {{ formatPkr(saleGrossProfit(detail.items)) }}</p>
            <NSpace>
              <NButton type="primary" :loading="receiptPrinting" @click="printSaleReceipt">
                Print receipt
              </NButton>
              <NButton
                v-if="canDeleteSales"
                type="error"
                @click="confirmDeleteOne(detail.sale)"
              >
                Delete sale
              </NButton>
            </NSpace>
          </div>
          <div style="flex: 1; min-width: 280px">
            <ReceiptPreview
              :sale="detail.sale"
              :items="detail.items"
              :settings="receiptSettings"
            />
          </div>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
