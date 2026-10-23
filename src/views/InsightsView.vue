<script setup>
import { computed, h, onMounted, ref, watch } from "vue";
import {
  NAlert,
  NButton,
  NDataTable,
  NDatePicker,
  NSelect,
  NSpace,
  NSpin,
  NText,
} from "naive-ui";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import OfflinePendingBanner from "../components/OfflinePendingBanner.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { listActiveVendorOptions } from "../services/vendors.js";
import { listCategories } from "../services/categories.js";
import { fetchInsightsReport } from "../services/insights.js";
import { formatPkr } from "../utils/format.js";
import {
  fitNameColumnWidth,
  paginationTotalPrefix,
  rowNumberColumn,
  tableSorter,
} from "../utils/tableColumns.js";

const loading = ref(false);
const metaLoading = ref(false);
const error = ref("");
const report = ref(null);

const dimension = ref("vendor");
const entityIds = ref([]);
const rangePreset = ref("month");
const customFrom = ref(null);
const customTo = ref(null);

const vendorOptions = ref([]);
const categoryOptions = ref([]);

const dimensionOptions = [
  { label: "Vendor", value: "vendor" },
  { label: "Category", value: "category" },
];

const rangeOptions = [
  { label: "Today", value: "today" },
  { label: "This week", value: "week" },
  { label: "This month", value: "month" },
  { label: "All time", value: "all" },
  { label: "Custom range", value: "custom" },
];

const entityOptions = computed(() =>
  dimension.value === "vendor" ? vendorOptions.value : categoryOptions.value
);

const entityPlaceholder = computed(() =>
  dimension.value === "vendor" ? "Select vendor(s)" : "Select category(s)"
);

const hasSelection = computed(() => (entityIds.value?.length ?? 0) > 0);

const hasActiveFilters = computed(
  () =>
    hasSelection.value ||
    rangePreset.value !== "month" ||
    customFrom.value != null ||
    customTo.value != null ||
    dimension.value !== "vendor"
);

const summary = computed(() => report.value?.summary || null);

const page = ref(1);
const pageSize = ref(50);

const nameColumnWidth = computed(() => fitNameColumnWidth(report.value?.products || []));

function renderMoneyTone(value) {
  const n = Number(value);
  return h(
    "span",
    { style: n < 0 ? "color:#b91c1c;font-weight:700" : "font-weight:700;color:#0f766e" },
    formatPkr(value)
  );
}

const tableColumns = computed(() => [
  rowNumberColumn(page, pageSize),
  {
    title: "Product ID",
    key: "external_product_id",
    width: 100,
    ellipsis: { tooltip: true },
    ...tableSorter("string", "external_product_id"),
  },
  {
    title: "Product",
    key: "name",
    width: nameColumnWidth.value,
    ellipsis: { tooltip: true },
    ...tableSorter("string", "name"),
  },
  {
    title: "Qty sold",
    key: "qtySold",
    width: 90,
    ...tableSorter("number", "qtySold"),
  },
  {
    title: "Revenue",
    key: "revenue",
    width: 120,
    ...tableSorter("number", "revenue"),
    render: (r) => formatPkr(r.revenue),
  },
  {
    title: "Sold cost",
    key: "soldCost",
    width: 120,
    ...tableSorter("number", "soldCost"),
    render: (r) => formatPkr(r.soldCost),
  },
  {
    title: "Profit",
    key: "profit",
    width: 120,
    ...tableSorter("number", "profit"),
    render: (r) => renderMoneyTone(r.profit),
  },
  {
    title: "Margin",
    key: "marginPct",
    width: 88,
    ...tableSorter("number", "marginPct"),
    render: (r) => {
      const m = r.marginPct;
      if (m == null) return "—";
      return h("span", { style: m < 0 ? "color:#b91c1c;font-weight:700" : undefined }, `${m}%`);
    },
  },
  {
    title: "Purchased qty",
    key: "qtyPurchased",
    width: 110,
    ...tableSorter("number", "qtyPurchased"),
  },
  {
    title: "Purchased value",
    key: "purchasedValue",
    width: 130,
    ...tableSorter("number", "purchasedValue"),
    render: (r) => formatPkr(r.purchasedValue),
  },
  {
    title: "On hand",
    key: "onHand",
    width: 90,
    ...tableSorter("number", "onHand"),
  },
]);

const pagedRows = computed(() => {
  const rows = report.value?.products || [];
  const start = (page.value - 1) * pageSize.value;
  return rows.slice(start, start + pageSize.value);
});

const tableScrollX = computed(
  () => 52 + 100 + nameColumnWidth.value + 90 + 120 + 120 + 120 + 88 + 110 + 130 + 90 + 24
);

function clearFilters() {
  dimension.value = "vendor";
  entityIds.value = [];
  rangePreset.value = "month";
  customFrom.value = null;
  customTo.value = null;
  report.value = null;
  error.value = "";
  page.value = 1;
}

async function loadMeta() {
  metaLoading.value = true;
  try {
    const [vendors, categories] = await Promise.all([
      listActiveVendorOptions(),
      listCategories(),
    ]);
    vendorOptions.value = (vendors || []).map((v) => ({ label: v.name, value: v.id }));
    categoryOptions.value = (categories || []).map((c) => ({ label: c.name, value: c.id }));
  } catch (e) {
    error.value = e.message || "Failed to load filters";
  } finally {
    metaLoading.value = false;
  }
}

async function load() {
  if (!supabaseConfigured) return;
  if (!hasSelection.value) {
    report.value = null;
    error.value = "";
    return;
  }
  if (rangePreset.value === "custom" && !customFrom.value && !customTo.value) {
    error.value = "Pick a custom from and/or to date";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    report.value = await fetchInsightsReport({
      dimension: dimension.value,
      entityIds: entityIds.value,
      rangePreset: rangePreset.value,
      fromYmd: customFrom.value,
      toYmd: customTo.value,
    });
    page.value = 1;
  } catch (e) {
    report.value = null;
    error.value = e.message || "Failed to load insights";
  } finally {
    loading.value = false;
  }
}

function onPageChange(p) {
  page.value = p;
}

function onPageSizeChange(s) {
  pageSize.value = s;
  page.value = 1;
}

watch(dimension, () => {
  entityIds.value = [];
  report.value = null;
});

watch([entityIds, rangePreset], () => {
  if (hasSelection.value) load();
  else {
    report.value = null;
    error.value = "";
  }
});

watch([customFrom, customTo], () => {
  if (rangePreset.value === "custom" && hasSelection.value) load();
});

onMounted(async () => {
  await loadMeta();
});
</script>

<template>
  <div class="insights app-page app-page--fill">
    <header class="insights-hero">
      <div>
        <p class="insights-eyebrow">Profitability</p>
        <h1 class="insights-title">Insights</h1>
        <p class="insights-sub">
          Purchased from stock receipts · sold revenue &amp; gross profit from completed sales.
          Filter by vendor or category.
        </p>
      </div>
      <NButton class="insights-refresh" :loading="loading" :disabled="!hasSelection" @click="load">
        Refresh
      </NButton>
    </header>

    <SupabaseRequiredAlert />
    <OfflinePendingBanner />

    <div class="app-toolbar app-toolbar--tight">
      <NSpace class="app-filter-stack" align="center" wrap>
        <NSelect
          v-model:value="dimension"
          :options="dimensionOptions"
          style="width: 140px"
        />
        <NSelect
          v-model:value="entityIds"
          :options="entityOptions"
          :placeholder="entityPlaceholder"
          :loading="metaLoading"
          multiple
          filterable
          clearable
          max-tag-count="responsive"
          style="min-width: 240px; max-width: 420px"
        />
        <NSelect
          v-model:value="rangePreset"
          :options="rangeOptions"
          style="width: 160px"
        />
        <template v-if="rangePreset === 'custom'">
          <NDatePicker
            v-model:formatted-value="customFrom"
            value-format="yyyy-MM-dd"
            type="date"
            clearable
            placeholder="From"
            style="width: 140px"
          />
          <NDatePicker
            v-model:formatted-value="customTo"
            value-format="yyyy-MM-dd"
            type="date"
            clearable
            placeholder="To"
            style="width: 140px"
          />
        </template>
        <ClearFiltersButton v-if="hasActiveFilters" :disabled="false" @clear="clearFilters" />
      </NSpace>
    </div>

    <NAlert v-if="error" type="error" style="margin-bottom: 12px">{{ error }}</NAlert>
    <NAlert v-else-if="!hasSelection" type="info" style="margin-bottom: 12px">
      Select one or more {{ dimension === "vendor" ? "vendors" : "categories" }} to see purchased
      value, sales, profit, and top products.
    </NAlert>

    <NSpin :show="loading">
      <template v-if="summary">
        <section class="kpi-grid">
          <article class="kpi-card">
            <span class="kpi-label">Purchased</span>
            <span class="kpi-value">{{ formatPkr(summary.purchasedValue) }}</span>
            <span class="kpi-meta">{{ summary.purchasedQty }} units received</span>
          </article>
          <article class="kpi-card">
            <span class="kpi-label">Sold revenue</span>
            <span class="kpi-value">{{ formatPkr(summary.revenue) }}</span>
            <span class="kpi-meta">{{ summary.qtySold }} units sold</span>
          </article>
          <article class="kpi-card">
            <span class="kpi-label">Sold cost</span>
            <span class="kpi-value">{{ formatPkr(summary.soldCost) }}</span>
            <span class="kpi-meta">FIFO cost on sales</span>
          </article>
          <article class="kpi-card" :data-tone="summary.profit < 0 ? 'down' : 'up'">
            <span class="kpi-label">Gross profit</span>
            <span class="kpi-value">{{ formatPkr(summary.profit) }}</span>
            <span class="kpi-meta">
              Margin {{ summary.marginPct != null ? `${summary.marginPct}%` : "—" }}
            </span>
          </article>
          <article class="kpi-card kpi-card--muted">
            <span class="kpi-label">On-hand (now)</span>
            <span class="kpi-value">{{ formatPkr(summary.onHandValue) }}</span>
            <span class="kpi-meta">
              {{ summary.onHandUnits }} pcs · {{ summary.productCount }} products
            </span>
          </article>
        </section>

        <div class="insights-table-panel app-table-panel">
          <div class="table-head">
            <h2>Products</h2>
            <NText depth="3" style="font-size: 13px">
              Sorted by revenue — best sellers first ({{ summary.productRowsCount }})
            </NText>
          </div>
          <NDataTable
            :columns="tableColumns"
            :data="pagedRows"
            :row-key="(r) => r.id"
            :scroll-x="tableScrollX"
            flex-height
            :pagination="{
              page,
              pageSize,
              itemCount: report?.products?.length || 0,
              showSizePicker: true,
              pageSizes: [20, 50, 100],
              prefix: paginationTotalPrefix,
              onUpdatePage: onPageChange,
              onUpdatePageSize: onPageSizeChange,
            }"
          />
        </div>
      </template>
    </NSpin>
  </div>
</template>

<style scoped>
.insights-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding: 20px 22px;
  border-radius: 16px;
  color: #fff;
  background:
    radial-gradient(900px 220px at 0% 0%, rgba(45, 212, 191, 0.25), transparent 50%),
    linear-gradient(145deg, #042f2e 0%, #0f766e 50%, #134e4a 100%);
  box-shadow: 0 12px 28px rgba(15, 118, 110, 0.22);
}
.insights-eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.75;
}
.insights-title {
  margin: 0;
  font-size: 1.65rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.insights-sub {
  margin: 6px 0 0;
  max-width: 40rem;
  font-size: 13px;
  line-height: 1.45;
  opacity: 0.88;
}
.insights-refresh {
  color: #0f766e !important;
  background: #fff !important;
  border: none !important;
  font-weight: 700;
}
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.kpi-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.kpi-card--muted {
  background: #f8fafc;
}
.kpi-label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #9ca3af;
}
.kpi-value {
  display: block;
  margin-top: 4px;
  font-size: 1.15rem;
  font-weight: 800;
  color: #111827;
  font-variant-numeric: tabular-nums;
}
.kpi-card[data-tone="up"] .kpi-value {
  color: #047857;
}
.kpi-card[data-tone="down"] .kpi-value {
  color: #b91c1c;
}
.kpi-meta {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
}
.insights-table-panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 12px 14px 8px;
  min-height: 320px;
}
.table-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.table-head h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 750;
}
@media (max-width: 1100px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .kpi-grid {
    grid-template-columns: 1fr;
  }
}
</style>
