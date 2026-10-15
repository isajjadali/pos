<script setup>
import { ref, onMounted, onUnmounted, computed, watch, nextTick, h } from "vue";
import { storeToRefs } from "pinia";
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
  NModal,
  NSpin,
  NText,
  useMessage,
} from "naive-ui";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import ReceiptPreview from "../components/ReceiptPreview.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { formatPkr } from "../utils/format.js";
import {
  searchProductsForPos,
  searchProductsForPosLocal,
  findProductByBarcode,
  completeSaleFromCart,
} from "../services/pos.js";
import { findProductByCodeCached, isProductCatalogReady, refreshProductCatalog } from "../services/productCatalog.js";
import { getSale } from "../services/sales.js";
import { getSettings } from "../services/settings.js";
import { openReceiptPrintWindow } from "../utils/receipt.js";
import { shouldBlockShortcut } from "../utils/hotkeys.js";
import { usePosCartStore } from "../stores/posCart.js";

const message = useMessage();
const cartStore = usePosCartStore();
const { items, subtotal, carts, activeCartId } = storeToRefs(cartStore);

const search = ref("");
const searchResults = ref([]);
const cashReceived = ref(0);
const completing = ref(false);
const scanBuffer = ref("");
const receiptOpen = ref(false);
const receiptDetail = ref(null);
const receiptSettings = ref({});
const scanRef = ref(null);
const searchRef = ref(null);
const discountRef = ref(null);
const cashRef = ref(null);
const selectedSearchIndex = ref(-1);
const lookupLoading = ref(false);
const activeLookupField = ref("scan");
let lookupTimer;

const discount = computed({
  get: () => cartStore.activeCart?.discount ?? 0,
  set: (v) => cartStore.setDiscount(v),
});

const total = computed(() => Math.max(Number(subtotal.value || 0) - Number(discount.value || 0), 0));
const changeDue = computed(() => Math.max(Number(cashReceived.value || 0) - total.value, 0));

function focusRef(r) {
  nextTick(() => r.value?.focus?.());
}

function currentLookupTerm() {
  return activeLookupField.value === "scan" ? scanBuffer.value.trim() : search.value.trim();
}

function runLiveLookup(term) {
  if (!supabaseConfigured) return;
  const q = String(term ?? "").trim();
  if (q.length < 1) {
    searchResults.value = [];
    selectedSearchIndex.value = -1;
    lookupLoading.value = false;
    return;
  }

  const local = searchProductsForPosLocal(q);
  if (local) {
    searchResults.value = local;
    selectedSearchIndex.value = local.length ? 0 : -1;
    lookupLoading.value = false;
    return;
  }

  lookupLoading.value = true;
  searchProductsForPos(q)
    .then((rows) => {
      searchResults.value = rows;
      selectedSearchIndex.value = rows.length ? 0 : -1;
    })
    .catch((e) => {
      message.error(e.message || "Search failed");
      searchResults.value = [];
    })
    .finally(() => {
      lookupLoading.value = false;
    });
}

function scheduleLiveLookup() {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(() => runLiveLookup(currentLookupTerm()), 280);
}

watch(search, () => {
  if (activeLookupField.value === "search") scheduleLiveLookup();
});

watch(scanBuffer, () => {
  if (activeLookupField.value === "scan") scheduleLiveLookup();
});

watch(searchResults, (list) => {
  if (selectedSearchIndex.value >= list.length) {
    selectedSearchIndex.value = list.length ? 0 : -1;
  } else if (list.length && selectedSearchIndex.value < 0) {
    selectedSearchIndex.value = 0;
  }
});

const lookupTerm = computed(() => currentLookupTerm());
const showPickList = computed(
  () => lookupLoading.value || (lookupTerm.value.length > 0 && searchResults.value.length > 0)
);
const showPickEmpty = computed(
  () => !lookupLoading.value && lookupTerm.value.length > 0 && searchResults.value.length === 0
);

const itemColumns = [
  { title: "Product", key: "products", render: (r) => r.products?.name, ellipsis: { tooltip: true } },
  { title: "Price", key: "unit_selling_price", width: 100, render: (r) => formatPkr(r.unit_selling_price) },
  {
    title: "Qty",
    key: "quantity",
    width: 150,
    render: (row) =>
      h(NSpace, { size: 4, align: "center" }, () => [
        h(
          NButton,
          { size: "tiny", disabled: row.quantity <= 1, onClick: () => changeLineQty(row, row.quantity - 1) },
          () => "−"
        ),
        h(NInputNumber, {
          size: "small",
          value: row.quantity,
          min: 1,
          max: row.products?.current_stock ?? 9999,
          precision: 0,
          style: "width: 72px",
          onUpdateValue: (v) => {
            if (v != null && v !== row.quantity) changeLineQty(row, v);
          },
        }),
        h(
          NButton,
          {
            size: "tiny",
            disabled: row.quantity >= (row.products?.current_stock ?? 0),
            onClick: () => changeLineQty(row, row.quantity + 1),
          },
          () => "+"
        ),
      ]),
  },
  { title: "Line", key: "line_total", width: 100, render: (r) => formatPkr(r.line_total) },
  {
    title: "",
    key: "remove",
    width: 80,
    render: (row) =>
      h(NButton, { size: "tiny", type: "error", secondary: true, onClick: () => removeLine(row) }, () => "Remove"),
  },
];

function clearLookupUi() {
  search.value = "";
  scanBuffer.value = "";
  searchResults.value = [];
  selectedSearchIndex.value = -1;
  focusRef(scanRef);
}

function addProduct(product) {
  cartStore.addProduct(product);
  clearLookupUi();
}

async function addHighlightedSearchResult() {
  if (selectedSearchIndex.value < 0 || !searchResults.value.length) return false;
  const p = searchResults.value[selectedSearchIndex.value];
  if (p) addProduct(p);
  return Boolean(p);
}

function changeLineQty(row, qty) {
  const stock = row.products?.current_stock ?? 0;
  const next = Math.floor(Number(qty) || 1);
  if (next > stock) {
    message.error(`Only ${stock} in stock`);
    return;
  }
  cartStore.setLineQty(row.lineId, next);
}

function removeLine(row) {
  cartStore.removeLine(row.lineId);
}

function holdOrder() {
  if (cartStore.holdActiveCart()) message.success("Order on hold (local)");
  else message.warning("Cart is empty");
}

function newOrder() {
  cartStore.newSaleTab();
}

function cancelCart() {
  cartStore.clearActiveCart();
  message.info("Cart cleared");
}

async function doSearch() {
  activeLookupField.value = "search";
  await runLiveLookup(search.value);
}

async function onScanEnter() {
  if (searchResults.value.length && selectedSearchIndex.value >= 0) {
    addProduct(searchResults.value[selectedSearchIndex.value]);
    return;
  }
  const code = scanBuffer.value.trim();
  if (!code) return;
  const product = isProductCatalogReady()
    ? findProductByCodeCached(code)
    : await findProductByBarcode(code);
  if (product) {
    addProduct(product);
    return;
  }
  if (searchResults.value.length === 1) {
    addProduct(searchResults.value[0]);
    return;
  }
  message.error("Not found — pick from list below or keep typing");
}

async function onSearchEnter(e) {
  e?.preventDefault?.();
  if (await addHighlightedSearchResult()) return;
  await doSearch();
}

async function onLookupEnter(e) {
  e?.preventDefault?.();
  if (await addHighlightedSearchResult()) return;
  if (activeLookupField.value === "scan") await onScanEnter();
  else await doSearch();
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
    const saleId = await completeSaleFromCart(cartStore.linesForCheckout(), {
      discount: discount.value,
      amountReceived: cashReceived.value,
    });
    message.success("Sale completed");
    receiptDetail.value = await getSale(saleId);
    const s = await getSettings();
    if (s) receiptSettings.value = s;
    receiptOpen.value = true;
    cashReceived.value = 0;
    cartStore.afterCompletedSale();
    refreshProductCatalog().catch(() => {});
  } catch (e) {
    message.error(e.message);
  } finally {
    completing.value = false;
  }
}

function onPosKeyDown(e) {
  const key = e.key;

  if (key === "Escape") {
    if (receiptOpen.value) {
      e.preventDefault();
      receiptOpen.value = false;
      return;
    }
    if (searchResults.value.length) {
      e.preventDefault();
      searchResults.value = [];
      selectedSearchIndex.value = -1;
      return;
    }
  }

  if (receiptOpen.value && (key === "p" || key === "P") && !shouldBlockShortcut(e)) {
    e.preventDefault();
    if (receiptDetail.value) {
      openReceiptPrintWindow(receiptDetail.value.sale, receiptDetail.value.items, receiptSettings.value);
    }
    return;
  }

  if (searchResults.value.length && (key === "ArrowDown" || key === "ArrowUp")) {
    const active = document.activeElement;
    const inLookup = active?.closest?.(".pos-search-wrap") || active?.closest?.(".pos-scan-wrap");
    if (!inLookup) return;
    e.preventDefault();
    const n = searchResults.value.length;
    if (key === "ArrowDown") selectedSearchIndex.value = (selectedSearchIndex.value + 1) % n;
    else selectedSearchIndex.value = (selectedSearchIndex.value - 1 + n) % n;
    return;
  }

  if (/^F\d{1,2}$/i.test(key)) {
    e.preventDefault();
    if (key === "F2") focusRef(scanRef);
    else if (key === "F3") focusRef(searchRef);
    else if (key === "F4") focusRef(discountRef);
    else if (key === "F5") focusRef(cashRef);
    else if (key === "F6") cashReceived.value = total.value;
    else if (key === "F7") holdOrder();
    else if (key === "F8") newOrder();
    else if (key === "F9") complete();
    return;
  }

  if (e.ctrlKey && key === "Enter") {
    e.preventDefault();
    complete();
    return;
  }

  if (shouldBlockShortcut(e)) return;

  if (key === "f" || key === "F") {
    e.preventDefault();
    focusRef(scanRef);
  }
}

onMounted(() => {
  window.addEventListener("keydown", onPosKeyDown);
  cartStore.init();
  focusRef(scanRef);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onPosKeyDown);
  clearTimeout(lookupTimer);
});
</script>

<template>
  <div>
    <h1 style="margin-top: 0">POS / New Sale</h1>
    <p class="pos-hint">
      Cart is instant (no save until <strong>Complete sale</strong>). <kbd>F9</kbd> checkout ·
      <kbd>F7</kbd> hold tab locally
    </p>
    <SupabaseRequiredAlert />
    <NGrid cols="1 l:3" :x-gap="16">
      <NGi>
        <NCard title="Tabs (local)" size="small">
          <NSpace vertical style="width: 100%">
            <NButton block type="primary" @click="newOrder">New tab (F8)</NButton>
            <div v-for="c in carts" :key="c.id">
              <NButton
                block
                :type="c.id === activeCartId ? 'primary' : 'default'"
                @click="cartStore.selectCart(c.id)"
              >
                {{ c.label }}
                <NTag size="tiny" style="margin-left: 6px">{{ c.status }}</NTag>
                <span v-if="c.items.length" style="margin-left: 6px">({{ c.items.length }})</span>
              </NButton>
            </div>
          </NSpace>
        </NCard>
      </NGi>
      <NGi :span="2">
        <NCard title="Cart" size="small">
          <NSpace style="margin-bottom: 12px" vertical>
            <div class="pos-scan-wrap">
              <NInput
                ref="scanRef"
                v-model:value="scanBuffer"
                placeholder="Scan or type barcode / name (F2) — list updates as you type"
                @focus="activeLookupField = 'scan'; scheduleLiveLookup()"
                @keydown.enter="onLookupEnter"
              />
            </div>
            <NSpace class="pos-search-wrap">
              <NInput
                ref="searchRef"
                v-model:value="search"
                placeholder="Search name, SKU, ID (F3)"
                @focus="activeLookupField = 'search'; scheduleLiveLookup()"
                @keydown.enter="onSearchEnter"
              />
              <NButton @click="doSearch">Search</NButton>
            </NSpace>
            <div v-if="lookupLoading" class="pos-pick-list">
              <NSpin size="small" />
              <NText depth="3" style="margin-left: 8px">Searching…</NText>
            </div>
            <div v-else-if="showPickEmpty" class="pos-pick-list pos-pick-empty">
              <NText depth="3">No matching products</NText>
            </div>
            <NSpace v-else-if="showPickList && searchResults.length" class="pos-pick-list" vertical>
              <NButton
                v-for="(p, idx) in searchResults"
                :key="p.id"
                block
                :type="idx === selectedSearchIndex ? 'primary' : 'secondary'"
                @click.stop="addProduct(p)"
              >
                <span class="pick-line">
                  <span>{{ p.name }}</span>
                  <span class="pick-meta">
                    {{ formatPkr(p.selling_price) }} · stock {{ p.current_stock }}
                    <template v-if="p.barcode"> · {{ p.barcode }}</template>
                  </span>
                </span>
              </NButton>
            </NSpace>
          </NSpace>
          <NDataTable :row-key="(row) => row.lineId" :columns="itemColumns" :data="items" size="small" />
          <NSpace style="margin-top: 16px" vertical>
            <div>Subtotal: <strong>{{ formatPkr(subtotal) }}</strong></div>
            <div>
              Discount (F4):
              <NInputNumber ref="discountRef" v-model:value="discount" :min="0" style="width: 140px" />
            </div>
            <div>Total: <strong>{{ formatPkr(total) }}</strong></div>
            <div>
              Cash (F5 / F6=total):
              <NInputNumber ref="cashRef" v-model:value="cashReceived" :min="0" style="width: 140px" />
            </div>
            <div>Change: <strong>{{ formatPkr(changeDue) }}</strong></div>
          </NSpace>
          <NSpace style="margin-top: 16px">
            <NButton @click="holdOrder">Hold tab</NButton>
            <NButton type="primary" :loading="completing" @click="complete">Complete sale (F9)</NButton>
            <NButton type="warning" @click="cancelCart">Clear cart</NButton>
          </NSpace>
        </NCard>
      </NGi>
    </NGrid>

    <NModal v-model:show="receiptOpen" preset="card" title="Receipt" style="width: min(480px, 96vw)">
      <ReceiptPreview
        v-if="receiptDetail"
        :sale="receiptDetail.sale"
        :items="receiptDetail.items"
        :settings="receiptSettings"
      />
      <NSpace v-if="receiptDetail" style="margin-top: 12px" justify="end">
        <NButton @click="receiptOpen = false">Close</NButton>
        <NButton
          type="primary"
          @click="
            openReceiptPrintWindow(receiptDetail.sale, receiptDetail.items, receiptSettings) ||
              message.warning('Allow pop-ups to print')
          "
        >
          Print
        </NButton>
      </NSpace>
    </NModal>
  </div>
</template>

<style scoped>
.pos-hint {
  margin: -4px 0 12px;
  font-size: 13px;
  color: #4b5563;
}
.pos-hint kbd {
  display: inline-block;
  padding: 1px 5px;
  font-size: 11px;
  background: #e5e7eb;
  border: 1px solid #9ca3af;
  border-radius: 4px;
}
.pos-pick-list {
  max-height: 280px;
  overflow-y: auto;
  padding: 8px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 8px;
}
.pos-pick-empty {
  text-align: center;
  padding: 16px;
}
.pick-line {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  width: 100%;
  gap: 2px;
}
.pick-meta {
  font-size: 12px;
  opacity: 0.85;
}
</style>
