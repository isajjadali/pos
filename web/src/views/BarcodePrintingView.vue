<script setup>
import { ref, onMounted, h, computed } from "vue";
import {
  NButton,
  NSpace,
  NInput,
  NDataTable,
  NInputNumber,
  NRadioGroup,
  NRadio,
  useMessage,
} from "naive-ui";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { listProductsForPrinting, reconcilePrint, listPrintJobs } from "../services/barcodes.js";
import { getSettings } from "../services/settings.js";
import { buildBatchZpl } from "../utils/zebraZpl.js";
import { resolveBrowserPrintBase, sendZplToZebra } from "../utils/zebraBrowserPrint.js";

/** Fixed label size for now (mm) — always 40 × 25 */
const labelSize = { w: 40, h: 25 };

const message = useMessage();
const rows = ref([]);
const search = ref("");
const loading = ref(false);
const printing = ref(false);
const printingRowId = ref(null);
const selected = ref([]);
const printMode = ref("unprinted");
const customQty = ref(1);
const jobs = ref([]);

const columns = computed(() => [
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
]);

async function load({ silent = false } = {}) {
  if (!supabaseConfigured) return;
  if (!silent) loading.value = true;
  try {
    rows.value = await listProductsForPrinting({ search: search.value });
    jobs.value = await listPrintJobs(15);
    await getSettings();
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

function qtyForRow(row) {
  if (printMode.value === "unprinted") return Math.max(0, row.unprinted_barcode_qty || 0);
  if (printMode.value === "current_stock") return Math.max(0, row.current_stock || 0);
  return Math.max(1, customQty.value);
}

function buildBatchFromRows(list) {
  const batch = [];
  for (const row of list) {
    const qty = qtyForRow(row);
    if (qty > 0) batch.push({ product: row, requested: qty });
  }
  return batch;
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

    const zpl = buildBatchZpl(allLabels, labelSize.w, labelSize.h);
    await sendZplToZebra(zpl);

    for (const item of batch) {
      await reconcilePrint(item.product.id, printMode.value, item.requested, item.requested);
    }

    message.success("Labels sent to printer.");
    await load({ silent: true });
  } catch (e) {
    message.error(e.message || "Print failed");
  } finally {
    printing.value = false;
    printingRowId.value = null;
  }
}

function printOne(row) {
  const qty = qtyForRow(row);
  if (qty <= 0) {
    message.warning("No labels to print for this product.");
    return;
  }
  runPrint([{ product: row, requested: qty }]);
}

function printSelected() {
  const list = rows.value.filter((r) => selected.value.includes(r.id));
  if (!list.length) return message.warning("Select products");
  runPrint(buildBatchFromRows(list));
}

onMounted(() => {
  load();
  resolveBrowserPrintBase().catch(() => {});
});
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
    <NInputNumber
      v-if="printMode === 'custom'"
      v-model:value="customQty"
      :min="1"
      style="width: 120px; margin-bottom: 12px"
    />
    <NSpace style="margin-bottom: 12px">
      <NInput v-model:value="search" placeholder="Search" clearable @keyup.enter="load" />
      <NButton @click="load">Search</NButton>
      <NButton type="primary" :loading="printing" @click="printSelected">Print selected</NButton>
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
  </div>
</template>
