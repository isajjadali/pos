<script setup>
import { ref, onMounted } from "vue";
import {
  NButton,
  NSpace,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NInputNumber,
  NSelect,
  NInput,
  useMessage,
} from "naive-ui";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { listStockMovements, receiveStock, adjustStock, listLowStockProducts } from "../services/inventory.js";
import { listProducts } from "../services/products.js";
import { listActiveVendorOptions } from "../services/vendors.js";

const message = useMessage();
const movements = ref([]);
const lowStock = ref([]);
const productOptions = ref([]);
const vendorOptions = ref([]);
const loading = ref(false);

const showReceive = ref(false);
const showAdjust = ref(false);
const receiveForm = ref({ productId: null, quantity: 1, unitCost: 0, vendorId: null, notes: "" });
const adjustForm = ref({ productId: null, quantityChange: -1, movementType: "damage", notes: "" });

const columns = [
  { title: "When", key: "created_at", width: 160, render: (r) => new Date(r.created_at).toLocaleString() },
  { title: "Product", key: "products", render: (r) => r.products?.name || "—" },
  { title: "Type", key: "movement_type" },
  { title: "Change", key: "quantity_change" },
  { title: "Qty after", key: "new_quantity" },
  { title: "Cost", key: "unit_cost" },
  { title: "Notes", key: "notes", ellipsis: true },
];

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    const [m, l, p, v] = await Promise.all([
      listStockMovements({ pageSize: 50 }),
      listLowStockProducts(),
      listProducts({ pageSize: 500, activeOnly: true }),
      listActiveVendorOptions(),
    ]);
    movements.value = m.rows;
    lowStock.value = l;
    productOptions.value = p.rows.map((x) => ({ label: `${x.name} (${x.current_stock})`, value: x.id }));
    vendorOptions.value = v.map((x) => ({ label: x.name, value: x.id }));
  } catch (e) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function submitReceive() {
  try {
    await receiveStock(receiveForm.value);
    message.success("Stock received");
    showReceive.value = false;
    await load();
  } catch (e) {
    message.error(e.message);
  }
}

async function submitAdjust() {
  try {
    await adjustStock(adjustForm.value);
    message.success("Stock adjusted");
    showAdjust.value = false;
    await load();
  } catch (e) {
    message.error(e.message);
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1 style="margin-top: 0">Inventory</h1>
    <SupabaseRequiredAlert />
    <NSpace style="margin-bottom: 16px">
      <NButton type="primary" :disabled="!supabaseConfigured" @click="showReceive = true">Receive stock</NButton>
      <NButton :disabled="!supabaseConfigured" @click="showAdjust = true">Adjustment / damage</NButton>
      <NButton @click="load">Refresh</NButton>
    </NSpace>
    <p v-if="lowStock.length"><strong>Low stock:</strong> {{ lowStock.map((p) => p.name).join(", ") }}</p>
    <NDataTable :loading="loading" :columns="columns" :data="movements" />
    <NModal v-model:show="showReceive" preset="card" title="Receive stock" style="width: 480px">
      <NForm>
        <NFormItem label="Product"><NSelect v-model:value="receiveForm.productId" :options="productOptions" filterable /></NFormItem>
        <NFormItem label="Quantity"><NInputNumber v-model:value="receiveForm.quantity" :min="1" style="width: 100%" /></NFormItem>
        <NFormItem label="Purchase cost (per unit)"><NInputNumber v-model:value="receiveForm.unitCost" :min="0" style="width: 100%" /></NFormItem>
        <NFormItem label="Vendor"><NSelect v-model:value="receiveForm.vendorId" :options="vendorOptions" clearable /></NFormItem>
        <NFormItem label="Notes"><NInput v-model:value="receiveForm.notes" type="textarea" /></NFormItem>
      </NForm>
      <template #footer><NButton type="primary" @click="submitReceive">Confirm receipt</NButton></template>
    </NModal>
    <NModal v-model:show="showAdjust" preset="card" title="Stock adjustment" style="width: 480px">
      <NForm>
        <NFormItem label="Product"><NSelect v-model:value="adjustForm.productId" :options="productOptions" filterable /></NFormItem>
        <NFormItem label="Quantity change (negative = remove)"><NInputNumber v-model:value="adjustForm.quantityChange" style="width: 100%" /></NFormItem>
        <NFormItem label="Type"><NInput v-model:value="adjustForm.movementType" /></NFormItem>
        <NFormItem label="Notes"><NInput v-model:value="adjustForm.notes" type="textarea" /></NFormItem>
      </NForm>
      <template #footer><NButton type="warning" @click="submitAdjust">Save adjustment</NButton></template>
    </NModal>
  </div>
</template>
