<script setup>
import { ref, onMounted, computed } from "vue";
import {
  NButton,
  NSpace,
  NInput,
  NInputNumber,
  NDataTable,
  NCard,
  NTag,
  NGrid,
  NGi,
  useMessage,
} from "naive-ui";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { formatPkr } from "../utils/format.js";
import {
  listOpenOrders,
  createOrder,
  getOrder,
  addProductToOrder,
  updateOrderItemQty,
  removeOrderItem,
  setOrderStatus,
  cancelOrder,
  searchProductsForPos,
  findProductByBarcode,
  completeSale,
} from "../services/pos.js";

const message = useMessage();
const orders = ref([]);
const currentOrderId = ref(null);
const order = ref(null);
const items = ref([]);
const search = ref("");
const searchResults = ref([]);
const discount = ref(0);
const cashReceived = ref(0);
const completing = ref(false);
const scanBuffer = ref("");

const total = computed(() => Math.max(Number(order.value?.subtotal || 0) - Number(discount.value || 0), 0));
const changeDue = computed(() => Math.max(Number(cashReceived.value || 0) - total.value, 0));

const itemColumns = [
  { title: "Product", key: "products", render: (r) => r.products?.name },
  { title: "Price", key: "unit_selling_price", render: (r) => formatPkr(r.unit_selling_price) },
  {
    title: "Qty",
    key: "quantity",
    render: (r) => r.quantity,
  },
  { title: "Line", key: "line_total", render: (r) => formatPkr(r.line_total) },
  {
    title: "",
    key: "x",
    render: (r) => null,
  },
];

async function refreshOrders() {
  orders.value = await listOpenOrders();
}

async function loadCurrent() {
  if (!currentOrderId.value) {
    order.value = null;
    items.value = [];
    return;
  }
  const data = await getOrder(currentOrderId.value);
  order.value = data.order;
  items.value = data.items;
  discount.value = Number(data.order.discount_amount) || 0;
}

async function newOrder() {
  const o = await createOrder();
  await refreshOrders();
  currentOrderId.value = o.id;
  await loadCurrent();
}

async function selectOrder(id) {
  currentOrderId.value = id;
  await loadCurrent();
}

async function holdOrder() {
  if (!currentOrderId.value) return;
  await setOrderStatus(currentOrderId.value, "on_hold");
  message.success("Order on hold");
  await refreshOrders();
  currentOrderId.value = null;
  await loadCurrent();
}

async function resumeOrder(id) {
  await setOrderStatus(id, "active");
  currentOrderId.value = id;
  await refreshOrders();
  await loadCurrent();
}

async function doSearch() {
  searchResults.value = await searchProductsForPos(search.value);
}

async function addProduct(product) {
  if (!currentOrderId.value) await newOrder();
  await addProductToOrder(currentOrderId.value, product);
  await loadCurrent();
  search.value = "";
  searchResults.value = [];
}

async function onScanEnter() {
  const code = scanBuffer.value.trim();
  scanBuffer.value = "";
  if (!code) return;
  const product = await findProductByBarcode(code);
  if (!product) {
    message.error("Barcode not found");
    return;
  }
  await addProduct(product);
}

async function complete() {
  if (!items.value.length) return message.warning("Cart is empty");
  for (const line of items.value) {
    if (line.quantity > line.products?.current_stock) {
      return message.error(`Insufficient stock: ${line.products?.name}`);
    }
  }
  completing.value = true;
  try {
    const saleId = await completeSale(currentOrderId.value, {
      discount: discount.value,
      amountReceived: cashReceived.value,
    });
    message.success(`Sale completed (${saleId})`);
    cashReceived.value = 0;
    discount.value = 0;
    await refreshOrders();
    await newOrder();
  } catch (e) {
    message.error(e.message);
  } finally {
    completing.value = false;
  }
}

async function removeLine(row) {
  await removeOrderItem(row.id, currentOrderId.value);
  await loadCurrent();
}

onMounted(async () => {
  if (!supabaseConfigured) return;
  await refreshOrders();
  if (orders.value.length) currentOrderId.value = orders.value.find((o) => o.status === "active")?.id || orders.value[0].id;
  else await newOrder();
  await loadCurrent();
});
</script>

<template>
  <div>
    <h1 style="margin-top: 0">POS / New Sale</h1>
    <SupabaseRequiredAlert />
    <NGrid cols="1 l:3" :x-gap="16">
      <NGi>
        <NCard title="Orders" size="small">
          <NSpace vertical style="width: 100%">
            <NButton block type="primary" @click="newOrder">New order</NButton>
            <div v-for="o in orders" :key="o.id">
              <NButton
                block
                :type="o.id === currentOrderId ? 'primary' : 'default'"
                @click="o.status === 'on_hold' ? resumeOrder(o.id) : selectOrder(o.id)"
              >
                {{ o.order_reference }}
                <NTag size="tiny" style="margin-left: 6px">{{ o.status }}</NTag>
              </NButton>
            </div>
          </NSpace>
        </NCard>
      </NGi>
      <NGi :span="2">
        <NCard title="Cart" size="small">
          <NSpace style="margin-bottom: 12px" vertical>
            <NInput
              v-model:value="scanBuffer"
              placeholder="Scan barcode or type SKU and press Enter"
              @keyup.enter="onScanEnter"
            />
            <NSpace>
              <NInput v-model:value="search" placeholder="Search product" @keyup.enter="doSearch" />
              <NButton @click="doSearch">Search</NButton>
            </NSpace>
            <NSpace v-if="searchResults.length" vertical>
              <NButton
                v-for="p in searchResults"
                :key="p.id"
                block
                secondary
                @click="addProduct(p)"
              >
                {{ p.name }} — {{ formatPkr(p.selling_price) }} (stock {{ p.current_stock }})
              </NButton>
            </NSpace>
          </NSpace>
          <NDataTable :columns="itemColumns" :data="items" size="small" />
          <NSpace style="margin-top: 16px" vertical>
            <div>Subtotal: <strong>{{ formatPkr(order?.subtotal) }}</strong></div>
            <div>Discount (PKR): <NInputNumber v-model:value="discount" :min="0" style="width: 140px" /></div>
            <div>Total: <strong>{{ formatPkr(total) }}</strong></div>
            <div>Cash received: <NInputNumber v-model:value="cashReceived" :min="0" style="width: 140px" /></div>
            <div>Change: <strong>{{ formatPkr(changeDue) }}</strong></div>
          </NSpace>
          <NSpace style="margin-top: 16px">
            <NButton @click="holdOrder">Hold order</NButton>
            <NButton type="primary" :loading="completing" @click="complete">Complete sale</NButton>
            <NButton type="warning" @click="cancelOrder(currentOrderId).then(refreshOrders)">Cancel</NButton>
          </NSpace>
        </NCard>
      </NGi>
    </NGrid>
  </div>
</template>
