<script setup>
import { ref, onMounted, h } from "vue";
import { NButton, NDataTable, NModal, NSpace, useMessage } from "naive-ui";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import ReceiptPreview from "../components/ReceiptPreview.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { listSales, getSale, saleGrossProfit } from "../services/sales.js";
import { formatPkr } from "../utils/format.js";
import { getSettings } from "../services/settings.js";
import { openReceiptPrintWindow } from "../utils/receipt.js";

const message = useMessage();
const rows = ref([]);
const loading = ref(false);
const detailOpen = ref(false);
const detail = ref(null);
const receiptSettings = ref({});

const columns = [
  { title: "Reference", key: "sale_reference" },
  { title: "Date", key: "completed_at", render: (r) => new Date(r.completed_at).toLocaleString() },
  { title: "Total", key: "total_amount", render: (r) => formatPkr(r.total_amount) },
  { title: "Payment", key: "payment_method" },
  {
    title: "",
    key: "open",
    render: (row) => h(NButton, { size: "small", onClick: () => openSale(row.id) }, () => "View"),
  },
];

async function loadSettings() {
  if (!supabaseConfigured) return;
  const s = await getSettings();
  if (s) receiptSettings.value = s;
}

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    const res = await listSales();
    rows.value = res.rows;
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

function printReceipt() {
  if (!detail.value) return;
  const ok = openReceiptPrintWindow(detail.value.sale, detail.value.items, receiptSettings.value);
  if (!ok) message.warning("Allow pop-ups to print receipt");
}

onMounted(load);
</script>

<template>
  <div>
    <h1 style="margin-top: 0">Sales history</h1>
    <SupabaseRequiredAlert />
    <NDataTable :loading="loading" :columns="columns" :data="rows" />
    <NModal v-model:show="detailOpen" preset="card" title="Sale & receipt" style="width: min(920px, 96vw)">
      <template v-if="detail">
        <NSpace align="start" :size="20" wrap item-style="flex: 1; min-width: 280px">
          <div style="flex: 1; min-width: 200px">
            <p><strong>{{ detail.sale.sale_reference }}</strong></p>
            <p>Total: {{ formatPkr(detail.sale.total_amount) }}</p>
            <p>Gross profit: {{ formatPkr(saleGrossProfit(detail.items)) }}</p>
            <NSpace>
              <NButton type="primary" @click="printReceipt">Print receipt</NButton>
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
