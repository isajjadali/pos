<script setup>
import { ref, onMounted, h } from "vue";
import {
  NButton,
  NSpace,
  NInput,
  NDataTable,
  NModal,
  NInputNumber,
  NRadioGroup,
  NRadio,
  useMessage,
} from "naive-ui";
import { createApp } from "vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import BarcodePrintSheet from "../components/BarcodePrintSheet.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { listProductsForPrinting, reconcilePrint, listPrintJobs } from "../services/barcodes.js";
import { getSettings } from "../services/settings.js";

const message = useMessage();
const rows = ref([]);
const search = ref("");
const loading = ref(false);
const selected = ref([]);
const printMode = ref("unprinted");
const customQty = ref(1);
const showReconcile = ref(false);
const reconcileQty = ref(0);
const pendingPrint = ref([]);
const labelSize = ref({ w: 50, h: 30 });
const jobs = ref([]);

const columns = [
  { type: "selection" },
  { title: "Name", key: "name", ellipsis: true },
  { title: "Barcode", key: "barcode", width: 120 },
  { title: "Stock", key: "current_stock", width: 70 },
  { title: "Pending labels", key: "unprinted_barcode_qty", width: 110 },
  {
    title: "",
    key: "print",
    width: 90,
    render: (row) =>
      h(NButton, { size: "small", onClick: () => printOne(row) }, () => "Print"),
  },
];

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    rows.value = await listProductsForPrinting({ search: search.value });
    jobs.value = await listPrintJobs(15);
    const s = await getSettings();
    if (s) labelSize.value = { w: Number(s.label_width_mm) || 50, h: Number(s.label_height_mm) || 30 };
  } catch (e) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

function buildLabels(product, count) {
  const labels = [];
  for (let i = 0; i < count; i++) {
    labels.push({ name: product.name, barcode: product.barcode, price: product.selling_price });
  }
  return labels;
}

function openPrintWindow(labels) {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const app = createApp(BarcodePrintSheet, {
    labels,
    widthMm: labelSize.value.w,
    heightMm: labelSize.value.h,
  });
  app.mount(mount);
  setTimeout(() => {
    app.unmount();
    mount.remove();
  }, 3000);
}

function printOne(row) {
  let qty = 1;
  if (printMode.value === "unprinted") qty = Math.max(1, row.unprinted_barcode_qty || 0);
  else if (printMode.value === "current_stock") qty = Math.max(1, row.current_stock || 0);
  else qty = customQty.value;
  pendingPrint.value = [{ product: row, requested: qty }];
  reconcileQty.value = qty;
  showReconcile.value = true;
}

function printSelected() {
  const list = rows.value.filter((r) => selected.value.includes(r.id));
  if (!list.length) return message.warning("Select products");
  const batch = [];
  for (const row of list) {
    let qty = 1;
    if (printMode.value === "unprinted") qty = Math.max(0, row.unprinted_barcode_qty || 0);
    else if (printMode.value === "current_stock") qty = Math.max(0, row.current_stock || 0);
    else qty = customQty.value;
    if (qty > 0) batch.push({ product: row, requested: qty });
  }
  pendingPrint.value = batch;
  reconcileQty.value = batch[0]?.requested || 0;
  showReconcile.value = true;
}

async function confirmPrinted() {
  try {
    let allLabels = [];
    for (const item of pendingPrint.value) {
      const labels = buildLabels(item.product, item.requested);
      allLabels = allLabels.concat(labels);
      const reconciled =
        pendingPrint.value.length === 1 ? reconcileQty.value : item.requested;
      await reconcilePrint(item.product.id, printMode.value, item.requested, reconciled);
    }
    openPrintWindow(allLabels);
    showReconcile.value = false;
    message.success("Print job recorded. Pending qty updated.");
    await load();
  } catch (e) {
    message.error(e.message);
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1 style="margin-top: 0">Barcode printing</h1>
    <SupabaseRequiredAlert />
    <NRadioGroup v-model:value="printMode" style="margin-bottom: 12px">
      <NSpace>
        <NRadio value="unprinted">Print new / unprinted</NRadio>
        <NRadio value="current_stock">Print for current stock</NRadio>
        <NRadio value="custom">Custom quantity</NRadio>
      </NSpace>
    </NRadioGroup>
    <NInputNumber v-if="printMode === 'custom'" v-model:value="customQty" :min="1" style="width: 120px; margin-bottom: 12px" />
    <NSpace style="margin-bottom: 12px">
      <NInput v-model:value="search" placeholder="Search" clearable @keyup.enter="load" />
      <NButton @click="load">Search</NButton>
      <NButton type="primary" @click="printSelected">Print selected</NButton>
    </NSpace>
    <NDataTable
      v-model:checked-row-keys="selected"
      :row-key="(r) => r.id"
      :loading="loading"
      :columns="columns"
      :data="rows"
    />
    <h3>Recent print jobs</h3>
    <pre style="font-size: 12px">{{ jobs.length }} jobs loaded</pre>

    <NModal v-model:show="showReconcile" preset="dialog" title="Confirm labels printed?">
      <p>How many labels did you actually print? (Updates pending barcode qty only — stock unchanged.)</p>
      <NInputNumber v-model:value="reconcileQty" :min="0" style="width: 100%" />
      <template #action>
        <NButton @click="showReconcile = false">Cancel</NButton>
        <NButton type="primary" @click="confirmPrinted">Printed — update counts</NButton>
      </template>
    </NModal>
  </div>
</template>
