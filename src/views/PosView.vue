<script setup>
import { ref, onMounted, onUnmounted, computed, watch, nextTick, h } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import {
  NButton,
  NSpace,
  NInput,
  NInputNumber,
  NAutoComplete,
  NSelect,
  NDataTable,
  NModal,
  NSpin,
  NText,
  NAlert,
  NForm,
  NFormItem,
  useMessage,
  useDialog,
} from "naive-ui";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import ReceiptPreview from "../components/ReceiptPreview.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { formatPkr } from "../utils/format.js";
import { matchesSearchFields } from "../utils/textSearch.js";
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
import { getSettings, getCachedSettings } from "../services/settings.js";
import { printReceipt } from "../utils/receiptPrint.js";
import { shouldBlockShortcut } from "../utils/hotkeys.js";
import { usePosCartStore } from "../stores/posCart.js";
import { useLayoutStore } from "../stores/layout.js";
import { useOfflineSalesStore } from "../stores/offlineSales.js";
import { PRODUCT_CATALOG_UPDATED } from "../utils/catalogSync.js";
import { BARCODE_WEDGE_SCAN_EVENT } from "../utils/barcodeWedge.js";
import { useRouteQuerySync, routeQuery } from "../composables/useRouteQuerySync.js";
import { useOnlineStatus } from "../composables/useOnlineStatus.js";
import { isLikelyNetworkError } from "../services/offlineSaleOutbox.js";
import { drainAllOfflineQueues } from "../services/adminOutboxSync.js";
import {
  buildOfflineReceiptDetail,
  stockDeltasFromCartLines,
} from "../utils/offlineSaleReceipt.js";
import { applyOverriddenPricesToLocalCatalog } from "../utils/posCatalogPriceSync.js";
import { getActiveScheduledSaleDiscount } from "../services/scheduledDiscounts.js";
import {
  formatScheduledPromoRule,
  formatLinePromoRule,
  computeLineScheduledDiscountPkr,
  lineMatchesPromo,
} from "../utils/scheduledDiscount.js";
import {
  availableUnitsOf,
  defaultPosSaleUnit,
  formatProductUnitPrices,
  piecesPerPackOf,
  resolveSaleUnit,
} from "../utils/saleUnits.js";
import {
  listCustomItemHistory,
  rememberCustomItem,
  replaceCustomItemHistoryCache,
  findCustomItemHistory,
  sanitizeCustomItemName,
  formatCustomItemName,
  parseCustomItemName,
} from "../utils/posCustomItemHistory.js";
import { listActiveCustomItemsForPos } from "../services/posCustomItems.js";

const message = useMessage();
const dialog = useDialog();
const route = useRoute();
const cartStore = usePosCartStore();
const layoutStore = useLayoutStore();
const productCache = useProductCacheStore();
const offlineSales = useOfflineSalesStore();
const { online } = useOnlineStatus();
const { items, subtotal, carts, activeCartId, focusQtyLineId } = storeToRefs(cartStore);
const { pendingCount, failedCount, pendingEntries, syncing: offlineSyncing } = storeToRefs(offlineSales);

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
const customItemOpen = ref(false);
const customItemSaving = ref(false);
const customItemForm = ref({ name: "", unit_selling_price: null, quantity: 1 });
const customItemHistory = ref(listCustomItemHistory());
const customNameRef = ref(null);
const customPriceRef = ref(null);
const customQtyRef = ref(null);

const customItemNameOptions = computed(() => {
  const q = sanitizeCustomItemName(customItemForm.value.name).toLowerCase();
  return customItemHistory.value
    .filter((h) => !q || h.name.toLowerCase().includes(q))
    .slice(0, 15)
    .map((h) => {
      const label = formatCustomItemName(h.name, h.unit_selling_price);
      return { label, value: label };
    });
});
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
    receiptOpen.value = false;
  } catch (e) {
    message.error(e.message || "Receipt print failed");
  } finally {
    receiptPrinting.value = false;
  }
}

function receiptConfirmOpen() {
  return Boolean(document.querySelector(".n-dialog"));
}

function requestCloseReceipt() {
  if (!receiptOpen.value || receiptConfirmOpen()) return;
  // Defer past the current Escape keyup/keydown so the confirm is not auto-dismissed.
  window.setTimeout(() => {
    if (!receiptOpen.value || receiptConfirmOpen()) return;
    dialog.warning({
      title: "Close receipt?",
      content: "Close without printing? You can still open this sale from Sales history.",
      positiveText: "Close",
      negativeText: "Stay",
      closeOnEsc: false,
      maskClosable: false,
      onPositiveClick: () => {
        receiptOpen.value = false;
      },
    });
  }, 0);
}

function onReceiptModalUpdate(show) {
  if (show) {
    receiptOpen.value = true;
    return;
  }
  requestCloseReceipt();
}
const scanRef = ref(null);
const searchRef = ref(null);
const discountRef = ref(null);
const cashRef = ref(null);
const selectedSearchIndex = ref(-1);
/** True only after user moves highlight with ↑/↓ (Enter won't grab first row by default). */
const searchHighlightByUser = ref(false);
/** Cart line keyboard selection (↑/↓ then R). */
const selectedCartLineId = ref(null);
const pickListRef = ref(null);
const lookupLoading = ref(false);
let lookupTimer;
let scanBurstEndTimer;
let lastScanKeyAt = 0;
/** True while keystrokes arrive scanner-fast — defers name search dropdown. */
const scanInputBurst = ref(false);

function lineMatchesFilter(line, q) {
  const p = line.products;
  return matchesSearchFields([p?.name, p?.sku, p?.barcode, line.product_id], q);
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
    searchHighlightByUser.value = false;
    lookupLoading.value = false;
    return;
  }

  const local = searchProductsForPosLocal(q);
  if (local) {
    searchResults.value = enrichSearchResults(local);
    selectedSearchIndex.value = firstSelectableSearchIndex(searchResults.value);
    searchHighlightByUser.value = selectedSearchIndex.value >= 0;
    lookupLoading.value = false;
    return;
  }

  lookupLoading.value = true;
  searchProductsForPos(q)
    .then((rows) => {
      searchResults.value = enrichSearchResults(rows);
      selectedSearchIndex.value = firstSelectableSearchIndex(searchResults.value);
      searchHighlightByUser.value = selectedSearchIndex.value >= 0;
    })
    .catch((e) => {
      message.error(e.message || "Search failed");
      searchResults.value = [];
      selectedSearchIndex.value = -1;
      searchHighlightByUser.value = false;
    })
    .finally(() => {
      lookupLoading.value = false;
    });
}

function scheduleLiveLookup() {
  if (scanInputBurst.value) return;
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(() => runLiveLookup(currentLookupTerm()), 280);
}

function onScanFieldKeydown(e) {
  if (e.key === "Enter") {
    scanInputBurst.value = false;
    clearTimeout(scanBurstEndTimer);
    lastScanKeyAt = 0;
    return;
  }
  if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
  const now = Date.now();
  // Scanner-fast only — do not wipe the field/list for normal typing
  if (lastScanKeyAt > 0 && now - lastScanKeyAt < 45) {
    scanInputBurst.value = true;
    clearTimeout(lookupTimer);
  }
  lastScanKeyAt = now;
  clearTimeout(scanBurstEndTimer);
  scanBurstEndTimer = setTimeout(() => {
    scanInputBurst.value = false;
    lastScanKeyAt = 0;
    scheduleLiveLookup();
  }, 180);
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
    searchHighlightByUser.value = selectedSearchIndex.value >= 0;
  }
}

watch(searchResults, (list) => {
  if (selectedSearchIndex.value >= list.length) {
    selectedSearchIndex.value = firstSelectableSearchIndex(list);
  } else if (list.length && selectedSearchIndex.value < 0) {
    selectedSearchIndex.value = firstSelectableSearchIndex(list);
  }
  searchHighlightByUser.value = selectedSearchIndex.value >= 0;
});

watch(
  () =>
    carts.value
      .map((c) =>
        c.items.map((l) => `${l.product_id}:${l.sale_unit}:${l.quantity}:${l.pieces_per_unit}`).join(",")
      )
      .join("|"),
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
const scanDropdownOpen = computed(() => {
  if (lookupLoading.value) return true;
  const term = lookupTerm.value;
  if (!term.length) return false;
  if (scanInputBurst.value) return false;
  if (searchResults.value.length > 0) return true;
  return term.length >= 3;
});
const showPickList = computed(
  () => lookupLoading.value || (lookupTerm.value.length > 0 && searchResults.value.length > 0)
);
const showPickEmpty = computed(
  () => !lookupLoading.value && lookupTerm.value.length > 0 && searchResults.value.length === 0
);

function scrollActivePickIntoView() {
  nextTick(() => {
    const root = pickListRef.value;
    if (!root) return;
    const active = root.querySelector(".pos-pick-item--active");
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

watch(selectedSearchIndex, (idx) => {
  if (idx >= 0 && showPickList.value) scrollActivePickIntoView();
});

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
  searchHighlightByUser.value = false;
  scanBuffer.value = "";
  focusRef(scanRef);
}

function productPriceHint(p) {
  return formatProductUnitPrices(p);
}

function enrichSearchResults(rows) {
  const list = (rows ?? []).map((p) => {
    const stock = Math.floor(Number(p.current_stock) || 0);
    const resolved = resolveSaleUnit(p, defaultPosSaleUnit(p));
    const available = cartStore.availableToAdd(p.id, stock, resolved.pieces_per_unit);
    return {
      ...p,
      pos_available: available,
      pos_in_stock: stock > 0,
      pos_unit: resolved.sale_unit,
      pos_price_hint: productPriceHint(p),
    };
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
    const { clearForcedOffline } = await import("../services/offlineGuard.js");
    clearForcedOffline();
    await refreshProductCatalog({ force: true });
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

const itemColumns = computed(() => {
  const rows = items.value;
  const promo = scheduledPromoOnCart.value;

  const showUnitCol = rows.some((row) => {
    if (row.is_custom || !row.product_id) return false;
    return availableUnitsOf(row.products || row).length > 1;
  });

  const showDiscCol =
    Boolean(promo) &&
    rows.some((row) => {
      if (row.is_custom) return false;
      if (!lineMatchesPromo(promo, row)) return false;
      return computeLineScheduledDiscountPkr(promo, row, rows) > 0;
    });

  const cols = [
    {
      title: "Product",
      key: "products",
      width: 220,
      render: (r) =>
        h("span", { class: "pos-line-name" }, [
          h("span", { class: "pos-line-name-text" }, r.products?.name ?? "—"),
          r.is_custom ? h("span", { class: "pos-line-custom-badge" }, "Custom") : null,
        ]),
    },
    {
      title: "Avail.",
      key: "avail",
      width: 72,
      align: "center",
      render: (row) => {
        if (row.is_custom || !row.product_id) {
          return h("span", { class: "pos-line-disc-none" }, "—");
        }
        const stock = row.products?.current_stock ?? 0;
        const max = cartStore.maxQtyForLine(row, stock);
        return h("span", { class: max <= 0 ? "pos-avail-warn" : "pos-avail-ok" }, String(max));
      },
    },
  ];

  if (showUnitCol) {
    cols.push({
      title: "Unit",
      key: "sale_unit",
      width: 118,
      render: (row) => {
        if (row.is_custom || !row.product_id) {
          return h("span", { class: "pos-line-disc-none" }, "Piece");
        }
        const opts = availableUnitsOf(row.products || row);
        if (opts.length <= 1) {
          return h("span", { class: "pos-line-disc-none" }, opts[0]?.label || "Piece");
        }
        return h(NSelect, {
          size: "tiny",
          value: row.sale_unit || "piece",
          options: opts,
          consistentMenuWidth: false,
          style: "width: 108px",
          onUpdateValue: (v) => {
            try {
              cartStore.setLineSaleUnit(row.lineId, v);
            } catch (e) {
              message.error(e.message || "Cannot change unit");
            }
          },
        });
      },
    });
  }

  cols.push({
    title: "Price",
    key: "unit_selling_price",
    width: 90,
    render: (row) =>
      h(
        "div",
        { class: row.price_overridden ? "pos-line-price pos-line-price--edited" : "pos-line-price" },
        [
          h(NInputNumber, {
            size: "small",
            value: Math.round(Number(row.unit_selling_price) || 0),
            min: 0,
            precision: 0,
            showButton: false,
            style: "width: 64px",
            onUpdateValue: (v) => {
              if (v == null) return;
              cartStore.setLineUnitPrice(row.lineId, Math.round(Number(v) || 0));
            },
            onKeydown: (e) => {
              const cur = Math.round(Number(row.unit_selling_price) || 0);
              if (e.key === "+" || e.key === "=") {
                e.preventDefault();
                cartStore.setLineUnitPrice(row.lineId, cur + 1);
                return;
              }
              if (e.key === "-" || e.key === "_") {
                e.preventDefault();
                if (cur > 0) cartStore.setLineUnitPrice(row.lineId, cur - 1);
              }
            },
          }),
        ]
      ),
  });

  if (showDiscCol) {
    cols.push({
      title: "Disc.",
      key: "line_discount",
      width: 110,
      render: (row) => {
        if (row.is_custom) return h("span", { class: "pos-line-disc-none" }, "—");
        if (!promo || !lineMatchesPromo(promo, row)) {
          return h("span", { class: "pos-line-disc-none" }, "—");
        }
        const rule = formatLinePromoRule(promo, row, formatPkr);
        const amt = computeLineScheduledDiscountPkr(promo, row, rows);
        if (amt <= 0) return h("span", { class: "pos-line-disc-none" }, "—");
        return h("div", { class: "pos-line-disc" }, [
          h("span", { class: "pos-line-disc-rule" }, rule),
          h("span", { class: "pos-line-disc-amt" }, `−${formatPkr(amt)}`),
        ]);
      },
    });
  }

  cols.push(
    {
      title: "Qty",
      key: "quantity",
      width: 130,
      render: (row) => {
        const stock = row.products?.current_stock ?? 0;
        const max = cartStore.maxQtyForLine(row, stock);
        const atMax = !row.is_custom && row.product_id && row.quantity >= max;
        return h("div", { class: "pos-line-qty", "data-line-id": row.lineId }, [
          h(NInputNumber, {
            size: "small",
            value: row.quantity,
            min: 1,
            max: row.is_custom || !row.product_id ? undefined : max > 0 ? max : 1,
            precision: 0,
            showButton: true,
            style: "width: 110px",
            onUpdateValue: (v) => {
              if (v != null && v !== row.quantity) changeLineQty(row, v);
            },
            onKeydown: (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                returnToScanField();
                return;
              }
              if (e.key === "+" || e.key === "=") {
                e.preventDefault();
                if (!atMax) changeLineQty(row, row.quantity + 1);
                return;
              }
              if (e.key === "-" || e.key === "_") {
                e.preventDefault();
                if (row.quantity > 1) changeLineQty(row, row.quantity - 1);
              }
            },
          }),
        ]);
      },
    },
    {
      title: "Item total",
      key: "line_total",
      width: 100,
      align: "right",
      render: (r) => formatPkr(Math.round(Number(r.line_total) || 0)),
    },
    {
      title: "",
      key: "remove",
      width: 90,
      render: (row) =>
        h(
          NButton,
          { size: "tiny", type: "error", secondary: true, onClick: () => removeLine(row) },
          () => "Remove"
        ),
    }
  );

  return cols;
});

const cartTableScrollX = computed(() =>
  itemColumns.value.reduce((sum, col) => sum + (Number(col.width) || 160), 0)
);

async function refreshCustomItemHistory() {
  if (!supabaseConfigured || !online.value) {
    customItemHistory.value = listCustomItemHistory();
    return;
  }
  try {
    const rows = await listActiveCustomItemsForPos({ limit: 80 });
    customItemHistory.value = replaceCustomItemHistoryCache(rows);
  } catch {
    customItemHistory.value = listCustomItemHistory();
  }
}

function openCustomItem() {
  customItemHistory.value = listCustomItemHistory();
  customItemForm.value = { name: "", unit_selling_price: null, quantity: 1 };
  customItemOpen.value = true;
  refreshCustomItemHistory();
  nextTick(() => {
    // Modal mounts asynchronously; slight delay so name field can take focus.
    window.setTimeout(() => focusRef(customNameRef), 40);
  });
}

function onCustomItemNameSelect(value) {
  const parsed = parseCustomItemName(value);
  const hit = findCustomItemHistory(parsed.base);
  customItemForm.value.name = hit?.name ?? parsed.base;
  const price = hit?.unit_selling_price ?? parsed.price;
  if (price != null) customItemForm.value.unit_selling_price = price;
}

function onCustomNameKeydown(e) {
  if (e.key !== "Enter" || e.isComposing) return;
  // Let autocomplete handle selection when menu is open; otherwise move to price.
  const menuOpen = document.querySelector(".n-auto-complete-menu");
  if (menuOpen) return;
  e.preventDefault();
  focusRef(customPriceRef);
}

function onCustomPriceKeydown(e) {
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  focusRef(customQtyRef);
}

function onCustomQtyKeydown(e) {
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  submitCustomItem();
}

function submitCustomItem() {
  customItemSaving.value = true;
  try {
    const price = customItemForm.value.unit_selling_price;
    const displayName = formatCustomItemName(customItemForm.value.name, price);
    const line = cartStore.addCustomItem({
      name: displayName,
      unit_selling_price: price,
      quantity: customItemForm.value.quantity,
    });
    rememberCustomItem({
      name: sanitizeCustomItemName(displayName),
      unit_selling_price: line?.unit_selling_price ?? price,
    });
    customItemHistory.value = listCustomItemHistory();
    customItemOpen.value = false;
    focusLineQty(line?.lineId);
  } catch (e) {
    message.error(e.message || "Could not add item");
  } finally {
    customItemSaving.value = false;
  }
}

const SCAN_AT_MAX_MESSAGE = "Full quantity in cart — no more stock available for this item.";

function clearLookupUi() {
  clearTimeout(lookupTimer);
  clearTimeout(scanBurstEndTimer);
  scanInputBurst.value = false;
  lastScanKeyAt = 0;
  lookupLoading.value = false;
  scanBuffer.value = "";
  searchResults.value = [];
  selectedSearchIndex.value = -1;
  searchHighlightByUser.value = false;
  focusRef(scanRef);
}

/** After any barcode Enter (added, max stock, or not found) — ready for next scan. */
function resetScanFieldAfterBarcodeAttempt() {
  cartStore.clearFocusQtyLine();
  clearLookupUi();
}

function focusLineQty(lineId) {
  if (!lineId) return;
  const tryFocus = (attempt = 0) => {
    const wrap = document.querySelector(`.pos-line-qty[data-line-id="${CSS.escape(String(lineId))}"]`);
    const el = wrap?.querySelector("input");
    if (el) {
      wrap.closest("tr")?.scrollIntoView({ block: "nearest" });
      el.focus();
      el.select?.();
      return;
    }
    if (attempt < 8) requestAnimationFrame(() => tryFocus(attempt + 1));
  };
  nextTick(() => tryFocus());
}

function addProduct(product, { fromScan = false } = {}) {
  if (product?.pos_available != null && product.pos_available <= 0) {
    message.error(SCAN_AT_MAX_MESSAGE);
    if (fromScan) resetScanFieldAfterBarcodeAttempt();
    return;
  }
  try {
    const line = cartStore.addProduct(product, 1, null, { focusQty: !fromScan });
    clearLookupUi();
    if (fromScan) {
      focusRef(scanRef);
    } else {
      focusLineQty(line?.lineId);
    }
  } catch (e) {
    const msg = e.message || "Cannot add to cart";
    message.error(msg);
    if (fromScan) resetScanFieldAfterBarcodeAttempt();
  }
}

/** Global HID wedge owns Enter — clear leaked scan-field prefix (e.g. "DW"). */
function onBarcodeWedgeScan() {
  clearTimeout(lookupTimer);
  clearTimeout(scanBurstEndTimer);
  scanInputBurst.value = false;
  lastScanKeyAt = 0;
  lookupLoading.value = false;
  scanBuffer.value = "";
  searchResults.value = [];
  selectedSearchIndex.value = -1;
  searchHighlightByUser.value = false;
  nextTick(() => focusRef(scanRef));
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
  if (selectedCartLineId.value === row.lineId) selectedCartLineId.value = null;
  cartStore.removeLine(row.lineId);
}

function undoLastCartItem() {
  const list = items.value;
  if (!list.length) {
    message.info("Cart is empty");
    return;
  }
  const last = list[list.length - 1];
  const name = last.products?.name || "item";
  cartStore.removeLine(last.lineId);
  if (selectedCartLineId.value === last.lineId) selectedCartLineId.value = null;
  message.success(`Removed: ${name}`);
  focusRef(scanRef);
}

function focusLastLineQty() {
  const list = items.value;
  if (!list.length) {
    message.info("Cart is empty");
    return;
  }
  const last = list[list.length - 1];
  selectedCartLineId.value = last.lineId;
  // Blur scan field so qty input can take focus reliably
  document.activeElement?.blur?.();
  focusLineQty(last.lineId);
}

function closeActiveSaleTab() {
  const cart = cartStore.activeCart;
  if (!cart) return;
  requestCloseTab(cart);
}

function moveCartLineSelection(delta) {
  const list = displayItems.value;
  if (!list.length) return;
  let idx = list.findIndex((l) => l.lineId === selectedCartLineId.value);
  if (idx < 0) idx = delta > 0 ? 0 : list.length - 1;
  else idx = (idx + delta + list.length) % list.length;
  const line = list[idx];
  selectedCartLineId.value = line.lineId;
  nextTick(() => {
    document
      .querySelector(`.pos-line-qty[data-line-id="${line.lineId}"]`)
      ?.closest("tr")
      ?.scrollIntoView({ block: "nearest" });
  });
}

function removeSelectedCartLine() {
  const list = displayItems.value;
  if (!list.length) return;
  let idx = list.findIndex((l) => l.lineId === selectedCartLineId.value);
  if (idx < 0) idx = list.length - 1;
  const line = list[idx];
  if (!line) return;
  removeLine(line);
  message.success(`Removed: ${line.products?.name || "item"}`);
  const next = displayItems.value;
  if (!next.length) {
    selectedCartLineId.value = null;
  } else {
    // Prefer the row that was below the removed one (same index); else the new last
    selectedCartLineId.value = next[Math.min(idx, next.length - 1)].lineId;
  }
  focusRef(scanRef);
}

function cartRowClassName(row) {
  const promo = scheduledPromoOnCart.value;
  const disc = promo && lineMatchesPromo(promo, row);
  const selected = row.lineId === selectedCartLineId.value;
  return [
    "pos-cart-row",
    disc ? "pos-cart-row--disc" : "",
    selected ? "pos-cart-row--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
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
    content: `Remove all ${items.value.length} item(s) from this tab?`,
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

async function resolveProductByScanCode(code) {
  const term = String(code ?? "").trim();
  if (!term) return null;
  return isProductCatalogReady() ? findProductByCodeCached(term) : findProductByBarcode(term);
}

async function onLookupEnter(e) {
  e?.preventDefault?.();
  clearTimeout(lookupTimer);
  scanInputBurst.value = false;
  clearTimeout(scanBurstEndTimer);
  lastScanKeyAt = 0;

  const code = scanBuffer.value.trim();

  if (code) {
    const product = await resolveProductByScanCode(code);
    if (product) {
      addProduct(product, { fromScan: true });
      return;
    }
  }

  // Prefer highlighted row (auto = first match; ↑/↓ can change it)
  if (await addHighlightedSearchResult()) return;

  if (searchResults.value.length === 1 && searchResults.value[0].pos_available > 0) {
    addProduct(searchResults.value[0], { fromScan: false });
    return;
  }

  if (code) {
    message.error("Not found — pick from list below or keep typing");
  }
}

function finishWithLocalReceipt(detail, settings) {
  receiptDetail.value = detail;
  if (settings) receiptSettings.value = settings;
  receiptOpen.value = true;
  cashReceived.value = 0;
  cartStore.afterCompletedSale();
}

function enqueueOfflineSaleFromCart() {
  const clientSaleId = crypto.randomUUID();
  const cartSnapshot = items.value.map((l) => ({ ...l, products: { ...l.products } }));
  const lines = cartStore.linesForCheckout();
  const detail = buildOfflineReceiptDetail(cartSnapshot, {
    discount: discount.value,
    amountReceived: cashReceived.value,
    clientSaleId,
  });
  offlineSales.enqueue({
    clientSaleId,
    createdAt: new Date().toISOString(),
    lines,
    discount: Number(discount.value) || 0,
    amountReceived: Number(cashReceived.value) || 0,
    totals: {
      subtotal: detail.sale.subtotal,
      total: detail.sale.total_amount,
    },
    receiptItems: detail.items,
    receiptSale: detail.sale,
    status: "pending",
    lastError: null,
  });
  for (const { productId, deltaQty } of stockDeltasFromCartLines(cartSnapshot)) {
    productCache.applyStockDelta(productId, deltaQty);
  }
  applyOverriddenPricesToLocalCatalog(cartSnapshot, productCache);
  const settings = getCachedSettings() || receiptSettings.value || {};
  finishWithLocalReceipt(detail, settings);
  message.success("Sale saved offline — will sync when online");
}

async function complete() {
  if (!items.value.length) return message.warning("Cart is empty");
  for (const line of items.value) {
    if (line.is_custom || !line.product_id) continue;
    const max = cartStore.maxQtyForLine(line, line.products?.current_stock ?? 0);
    if (line.quantity > max) {
      return message.error(`Insufficient stock: ${line.products?.name} (max ${max} now)`);
    }
  }
  const received = Number(cashReceived.value);
  if (!Number.isFinite(received) || received <= 0) {
    message.warning("Enter cash received before completing the sale");
    focusRef(cashRef);
    return;
  }
  if (received + 1e-9 < total.value) {
    message.warning(
      `Cash received (${formatPkr(received)}) is less than total (${formatPkr(total.value)})`
    );
    focusRef(cashRef);
    return;
  }
  completing.value = true;
  try {
    if (!online.value) {
      enqueueOfflineSaleFromCart();
      return;
    }
    const lines = cartStore.linesForCheckout();
    const cartSnapshot = items.value.map((l) => ({ ...l, products: { ...l.products } }));
    const disc = discount.value;
    const receivedAmt = cashReceived.value;
    const saleId = await completeSaleFromCart(lines, {
      discount: disc,
      amountReceived: receivedAmt,
    });
    // Server already wrote catalog prices; keep local cache in sync for next scan
    applyOverriddenPricesToLocalCatalog(cartSnapshot, productCache);
    message.success("Sale completed");
    let detail = null;
    try {
      detail = await getSale(saleId);
    } catch {
      /* sale already committed — fall back to local receipt shape */
      detail = buildOfflineReceiptDetail(cartSnapshot, {
        discount: disc,
        amountReceived: receivedAmt,
        clientSaleId: typeof saleId === "string" ? saleId : crypto.randomUUID(),
      });
      if (detail.sale) detail.sale.offline_pending = false;
    }
    const s = await getSettings().catch(() => getCachedSettings());
    finishWithLocalReceipt(detail, s || receiptSettings.value);
    await refreshPosCatalog();
    await refreshCustomItemHistory();
  } catch (e) {
    if (isLikelyNetworkError(e)) {
      enqueueOfflineSaleFromCart();
      return;
    }
    message.error(e.message);
  } finally {
    completing.value = false;
  }
}

async function retryOfflineSync() {
  const result = await drainAllOfflineQueues();
  if (result?.synced) {
    message.success(`Synced ${result.synced} change(s)`);
    await refreshCustomItemHistory();
  } else if (result?.failed) message.warning(`${result.failed} change(s) failed`);
  else if (!online.value) message.warning("Still offline");
  else message.info("Nothing to sync");
}

function discardFailedOfflineSale(clientSaleId) {
  dialog.warning({
    title: "Discard offline sale?",
    content: "This sale will not be sent to the server. Local stock was already reduced.",
    positiveText: "Discard",
    negativeText: "Cancel",
    onPositiveClick: () => {
      offlineSales.discard(clientSaleId);
      message.success("Discarded");
    },
  });
}

function retryFailedOfflineSale(clientSaleId) {
  offlineSales.markPending(clientSaleId);
  retryOfflineSync();
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

  if (customItemOpen.value) {
    if (key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      customItemOpen.value = false;
      return;
    }
    // Allow native Tab / typing inside the modal; block POS F-keys.
    if (/^F\d{1,2}$/i.test(key)) e.preventDefault();
    return;
  }

  if (handleSaleTabSwitchKey(e)) return;

  if (key === "Tab" && !e.ctrlKey && !e.altKey && !receiptOpen.value) {
    handlePosTabKey(e);
    return;
  }

  if (key === "Enter") {
    if (receiptOpen.value && !receiptConfirmOpen()) {
      e.preventDefault();
      if (receiptDetail.value) printSaleReceipt();
      return;
    }
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
      e.stopPropagation();
      if (receiptConfirmOpen()) return;
      requestCloseReceipt();
      return;
    }
    if (searchResults.value.length || scanBuffer.value.trim()) {
      e.preventDefault();
      const inScan = document.activeElement?.closest?.(".pos-scan-wrap");
      searchResults.value = [];
      selectedSearchIndex.value = -1;
      if (inScan || scanBuffer.value.trim()) {
        resetScanFieldAfterBarcodeAttempt();
      }
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
    if (inLookup) {
      e.preventDefault();
      const n = searchResults.value.length;
      let idx = selectedSearchIndex.value;
      for (let step = 0; step < n; step++) {
        if (key === "ArrowDown") idx = idx < 0 ? 0 : (idx + 1) % n;
        else idx = idx < 0 ? n - 1 : (idx - 1 + n) % n;
        if (searchResults.value[idx]?.pos_available > 0) {
          selectedSearchIndex.value = idx;
          searchHighlightByUser.value = true;
          break;
        }
      }
      return;
    }
  }

  // Cart ↑/↓ — works from scan field when dropdown is closed (before typing-block)
  if (
    (key === "ArrowDown" || key === "ArrowUp") &&
    !searchResults.value.length &&
    !lookupLoading.value &&
    items.value.length &&
    !receiptOpen.value
  ) {
    const active = document.activeElement;
    if (!active?.closest?.(".pos-line-qty") && !active?.closest?.(".pos-line-price")) {
      e.preventDefault();
      e.stopPropagation();
      moveCartLineSelection(key === "ArrowDown" ? 1 : -1);
      return;
    }
  }

  // Close sale tab: browser owns Ctrl+W — use Alt+W (and Ctrl+Shift+W as alternate)
  if (key.toLowerCase() === "w" && !receiptOpen.value) {
    if (e.altKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      closeActiveSaleTab();
      return;
    }
    if (e.ctrlKey && e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      closeActiveSaleTab();
      return;
    }
    if (e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      message.info("Browser uses Ctrl+W — press Alt+W to close this sale tab");
      return;
    }
  }

  // Remove selected cart line — Alt+R (plain R would type into scan field)
  if (
    (key === "r" || key === "R") &&
    e.altKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !receiptOpen.value &&
    items.value.length
  ) {
    e.preventDefault();
    e.stopPropagation();
    removeSelectedCartLine();
    return;
  }

  if (e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (e.code === "KeyZ" || key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopPropagation();
      undoLastCartItem();
      return;
    }
    if (e.code === "KeyQ" || key.toLowerCase() === "q") {
      e.preventDefault();
      e.stopPropagation();
      focusLastLineQty();
      return;
    }
  }

  if (/^F\d{1,2}$/i.test(key)) {
    e.preventDefault();
    if (key === "F1") openCustomItem();
    else if (key === "F2") focusRef(scanRef);
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
  selectedCartLineId.value = null;
  cartStore.syncScheduledDiscount(activeScheduledPromo.value, items.value);
});

watch(
  items,
  (list) => {
    if (!selectedCartLineId.value) return;
    if (!list.some((l) => l.lineId === selectedCartLineId.value)) {
      selectedCartLineId.value = null;
    }
  },
  { deep: true }
);

watch(subtotal, () => {
  applyScheduledPromoToCart();
});

onMounted(() => {
  layoutStore.applyRouteSidebar("pos");
  window.addEventListener("keydown", onPosKeyDown, true);
  window.addEventListener(PRODUCT_CATALOG_UPDATED, onGlobalCatalogUpdated);
  window.addEventListener(BARCODE_WEDGE_SCAN_EVENT, onBarcodeWedgeScan);
  cartStore.init();
  offlineSales.hydrate();
  refreshPosCatalog();
  refreshCustomItemHistory();
  refreshScheduledPromoForPos();
  getSettings()
    .then((s) => {
      if (s) receiptSettings.value = s;
    })
    .catch(() => {
      const cached = getCachedSettings();
      if (cached) receiptSettings.value = cached;
    });
  if (online.value && pendingCount.value) drainAllOfflineQueues().then(() => refreshCustomItemHistory());
  focusRef(scanRef);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onPosKeyDown, true);
  window.removeEventListener(PRODUCT_CATALOG_UPDATED, onGlobalCatalogUpdated);
  window.removeEventListener(BARCODE_WEDGE_SCAN_EVENT, onBarcodeWedgeScan);
  clearTimeout(lookupTimer);
  clearTimeout(scanBurstEndTimer);
});
</script>

<template>
  <div class="pos-page">
    <h1 style="margin-top: 0; margin-bottom: 8px">POS / New Sale</h1>
    <SupabaseRequiredAlert />
    <NAlert v-if="!online" type="warning" style="margin-bottom: 12px" :bordered="false">
      Offline — scan and sell from the cached catalog. Sales queue and sync when you are back online.
    </NAlert>
    <NAlert
      v-else-if="pendingCount"
      :type="failedCount ? 'error' : 'info'"
      style="margin-bottom: 12px"
      :bordered="false"
    >
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px">
        <span>
          Pending sync: {{ pendingCount }}
          <template v-if="failedCount"> ({{ failedCount }} failed)</template>
        </span>
        <NButton size="tiny" type="primary" :loading="offlineSyncing" @click="retryOfflineSync">
          Sync now
        </NButton>
      </div>
      <div v-if="failedCount" class="pos-offline-failed" style="margin-top: 8px">
        <div
          v-for="e in pendingEntries.filter((x) => x.status === 'failed')"
          :key="e.clientSaleId"
          style="font-size: 12px; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center"
        >
          <span>{{ e.receiptSale?.sale_reference || e.clientSaleId.slice(0, 8) }} — {{ e.lastError }}</span>
          <NButton size="tiny" secondary @click="retryFailedOfflineSale(e.clientSaleId)">Retry</NButton>
          <NButton size="tiny" quaternary type="error" @click="discardFailedOfflineSale(e.clientSaleId)">
            Discard
          </NButton>
        </div>
      </div>
    </NAlert>
    <div class="pos-workspace">
      <section class="pos-cart-col">
    <div class="pos-head">
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
            title="Close tab (Alt+W)"
            aria-label="Close tab"
            @click.stop="requestCloseTab(c)"
          >
            ×
          </button>
        </div>
        <NButton size="small" quaternary class="pos-tab-new" @click="newOrder">
          + New<span class="pos-key-hint pos-key-hint--sm pos-key-hint--inline">(F8)</span>
        </NButton>
        <span class="pos-tab-shortcut-hint">
          <span class="pos-key-hint pos-key-hint--sm">(Shift+F11)</span>
          <span class="pos-tab-shortcut-sep">/</span>
          <span class="pos-key-hint pos-key-hint--sm">(Shift+F12)</span>
          <span class="pos-tab-shortcut-text">prev / next tab</span>
        </span>
      </div>

      <div
        class="pos-scan-wrap"
        :class="{ 'pos-scan-wrap--open': scanDropdownOpen }"
      >
        <NInput
          ref="scanRef"
          v-model:value="scanBuffer"
          placeholder="Scan or type barcode / name — list updates as you type"
          @focus="scheduleLiveLookup()"
          @keydown="onScanFieldKeydown"
          @keydown.enter="onLookupEnter"
        >
          <template #suffix>
            <span class="pos-key-hint pos-key-hint--suffix" title="Focus scan field">(F2)</span>
          </template>
        </NInput>
        <div v-if="scanDropdownOpen" class="pos-pick-panel" role="listbox">
          <div v-if="lookupLoading" class="pos-pick-list pos-pick-status">
            <NSpin size="small" />
            <NText depth="3" style="margin-left: 8px">Searching catalog…</NText>
          </div>
          <div v-else-if="showPickEmpty" class="pos-pick-list pos-pick-empty">
            <NText depth="3">No matching products in catalog</NText>
          </div>
          <div v-else-if="showPickList && searchResults.length" ref="pickListRef" class="pos-pick-list">
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
                  {{ p.pos_price_hint || formatPkr(p.selling_price) }} ·
                  <template v-if="p.pos_available > 0"
                    >{{ p.pos_available }} {{ p.pos_unit || "unit" }}(s) left</template
                  >
                  <template v-else>Out of stock for tabs ({{ p.current_stock }} pcs in store)</template>
                  <template v-if="p.barcode"> · {{ p.barcode }}</template>
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <div class="pos-cart-filter">
        <NInput
          ref="searchRef"
          v-model:value="cartFilter"
          clearable
          class="pos-cart-filter-input"
          placeholder="Filter cart items — name, SKU, barcode"
        >
          <template #suffix>
            <span class="pos-key-hint pos-key-hint--suffix" title="Focus cart item filter">(F3)</span>
          </template>
        </NInput>
        <ClearFiltersButton :disabled="!hasCartLineFilter" @clear="clearCartLineFilter" />
        <NButton size="medium" class="pos-cart-filter-custom" @click="openCustomItem">
          + Custom item<span class="pos-key-hint pos-key-hint--sm pos-key-hint--inline">(F1)</span>
        </NButton>
      </div>
    </div>

    <div class="pos-cart-list-head">
      <h2 class="pos-cart-title">Items in this sale</h2>
      <span class="pos-cart-count">{{ displayItems.length }} {{ displayItems.length === 1 ? 'item' : 'items' }}</span>
    </div>

    <div class="app-table-panel pos-table-panel">
      <p v-if="!displayItems.length" class="pos-cart-empty">
        No items yet — scan a barcode or search above
      </p>
      <NDataTable
        v-else
        class="pos-table"
        :row-key="(row) => row.lineId"
        :columns="itemColumns"
        :data="displayItems"
        :row-class-name="cartRowClassName"
        size="medium"
        striped
        :scroll-x="cartTableScrollX"
      />
    </div>
      </section>

      <aside class="pos-pay-col">
    <div class="pos-checkout">
      <h2 class="pos-pay-heading">Payment</h2>
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
          <span class="pos-pay-label">Sub total</span>
          <strong class="pos-pay-value">{{ formatPkr(subtotal) }}</strong>
        </div>
        <div class="pos-totals-row pos-totals-row--discount">
          <div class="pos-pay-label-row">
            <span class="pos-pay-label">Discount</span>
            <span class="pos-key-hint pos-key-hint--sm">(F4)</span>
          </div>
          <NInputNumber ref="discountRef" v-model:value="discount" :min="0" class="pos-num-input" />
        </div>
        <div class="pos-totals-row pos-totals-row--total">
          <span class="pos-pay-label">Total</span>
          <strong class="pos-pay-value pos-pay-value--total">{{ formatPkr(total) }}</strong>
        </div>
        <div class="pos-totals-row">
          <div class="pos-pay-label-row">
            <span class="pos-pay-label">Cash</span>
            <span class="pos-key-hint-row">
              <span class="pos-key-hint pos-key-hint--sm">(F5)</span>
              <span class="pos-key-hint pos-key-hint--sm" title="Fill cash with total">(F6 = total)</span>
            </span>
          </div>
          <NInputNumber ref="cashRef" v-model:value="cashReceived" :min="0" class="pos-num-input" />
        </div>
        <div class="pos-totals-row pos-totals-row--change">
          <span class="pos-pay-label">Change</span>
          <strong class="pos-pay-value">{{ formatPkr(changeDue) }}</strong>
        </div>
      </div>
      <NButton
        type="primary"
        class="pos-complete-btn"
        block
        size="large"
        :loading="completing"
        @click="complete"
      >
        Complete sale<span class="pos-key-hint pos-key-hint--inline">(F9)</span>
      </NButton>
      <div class="pos-actions-secondary">
        <NButton block secondary @click="holdOrder">
          Hold tab<span class="pos-key-hint pos-key-hint--sm pos-key-hint--inline">(F7)</span>
        </NButton>
        <NButton block type="warning" class="pos-clear-cart-btn" @click="confirmClearCart">
          Clear cart<span class="pos-key-hint pos-key-hint--sm pos-key-hint--inline">(F10)</span>
        </NButton>
      </div>
    </div>
      </aside>
    </div>

    <NModal
      :show="receiptOpen"
      preset="card"
      title="Receipt"
      style="width: min(480px, 96vw)"
      :mask-closable="false"
      :close-on-esc="false"
      @update:show="onReceiptModalUpdate"
    >
      <ReceiptPreview
        v-if="receiptDetail"
        :sale="receiptDetail.sale"
        :items="receiptDetail.items"
        :settings="receiptSettings"
      />
      <NSpace v-if="receiptDetail" style="margin-top: 12px" justify="end">
        <NButton @click="requestCloseReceipt">Close</NButton>
        <NButton type="primary" :loading="receiptPrinting" @click="printSaleReceipt">
          Print (Enter)
        </NButton>
      </NSpace>
    </NModal>

    <NModal
      v-model:show="customItemOpen"
      preset="card"
      title="Custom item"
      style="width: min(400px, 96vw)"
      :mask-closable="false"
    >
      <NText depth="3" style="display: block; margin-bottom: 12px; font-size: 13px">
        Not in catalog — sold on this receipt only (no stock change). Past custom items appear as you type.
      </NText>
      <NForm label-placement="top">
        <NFormItem label="Name" required>
          <NAutoComplete
            ref="customNameRef"
            v-model:value="customItemForm.name"
            :options="customItemNameOptions"
            clearable
            placeholder="Item name"
            style="width: 100%"
            @select="onCustomItemNameSelect"
            @keydown="onCustomNameKeydown"
          />
        </NFormItem>
        <NFormItem label="Price (PKR)" required>
          <NInputNumber
            ref="customPriceRef"
            v-model:value="customItemForm.unit_selling_price"
            :min="0"
            :precision="2"
            clearable
            placeholder="Selling price"
            style="width: 100%"
            @keydown="onCustomPriceKeydown"
          />
        </NFormItem>
        <NFormItem label="Qty">
          <NInputNumber
            ref="customQtyRef"
            v-model:value="customItemForm.quantity"
            :min="1"
            :precision="0"
            style="width: 100%"
            @keydown="onCustomQtyKeydown"
          />
        </NFormItem>
      </NForm>
      <NSpace justify="end">
        <NButton @click="customItemOpen = false">Cancel</NButton>
        <NButton type="primary" :loading="customItemSaving" @click="submitCustomItem">Add to cart</NButton>
      </NSpace>
    </NModal>
  </div>
</template>

<style scoped>
.pos-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) min(360px, 34vw);
  gap: 14px;
  align-items: start;
}
.pos-cart-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}
.pos-cart-col .pos-head {
  border: none;
  border-radius: 0;
  border-bottom: 1px solid #e5e7eb;
}
.pos-cart-col .pos-table-panel {
  border: none;
  border-radius: 0;
  min-height: 200px;
  overflow: visible;
  padding: 0;
}
.pos-cart-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: #0f766e;
  color: #fff;
  border-bottom: 1px solid #0d9488;
}
.pos-cart-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  line-height: 1.2;
}
.pos-cart-count {
  flex-shrink: 0;
  font-size: 0.875rem;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.35);
}
.pos-cart-empty {
  margin: 0;
  padding: 56px 20px;
  text-align: center;
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.5;
  color: #64748b;
  background: #fafafa;
  border-top: 1px solid #f1f5f9;
}
.pos-cart-col .pos-table-panel:has(.pos-table) {
  padding: 0 12px 12px;
  background: #fff;
}
.pos-pay-col {
  position: sticky;
  top: 0;
}
.pos-pay-heading {
  margin: 0 0 12px;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6b7280;
}
.pos-head {
  flex: 0 0 auto;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-bottom: none;
  border-radius: 10px 10px 0 0;
  padding: 12px 12px 8px;
}
.pos-table-panel {
  background: #fff;
  min-height: 200px;
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
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35em 0.5em;
  margin-left: 0.65em;
}
.pos-tab-shortcut-sep {
  color: #9ca3af;
  font-weight: 600;
}
.pos-tab-shortcut-text {
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  white-space: nowrap;
}
.pos-key-hint {
  display: inline;
  font-size: 1em;
  font-weight: 700;
  line-height: inherit;
  color: var(--app-primary);
  letter-spacing: 0.02em;
  vertical-align: baseline;
  background: none;
  border: none;
  padding: 0;
  box-shadow: none;
}
.pos-key-hint--sm {
  font-size: 0.95em;
}
.pos-key-hint--inline {
  margin-left: 0.4em;
}
.pos-key-hint--suffix {
  margin-left: 0.5em;
  white-space: nowrap;
}
.pos-key-hint-row {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5em;
}
.pos-pay-label-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35em 0.5em;
}
.pos-scan-wrap :deep(.n-input__suffix) {
  padding-right: 8px;
  padding-left: 4px;
}
.pos-cart-filter-input :deep(.n-input__suffix) {
  padding-right: 8px;
  padding-left: 4px;
}
.pos-complete-btn :deep(.n-button__content) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0;
}
.pos-actions-secondary :deep(.n-button__content) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0;
  white-space: normal;
  text-align: center;
  line-height: 1.25;
}
.pos-scan-wrap {
  flex: 0 0 auto;
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  margin-bottom: 0;
}
.pos-cart-filter-input {
  width: 100%;
  min-width: 0;
}
.pos-cart-filter-custom {
  flex-shrink: 0;
  white-space: nowrap;
  font-weight: 700 !important;
  min-height: 36px;
  padding-left: 14px !important;
  padding-right: 14px !important;
  color: #111827 !important;
  background-color: #fbbf24 !important;
  border: 1px solid #b45309 !important;
  box-shadow: 0 1px 2px rgba(180, 83, 9, 0.15);
}
.pos-cart-filter-custom:not(.n-button--disabled):hover {
  color: #000 !important;
  background-color: #fcd34d !important;
  border-color: #92400e !important;
}
.pos-cart-filter-custom:not(.n-button--disabled):active,
.pos-cart-filter-custom:not(.n-button--disabled):focus {
  color: #000 !important;
  background-color: #f59e0b !important;
  border-color: #78350f !important;
}
.pos-cart-filter-custom :deep(.n-button__content) {
  flex-wrap: nowrap;
}
.pos-cart-filter-custom .pos-key-hint {
  color: rgba(17, 24, 39, 0.72);
  font-weight: 600;
}
.pos-table {
  margin-bottom: 0;
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
  display: inline-flex;
  align-items: flex-start;
  gap: 6px;
  font-weight: 700;
  color: #111827;
  font-size: 15px;
  max-width: 100%;
  white-space: normal;
}
.pos-line-name-text {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.35;
}
.pos-line-custom-badge {
  flex: 0 0 auto;
  font-weight: 700;
  font-size: 10px;
  line-height: 1;
  color: #0f766e;
  background: #ccfbf1;
  border: 1px solid #99f6e4;
  border-radius: 4px;
  padding: 3px 5px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.pos-table :deep(.pos-line-price--edited .n-input__input-el) {
  font-weight: 700;
  color: #0f766e;
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
.pos-table :deep(.pos-cart-row--selected td) {
  background: #bbf7d0 !important;
  box-shadow: none !important;
}
.pos-table :deep(.pos-cart-row--selected.pos-cart-row--disc td) {
  background: #bbf7d0 !important;
}
.pos-table :deep(.pos-cart-row--selected:hover td) {
  background: #86efac !important;
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
  gap: 12px;
  padding: 16px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);
}
.pos-totals {
  width: 100%;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 4px 12px;
}
.pos-totals-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #f1f5f9;
}
.pos-totals-row:last-child {
  border-bottom: none;
}
.pos-pay-label {
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #64748b;
}
.pos-pay-value {
  font-size: 1.25rem;
  font-weight: 800;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.pos-totals-row--discount :deep(.n-input__input-el) {
  color: #b45309;
}
.pos-totals-row--total {
  padding: 14px 0;
  border-top: 2px solid #e2e8f0;
  border-bottom: 2px solid #e2e8f0;
  margin: 4px 0;
}
.pos-pay-value--total {
  font-size: 1.65rem;
  color: #0f766e;
}
.pos-totals-row--change .pos-pay-value {
  font-size: 1.35rem;
}
.pos-num-input {
  width: min(150px, 52%);
}
.pos-num-input :deep(.n-input__input-el) {
  font-size: 1.2rem !important;
  font-weight: 700;
  text-align: right;
}

.pos-complete-btn {
  min-height: 52px;
  font-size: 1.05rem !important;
  font-weight: 800 !important;
  letter-spacing: 0.02em;
}
.pos-complete-btn .pos-key-hint {
  color: rgba(255, 255, 255, 0.92);
  font-weight: 600;
}
.pos-actions-secondary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
.pos-actions-secondary :deep(.n-button) {
  font-weight: 600;
}
.pos-clear-cart-btn {
  min-height: 44px;
  font-weight: 700 !important;
  font-size: 0.95rem !important;
}
.pos-clear-cart-btn .pos-key-hint {
  color: rgba(17, 24, 39, 0.72);
  font-weight: 600;
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
@media (max-width: 960px) {
  .pos-workspace {
    grid-template-columns: 1fr;
  }
  .pos-pay-col {
    position: static;
  }
}
@media (max-width: 768px) {
  .pos-tab-shortcut-hint {
    display: none;
  }
  .pos-cart-filter {
    grid-template-columns: 1fr;
  }
  .pos-cart-filter-custom {
    justify-self: start;
  }
  .pos-scheduled-promo {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .pos-actions-secondary {
    grid-template-columns: 1fr;
  }
}
</style>
