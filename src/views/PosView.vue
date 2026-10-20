<script setup>
import { ref, onMounted, onUnmounted, computed, watch, nextTick, h } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import {
  NButton,
  NSpace,
  NInput,
  NInputNumber,
  NDataTable,
  NCard,
  NModal,
  NSpin,
  NText,
  useMessage,
  useDialog,
} from "naive-ui";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
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
import {
  findProductByCodeCached,
  isProductCatalogReady,
  refreshProductCatalog,
} from "../services/productCatalog.js";
import { useProductCacheStore } from "../stores/productCache.js";
import { getSale } from "../services/sales.js";
import { getSettings } from "../services/settings.js";
import { printReceipt } from "../utils/receiptPrint.js";
import { shouldBlockShortcut } from "../utils/hotkeys.js";
import { usePosCartStore } from "../stores/posCart.js";
import { useLayoutStore } from "../stores/layout.js";
import { PRODUCT_CATALOG_UPDATED } from "../utils/catalogSync.js";
import { useRouteQuerySync, routeQuery } from "../composables/useRouteQuerySync.js";
import { getActiveScheduledSaleDiscount } from "../services/scheduledDiscounts.js";
import {
  formatScheduledPromoRule,
  formatLinePromoRule,
  computeLineScheduledDiscountPkr,
  lineMatchesPromo,
} from "../utils/scheduledDiscount.js";

const message = useMessage();
const dialog = useDialog();
const route = useRoute();
const cartStore = usePosCartStore();
const layoutStore = useLayoutStore();
const productCache = useProductCacheStore();
const { items, subtotal, carts, activeCartId, focusQtyLineId } = storeToRefs(cartStore);

const cartFilter = ref("");
useRouteQuerySync({
  cartQ: { ...routeQuery.string(cartFilter), debounceMs: 300 },
});
const hasCartLineFilter = computed(() => Boolean(cartFilter.value.trim()));
function clearCartLineFilter() {
  cartFilter.value = "";
}
const searchResults = ref([]);
const cashReceived = ref(0);
const completing = ref(false);
const scanBuffer = ref("");
const receiptOpen = ref(false);
const receiptDetail = ref(null);
const receiptSettings = ref({});
const receiptPrinting = ref(false);

async function printSaleReceipt() {
  if (!receiptDetail.value) return;
  receiptPrinting.value = true;
  try {
    const res = await printReceipt(
      receiptDetail.value.sale,
      receiptDetail.value.items,
      receiptSettings.value
    );
    if (res.warning) message.warning(res.warning);
    else message.success(`Receipt sent to ${res.printerName || "printer"}`);
  } catch (e) {
    message.error(e.message || "Receipt print failed");
  } finally {
    receiptPrinting.value = false;
  }
}
const scanRef = ref(null);
const searchRef = ref(null);
const discountRef = ref(null);
const cashRef = ref(null);
const selectedSearchIndex = ref(-1);
const lookupLoading = ref(false);
let lookupTimer;

function lineMatchesFilter(line, q) {
  const term = String(q ?? "").trim().toLowerCase();
  if (!term) return true;
  const p = line.products;
  const hay = [p?.name, p?.sku, p?.barcode, line.product_id]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(term);
}

const displayItems = computed(() => {
  const list = items.value;
  if (!cartFilter.value.trim()) return list;
  return list.filter((line) => lineMatchesFilter(line, cartFilter.value));
});

const discount = computed({
  get: () => cartStore.activeCart?.discount ?? 0,
  set: (v) => cartStore.setDiscount(v),
});

const activeScheduledPromo = ref(null);

const scheduledPromoOnCart = computed(() => {
  const cart = cartStore.activeCart;
  if (!cart?.scheduledDiscountId || cart.scheduledDiscountDismissed) return null;
  const promo = activeScheduledPromo.value;
  if (!promo || promo.id !== cart.scheduledDiscountId) return null;
  return promo;
});

async function applyScheduledPromoToCart() {
  if (!supabaseConfigured) {
    activeScheduledPromo.value = null;
    cartStore.syncScheduledDiscount(null, items.value);
    return;
  }
  try {
    activeScheduledPromo.value = await getActiveScheduledSaleDiscount(undefined, items.value);
  } catch {
    activeScheduledPromo.value = null;
  }
  cartStore.syncScheduledDiscount(activeScheduledPromo.value, items.value);
}

function refreshScheduledPromoForPos() {
  return applyScheduledPromoToCart();
}

const scheduledPromoBannerText = computed(() => {
  const p = scheduledPromoOnCart.value;
  if (!p) return "";
  const rule = formatScheduledPromoRule(p, formatPkr);
  return `−${formatPkr(discount.value)} (${rule})`;
});

function removeScheduledPromoFromSale() {
  cartStore.dismissScheduledDiscount();
}

const total = computed(() => Math.max(Number(subtotal.value || 0) - Number(discount.value || 0), 0));
const changeDue = computed(() => Math.max(Number(cashReceived.value || 0) - total.value, 0));

const posTabFieldRefs = [scanRef, searchRef, discountRef, cashRef];

function focusRef(r) {
  focusPosTabFieldByRef(r);
}

function refContainsElement(ref, el) {
  const inst = ref?.value;
  if (!inst || !el) return false;
  const root = inst.$el ?? inst;
  return typeof root.contains === "function" && root.contains(el);
}

function indexOfFocusedPosTabField() {
  const el = document.activeElement;
  for (let i = 0; i < posTabFieldRefs.length; i++) {
    if (refContainsElement(posTabFieldRefs[i], el)) return i;
  }
  return -1;
}

function focusPosTabFieldByRef(r) {
  nextTick(() => {
    const inst = r?.value ?? r;
    if (!inst) return;
    if (typeof inst.focus === "function") {
      inst.focus();
      return;
    }
    const input = inst.$el?.querySelector?.("input");
    input?.focus?.();
    input?.select?.();
  });
}

function focusPosTabFieldIndex(index) {
  const ref = posTabFieldRefs[index];
  if (ref) focusPosTabFieldByRef(ref);
}

function handlePosTabKey(e) {
  if (receiptOpen.value) return;
  e.preventDefault();
  const n = posTabFieldRefs.length;
  let idx = indexOfFocusedPosTabField();
  if (idx < 0) {
    focusPosTabFieldIndex(e.shiftKey ? n - 1 : 0);
    return;
  }
  const next = e.shiftKey ? (idx - 1 + n) % n : (idx + 1) % n;
  focusPosTabFieldIndex(next);
}

function currentLookupTerm() {
  return scanBuffer.value.trim();
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
    searchResults.value = enrichSearchResults(local);
    selectedSearchIndex.value = firstSelectableSearchIndex(searchResults.value);
    lookupLoading.value = false;
    return;
  }

  lookupLoading.value = true;
  searchProductsForPos(q)
    .then((rows) => {
      searchResults.value = enrichSearchResults(rows);
      selectedSearchIndex.value = firstSelectableSearchIndex(searchResults.value);
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

watch(scanBuffer, () => {
  scheduleLiveLookup();
});

function refreshSearchAvailability() {
  if (!searchResults.value.length) return;
  const raw = searchResults.value.map((p) => {
    const { pos_available: _a, pos_in_stock: _s, ...rest } = p;
    return rest;
  });
  searchResults.value = enrichSearchResults(raw);
  if (
    selectedSearchIndex.value < 0 ||
    selectedSearchIndex.value >= searchResults.value.length ||
    searchResults.value[selectedSearchIndex.value]?.pos_available <= 0
  ) {
    selectedSearchIndex.value = firstSelectableSearchIndex(searchResults.value);
  }
}

watch(searchResults, (list) => {
  if (selectedSearchIndex.value >= list.length) {
    selectedSearchIndex.value = firstSelectableSearchIndex(list);
  } else if (list.length && selectedSearchIndex.value < 0) {
    selectedSearchIndex.value = firstSelectableSearchIndex(list);
  }
});

watch(
  () => carts.value.map((c) => c.items.map((l) => `${l.product_id}:${l.quantity}`).join(",")).join("|"),
  () => refreshSearchAvailability()
);

watch(
  () => productCache.products,
  () => {
    if (route.name !== "pos") return;
    cartStore.syncLineStockFromCatalog((id) => productCache.products.find((p) => p.id === id));
    refreshSearchAvailability();
  },
  { deep: true }
);

const lookupTerm = computed(() => currentLookupTerm());
const scanDropdownOpen = computed(
  () =>
    lookupLoading.value ||
    (lookupTerm.value.length > 0 &&
      (searchResults.value.length > 0 || (!lookupLoading.value && lookupTerm.value.length > 0)))
);
const showPickList = computed(
  () => lookupLoading.value || (lookupTerm.value.length > 0 && searchResults.value.length > 0)
);
const showPickEmpty = computed(
  () => !lookupLoading.value && lookupTerm.value.length > 0 && searchResults.value.length === 0
);

function tabShortLabel(cart) {
  const base = cart.label.replace(/\s*\(hold\)\s*/i, "").trim();
  const m = base.match(/Sale\s+(\d+)/i);
  const n = m ? m[1] : base.slice(0, 8);
  const hold = cart.status === "on_hold" ? " · hold" : "";
  const count = cart.items.length ? ` (${cart.items.length})` : "";
  return `Sale ${n}${count}${hold}`;
}

function returnToScanField() {
  searchResults.value = [];
  selectedSearchIndex.value = -1;
  scanBuffer.value = "";
  focusRef(scanRef);
}

function enrichSearchResults(rows) {
  const list = (rows ?? []).map((p) => {
    const stock = Math.floor(Number(p.current_stock) || 0);
    const available = cartStore.availableToAdd(p.id, stock);
    return { ...p, pos_available: available, pos_in_stock: stock > 0 };
  });
  list.sort((a, b) => {
    if (a.pos_available > 0 && b.pos_available <= 0) return -1;
    if (a.pos_available <= 0 && b.pos_available > 0) return 1;
    return 0;
  });
  return list;
}

function firstSelectableSearchIndex(list) {
  const idx = (list ?? []).findIndex((p) => p.pos_available > 0);
  return idx >= 0 ? idx : list?.length ? 0 : -1;
}

async function refreshPosCatalog() {
  if (!supabaseConfigured) return;
  try {
    await refreshProductCatalog();
    cartStore.syncLineStockFromCatalog((id) => productCache.products.find((p) => p.id === id));
    if (lookupTerm.value.length > 0) scheduleLiveLookup();
  } catch {
    /* keep cached data */
  }
}

function onGlobalCatalogUpdated() {
  if (route.name !== "pos") return;
  cartStore.syncLineStockFromCatalog((id) => productCache.products.find((p) => p.id === id));
  refreshSearchAvailability();
}

const itemColumns = computed(() => [
  {
    title: "Product",
    key: "products",
    render: (r) => h("span", { class: "pos-line-name" }, r.products?.name ?? "—"),
    ellipsis: { tooltip: true },
  },
  {
    title: "Avail.",
    key: "avail",
    width: 72,
    align: "center",
    render: (row) => {
      const stock = row.products?.current_stock ?? 0;
      const max = cartStore.maxQtyForLine(row, stock);
      return h("span", { class: max <= 0 ? "pos-avail-warn" : "pos-avail-ok" }, String(max));
    },
  },
  { title: "Price", key: "unit_selling_price", width: 88, render: (r) => formatPkr(r.unit_selling_price) },
  {
    title: "Disc.",
    key: "line_discount",
    width: 110,
    render: (row) => {
      const promo = scheduledPromoOnCart.value;
      if (!promo || !lineMatchesPromo(promo, row)) {
        return h("span", { class: "pos-line-disc-none" }, "—");
      }
      const rule = formatLinePromoRule(promo, row, formatPkr);
      const amt = computeLineScheduledDiscountPkr(promo, row, items.value);
      if (amt <= 0) return h("span", { class: "pos-line-disc-none" }, "—");
      return h("div", { class: "pos-line-disc" }, [
        h("span", { class: "pos-line-disc-rule" }, rule),
        h("span", { class: "pos-line-disc-amt" }, `−${formatPkr(amt)}`),
      ]);
    },
  },
  {
    title: "Qty",
    key: "quantity",
    width: 150,
    render: (row) => {
      const stock = row.products?.current_stock ?? 0;
      const max = cartStore.maxQtyForLine(row, stock);
      return h("div", { class: "pos-line-qty", "data-line-id": row.lineId }, [
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
            max: max > 0 ? max : 1,
            precision: 0,
            style: "width: 72px",
            onUpdateValue: (v) => {
              if (v != null && v !== row.quantity) changeLineQty(row, v);
            },
            onKeydown: (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                returnToScanField();
              }
            },
          }),
          h(
            NButton,
            {
              size: "tiny",
              disabled: row.quantity >= max,
              onClick: () => changeLineQty(row, row.quantity + 1),
            },
            () => "+"
          ),
        ]),
      ]);
    },
  },
  { title: "Line", key: "line_total", width: 100, render: (r) => formatPkr(r.line_total) },
  {
    title: "",
    key: "remove",
    width: 80,
    render: (row) =>
      h(NButton, { size: "tiny", type: "error", secondary: true, onClick: () => removeLine(row) }, () => "Remove"),
  },
]);

function clearLookupUi() {
  scanBuffer.value = "";
  searchResults.value = [];
  selectedSearchIndex.value = -1;
  focusRef(scanRef);
}

function focusLineQty(lineId) {
  if (!lineId) return;
  nextTick(() => {
    requestAnimationFrame(() => {
      const wrap = document.querySelector(`.pos-line-qty[data-line-id="${lineId}"]`);
      const el = wrap?.querySelector("input");
      if (el) {
        el.focus();
        el.select?.();
      }
    });
  });
}

function addProduct(product) {
  if (product?.pos_available != null && product.pos_available <= 0) {
    message.warning("Out of stock for this tab (check other held tabs)");
    return;
  }
  try {
    const line = cartStore.addProduct(product);
    clearLookupUi();
    focusLineQty(line?.lineId);
  } catch (e) {
    message.error(e.message || "Cannot add to cart");
  }
}

watch(focusQtyLineId, (id) => {
  if (!id) return;
  focusLineQty(id);
  cartStore.clearFocusQtyLine();
});

async function addHighlightedSearchResult() {
  if (selectedSearchIndex.value < 0 || !searchResults.value.length) return false;
  const p = searchResults.value[selectedSearchIndex.value];
  if (!p) return false;
  if (p.pos_available <= 0) {
    message.warning("Out of stock for this tab");
    return false;
  }
  addProduct(p);
  return true;
}

function changeLineQty(row, qty) {
  try {
    cartStore.setLineQty(row.lineId, qty);
  } catch (e) {
    message.error(e.message || "Invalid quantity");
  }
}

function removeLine(row) {
  cartStore.removeLine(row.lineId);
}

function holdOrder() {
  if (cartStore.holdActiveCart()) {
    message.success("Tab on hold — its quantities stay reserved until you complete or clear that tab");
  } else message.warning("Cart is empty");
}

function newOrder() {
  cartStore.newSaleTab();
  cartStore.syncScheduledDiscount(activeScheduledPromo.value, items.value);
}

function cancelCart() {
  cartStore.clearActiveCart();
  cartStore.syncScheduledDiscount(activeScheduledPromo.value, items.value);
  cashReceived.value = 0;
  message.info("Cart cleared");
  returnToScanField();
}

function confirmClearCart() {
  if (!items.value.length) {
    cancelCart();
    return;
  }
  dialog.warning({
    title: "Clear cart?",
    content: `Remove all ${items.value.length} line(s) from this tab?`,
    positiveText: "Clear",
    negativeText: "Cancel",
    onPositiveClick: () => cancelCart(),
  });
}

function requestCloseTab(cart) {
  if (!cart.items.length) {
    cartStore.removeCart(cart.id);
    returnToScanField();
    return;
  }
  dialog.warning({
    title: "Close tab?",
    content: `"${cart.label}" has ${cart.items.length} item(s). Close and discard this cart?`,
    positiveText: "Close tab",
    negativeText: "Cancel",
    onPositiveClick: () => {
      cartStore.removeCart(cart.id);
      returnToScanField();
    },
  });
}

async function onScanEnter() {
  if (searchResults.value.length && selectedSearchIndex.value >= 0) {
    const p = searchResults.value[selectedSearchIndex.value];
    if (p?.pos_available > 0) addProduct(p);
    else message.warning("Out of stock for this tab");
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
  if (searchResults.value.length === 1 && searchResults.value[0].pos_available > 0) {
    addProduct(searchResults.value[0]);
    return;
  }
  message.error("Not found — pick from list below or keep typing");
}

async function onLookupEnter(e) {
  e?.preventDefault?.();
  if (await addHighlightedSearchResult()) return;
  await onScanEnter();
}

async function complete() {
  if (!items.value.length) return message.warning("Cart is empty");
  for (const line of items.value) {
    const max = cartStore.maxQtyForLine(line, line.products?.current_stock ?? 0);
    if (line.quantity > max) {
      return message.error(`Insufficient stock: ${line.products?.name} (max ${max} now)`);
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
    await refreshPosCatalog();
  } catch (e) {
    message.error(e.message);
  } finally {
    completing.value = false;
  }
}

function switchSaleTab(delta) {
  cartStore.selectAdjacentCart(delta);
  returnToScanField();
}

/** Sale tabs — Shift+F11/F12 (Windows steals Alt+Shift for keyboard layout). */
function handleSaleTabSwitchKey(e) {
  if (receiptOpen.value) return false;
  const key = e.key;
  const code = e.code;

  if (e.shiftKey && !e.ctrlKey && !e.altKey && key === "F11") {
    e.preventDefault();
    e.stopPropagation();
    switchSaleTab(-1);
    return true;
  }
  if (e.shiftKey && !e.ctrlKey && !e.altKey && key === "F12") {
    e.preventDefault();
    e.stopPropagation();
    switchSaleTab(1);
    return true;
  }

  if (e.ctrlKey && e.shiftKey && !e.altKey) {
    if (code === "BracketRight" || key === "]") {
      e.preventDefault();
      e.stopPropagation();
      switchSaleTab(1);
      return true;
    }
    if (code === "BracketLeft" || key === "[") {
      e.preventDefault();
      e.stopPropagation();
      switchSaleTab(-1);
      return true;
    }
  }
  return false;
}

function onPosKeyDown(e) {
  const key = e.key;

  if (handleSaleTabSwitchKey(e)) return;

  if (key === "Tab" && !e.ctrlKey && !e.altKey && !receiptOpen.value) {
    handlePosTabKey(e);
    return;
  }

  if (key === "Enter") {
    const active = document.activeElement;
    if (active?.closest?.(".pos-line-qty")) {
      e.preventDefault();
      returnToScanField();
      return;
    }
  }

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
    if (receiptDetail.value) printSaleReceipt();
    return;
  }

  if (searchResults.value.length && (key === "ArrowDown" || key === "ArrowUp")) {
    const active = document.activeElement;
    const inLookup = active?.closest?.(".pos-scan-wrap");
    if (!inLookup) return;
    e.preventDefault();
    const n = searchResults.value.length;
    let idx = selectedSearchIndex.value;
    for (let step = 0; step < n; step++) {
      if (key === "ArrowDown") idx = (idx + 1) % n;
      else idx = (idx - 1 + n) % n;
      if (searchResults.value[idx]?.pos_available > 0) {
        selectedSearchIndex.value = idx;
        break;
      }
    }
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
    else if (key === "F10") confirmClearCart();
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

watch(
  () => route.name,
  (name) => {
    if (name === "pos") {
      refreshPosCatalog();
      refreshScheduledPromoForPos();
    }
  }
);

watch(activeCartId, () => {
  cartStore.syncScheduledDiscount(activeScheduledPromo.value, items.value);
});

watch(subtotal, () => {
  applyScheduledPromoToCart();
});

onMounted(() => {
  layoutStore.applyRouteSidebar("pos");
  window.addEventListener("keydown", onPosKeyDown, true);
  window.addEventListener(PRODUCT_CATALOG_UPDATED, onGlobalCatalogUpdated);
  cartStore.init();
  refreshPosCatalog();
  refreshScheduledPromoForPos();
  focusRef(scanRef);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onPosKeyDown, true);
  window.removeEventListener(PRODUCT_CATALOG_UPDATED, onGlobalCatalogUpdated);
  clearTimeout(lookupTimer);
});
</script>

<template>
  <div class="pos-page">
    <h1 style="margin-top: 0">POS / New Sale</h1>
    <p class="pos-hint">
      <kbd>F7</kbd> hold tab (park sale locally; qty stays reserved in other tabs) ·
      <kbd>F9</kbd> checkout · <kbd>F8</kbd> new tab · <kbd>F10</kbd> clear cart ·
      <kbd>Tab</kbd> scan → filter → discount → cash ·
      <kbd>Shift+F12</kbd> / <kbd>Shift+F11</kbd> next / prev sale tab · Enter on qty → scan
    </p>
    <SupabaseRequiredAlert />
    <NCard size="small" class="pos-card">
      <div class="pos-tabs-row">
        <div
          v-for="c in carts"
          :key="c.id"
          class="pos-tab-chip"
          :class="{
            'pos-tab-chip--active': c.id === activeCartId,
            'pos-tab-chip--hold': c.status === 'on_hold',
          }"
        >
          <button type="button" class="pos-tab-label" @click="cartStore.selectCart(c.id)">
            {{ tabShortLabel(c) }}
          </button>
          <button
            type="button"
            class="pos-tab-close"
            title="Close tab"
            aria-label="Close tab"
            @click.stop="requestCloseTab(c)"
          >
            ×
          </button>
        </div>
        <NButton size="small" quaternary class="pos-tab-new" @click="newOrder">+ New (F8)</NButton>
        <span class="pos-tab-shortcut-hint">Shift+F11 / F12 = prev / next tab</span>
      </div>

      <div
        class="pos-scan-wrap"
        :class="{ 'pos-scan-wrap--open': scanDropdownOpen }"
      >
        <NInput
          ref="scanRef"
          v-model:value="scanBuffer"
          placeholder="Scan or type barcode / name (F2) — list updates as you type"
          @focus="scheduleLiveLookup()"
          @keydown.enter="onLookupEnter"
        />
        <div v-if="scanDropdownOpen" class="pos-pick-panel" role="listbox">
          <div v-if="lookupLoading" class="pos-pick-list pos-pick-status">
            <NSpin size="small" />
            <NText depth="3" style="margin-left: 8px">Searching catalog…</NText>
          </div>
          <div v-else-if="showPickEmpty" class="pos-pick-list pos-pick-empty">
            <NText depth="3">No matching products in catalog</NText>
          </div>
          <div v-else-if="showPickList && searchResults.length" class="pos-pick-list">
            <button
              v-for="(p, idx) in searchResults"
              :key="p.id"
              type="button"
              class="pos-pick-item"
              :class="{
                'pos-pick-item--active': idx === selectedSearchIndex,
                'pos-pick-item--disabled': p.pos_available <= 0,
              }"
              :disabled="p.pos_available <= 0"
              @click.stop="addProduct(p)"
            >
              <span class="pick-line">
                <span>{{ p.name }}</span>
                <span class="pick-meta">
                  {{ formatPkr(p.selling_price) }} ·
                  <template v-if="p.pos_available > 0">{{ p.pos_available }} left for this tab</template>
                  <template v-else>Out of stock for tabs ({{ p.current_stock }} in store)</template>
                  <template v-if="p.barcode"> · {{ p.barcode }}</template>
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <div class="pos-cart-filter pos-search-wrap">
        <NSpace align="center" :size="8" style="width: 100%">
          <NInput
            ref="searchRef"
            v-model:value="cartFilter"
            clearable
            placeholder="Filter cart lines — name, SKU, barcode (F3)"
            style="flex: 1"
          />
          <ClearFiltersButton :disabled="!hasCartLineFilter" @clear="clearCartLineFilter" />
        </NSpace>
      </div>

      <NDataTable
        class="pos-table"
        :row-key="(row) => row.lineId"
        :columns="itemColumns"
        :data="displayItems"
        :row-class-name="(row) => {
          const promo = scheduledPromoOnCart;
          const on = promo && lineMatchesPromo(promo, row);
          return on ? 'pos-cart-row pos-cart-row--disc' : 'pos-cart-row';
        }"
        size="medium"
        striped
        :scroll-x="720"
      />

      <div class="pos-checkout">
        <div v-if="scheduledPromoOnCart" class="pos-scheduled-promo">
          <span>
            Auto discount:
            <strong>{{ scheduledPromoOnCart.name || "Scheduled sale" }}</strong>
            {{ scheduledPromoBannerText }}
          </span>
          <NButton
            size="tiny"
            quaternary
            class="pos-scheduled-promo-remove"
            @click="removeScheduledPromoFromSale"
          >
            Remove from this sale
          </NButton>
        </div>
        <div class="pos-totals">
          <div class="pos-totals-row">
            <span>Subtotal</span>
            <strong>{{ formatPkr(subtotal) }}</strong>
          </div>
          <div class="pos-totals-row">
            <span>Discount <span class="pos-kbd-hint">(F4)</span></span>
            <NInputNumber ref="discountRef" v-model:value="discount" :min="0" class="pos-num-input" />
          </div>
          <div class="pos-totals-row pos-totals-row--emph">
            <span>Total</span>
            <strong>{{ formatPkr(total) }}</strong>
          </div>
          <div class="pos-totals-row">
            <span>Cash <span class="pos-kbd-hint">(F5 · F6=total)</span></span>
            <NInputNumber ref="cashRef" v-model:value="cashReceived" :min="0" class="pos-num-input" />
          </div>
          <div class="pos-totals-row">
            <span>Change</span>
            <strong>{{ formatPkr(changeDue) }}</strong>
          </div>
        </div>
        <NSpace class="pos-actions" justify="end">
          <NButton @click="holdOrder">Hold tab (F7)</NButton>
          <NButton type="warning" @click="confirmClearCart">Clear cart (F10)</NButton>
          <NButton type="primary" :loading="completing" @click="complete">Complete sale (F9)</NButton>
        </NSpace>
      </div>
    </NCard>

    <NModal v-model:show="receiptOpen" preset="card" title="Receipt" style="width: min(480px, 96vw)">
      <ReceiptPreview
        v-if="receiptDetail"
        :sale="receiptDetail.sale"
        :items="receiptDetail.items"
        :settings="receiptSettings"
      />
      <NSpace v-if="receiptDetail" style="margin-top: 12px" justify="end">
        <NButton @click="receiptOpen = false">Close</NButton>
        <NButton type="primary" :loading="receiptPrinting" @click="printSaleReceipt">Print</NButton>
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
.pos-card {
  max-width: 100%;
}
.pos-tabs-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
  margin-bottom: 12px;
  scrollbar-width: thin;
}
.pos-tab-chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 999px;
  overflow: hidden;
}
.pos-tab-label {
  border: none;
  background: transparent;
  color: #374151;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 10px 6px 12px;
  cursor: pointer;
  white-space: nowrap;
}
.pos-tab-close {
  border: none;
  background: transparent;
  color: #9ca3af;
  font-size: 16px;
  line-height: 1;
  padding: 4px 10px 6px 6px;
  cursor: pointer;
}
.pos-tab-close:hover {
  color: #dc2626;
  background: #fef2f2;
}
.pos-tab-chip:hover {
  border-color: #0f766e;
}
.pos-tab-chip--active {
  background: #0f766e;
  border-color: #0f766e;
}
.pos-tab-chip--active .pos-tab-label {
  color: #fff;
}
.pos-tab-chip--active .pos-tab-close {
  color: rgba(255, 255, 255, 0.85);
}
.pos-tab-chip--active .pos-tab-close:hover {
  color: #fff;
  background: rgba(0, 0, 0, 0.15);
}
.pos-tab-chip--hold:not(.pos-tab-chip--active) {
  border-style: dashed;
}
.pos-tab-chip--hold:not(.pos-tab-chip--active) .pos-tab-label {
  color: var(--app-warning-accent);
}
.pos-tab-new {
  flex-shrink: 0;
}
.pos-tab-shortcut-hint {
  flex-shrink: 0;
  align-self: center;
  font-size: 11px;
  color: #9ca3af;
  white-space: nowrap;
  margin-left: 4px;
}
.pos-scan-wrap {
  position: relative;
  margin-bottom: 10px;
  z-index: 20;
}
.pos-scan-wrap--open :deep(.n-input .n-input-wrapper) {
  border-color: #0f766e !important;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.22);
}
.pos-pick-panel {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 2px);
  z-index: 30;
  border: 2px solid #0f766e;
  border-radius: 0 0 10px 10px;
  background: #fff;
  box-shadow: 0 12px 28px rgba(15, 118, 110, 0.22);
}
.pos-pick-list {
  max-height: 280px;
  overflow-y: auto;
}
.pos-pick-status,
.pos-pick-empty {
  padding: 14px 16px;
  text-align: center;
}
.pos-pick-item {
  display: block;
  width: 100%;
  border: none;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
  padding: 10px 14px;
  cursor: pointer;
  text-align: left;
}
.pos-pick-item:last-child {
  border-bottom: none;
}
.pos-pick-item:hover,
.pos-pick-item--active {
  background: #ecfdf5;
}
.pos-pick-item--active {
  box-shadow: inset 3px 0 0 #0f766e;
}
.pos-pick-item--disabled {
  opacity: 0.65;
  cursor: not-allowed;
  background: #f9fafb;
}
.pos-pick-item--disabled .pick-meta {
  color: var(--app-warning-accent);
}
.pos-avail-ok {
  font-weight: 700;
  color: #0f766e;
}
.pos-avail-warn {
  font-weight: 700;
  color: #dc2626;
}
.pos-cart-filter {
  margin-bottom: 12px;
  max-width: 420px;
}
.pos-table {
  margin-bottom: 8px;
}
.pos-table :deep(.pos-cart-row td) {
  padding-top: 14px !important;
  padding-bottom: 14px !important;
  font-size: 15px;
  border-bottom: 1px solid #e5e7eb;
}
.pos-table :deep(.pos-cart-row:hover td) {
  background: #f0fdfa !important;
}
.pos-table :deep(.pos-line-name) {
  font-weight: 700;
  color: #111827;
  font-size: 15px;
}
.pos-line-disc {
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1.2;
}
.pos-line-disc-rule {
  font-size: 12px;
  font-weight: 700;
  color: #92400e;
}
.pos-line-disc-amt {
  font-size: 13px;
  font-weight: 700;
  color: #b45309;
}
.pos-line-disc-none {
  color: #9ca3af;
}
.pos-table :deep(.pos-cart-row--disc td) {
  background: #fffbeb !important;
}
.pos-table :deep(.n-data-table-th) {
  font-weight: 700;
  background: #f3f4f6;
}
.pos-scheduled-promo {
  width: min(480px, 100%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--app-warning-bg);
  border: 1px solid var(--app-warning-border);
  font-size: 13px;
  color: var(--app-warning-text);
}
.pos-scheduled-promo strong {
  color: var(--app-warning-text-strong);
}
.pos-scheduled-promo-remove {
  font-weight: 700 !important;
  --n-text-color: #111827 !important;
  --n-text-color-hover: #000000 !important;
  --n-text-color-pressed: #000000 !important;
  --n-text-color-focus: #111827 !important;
}
.pos-scheduled-promo-remove :deep(.n-button__content) {
  font-weight: 700;
  color: #111827;
}
.pos-checkout {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
}
.pos-totals {
  width: min(340px, 100%);
}
.pos-totals-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
  font-size: 14px;
  color: #4b5563;
}
.pos-totals-row--emph {
  font-size: 1.05rem;
  color: #111827;
  border-top: 1px dashed #e5e7eb;
  border-bottom: 1px dashed #e5e7eb;
  margin: 4px 0;
  padding: 10px 0;
}
.pos-totals-row strong {
  color: #111827;
  font-variant-numeric: tabular-nums;
}
.pos-num-input {
  width: 140px;
}
.pos-kbd-hint {
  font-size: 11px;
  color: #9ca3af;
}
.pos-actions {
  width: 100%;
  flex-wrap: wrap;
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
@media (max-width: 768px) {
  .pos-hint,
  .pos-tab-shortcut-hint {
    display: none;
  }
  .pos-cart-filter {
    max-width: none;
  }
  .pos-scheduled-promo {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .pos-checkout {
    align-items: stretch;
  }
  .pos-totals {
    width: 100%;
  }
  .pos-num-input {
    width: min(160px, 42vw);
  }
  .pos-actions {
    justify-content: stretch !important;
  }
  .pos-actions :deep(.n-space) {
    display: flex;
    flex-wrap: wrap;
    width: 100%;
    gap: 8px;
  }
  .pos-actions :deep(.n-button) {
    flex: 1 1 calc(50% - 4px);
    min-width: 0;
  }
  .pos-table :deep(.n-data-table-table) {
    min-width: 480px;
  }
}
</style>
