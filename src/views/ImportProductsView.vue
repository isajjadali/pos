<script setup>
import { ref, computed } from "vue";
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
  useMessage,
} from "naive-ui";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { parseCsv, rowsToObjects, IMPORT_FIELD_OPTIONS, SAMPLE_CSV } from "../utils/csv.js";
import { importProductsBulk, recordImportJob } from "../services/importProducts.js";
const message = useMessage();
const step = ref(1);
const headers = ref([]);
const records = ref([]);
const mapping = ref({});
const duplicateBehavior = ref("add_stock");
const importing = ref(false);
const importProgress = ref({ done: 0, total: 0 });
const results = ref([]);

const systemFields = IMPORT_FIELD_OPTIONS.filter((f) => f.value !== "skip");

const previewRows = computed(() => records.value.map((r) => mapRecord(r)));

const columns = computed(() => [
  {
    title: "#",
    key: "_n",
    width: 48,
    render: (_r, i) => i + 1,
  },
  ...systemFields.map((f) => ({ title: f.label, key: f.value })),
]);

function mapRecord(raw) {
  const out = {};
  for (const field of systemFields) {
    const col = Object.entries(mapping.value).find(([, v]) => v === field.value)?.[0];
    out[field.value] = col ? raw[col] : "";
  }
  return out;
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

async function runImport() {
  if (!supabaseConfigured) return;
  importing.value = true;
  results.value = [];
  importProgress.value = { done: 0, total: records.value.length };

  const mappedRows = records.value.map((raw) => mapRecord(raw));

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
    });
    step.value = 4;
    message.success(`Import done: ${success} ok, ${failed} failed`);
  } catch (e) {
    message.error(e.message || "Import failed");
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div>
    <h1 style="margin-top: 0">Import Products (CSV)</h1>
    <NAlert type="info" style="margin-bottom: 12px">Image / AI import is not part of MVP.</NAlert>
    <SupabaseRequiredAlert />
    <NSteps :current="step" style="margin-bottom: 24px">
      <NStep title="Upload" />
      <NStep title="Map columns" />
      <NStep title="Preview & import" />
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
      <NButton type="primary" style="margin-top: 16px" @click="step = 3">Continue</NButton>
    </div>

    <div v-else-if="step === 3">
      <p>When a row matches an existing product:</p>
      <NRadioGroup v-model:value="duplicateBehavior">
        <NSpace vertical>
          <NRadio value="add_stock">Add quantity to stock</NRadio>
          <NRadio value="update_info">Update info only (no stock change)</NRadio>
          <NRadio value="skip">Skip row</NRadio>
        </NSpace>
      </NRadioGroup>
      <h3>Preview ({{ previewRows.length }} rows)</h3>
      <NDataTable :columns="columns" :data="previewRows" :max-height="480" :scroll-x="900" />
      <NSpace style="margin-top: 16px">
        <NButton :loading="importing" type="primary" @click="runImport">
          Confirm import
          <template v-if="importing && importProgress.total">
            ({{ importProgress.done }} / {{ importProgress.total }})
          </template>
        </NButton>
        <NButton @click="step = 2">Back</NButton>
      </NSpace>
    </div>

    <div v-else>
      <NDataTable :columns="[{ title: 'Product', key: 'name' }, { title: 'Result', key: 'status' }]" :data="results" />
      <NButton style="margin-top: 16px" @click="step = 1">Import another file</NButton>
    </div>
  </div>
</template>

<style scoped>
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
