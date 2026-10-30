<script setup>
import { ref, computed, nextTick, h, watch, onMounted } from "vue";
import {
  NSteps,
  NStep,
  NButton,
  NSpace,
  NUpload,
  NSelect,
  NDataTable,
  NRadioGroup,
  NRadio,
  NAlert,
  NInput,
  NInputNumber,
  NText,
  NIcon,
  NTag,
  useMessage,
  useDialog,
} from "naive-ui";
import { ArrowDownOutline } from "@vicons/ionicons5";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { parseCsv, rowsToObjects, IMPORT_FIELD_OPTIONS, SAMPLE_CSV } from "../utils/csv.js";
import {
  importProductsBulk,
  recordImportJob,
  matchExistingImportProducts,
  getLastUndoableImportJob,
  undoImportJob,
} from "../services/importProducts.js";
import { listActiveVendorOptions } from "../services/vendors.js";
import { formatPkr, marginPercent } from "../utils/format.js";
import { fitNameColumnWidth } from "../utils/tableColumns.js";
import { naiveSelectSubstringFilter } from "../utils/textSearch.js";

const message = useMessage();
const dialog = useDialog();

/** 1 upload · 2 map · 3 edit · 4 review · 5 results */
const step = ref(1);
const headers = ref([]);
const records = ref([]);
const mapping = ref({});
const duplicateBehavior = ref("add_stock");
const importing = ref(false);
const importProgress = ref({ done: 0, total: 0 });
const results = ref([]);
const draftRows = ref([]);
const reviewRows = ref([]);
const lastEdit = ref({ field: null, rowIndex: 0 });
const vendorOptions = ref([]);
const matchingExisting = ref(false);
const lastImportJob = ref(null);
const undoingImport = ref(false);

let rowSeq = 0;
let matchTimer = null;

const lastImportLabel = computed(() => {
  const j = lastImportJob.value;
  if (!j) return "";
  const when = j.created_at ? new Date(j.created_at).toLocaleString() : "";
  const actions = j.details?.actions?.length ?? 0;
  return `${j.filename || "CSV"} · ${j.successful_rows ?? 0} ok · ${actions} reversible · ${when}`;
});

async function refreshLastImportJob() {
  if (!supabaseConfigured) {
    lastImportJob.value = null;
    return;
  }
  try {
    lastImportJob.value = await getLastUndoableImportJob();
  } catch {
    lastImportJob.value = null;
  }
}

function confirmUndoLastImport() {
  const j = lastImportJob.value;
  if (!j) return;
  dialog.warning({
    title: "Undo last import?",
    content:
      "Created products will be soft-deleted, stock added by that import will be removed (up to current stock), and info-only updates will be restored when possible.",
    positiveText: "Undo import",
    negativeText: "Cancel",
    onPositiveClick: () => runUndoLastImport(),
  });
}

async function runUndoLastImport() {
  const j = lastImportJob.value;
  if (!j?.id || undoingImport.value) return;
  undoingImport.value = true;
  try {
    const res = await undoImportJob(j.id);
    message.success(
      `Import undone: ${res?.undone ?? 0} reversed` +
        (res?.failed ? `, ${res.failed} failed` : "")
    );
    await refreshLastImportJob();
  } catch (e) {
    message.error(e.message || "Undo failed");
  } finally {
    undoingImport.value = false;
  }
}

const systemFields = IMPORT_FIELD_OPTIONS.filter((f) => f.value !== "skip");

const EDIT_COLS = [
  "external_product_id",
  "name",
  "quantity",
  "purchase_price",
  "selling_price",
  "vendor",
  "category",
  "sku",
  "barcode",
];

function newDraftRow(seed = {}) {
  return {
    _key: ++rowSeq,
    external_product_id: String(seed.external_product_id ?? "").trim(),
    name: String(seed.name ?? "").trim(),
    quantity: Math.max(0, Math.floor(Number(seed.quantity) || 0)),
    purchase_price: Number(seed.purchase_price) || 0,
    selling_price: Number(seed.selling_price) || 0,
    vendor: String(seed.vendor ?? "").trim() || null,
    category: String(seed.category ?? "").trim(),
    sku: String(seed.sku ?? "").trim(),
    barcode: String(seed.barcode ?? "").trim(),
    _existing: null,
  };
}

const vendorSelectOptions = computed(() => {
  const base = vendorOptions.value.map((v) => ({ label: v.name, value: v.name }));
  const seen = new Set(base.map((o) => String(o.value).toLowerCase()));
  const extras = [];
  for (const row of draftRows.value) {
    const name = String(row.vendor ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push({ label: name, value: name });
  }
  return [...base, ...extras];
});

const existingCount = computed(
  () => draftRows.value.filter((r) => r._existing && String(r.name ?? "").trim()).length
);
const newCount = computed(() => {
  const named = draftRows.value.filter((r) => String(r.name ?? "").trim());
  return named.length - named.filter((r) => r._existing).length;
});

const reviewExistingCount = computed(
  () => reviewRows.value.filter((r) => r._existing).length
);
const reviewNewCount = computed(() => reviewRows.value.length - reviewExistingCount.value);

async function loadVendors() {
  if (!supabaseConfigured) return;
  try {
    vendorOptions.value = await listActiveVendorOptions();
  } catch {
    vendorOptions.value = [];
  }
}

async function refreshExistingMatches() {
  if (!supabaseConfigured || step.value !== 3) return;
  matchingExisting.value = true;
  try {
    const matches = await matchExistingImportProducts(draftRows.value);
    draftRows.value.forEach((row, index) => {
      row._existing = matches.get(index) || null;
    });
  } catch (e) {
    message.error(e.message || "Could not check existing products");
  } finally {
    matchingExisting.value = false;
  }
}

function scheduleMatchRefresh() {
  clearTimeout(matchTimer);
  matchTimer = setTimeout(() => {
    refreshExistingMatches();
  }, 400);
}

function mapRecord(raw) {
  const out = {};
  for (const field of systemFields) {
    const col = Object.entries(mapping.value).find(([, v]) => v === field.value)?.[0];
    out[field.value] = col ? raw[col] : "";
  }
  return out;
}

function buildDraftFromMapped() {
  rowSeq = 0;
  const rows = records.value.map((raw) => newDraftRow(mapRecord(raw)));
  draftRows.value = rows.length ? rows : [newDraftRow()];
}

const filledDraftRows = computed(() =>
  draftRows.value.filter((r) => String(r.name ?? "").trim())
);

function markEdit(field, rowIndex) {
  lastEdit.value = { field, rowIndex };
}

function copyFieldToAll(field) {
  const rows = draftRows.value;
  if (!rows.length) return;
  let src = lastEdit.value.field === field ? lastEdit.value.rowIndex : 0;
  if (src < 0 || src >= rows.length) src = 0;
  const value = rows[src][field];
  for (const row of rows) {
    row[field] = value;
  }
  message.success(`Copied to all ${rows.length} row(s)`);
}

function focusCell(rowIndex, colIndex) {
  nextTick(() => {
    const root = document.querySelector(
      `.import-edit-grid [data-import-row="${rowIndex}"][data-import-col="${colIndex}"]`
    );
    const input = root?.querySelector("input");
    input?.focus?.();
    input?.select?.();
  });
}

function onEnter(rowIndex, colIndex) {
  if (colIndex < EDIT_COLS.length - 1) {
    focusCell(rowIndex, colIndex + 1);
    return;
  }
  const row = draftRows.value[rowIndex];
  if (!String(row.name ?? "").trim()) {
    message.warning("Product name is required before adding another row");
    focusCell(rowIndex, 1);
    return;
  }
  if (rowIndex === draftRows.value.length - 1) {
    draftRows.value.push(newDraftRow());
  }
  focusCell(rowIndex + 1, 0);
}

function removeRow(index) {
  if (draftRows.value.length <= 1) {
    draftRows.value = [newDraftRow()];
    return;
  }
  draftRows.value.splice(index, 1);
}

function rowMarginLabel(row) {
  const m = marginPercent(row.selling_price, row.purchase_price);
  if (m == null) return "—";
  return `${m}%`;
}

function rowMarginNeg(row) {
  const m = marginPercent(row.selling_price, row.purchase_price);
  if (m == null) return false;
  return m < 0 || Number(row.selling_price) + 0.009 < Number(row.purchase_price);
}

function onFile({ file }) {
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCsv(reader.result);
    const { headers: h, records: recs } = rowsToObjects(rows);
    headers.value = h;
    records.value = recs;
    mapping.value = {};
    h.forEach((col) => {
      const lower = col.toLowerCase();
      if (lower.includes("product id") || lower === "id") mapping.value[col] = "external_product_id";
      else if (lower.includes("name")) mapping.value[col] = "name";
      else if (lower.includes("qty") || lower === "quantity") mapping.value[col] = "quantity";
      else if (lower.includes("sale")) mapping.value[col] = "selling_price";
      else if (lower.includes("purchase") || lower === "rate") mapping.value[col] = "purchase_price";
      else if (lower.includes("vendor")) mapping.value[col] = "vendor";
      else if (lower.includes("sku")) mapping.value[col] = "sku";
      else if (lower.includes("barcode")) mapping.value[col] = "barcode";
      else if (lower.includes("categor")) mapping.value[col] = "category";
      else mapping.value[col] = "skip";
    });
    step.value = 2;
  };
  reader.readAsText(file.file);
  return false;
}

function downloadSample() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "products-template.csv";
  a.click();
}

async function continueToEdit() {
  buildDraftFromMapped();
  step.value = 3;
  await loadVendors();
  await refreshExistingMatches();
}

function goToReview() {
  const rows = filledDraftRows.value;
  if (!rows.length) {
    message.warning("Add at least one product with a name");
    return;
  }
  reviewRows.value = rows.map((r) => ({ ...r }));
  step.value = 4;
}

const reviewColumns = computed(() => {
  const nameW = fitNameColumnWidth(reviewRows.value);
  return [
    { title: "#", key: "_n", width: 44, render: (_row, index) => index + 1 },
    {
      title: "Status",
      key: "_existing",
      width: 110,
      render: (r) =>
        r._existing
          ? h(NTag, { size: "small", type: "warning", round: true }, () => "Existing")
          : h(NTag, { size: "small", type: "success", round: true }, () => "New"),
    },
    {
      title: "Product ID",
      key: "external_product_id",
      width: 100,
      ellipsis: { tooltip: true },
      render: (r) => r.external_product_id || "—",
    },
    { title: "Name", key: "name", width: nameW, ellipsis: { tooltip: true } },
    { title: "Qty", key: "quantity", width: 70 },
    {
      title: "Purchase",
      key: "purchase_price",
      width: 100,
      render: (r) => formatPkr(r.purchase_price),
    },
    {
      title: "Sale",
      key: "selling_price",
      width: 100,
      render: (r) => formatPkr(r.selling_price),
    },
    {
      title: "Gross %",
      key: "margin",
      width: 80,
      render: (r) => {
        const m = marginPercent(r.selling_price, r.purchase_price);
        if (m == null) return "—";
        const below = Number(r.selling_price) + 0.009 < Number(r.purchase_price);
        return h(
          "span",
          { style: below || m < 0 ? "color:#dc2626;font-weight:700" : undefined },
          `${m}%`
        );
      },
    },
    { title: "Vendor", key: "vendor", width: 140, ellipsis: { tooltip: true } },
    { title: "Category", key: "category", width: 120, ellipsis: { tooltip: true } },
    { title: "SKU", key: "sku", width: 100, ellipsis: { tooltip: true } },
    { title: "Barcode", key: "barcode", width: 120, ellipsis: { tooltip: true } },
  ];
});

const reviewScrollX = computed(
  () =>
    44 +
    110 +
    100 +
    fitNameColumnWidth(reviewRows.value) +
    70 +
    100 +
    100 +
    80 +
    140 +
    120 +
    100 +
    120 +
    24
);

watch(
  () =>
    draftRows.value.map((r) =>
      [r.external_product_id, r.sku, r.barcode, r.name, r.vendor].join("\0")
    ),
  () => {
    if (step.value === 3) scheduleMatchRefresh();
  }
);

onMounted(() => {
  loadVendors();
  refreshLastImportJob();
});

async function runImport() {
  if (!supabaseConfigured) return;
  if (!reviewRows.value.length) {
    message.warning("Nothing to import");
    return;
  }
  importing.value = true;
  results.value = [];
  importProgress.value = { done: 0, total: reviewRows.value.length };

  const mappedRows = reviewRows.value.map((r) => ({
    external_product_id: r.external_product_id,
    name: r.name,
    quantity: r.quantity,
    purchase_price: r.purchase_price,
    selling_price: r.selling_price,
    vendor: r.vendor || "",
    category: r.category,
    sku: r.sku,
    barcode: r.barcode,
  }));

  try {
    const { results: bulkResults, success, failed, total } = await importProductsBulk(
      mappedRows,
      duplicateBehavior.value,
      {
        onProgress: (p) => {
          importProgress.value = p;
        },
      }
    );
    results.value = bulkResults;
    await recordImportJob({
      filename: "upload.csv",
      total,
      success,
      failed,
      behavior: duplicateBehavior.value,
      actions: bulkResults,
    });
    await refreshLastImportJob();
    step.value = 5;
    message.success(`Import done: ${success} ok, ${failed} failed`);
  } catch (e) {
    message.error(e.message || "Import failed");
  } finally {
    importing.value = false;
  }
}

function resetAll() {
  step.value = 1;
  headers.value = [];
  records.value = [];
  mapping.value = {};
  draftRows.value = [];
  reviewRows.value = [];
  results.value = [];
  duplicateBehavior.value = "add_stock";
}

function onMatchKeyEdit(field, rowIndex) {
  markEdit(field, rowIndex);
  scheduleMatchRefresh();
}
</script>

<template>
  <div class="app-page app-page--fill import-page">
    <h1 style="margin-top: 0; margin-bottom: 8px">Import Products (CSV)</h1>
    <NAlert type="info" style="margin-bottom: 8px" :bordered="false">
      Upload → map columns → edit rows (like bulk create) → review → import.
    </NAlert>
    <NAlert
      v-if="lastImportJob"
      type="warning"
      style="margin-bottom: 8px"
      :bordered="false"
    >
      <div class="import-undo-bar">
        <div>
          <strong>Last import</strong> — {{ lastImportLabel }}
        </div>
        <NButton
          size="small"
          type="warning"
          :loading="undoingImport"
          :disabled="!supabaseConfigured"
          @click="confirmUndoLastImport"
        >
          Undo last import
        </NButton>
      </div>
    </NAlert>
    <SupabaseRequiredAlert />
    <NSteps :current="step" class="import-steps" size="small">
      <NStep title="Upload" />
      <NStep title="Map columns" />
      <NStep title="Edit" />
      <NStep title="Review" />
      <NStep title="Results" />
    </NSteps>

    <div v-if="step === 1">
      <NSpace>
        <NUpload :show-file-list="false" accept=".csv,text/csv" @before-upload="onFile">
          <NButton type="primary">Upload CSV</NButton>
        </NUpload>
        <NButton @click="downloadSample">Download template</NButton>
      </NSpace>
    </div>

    <div v-else-if="step === 2">
      <p>Map each file column to a system field.</p>
      <div v-for="col in headers" :key="col" class="import-map-row">
        <strong>{{ col }}</strong>
        <NSelect v-model:value="mapping[col]" :options="IMPORT_FIELD_OPTIONS" class="import-map-select" />
      </div>
      <NSpace style="margin-top: 16px">
        <NButton @click="step = 1">Back</NButton>
        <NButton type="primary" @click="continueToEdit">Continue to edit</NButton>
      </NSpace>
    </div>

    <div v-else-if="step === 3" class="import-fill-panel">
      <NText depth="3" style="display: block; margin-bottom: 6px; font-size: 13px">
        {{ draftRows.length }} row(s) from CSV — edit anything before review. Press
        <strong>Enter</strong> to move across cells. Vendor: pick existing or keep/type a new name.
      </NText>
      <NAlert
        :type="existingCount ? 'warning' : 'success'"
        style="margin-bottom: 8px"
        :bordered="false"
      >
        <strong>{{ newCount }}</strong> new ·
        <strong>{{ existingCount }}</strong> existing
        <template v-if="existingCount">
          (highlighted — matched by product id / SKU / barcode / name+vendor). Stock add uses
          receive with CSV purchase cost (old batches keep their cost).
        </template>
        <span v-if="matchingExisting" style="margin-left: 8px; opacity: 0.7">Checking…</span>
      </NAlert>
      <div class="import-edit-grid">
        <div class="import-edit-head">
          <span class="import-col-head">
            Product ID
            <button type="button" class="import-copy-all" title="Copy column to all rows" @click="copyFieldToAll('external_product_id')">
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="import-col-head">
            Name
            <button type="button" class="import-copy-all" title="Copy column to all rows" @click="copyFieldToAll('name')">
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="import-col-head">
            Qty
            <button type="button" class="import-copy-all" title="Copy column to all rows" @click="copyFieldToAll('quantity')">
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="import-col-head">
            Purchase
            <button type="button" class="import-copy-all" title="Copy column to all rows" @click="copyFieldToAll('purchase_price')">
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="import-col-head">
            Sale
            <button type="button" class="import-copy-all" title="Copy column to all rows" @click="copyFieldToAll('selling_price')">
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="import-col-head">
            Vendor
            <button type="button" class="import-copy-all" title="Copy column to all rows" @click="copyFieldToAll('vendor')">
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="import-col-head">
            Category
            <button type="button" class="import-copy-all" title="Copy column to all rows" @click="copyFieldToAll('category')">
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="import-col-head">
            SKU
            <button type="button" class="import-copy-all" title="Copy column to all rows" @click="copyFieldToAll('sku')">
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="import-col-head">
            Barcode
            <button type="button" class="import-copy-all" title="Copy column to all rows" @click="copyFieldToAll('barcode')">
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span title="Gross margin">Gross %</span>
          <span>Status</span>
          <span />
        </div>
        <div
          v-for="(row, rowIndex) in draftRows"
          :key="row._key"
          class="import-edit-row"
          :class="{ 'import-edit-row--existing': row._existing }"
        >
          <div :data-import-row="rowIndex" :data-import-col="0">
            <NInput
              v-model:value="row.external_product_id"
              placeholder="Optional"
              size="small"
              @focus="markEdit('external_product_id', rowIndex)"
              @update:value="onMatchKeyEdit('external_product_id', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 0)"
            />
          </div>
          <div :data-import-row="rowIndex" :data-import-col="1">
            <NInput
              v-model:value="row.name"
              placeholder="Product name"
              size="small"
              @focus="markEdit('name', rowIndex)"
              @update:value="markEdit('name', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 1)"
            />
          </div>
          <div :data-import-row="rowIndex" :data-import-col="2">
            <NInputNumber
              v-model:value="row.quantity"
              :min="0"
              :precision="0"
              :show-button="false"
              size="small"
              style="width: 100%"
              @focus="markEdit('quantity', rowIndex)"
              @update:value="markEdit('quantity', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 2)"
            />
          </div>
          <div :data-import-row="rowIndex" :data-import-col="3">
            <NInputNumber
              v-model:value="row.purchase_price"
              :min="0"
              :show-button="false"
              size="small"
              style="width: 100%"
              @focus="markEdit('purchase_price', rowIndex)"
              @update:value="markEdit('purchase_price', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 3)"
            />
          </div>
          <div :data-import-row="rowIndex" :data-import-col="4">
            <NInputNumber
              v-model:value="row.selling_price"
              :min="0"
              :show-button="false"
              size="small"
              style="width: 100%"
              @focus="markEdit('selling_price', rowIndex)"
              @update:value="markEdit('selling_price', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 4)"
            />
          </div>
          <div :data-import-row="rowIndex" :data-import-col="5">
            <NSelect
              v-model:value="row.vendor"
              :options="vendorSelectOptions"
              filterable
              tag
              clearable
              size="small"
              placeholder="Select / type"
              :filter="naiveSelectSubstringFilter"
              style="width: 100%"
              @focus="markEdit('vendor', rowIndex)"
              @update:value="markEdit('vendor', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 5)"
            />
          </div>
          <div :data-import-row="rowIndex" :data-import-col="6">
            <NInput
              v-model:value="row.category"
              placeholder="Category"
              size="small"
              @focus="markEdit('category', rowIndex)"
              @update:value="markEdit('category', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 6)"
            />
          </div>
          <div :data-import-row="rowIndex" :data-import-col="7">
            <NInput
              v-model:value="row.sku"
              placeholder="SKU"
              size="small"
              @focus="markEdit('sku', rowIndex)"
              @update:value="onMatchKeyEdit('sku', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 7)"
            />
          </div>
          <div :data-import-row="rowIndex" :data-import-col="8">
            <NInput
              v-model:value="row.barcode"
              placeholder="Barcode"
              size="small"
              @focus="markEdit('barcode', rowIndex)"
              @update:value="onMatchKeyEdit('barcode', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 8)"
            />
          </div>
          <span
            class="import-margin"
            :class="{ 'import-margin--neg': rowMarginNeg(row) }"
            title="Gross margin"
          >
            {{ rowMarginLabel(row) }}
          </span>
          <span class="import-status">
            <NTag
              v-if="row._existing"
              size="tiny"
              type="warning"
              round
              :title="`Matched by ${row._existing.matchBy}`"
            >
              Existing · stock {{ row._existing.current_stock }}
            </NTag>
            <NTag v-else-if="String(row.name || '').trim()" size="tiny" type="success" round>
              New
            </NTag>
          </span>
          <NButton
            quaternary
            size="tiny"
            type="error"
            :disabled="draftRows.length <= 1 && !row.name"
            @click="removeRow(rowIndex)"
          >
            ×
          </NButton>
        </div>
      </div>
      <NSpace class="import-fill-actions" justify="space-between" wrap>
        <NSpace>
          <NButton @click="step = 2">Back</NButton>
          <NButton @click="draftRows.push(newDraftRow())">Add row</NButton>
        </NSpace>
        <NButton type="primary" @click="goToReview">
          Review {{ filledDraftRows.length || "" }} row(s)
        </NButton>
      </NSpace>
    </div>

    <div v-else-if="step === 4" class="import-fill-panel">
      <NAlert type="warning" style="margin-bottom: 8px" :bordered="false">
        <strong>{{ reviewNewCount }}</strong> new ·
        <strong>{{ reviewExistingCount }}</strong> existing
        <template v-if="reviewExistingCount">
          — choose what to do with existing rows below
        </template>
      </NAlert>
      <p style="margin: 0 0 8px">When a row matches an existing product:</p>
      <NRadioGroup v-model:value="duplicateBehavior" style="margin-bottom: 8px">
        <NSpace vertical>
          <NRadio value="add_stock">
            Add quantity to stock (new batch at CSV purchase price — old stock cost unchanged)
          </NRadio>
          <NRadio value="update_info">
            Update info only (name / sale price — no stock or cost change)
          </NRadio>
          <NRadio value="skip">Skip row</NRadio>
        </NSpace>
      </NRadioGroup>
      <NAlert type="info" style="margin-bottom: 8px" :bordered="false">
        {{ reviewRows.length }} product(s) ready to import. Go back to edit if anything looks wrong.
      </NAlert>
      <div class="import-review-table app-table-panel">
        <NDataTable
          :columns="reviewColumns"
          :data="reviewRows"
          :row-key="(r) => r._key"
          size="small"
          :bordered="true"
          flex-height
          :scroll-x="reviewScrollX"
        />
      </div>
      <NSpace class="import-fill-actions">
        <NButton :disabled="importing" @click="step = 3">Back to edit</NButton>
        <NButton :loading="importing" type="primary" @click="runImport">
          Confirm import
          <template v-if="importing && importProgress.total">
            ({{ importProgress.done }} / {{ importProgress.total }})
          </template>
        </NButton>
      </NSpace>
    </div>

    <div v-else>
      <NAlert v-if="lastImportJob" type="success" style="margin-bottom: 12px" :bordered="false">
        Import finished. You can undo it anytime from the yellow bar above (or here).
        <div style="margin-top: 8px">
          <NButton
            size="small"
            type="warning"
            :loading="undoingImport"
            @click="confirmUndoLastImport"
          >
            Undo last import
          </NButton>
        </div>
      </NAlert>
      <NDataTable
        :columns="[
          { title: 'Product', key: 'name' },
          { title: 'Result', key: 'status' },
        ]"
        :data="results"
      />
      <NButton style="margin-top: 16px" @click="resetAll">Import another file</NButton>
    </div>
  </div>
</template>

<style scoped>
.import-steps {
  margin-bottom: 12px;
  flex-shrink: 0;
}
.import-undo-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.import-map-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-bottom: 8px;
}
.import-map-select {
  width: 280px;
  margin-left: 12px;
}
.import-fill-panel {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.import-edit-grid {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 8px;
  background: #fff;
}
.import-review-table {
  flex: 1 1 auto;
  min-height: 180px;
  margin-bottom: 0;
}
.import-fill-actions {
  flex: 0 0 auto;
  margin-top: 12px;
  padding-bottom: 4px;
}
.import-edit-head,
.import-edit-row {
  display: grid;
  grid-template-columns:
    100px minmax(140px, 1.4fr) 72px 96px 96px minmax(120px, 1fr) minmax(90px, 0.9fr) 90px 110px 64px 130px 36px;
  gap: 8px;
  align-items: center;
  min-width: 1240px;
}
.import-edit-row--existing {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  padding: 4px 6px;
  margin: 0 -2px;
}
.import-status {
  display: flex;
  align-items: center;
  min-width: 0;
}
.import-edit-head {
  font-size: 12px;
  font-weight: 650;
  color: #6b7280;
  position: sticky;
  top: 0;
  z-index: 2;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 2px;
  box-shadow: 0 1px 0 #e5e7eb;
}
.import-col-head {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.import-copy-all {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 4px;
  line-height: 1;
  flex-shrink: 0;
}
.import-copy-all:hover {
  color: #0f766e;
  background: rgba(15, 118, 110, 0.08);
}
.import-margin {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #0f766e;
}
.import-margin--neg {
  color: #dc2626;
}
@media (max-width: 768px) {
  .import-map-row {
    flex-direction: column;
    align-items: stretch;
  }
  .import-map-select {
    width: 100% !important;
    margin-left: 0 !important;
  }
}
</style>

<style>
/* Beat .app-page--fill > * { flex: 0 } so edit/review fill the window */
.app-page--fill > .import-fill-panel {
  flex: 1 1 auto !important;
  min-height: 0;
}
</style>
