<script setup>
import { ref, onMounted, h, computed } from "vue";
import {
  NAlert,
  NButton,
  NDataTable,
  NDrawer,
  NDrawerContent,
  NInput,
  NSpace,
  NText,
  NTag,
  useMessage,
} from "naive-ui";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { shopifyOrdersList, shopifyOrderGet } from "../services/shopify.js";
import { formatPkr } from "../utils/format.js";
import { formatCreatedAt } from "../utils/tableColumns.js";

const message = useMessage();
const loading = ref(false);
const rows = ref([]);
const shop = ref("");
const query = ref("");
const detailOpen = ref(false);
const detailLoading = ref(false);
const detail = ref(null);
const accessError = ref("");

const columns = computed(() => [
  { title: "Order", key: "name", width: 110 },
  {
    title: "Created",
    key: "createdAt",
    width: 170,
    sorter: (a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ta - tb;
    },
    render: (r) => formatCreatedAt(r.createdAt),
  },
  {
    title: "Customer",
    key: "customerName",
    ellipsis: { tooltip: true },
    render: (r) => r.customerName || "—",
  },
  {
    title: "Total",
    key: "total",
    width: 110,
    render: (r) => (r.total != null ? formatPkr(r.total) : "—"),
  },
  {
    title: "Payment",
    key: "financialStatus",
    width: 120,
    render: (r) =>
      h(NTag, { size: "small", bordered: false }, () => r.financialStatus || "—"),
  },
  {
    title: "Fulfillment",
    key: "fulfillmentStatus",
    width: 130,
    render: (r) =>
      h(
        NTag,
        {
          size: "small",
          type: String(r.fulfillmentStatus || "").toUpperCase() === "FULFILLED" ? "success" : "warning",
          bordered: false,
        },
        () => r.fulfillmentStatus || "UNFULFILLED"
      ),
  },
  {
    title: "",
    key: "actions",
    width: 90,
    render: (row) =>
      h(NButton, { size: "small", onClick: () => openDetail(row.id) }, () => "View"),
  },
]);

const lineColumns = [
  { title: "Item", key: "title", ellipsis: { tooltip: true } },
  { title: "Variant", key: "variantTitle", width: 120, render: (r) => r.variantTitle || "—" },
  { title: "SKU", key: "sku", width: 110, render: (r) => r.sku || "—" },
  { title: "Qty", key: "quantity", width: 70 },
  {
    title: "Unit",
    key: "unitPrice",
    width: 100,
    render: (r) => (r.unitPrice != null ? formatPkr(r.unitPrice) : "—"),
  },
];

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  accessError.value = "";
  try {
    const res = await shopifyOrdersList({ query: query.value, first: 40 });
    rows.value = res.orders || [];
    shop.value = res.shop || "";
  } catch (e) {
    const msg = e.message || "Failed to load orders";
    accessError.value = msg;
    message.error(msg);
  } finally {
    loading.value = false;
  }
}

async function openDetail(orderId) {
  detailOpen.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    const res = await shopifyOrderGet(orderId);
    detail.value = res.order;
    if (res.shop) shop.value = res.shop;
  } catch (e) {
    message.error(e.message || "Failed to load order");
    detailOpen.value = false;
  } finally {
    detailLoading.value = false;
  }
}

function adminOrderUrl(order) {
  if (!shop.value || !order?.id) return null;
  const numeric = String(order.id).replace(/.*\//, "");
  return `https://${shop.value}/admin/orders/${numeric}`;
}

onMounted(load);
</script>

<template>
  <div>
    <SupabaseRequiredAlert />
    <NSpace justify="space-between" align="center" style="margin-bottom: 16px" wrap>
      <div>
        <h2 style="margin: 0">Shopify Orders</h2>
        <NText depth="3" style="font-size: 13px">
          View only — fulfill / refund in Shopify Admin.
        </NText>
      </div>
      <NSpace>
        <NInput
          v-model:value="query"
          clearable
          placeholder="Search #1001 or name…"
          style="width: 220px"
          @keyup.enter="load"
        />
        <NButton :loading="loading" type="primary" @click="load">Refresh</NButton>
      </NSpace>
    </NSpace>

    <NAlert v-if="accessError" type="warning" title="Orders access denied" style="margin-bottom: 16px">
      <div style="font-size: 13px; margin-bottom: 8px">{{ accessError }}</div>
      <ol style="margin: 0; padding-left: 18px; font-size: 13px">
        <li>Dev Dashboard → your app → enable scope <code>read_orders</code></li>
        <li>Shop Admin → Apps → uninstall this app, then install again (re-approve scopes)</li>
        <li>Settings → Shopify → Register webhooks</li>
      </ol>
    </NAlert>

    <NDataTable
      :columns="columns"
      :data="rows"
      :loading="loading"
      :bordered="false"
      size="small"
      :scroll-x="900"
    />

    <NDrawer v-model:show="detailOpen" :width="480" placement="right">
      <NDrawerContent :title="detail?.name || 'Order'" closable :native-scrollbar="false">
        <div v-if="detailLoading">Loading…</div>
        <template v-else-if="detail">
          <NSpace vertical :size="12">
            <NText depth="3" style="font-size: 13px">
              {{ detail.createdAt ? new Date(detail.createdAt).toLocaleString() : "" }}
            </NText>
            <div>
              <strong>Customer:</strong>
              {{ detail.customerName || "—" }}
              <span v-if="detail.customerEmail || detail.email">
                · {{ detail.customerEmail || detail.email }}
              </span>
            </div>
            <div>
              <NTag size="small" style="margin-right: 6px">{{ detail.financialStatus || "—" }}</NTag>
              <NTag size="small" type="warning">{{ detail.fulfillmentStatus || "UNFULFILLED" }}</NTag>
            </div>
            <div v-if="detail.shippingAddress">
              <strong>Ship to:</strong>
              <div style="font-size: 13px; color: #4b5563; margin-top: 4px">
                {{ detail.shippingAddress.name }}<br />
                {{ detail.shippingAddress.address1 }}
                <span v-if="detail.shippingAddress.address2">
                  , {{ detail.shippingAddress.address2 }}
                </span>
                <br />
                {{
                  [detail.shippingAddress.city, detail.shippingAddress.province, detail.shippingAddress.zip]
                    .filter(Boolean)
                    .join(", ")
                }}
              </div>
            </div>
            <NDataTable
              :columns="lineColumns"
              :data="detail.lineItems || []"
              size="small"
              :bordered="false"
            />
            <div style="text-align: right">
              <div v-if="detail.subtotal != null">Subtotal: {{ formatPkr(detail.subtotal) }}</div>
              <div v-if="detail.shipping != null">Shipping: {{ formatPkr(detail.shipping) }}</div>
              <strong>Total: {{ detail.total != null ? formatPkr(detail.total) : "—" }}</strong>
            </div>
            <NButton
              v-if="adminOrderUrl(detail)"
              tag="a"
              :href="adminOrderUrl(detail)"
              target="_blank"
              rel="noopener"
              block
            >
              Open in Shopify Admin
            </NButton>
          </NSpace>
        </template>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>
