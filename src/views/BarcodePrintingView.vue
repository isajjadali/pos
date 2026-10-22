<script setup>
import { ref, onMounted, h, computed, watch } from "vue";
import {
  NButton,
  NSpace,
  NInput,
  NDataTable,
  NInputNumber,
  NRadioGroup,
  NRadio,
  NSelect,
  NSwitch,
  NText,
  useMessage,
} from "naive-ui";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { listProductsForPrinting, reconcilePrint, listPrintJobs } from "../services/barcodes.js";
import { getSettings } from "../services/settings.js";
import { buildBatchZpl } from "../utils/zebraZpl.js";
import { resolveBrowserPrintBase, sendZplToZebra } from "../utils/zebraBrowserPrint.js";
import {
  rowNumberColumn,
  tableSorter,
  sortRowsByColumn,
  fitNameColumnWidth,
  paginationTotalPrefix,
} from "../utils/tableColumns.js";
import { useRouteQuerySync, routeQuery } from "../composables/useRouteQuerySync.js";
import {
  UNIT_LISTING_FILTER_OPTIONS,
  availableUnitsOf,
  defaultPosSaleUnit,
  labelContentForUnit,
  piecesPerPackOf,
  productMatchesUnitFilter,
  resolveSaleUnit,
} from "../utils/saleUnits.js";

const labelSize = ref({ w: 50, h: 30 });
const labelFonts = ref({
  fontFamily: "arial",
  titleSize: 100,
  nameSize: 100,
  barcodeSize: 100,
  priceSize: 100,
});

const message = useMessage();
const rows = ref([]);
const search = ref("");
const loading = ref(false);
const printing = ref(false);
const printingRowId = ref(null);
const printStatus = ref("");
const selected = ref([]);
const printMode = ref("unprinted");
const customQty = ref(1);
/** Per-product label unit: { [productId]: 'pack'|'piece'|'box' } */
const labelUnitById = ref({});
const jobs = ref([]);

function productHasPackOrBox(row) {
  return availableUnitsOf(row).length > 1;
}

function labelUnitFor(row) {
  return (
    labelUnitById.value[row.id] ||
    resolveSaleUnit(row, defaultPosSaleUnit(row)).sale_unit
  );
}

function setLabelUnit(row, unit) {
  labelUnitById.value = { ...labelUnitById.value, [row.id]: unit };
}

function seedLabelUnits(list) {
  const next = { ...labelUnitById.value };
  for (const row of list || []) {
    if (next[row.id]) continue;
    next[row.id] = resolveSaleUnit(row, defaultPosSaleUnit(row)).sale_unit;
  }
  labelUnitById.value = next;
}

/** all | pending | none */
const pendingFilter = ref("pending");
const stockFilterEnabled = ref(false);
const stockFilterQty = ref(5);
/** lte | gte | lt | gt */
const stockFilterMode = ref("lte");
/** all | piece | pack | box | multi */
const unitFilter = ref("all");
const unitFilterOptions = UNIT_LISTING_FILTER_OPTIONS;
const page = ref(1);
const pageSize = ref(50);
const tableSorterState = ref(null);
const sortKey = ref(null);
const sortOrder = ref(null);

function syncTableSorterFromQuery() {
  if (sortKey.value && sortOrder.value) {
    tableSorterState.value = { columnKey: sortKey.value, order: sortOrder.value };
  } else {
    tableSorterState.value = null;
  }
}

let loadFromQuery = () => {};
const { routeSyncing } = useRouteQuerySync(
  {
    q: { ...routeQuery.string(search), debounceMs: 300 },
    page: routeQuery.positiveInt(page, 1),
    pageSize: routeQuery.positiveInt(pageSize, 50),
    pending: routeQuery.enumValue(pendingFilter, "pending", ["pending", "none", "all"]),
    stock: routeQuery.booleanFlag(stockFilterEnabled, false),
    stockQty: routeQuery.positiveInt(stockFilterQty, 5),
    stockOp: routeQuery.enumValue(stockFilterMode, "lte", ["lte", "gte", "lt", "gt"]),
    unit: routeQuery.enumValue(unitFilter, "all", ["all", "piece", "pack", "box", "multi"]),
    mode: routeQuery.enumValue(printMode, "unprinted", ["unprinted", "current_stock", "custom"]),
    customQty: routeQuery.positiveInt(customQty, 1),
    sort: routeQuery.optionalString(sortKey),
    order: routeQuery.optionalString(sortOrder),
  },
  {
    onApplied: () => {
      syncTableSorterFromQuery();
      loadFromQuery();
    },
  }
);

const pendingFilterOptions = [
  { label: "Pending labels", value: "pending" },
  { label: "No pending labels", value: "none" },
  { label: "All products", value: "all" },
];

const stockFilterModeOptions = [
  { label: "At or below (≤)", value: "lte" },
  { label: "At or above (≥)", value: "gte" },
  { label: "Less than (<)", value: "lt" },
  { label: "Greater than (>)", value: "gt" },
];

const hasActiveFilters = computed(
  () =>
    Boolean(search.value.trim()) ||
    pendingFilter.value !== "pending" ||
    stockFilterEnabled.value ||
    unitFilter.value !== "all"
);

function clearFilters() {
  search.value = "";
  pendingFilter.value = "pending";
  stockFilterEnabled.value = false;
  stockFilterQty.value = 5;
  stockFilterMode.value = "lte";
  unitFilter.value = "all";
  sortKey.value = null;
  sortOrder.value = null;
  syncTableSorterFromQuery();
  page.value = 1;
  selected.value = [];
  load();
}

const filteredRows = computed(() => {
  let list = rows.value;
  if (pendingFilter.value === "pending") {
    list = list.filter((r) => (r.unprinted_barcode_qty || 0) > 0);
  } else if (pendingFilter.value === "none") {
    list = list.filter((r) => (r.unprinted_barcode_qty || 0) <= 0);
  }
  if (unitFilter.value !== "all") {
    list = list.filter((r) => productMatchesUnitFilter(r, unitFilter.value));
  }
  if (stockFilterEnabled.value) {
    const n = Math.floor(Number(stockFilterQty.value));
    if (Number.isFinite(n)) {
      const stock = (r) => r.current_stock ?? 0;
      const mode = stockFilterMode.value;
      if (mode === "lte") list = list.filter((r) => stock(r) <= n);
      else if (mode === "gte") list = list.filter((r) => stock(r) >= n);
      else if (mode === "lt") list = list.filter((r) => stock(r) < n);
      else if (mode === "gt") list = list.filter((r) => stock(r) > n);
    }
  }
  return list;
});

const sortedFilteredRows = computed(() =>
  sortRowsByColumn(filteredRows.value, tableSorterState.value)
);

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return sortedFilteredRows.value.slice(start, start + pageSize.value);
});

const pendingCount = computed(
  () => rows.value.filter((r) => (r.unprinted_barcode_qty || 0) > 0).length
);
const noPendingCount = computed(
  () => rows.value.filter((r) => (r.unprinted_barcode_qty || 0) <= 0).length
);

const nameColumnWidth = computed(() => fitNameColumnWidth(pagedRows.value));
const tableScrollX = computed(
  () => 52 + 40 + nameColumnWidth.value + 120 + 70 + 110 + 168 + 90 + 24
);

const columns = computed(() => {
  void labelUnitById.value;
  void printMode.value;
  void customQty.value;
  return [
    rowNumberColumn(page, pageSize),
    { type: "selection" },
    {
      title: "Name",
      key: "name",
      width: nameColumnWidth.value,
      ellipsis: { tooltip: true },
      ...tableSorter("string", "name"),
    },
    { title: "Barcode", key: "barcode", width: 120, ...tableSorter("string", "barcode") },
    { title: "Stock", key: "current_stock", width: 70, ...tableSorter("number", "current_stock") },
    {
      title: "Pending (pcs)",
      key: "unprinted_barcode_qty",
      width: 110,
      ...tableSorter("number", "unprinted_barcode_qty"),
    },
    {
      title: "Label unit",
      key: "label_unit",
      width: 168,
      render: (row) => {
        const n = qtyForRow(row);
        const hint = h(
          NText,
          { depth: 3, style: "font-size: 11px; display: block; margin-top: 2px" },
          () => `${n} label${n === 1 ? "" : "s"}`
        );
        if (!productHasPackOrBox(row)) {
          return h("div", [h(NText, { depth: 3, style: "font-size: 12px" }, () => "Piece"), hint]);
        }
        const pack = piecesPerPackOf(row);
        return h("div", [
          h(NSelect, {
            size: "small",
            value: labelUnitFor(row),
            options: availableUnitsOf(row),
            consistentMenuWidth: false,
            style: "width: 132px",
            placeholder: pack > 1 ? `Pack (${pack} pcs)` : "Unit",
            onUpdateValue: (v) => setLabelUnit(row, v),
          }),
          hint,
        ]);
      },
    },
    {
      title: "",
      key: "print",
      width: 90,
      render: (row) =>
        h(
          NButton,
          {
            size: "small",
            loading: printing.value && printingRowId.value === row.id,
            disabled: printing.value && printingRowId.value !== row.id,
            onClick: () => printOne(row),
          },
          () => "Print"
        ),
    },
  ];
});

const pagination = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  itemCount: sortedFilteredRows.value.length,
  showSizePicker: true,
  pageSizes: [20, 50, 100],
  prefix: paginationTotalPrefix,
  onUpdatePage: (p) => {
    page.value = p;
  },
  onUpdatePageSize: (s) => {
    pageSize.value = s;
    page.value = 1;
  },
}));

watch(pendingFilter, () => {
  if (routeSyncing.value) return;
  page.value = 1;
  selected.value = [];
});

watch([stockFilterEnabled, stockFilterQty, stockFilterMode], () => {
  if (routeSyncing.value) return;
  page.value = 1;
  selected.value = [];
});

watch(unitFilter, () => {
  if (routeSyncing.value) return;
  page.value = 1;
  selected.value = [];
});

function onTableSorterUpdate(sorter) {
  tableSorterState.value = sorter;
  sortKey.value = sorter?.columnKey ?? null;
  sortOrder.value = sorter?.order ?? null;
  page.value = 1;
  selected.value = [];
}

let searchLoadTimer;
watch(search, () => {
  if (routeSyncing.value) return;
  clearTimeout(searchLoadTimer);
  searchLoadTimer = setTimeout(() => load(), 300);
});

watch([sortKey, sortOrder], () => {
  if (routeSyncing.value) return;
  syncTableSorterFromQuery();
});

async function load({ silent = false } = {}) {
  if (!supabaseConfigured) return;
  if (!silent) loading.value = true;
  try {
    rows.value = await listProductsForPrinting({ search: search.value });
    seedLabelUnits(rows.value);
    jobs.value = await listPrintJobs(15);
    const settings = await getSettings();
    if (settings) {
      labelSize.value = {
        w: Number(settings.label_width_mm) || 50,
        h: Number(settings.label_height_mm) || 30,
      };
      const legacy = Number(settings.label_font_size) || 100;
      labelFonts.value = {
        fontFamily: settings.label_font_family || "arial",
        titleSize: Number(settings.label_title_font_size) || legacy,
        nameSize: Number(settings.label_name_font_size) || legacy,
        barcodeSize: Number(settings.label_barcode_font_size) || legacy,
        priceSize: Number(settings.label_price_font_size) || legacy,
      };
    }
    const maxPage = Math.max(1, Math.ceil(sortedFilteredRows.value.length / pageSize.value) || 1);
    if (page.value > maxPage) page.value = maxPage;
  } catch (e) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

function piecesPerLabel(row) {
  return resolveSaleUnit(row, labelUnitFor(row)).pieces_per_unit;
}

function buildLabels(product, count) {
  const content = labelContentForUnit(product, labelUnitFor(product));
  const labels = [];
  for (let i = 0; i < count; i++) {
    labels.push({
      name: content.name,
      barcode: product.barcode,
      price: content.price,
    });
  }
  return labels;
}

/** How many physical labels to print for this row (pieces ÷ unit size). */
function qtyForRow(row) {
  const ppu = piecesPerLabel(row);
  if (printMode.value === "custom") return Math.max(1, Math.floor(Number(customQty.value) || 1));
  const pieces =
    printMode.value === "unprinted"
      ? Math.max(0, Math.floor(Number(row.unprinted_barcode_qty) || 0))
      : Math.max(0, Math.floor(Number(row.current_stock) || 0));
  return Math.floor(pieces / ppu);
}

/** Pending stock is in pieces — deduct labelCount × pcs-per-unit after print. */
function reconcilePiecesFor(row, labelCount) {
  const ppu = piecesPerLabel(row);
  const labels = Math.max(0, Math.floor(Number(labelCount) || 0));
  if (printMode.value === "custom") return labels * ppu;
  const pieces =
    printMode.value === "unprinted"
      ? Math.max(0, Math.floor(Number(row.unprinted_barcode_qty) || 0))
      : Math.max(0, Math.floor(Number(row.current_stock) || 0));
  return Math.min(pieces, labels * ppu);
}

const selectedPrintStats = computed(() => {
  void labelUnitById.value;
  const idSet = new Set(selected.value);
  let products = 0;
  let labels = 0;
  let zeroQty = 0;
  for (const row of rows.value) {
    if (!idSet.has(row.id)) continue;
    products += 1;
    const q = qtyForRow(row);
    if (q <= 0) zeroQty += 1;
    labels += q;
  }
  return { products, labels, zeroQty };
});

function buildBatchFromRows(list) {
  const batch = [];
  for (const row of list) {
    const labelCount = qtyForRow(row);
    if (labelCount > 0) {
      batch.push({
        product: row,
        requested: labelCount,
        reconcilePieces: reconcilePiecesFor(row, labelCount),
      });
    }
  }
  return batch;
}

async function reconcileBatch(batch) {
  const CONCURRENCY = 8;
  let i = 0;
  async function worker() {
    while (i < batch.length) {
      const idx = i++;
      const item = batch[idx];
      const pieces = item.reconcilePieces ?? item.requested;
      await reconcilePrint(item.product.id, printMode.value, item.requested, pieces);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, () => worker()));
}

async function runPrint(batch) {
  if (!batch.length) {
    message.warning("Nothing to print — check quantity / pending labels.");
    return;
  }

  printing.value = true;
  printingRowId.value = batch.length === 1 ? batch[0].product.id : null;
  try {
    let allLabels = [];
    for (const item of batch) {
      allLabels = allLabels.concat(buildLabels(item.product, item.requested));
    }

    const totalLabels = allLabels.length;
    printStatus.value = `Building ${totalLabels} labels for ${batch.length} products…`;

    const zpl = buildBatchZpl(allLabels, labelSize.value.w, labelSize.value.h, undefined, labelFonts.value);
    printStatus.value = `Sending ${totalLabels} labels to printer…`;

    const result = await sendZplToZebra(zpl, {
      onProgress: ({ sent, total, job, jobs }) => {
        if (printStatus.value?.includes("roll") || printStatus.value?.includes("offline")) return;
        printStatus.value =
          jobs > 1
            ? `Printing… job ${job}/${jobs} (${sent}/${total} labels)`
            : `Printing ${total} labels…`;
      },
      onStatus: ({ phase, message }) => {
        if (phase === "media_out") {
          printStatus.value =
            message || "Label roll empty — load a new roll. Printing paused here.";
        } else if (phase === "offline") {
          printStatus.value = message || "Printer offline — check power/USB.";
        } else if (message) {
          printStatus.value = message;
        }
      },
    });

    // Only mark printed after printer finished (incl. wait for new roll if needed)
    printStatus.value = "Updating print records…";
    await reconcileBatch(batch);

    message.success(
      `Sent ${result.labelCount} labels (${result.jobCount} spool job${result.jobCount === 1 ? "" : "s"}).`
    );
    selected.value = [];
    await load({ silent: true });
  } catch (e) {
    message.error(e.message || "Print failed");
  } finally {
    printing.value = false;
    printingRowId.value = null;
    printStatus.value = "";
  }
}

function printOne(row) {
  const labelCount = qtyForRow(row);
  if (labelCount <= 0) {
    message.warning("No labels to print for this product (check stock vs pack/box size).");
    return;
  }
  runPrint([
    {
      product: row,
      requested: labelCount,
      reconcilePieces: reconcilePiecesFor(row, labelCount),
    },
  ]);
}

function printSelected() {
  const idSet = new Set(selected.value);
  const list = filteredRows.value.filter((r) => idSet.has(r.id));
  if (!list.length) return message.warning("Select products");
  runPrint(buildBatchFromRows(list));
}

function selectPage() {
  const ids = pagedRows.value.map((r) => r.id);
  const set = new Set(selected.value);
  for (const id of ids) set.add(id);
  selected.value = [...set];
}

function clearSelection() {
  selected.value = [];
}

loadFromQuery = load;

onMounted(() => {
  syncTableSorterFromQuery();
  load();
  resolveBrowserPrintBase().catch(() => {});
});
</script>

<template>
  <div class="app-page app-page--fill">
    <h1 style="margin-top: 0">Barcode printing</h1>
    <SupabaseRequiredAlert />
    <NRadioGroup v-model:value="printMode" style="margin-bottom: 12px">
      <NSpace>
        <NRadio value="unprinted">Print new / unprinted</NRadio>
        <NRadio value="current_stock">Print for current stock</NRadio>
        <NRadio value="custom">Custom quantity</NRadio>
      </NSpace>
    </NRadioGroup>
    <NInputNumber
      v-if="printMode === 'custom'"
      v-model:value="customQty"
      :min="1"
      style="width: 120px; margin-bottom: 12px"
    />
    <NSpace class="app-filter-stack" style="margin-bottom: 12px" align="center" wrap>
      <NInput
        v-model:value="search"
        placeholder="Search"
        clearable
        style="width: 220px"
        @keyup.enter="load"
      />
      <NButton @click="load">Search</NButton>
      <NSelect
        v-model:value="pendingFilter"
        :options="pendingFilterOptions"
        style="width: 200px"
      />
      <NSelect
        v-model:value="unitFilter"
        :options="unitFilterOptions"
        placeholder="Unit"
        style="width: 150px"
      />
      <NSpace align="center" :size="8" wrap>
        <NSwitch v-model:value="stockFilterEnabled" size="small" />
        <NText depth="3" style="font-size: 13px">Stock filter</NText>
        <NSelect
          v-model:value="stockFilterMode"
          :options="stockFilterModeOptions"
          :disabled="!stockFilterEnabled"
          style="width: 168px"
        />
        <NInputNumber
          v-model:value="stockFilterQty"
          :min="0"
          :disabled="!stockFilterEnabled"
          style="width: 100px"
        />
      </NSpace>
      <ClearFiltersButton :disabled="!hasActiveFilters" @clear="clearFilters" />
      <NButton quaternary :disabled="!pagedRows.length" @click="selectPage">
        Select page
      </NButton>
      <NButton quaternary :disabled="!selected.length" @click="clearSelection">
        Clear selection
      </NButton>
      <NButton type="primary" :loading="printing" :disabled="printing" @click="printSelected">
        Print selected
      </NButton>
      <span
        v-if="selected.length && !printStatus"
        class="selection-barcode-total"
      >
        {{ selectedPrintStats.products }} product(s) ·
        <strong>{{ selectedPrintStats.labels }}</strong> barcode(s) to print
        <NText
          v-if="selectedPrintStats.zeroQty"
          depth="3"
          style="font-size: 12px; margin-left: 4px"
        >
          ({{ selectedPrintStats.zeroQty }} with 0 — skipped)
        </NText>
      </span>
      <span v-if="printStatus" style="color: #0f766e; font-size: 13px">{{ printStatus }}</span>
      <span v-else style="color: #6b7280; font-size: 12px">
        Pending: {{ pendingCount }} · Done: {{ noPendingCount }}
      </span>
    </NSpace>
    <p style="margin: 0 0 8px; font-size: 13px; color: #6b7280">
      Recent print jobs: {{ jobs.length }} loaded
    </p>
    <div class="app-table-panel">
      <NDataTable
        v-model:checked-row-keys="selected"
        :row-key="(r) => r.id"
        :loading="loading"
        :columns="columns"
        :data="pagedRows"
        :scroll-x="tableScrollX"
        :remote="true"
        flex-height
        @update:sorter="onTableSorterUpdate"
        :pagination="pagination"
      />
    </div>
  </div>
</template>

<style scoped>
.selection-barcode-total {
  font-size: 14px;
  color: #374151;
  padding: 4px 10px;
  background: #ecfdf5;
  border: 1px solid #99f6e4;
  border-radius: 8px;
}
.selection-barcode-total strong {
  font-size: 1.1em;
  color: #0f766e;
}
</style>
