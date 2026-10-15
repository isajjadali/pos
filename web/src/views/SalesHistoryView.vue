<script setup>
import { ref, onMounted, h } from "vue";
import { NButton, NDataTable, NModal, NList, NListItem, useMessage } from "naive-ui";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { listSales, getSale, saleGrossProfit } from "../services/sales.js";
import { formatPkr } from "../utils/format.js";
import { getSettings } from "../services/settings.js";

const message = useMessage();
const rows = ref([]);
const loading = ref(false);
const detailOpen = ref(false);
const detail = ref(null);
const storeName = ref("Dollar World by WABz");

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

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    const res = await listSales();
    rows.value = res.rows;
    const s = await getSettings();
    if (s?.store_name) storeName.value = s.store_name;
  } catch (e) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function openSale(id) {
  detail.value = await getSale(id);
  detailOpen.value = true;
}

function printReceipt() {
  if (!detail.value) return;
  const { sale, items } = detail.value;
  const html = `
    <html><head><title>Receipt</title></head><body style="font-family:monospace;width:280px">
    <h3>${storeName.value}</h3>
    <div>${sale.sale_reference}</div>
    <div>${new Date(sale.completed_at).toLocaleString()}</div>
    <hr/>
    ${items.map((i) => `<div>${i.product_name_snapshot} x${i.quantity} @ ${i.unit_selling_price} = ${i.line_total}</div>`).join("")}
    <hr/>
    <div>Total: ${sale.total_amount}</div>
    <div>Cash: ${sale.amount_received ?? ""}</div>
    <div>Change: ${sale.change_due ?? ""}</div>
    </body></html>`;
  const w = window.open("", "_blank");
  w.document.write(html);
  w.print();
}

onMounted(load);
</script>

<template>
  <div>
    <h1 style="margin-top: 0">Sales history</h1>
    <SupabaseRequiredAlert />
    <NDataTable :loading="loading" :columns="columns" :data="rows" />
    <NModal v-model:show="detailOpen" preset="card" title="Sale details" style="width: 520px">
      <template v-if="detail">
        <p><strong>{{ detail.sale.sale_reference }}</strong></p>
        <NList>
          <NListItem v-for="i in detail.items" :key="i.id">
            {{ i.product_name_snapshot }} × {{ i.quantity }} — {{ formatPkr(i.line_total) }}
          </NListItem>
        </NList>
        <p>Total: {{ formatPkr(detail.sale.total_amount) }}</p>
        <p>Gross profit: {{ formatPkr(saleGrossProfit(detail.items)) }}</p>
        <NButton type="primary" @click="printReceipt">Print receipt</NButton>
      </template>
    </NModal>
  </div>
</template>
