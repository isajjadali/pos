<script setup>
import { ref, computed, onMounted, onUnmounted, h, watch, nextTick } from "vue";
import {
  NButton,
  NSpace,
  NInput,
  NInputNumber,
  NDataTable,
  NSelect,
  NSwitch,
  NText,
  NCard,
  NRadioGroup,
  NRadio,
  NDrawer,
  NDrawerContent,
  useMessage,
  useDialog,
} from "naive-ui";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
import PricingHelperCard from "../components/PricingHelperCard.vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import OfflinePendingBanner from "../components/OfflinePendingBanner.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { formatPkr, marginPercent } from "../utils/format.js";
import { bandForCost, suggestedSaleFromCost } from "../utils/pricingHelper.js";
import { listActiveVendorOptions } from "../services/vendors.js";
import {
  listProductsForPriceGroups,
  bulkUpdateSellingPrices,
  priceGroupKey,
} from "../services/priceGroups.js";
import { PRODUCT_CATALOG_UPDATED } from "../services/productCatalog.js";
import { rowNumberColumn, tableSorter } from "../utils/tableColumns.js";
import {
  UNIT_LISTING_FILTER_OPTIONS,
  boxPriceOf,
  defaultPosSaleUnit,
  formatProductUnitPrices,
  packPriceOf,
  piecePriceOf,
  piecesPerBoxOf,
  piecesPerPackOf,
  productHasPack,
  productHasBox,
  productMatchesUnitFilter,
  resolveSaleUnit,
} from "../utils/saleUnits.js";

const RANGES_LS = "dw_price_group_ranges_v1";

const message = useMessage();
const dialog = useDialog();

const loading = ref(false);
const saving = ref(false);
const products = ref([]);
const vendorOptions = ref([]);

const search = ref("");
const vendorFilter = ref([]);
const activeOnly = ref(true);
const includeZeroStock = ref(true);
/** all | piece | pack | box | multi */
const unitFilter = ref("all");
const unitFilterOptions = UNIT_LISTING_FILTER_OPTIONS;

/** exact = same purchase cost | ranges = custom min–max bands */
const groupMode = ref("exact");

/** @type {import('vue').Ref<Array<{ id: string, min: number, max: number }>>} */
const customRanges = ref(loadRanges());

/** @type {import('vue').Ref<Record<string, number>>} draft sale prices by group key */
const drafts = ref({});

/**
 * Draft piece/pack/box prices for solo multi-unit rows.
 * @type {import('vue').Ref<Record<string, { piece: number, pack: number, box: number|null }>>}
 */
const multiDrafts = ref({});

const modeOptions = [
  { label: "Exact purchase cost", value: "exact" },
  { label: "Custom cost ranges", value: "ranges" },
];

/** Always show cost ranges by min (then max). */
function sortRanges(list) {
  return [...(list ?? [])].sort((a, b) => {
    const d = (Number(a.min) || 0) - (Number(b.min) || 0);
    if (d !== 0) return d;
    return (Number(a.max) || 0) - (Number(b.max) || 0);
  });
}

function loadRanges() {
  try {
    const raw = localStorage.getItem(RANGES_LS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortRanges(
      parsed
        .map((r, i) => ({
          id: String(r.id || `r${i}`),
          min: Math.max(0, Number(r.min) || 0),
          max: Math.max(0, Number(r.max) || 0),
        }))
        .filter((r) => r.max >= r.min)
    );
  } catch {
    return [];
  }
}

function persistRanges() {
  try {
    localStorage.setItem(RANGES_LS, JSON.stringify(customRanges.value));
  } catch {
    /* ignore */
  }
}

watch(customRanges, persistRanges, { deep: true });
watch(groupMode, (mode) => {
  drafts.value = {};
  multiDrafts.value = {};
  if (mode === "ranges" && !customRanges.value.length) {
    addRange();
  }
});

function isMultiUnitProduct(p) {
  return productHasPack(p) || productHasBox(p);
}

const hasActiveFilters = computed(
  () =>
    Boolean(search.value.trim()) ||
    (vendorFilter.value?.length ?? 0) > 0 ||
    !activeOnly.value ||
    !includeZeroStock.value ||
    unitFilter.value !== "all"
);

/** Secondary filters only (inside More filters) — drives badge count. */
const moreFiltersCount = computed(() => {
  let n = 0;
  if (unitFilter.value !== "all") n += 1;
  if (!activeOnly.value) n += 1;
  if (!includeZeroStock.value) n += 1;
  return n;
});
const showMoreFilters = ref(false);

function clearFilters() {
  search.value = "";
  vendorFilter.value = [];
  activeOnly.value = true;
  includeZeroStock.value = true;
  unitFilter.value = "all";
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function nearlyEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.009;
}

function productCost(p) {
  return money(p.weighted_avg_cost);
}

/** Primary sell-unit price (pack when pack configured — same as POS default). */
function productSale(p) {
  return money(resolveSaleUnit(p, defaultPosSaleUnit(p)).unit_selling_price);
}

/** Current catalog value per piece (stock is always pieces). */
function productSalePerPiece(p) {
  const piece = Number(piecePriceOf(p));
  if (Number.isFinite(piece) && piece >= 0) return money(piece);
  return money(productSale(p));
}

function productSaleLabel(p) {
  return formatProductUnitPrices(p, { multiline: true });
}

const filteredProducts = computed(() => {
  const q = search.value.trim().toLowerCase();
  const vendors = Array.isArray(vendorFilter.value) ? vendorFilter.value.filter(Boolean) : [];
  const vendorSet = vendors.length ? new Set(vendors.map(String)) : null;
  return (products.value ?? []).filter((p) => {
    if (!includeZeroStock.value && (Number(p.current_stock) || 0) <= 0) return false;
    if (vendorSet && !vendorSet.has(String(p.vendor_id))) return false;
    if (!productMatchesUnitFilter(p, unitFilter.value)) return false;
    if (!q) return true;
    const hay = `${p.name ?? ""} ${p.external_product_id ?? ""}`.toLowerCase();
    return hay.includes(q);
  });
});

function findRangeForCost(cost) {
  const bands = customRanges.value;
  for (const r of bands) {
    if (cost + 0.009 >= r.min && cost - 0.009 <= r.max) return r;
  }
  return null;
}

/** Piece-only products go into cost groups; pack/box stay as solo rows. */
function pieceOnlyProducts() {
  return filteredProducts.value.filter((p) => !isMultiUnitProduct(p));
}

function multiUnitProducts() {
  return filteredProducts.value.filter((p) => isMultiUnitProduct(p));
}

function buildGroupBuckets() {
  /** @type {Map<string, { key: string, label: string, sortKey: number, purchaseCost: number|null, rangeMin: number|null, rangeMax: number|null, products: any[] }>} */
  const map = new Map();
  const pool = pieceOnlyProducts();

  if (groupMode.value === "ranges") {
    for (const r of customRanges.value) {
      if (r.max < r.min) continue;
      const key = `range:${r.id}`;
      map.set(key, {
        key,
        label: `${formatPkr(r.min)} – ${formatPkr(r.max)}`,
        sortKey: r.min,
        purchaseCost: null,
        rangeMin: money(r.min),
        rangeMax: money(r.max),
        products: [],
        outsideRange: false,
      });
    }
    for (const p of pool) {
      const cost = productCost(p);
      const band = findRangeForCost(cost);
      if (band) {
        map.get(`range:${band.id}`)?.products.push(p);
        continue;
      }
      const key = `outside:${priceGroupKey(cost)}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: formatPkr(cost),
          sortKey: 1e12 + cost,
          purchaseCost: cost,
          rangeMin: cost,
          rangeMax: cost,
          products: [],
          outsideRange: true,
        });
      }
      map.get(key).products.push(p);
    }
    return [...map.values()].filter((g) => g.products.length > 0);
  }

  for (const p of pool) {
    const cost = productCost(p);
    const key = `cost:${priceGroupKey(cost)}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: formatPkr(cost),
        sortKey: cost,
        purchaseCost: cost,
        rangeMin: cost,
        rangeMax: cost,
        products: [],
      });
    }
    map.get(key).products.push(p);
  }
  return [...map.values()];
}

/** Shared sale when every product matches; null if mixed (not an average). */
function sharedSaleForGroup(productsInGroup) {
  if (!productsInGroup.length) return null;
  const first = productSale(productsInGroup[0]);
  const allSame = productsInGroup.every((p) => nearlyEqual(productSale(p), first));
  return allSame ? first : null;
}

function baselineMultiDraft(p) {
  const hasPack = productHasPack(p);
  const hasBox = productHasBox(p);
  return {
    piece: money(piecePriceOf(p)),
    pack: hasPack ? money(packPriceOf(p)) : money(piecePriceOf(p)),
    box: hasBox ? money(boxPriceOf(p) ?? 0) : null,
  };
}

function resolveMultiDraft(key, p) {
  const base = baselineMultiDraft(p);
  const raw = multiDrafts.value[key];
  if (!raw) {
    return { ...base, hasExplicitDraft: false };
  }
  return {
    piece: money(raw.piece ?? base.piece),
    pack: money(raw.pack ?? base.pack),
    box: raw.box == null && base.box == null ? null : money(raw.box ?? base.box ?? 0),
    hasExplicitDraft: true,
  };
}

function buildGroupRow(g) {
  const sharedSale = sharedSaleForGroup(g.products);
  const mixedSales = sharedSale == null && g.products.length > 0;
  const draftRaw = drafts.value[g.key];
  const hasExplicitDraft = draftRaw != null && Number.isFinite(Number(draftRaw));
  // Mixed groups: no fake default (was first product — looked like an average).
  // Uniform groups: show the shared current sale until you type a new one.
  const draftPrice = hasExplicitDraft
    ? money(draftRaw)
    : sharedSale != null
      ? money(sharedSale)
      : null;

  let qty = 0;
  let costValue = 0;
  let saleValueBefore = 0;
  let saleValue = 0;
  let belowCostCount = 0;
  let needsUpdateCount = 0;

  for (const p of g.products) {
    const stock = Math.max(0, Number(p.current_stock) || 0);
    const cost = productCost(p);
    const sale = productSale(p);
    const salePerPiece = productSalePerPiece(p);
    // Preview uses draft only after you set one; else keep each product's own sale.
    const draftPerPiece = hasExplicitDraft ? money(draftPrice) : salePerPiece;
    qty += stock;
    costValue += stock * cost;
    saleValueBefore += stock * salePerPiece;
    saleValue += stock * draftPerPiece;
    if (hasExplicitDraft && draftPerPiece + 0.009 < cost) belowCostCount += 1;
    if (hasExplicitDraft && !nearlyEqual(sale, draftPrice)) needsUpdateCount += 1;
  }

  costValue = money(costValue);
  saleValue = money(saleValue);
  saleValueBefore = money(saleValueBefore);
  const profit = money(saleValue - costValue);
  const profitBefore = money(saleValueBefore - costValue);
  const changed = hasExplicitDraft && needsUpdateCount > 0;

  return {
    ...g,
    rowType: "group",
    draftPrice,
    draftPiece: draftPrice,
    draftPack: null,
    draftBox: null,
    hasPack: false,
    hasBox: false,
    hasExplicitDraft,
    changed,
    outsideRange: Boolean(g.outsideRange),
    mixedSales,
    productCount: g.products.length,
    qty,
    costValue,
    saleValue,
    saleValueBefore,
    profit,
    profitBefore,
    belowCostCount,
    needsUpdateCount,
    saleSort: g.products.length ? Math.min(...g.products.map((p) => productSale(p))) : 0,
    profitSort: changed ? profit : profitBefore,
    saleLabel: mixedSales
      ? "Mixed"
      : g.products.length
        ? productSaleLabel(g.products[0])
        : "—",
    saleLabelMulti: false,
  };
}

function buildSoloMultiRow(p) {
  const key = `solo:${p.id}`;
  const cost = productCost(p);
  const stock = Math.max(0, Number(p.current_stock) || 0);
  const hasPack = productHasPack(p);
  const hasBox = productHasBox(p);
  const draft = resolveMultiDraft(key, p);
  const salePerPiece = productSalePerPiece(p);
  const draftPerPiece = money(draft.piece);
  const costValue = money(stock * cost);
  const saleValueBefore = money(stock * salePerPiece);
  const saleValue = money(stock * draftPerPiece);
  const profit = money(saleValue - costValue);
  const profitBefore = money(saleValueBefore - costValue);

  const pieceChanged = !nearlyEqual(draft.piece, piecePriceOf(p));
  const packChanged = hasPack && !nearlyEqual(draft.pack, packPriceOf(p));
  const boxChanged =
    hasBox && draft.box != null && !nearlyEqual(draft.box, boxPriceOf(p) ?? 0);
  const needsUpdateCount = pieceChanged || packChanged || boxChanged ? 1 : 0;
  const changed = draft.hasExplicitDraft && needsUpdateCount > 0;
  const belowCostCount = draftPerPiece + 0.009 < cost ? 1 : 0;

  const idLabel = p.external_product_id || "—";
  const nameLabel = p.name || "Untitled";

  return {
    key,
    rowType: "multi",
    label: nameLabel,
    sortKey: 2e12 + cost,
    purchaseCost: cost,
    rangeMin: cost,
    rangeMax: cost,
    products: [p],
    outsideRange: false,
    draftPrice: draft.piece,
    draftPiece: draft.piece,
    draftPack: hasPack ? draft.pack : null,
    draftBox: hasBox ? draft.box : null,
    hasPack,
    hasBox,
    packPcs: hasPack ? piecesPerPackOf(p) : 1,
    boxPcs: hasBox ? piecesPerBoxOf(p) : null,
    hasExplicitDraft: draft.hasExplicitDraft,
    changed,
    mixedSales: false,
    productCount: 1,
    qty: stock,
    costValue,
    saleValue,
    saleValueBefore,
    profit,
    profitBefore,
    belowCostCount,
    needsUpdateCount,
    saleSort: salePerPiece,
    profitSort: changed ? profit : profitBefore,
    saleLabel: productSaleLabel(p),
    saleLabelMulti: true,
    productIdLabel: idLabel,
  };
}

const groups = computed(() => {
  const list = [
    ...buildGroupBuckets().map(buildGroupRow),
    ...multiUnitProducts().map(buildSoloMultiRow),
  ];
  list.sort((a, b) => {
    if (a.rowType !== b.rowType) return a.rowType === "group" ? -1 : 1;
    return a.sortKey - b.sortKey;
  });
  return list;
});

const summary = computed(() => {
  let cost = 0;
  let sale = 0;
  let saleBefore = 0;
  for (const g of groups.value) {
    cost += g.costValue;
    sale += g.saleValue;
    saleBefore += g.saleValueBefore;
  }
  cost = money(cost);
  sale = money(sale);
  saleBefore = money(saleBefore);
  const profit = money(sale - cost);
  const profitBefore = money(saleBefore - cost);
  const margin = sale > 0 ? Math.round((profit / sale) * 10000) / 100 : null;
  return {
    cost,
    sale,
    saleBefore,
    profit,
    profitBefore,
    margin,
    changedGroups: groups.value.filter((g) => g.changed).length,
    changedProducts: groups.value
      .filter((g) => g.changed)
      .reduce((s, g) => s + g.needsUpdateCount, 0),
    hasDraftDelta: !nearlyEqual(sale, saleBefore),
  };
});

function setDraft(key, value) {
  const next = { ...drafts.value };
  if (value == null || !Number.isFinite(Number(value))) {
    delete next[key];
  } else {
    next[key] = money(value);
  }
  drafts.value = next;
}

/** Fill New sale drafts from pricing-helper band margins (piece groups + multi piece). */
function applyPricingSuggestions(cfg) {
  let filled = 0;
  const nextDrafts = { ...drafts.value };
  const nextMulti = { ...multiDrafts.value };

  for (const g of groups.value) {
    if (g.rowType === "multi") {
      const p = g.products[0];
      if (!p) continue;
      const cost = productCost(p);
      const band = bandForCost(cost, cfg);
      const piece = suggestedSaleFromCost(cost, band.marginPct);
      if (piece <= 0) continue;
      const cur = resolveMultiDraft(g.key, p);
      nextMulti[g.key] = {
        piece: money(piece),
        pack: g.hasPack
          ? money(suggestedSaleFromCost(cost * Math.max(1, g.packPcs || 1), band.marginPct))
          : money(piece),
        box:
          g.hasBox && g.boxPcs
            ? money(suggestedSaleFromCost(cost * g.boxPcs, band.marginPct))
            : cur.box,
      };
      filled += 1;
      continue;
    }

    const cost =
      g.purchaseCost != null && Number.isFinite(Number(g.purchaseCost))
        ? Number(g.purchaseCost)
        : g.rangeMin != null
          ? Number(g.rangeMin)
          : g.products[0]
            ? productCost(g.products[0])
            : 0;
    if (cost <= 0) continue;
    const band = bandForCost(cost, cfg);
    const sale = suggestedSaleFromCost(cost, band.marginPct);
    if (sale <= 0) continue;
    nextDrafts[g.key] = money(sale);
    filled += 1;
  }

  drafts.value = nextDrafts;
  multiDrafts.value = nextMulti;
  message.success(
    `Filled suggested sale on ${filled} row(s). Review drafts, then Save.`
  );
}

function setMultiDraft(row, field, value) {
  const p = row.products[0];
  if (!p) return;
  const cur = resolveMultiDraft(row.key, p);
  const nextVal =
    value == null || !Number.isFinite(Number(value)) ? cur[field] : money(value);
  multiDrafts.value = {
    ...multiDrafts.value,
    [row.key]: {
      piece: field === "piece" ? nextVal : cur.piece,
      pack: field === "pack" ? nextVal : cur.pack,
      box: field === "box" ? nextVal : cur.box,
    },
  };
}

function groupDraftBase(group) {
  if (group.draftPrice != null && Number.isFinite(Number(group.draftPrice))) {
    return money(group.draftPrice);
  }
  // Mixed / empty: bump from cheapest current sale in the group (not an average).
  if (group.products?.length) {
    return money(Math.min(...group.products.map((p) => productSale(p))));
  }
  return 0;
}

function bumpGroup(group, pct) {
  if (group.rowType === "multi") {
    const factor = 1 + pct / 100;
    const p = group.products[0];
    const cur = resolveMultiDraft(group.key, p);
    multiDrafts.value = {
      ...multiDrafts.value,
      [group.key]: {
        piece: money(cur.piece * factor),
        pack: money(cur.pack * factor),
        box: cur.box == null ? null : money(cur.box * factor),
      },
    };
    return;
  }
  setDraft(group.key, money(groupDraftBase(group) * (1 + pct / 100)));
}

function roundGroup(group, step) {
  const s = Math.max(1, Number(step) || 10);
  if (group.rowType === "multi") {
    const p = group.products[0];
    const cur = resolveMultiDraft(group.key, p);
    multiDrafts.value = {
      ...multiDrafts.value,
      [group.key]: {
        piece: Math.round(cur.piece / s) * s,
        pack: Math.round(cur.pack / s) * s,
        box: cur.box == null ? null : Math.round(cur.box / s) * s,
      },
    };
    return;
  }
  setDraft(group.key, Math.round(groupDraftBase(group) / s) * s);
}

function resetDrafts() {
  drafts.value = {};
  multiDrafts.value = {};
  message.info("Draft sale prices cleared");
}

function addRange() {
  const sorted = sortRanges(customRanges.value);
  const last = sorted[sorted.length - 1];
  const min = last ? money(last.max) : 0;
  const max = money(min + 100);
  const id = `r${Date.now()}`;
  customRanges.value = sortRanges([...customRanges.value, { id, min, max }]);
  nextTick(() => {
    const rows = document.querySelectorAll(".pg-range-row");
    // After sort, focus the row that matches the new id (by index in sorted list)
    const idx = customRanges.value.findIndex((r) => r.id === id);
    const row = idx >= 0 ? rows[idx] : rows[rows.length - 1];
    const input = row?.querySelector("input");
    input?.focus?.();
    input?.select?.();
  });
  return id;
}

function onRangeEnter(e) {
  e?.preventDefault?.();
  addRange();
}

function removeRange(id) {
  customRanges.value = sortRanges(customRanges.value.filter((r) => r.id !== id));
  drafts.value = {};
  multiDrafts.value = {};
}

function focusRangeRow(id) {
  nextTick(() => {
    const idx = customRanges.value.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const rows = document.querySelectorAll(".pg-range-row");
    const input = rows[idx]?.querySelector("input");
    input?.focus?.();
  });
}

function updateRange(id, field, value) {
  const prevIdx = customRanges.value.findIndex((r) => r.id === id);
  customRanges.value = sortRanges(
    customRanges.value.map((r) =>
      r.id === id ? { ...r, [field]: Math.max(0, Number(value) || 0) } : r
    )
  );
  const nextIdx = customRanges.value.findIndex((r) => r.id === id);
  // If sort moved this row, keep focus on it so typing stays usable
  if (prevIdx !== nextIdx) focusRangeRow(id);
}

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    const [rows, vendors] = await Promise.all([
      listProductsForPriceGroups({ activeOnly: activeOnly.value }),
      listActiveVendorOptions(),
    ]);
    products.value = rows;
    vendorOptions.value = vendors.map((v) => ({ label: v.name, value: v.id }));
  } catch (e) {
    message.error(e.message || "Could not load products");
  } finally {
    loading.value = false;
  }
}

watch(activeOnly, () => {
  load();
});

function confirmSave() {
  const changed = groups.value.filter((g) => g.changed);
  if (!changed.length) {
    message.warning("Set a new sale price first (then save)");
    return;
  }
  const below = changed.reduce((s, g) => s + g.belowCostCount, 0);
  const productCount = changed.reduce((s, g) => s + g.needsUpdateCount, 0);
  const groupN = changed.filter((g) => g.rowType === "group").length;
  const multiN = changed.filter((g) => g.rowType === "multi").length;
  dialog.warning({
    title: "Save sale prices?",
    content: () =>
      h("div", [
        h(
          "p",
          `Update ${productCount} product(s)` +
            (groupN ? ` · ${groupN} cost group(s)` : "") +
            (multiN ? ` · ${multiN} pack/box row(s)` : "") +
            "."
        ),
        below > 0
          ? h(
              "p",
              { style: "color:#b45309;margin-top:8px" },
              `Warning: ${below} product(s) would be priced below their purchase cost.`
            )
          : null,
        h(
          "p",
          { style: "margin-top:8px;font-size:13px;color:#6b7280" },
          `Stock at sale: ${formatPkr(summary.value.saleBefore)} → ${formatPkr(summary.value.sale)}`
        ),
      ]),
    positiveText: "Save prices",
    negativeText: "Cancel",
    onPositiveClick: () => saveChanged(),
  });
}

async function saveChanged() {
  const changed = groups.value.filter((g) => g.changed);
  if (!changed.length) return;
  saving.value = true;
  try {
    const updates = [];
    for (const g of changed) {
      if (g.rowType === "multi") {
        const p = g.products[0];
        if (!p) continue;
        if (!nearlyEqual(g.draftPiece, piecePriceOf(p))) {
          updates.push({
            id: p.id,
            selling_price: g.draftPiece,
            target_unit: "piece",
          });
        }
        if (g.hasPack && !nearlyEqual(g.draftPack, packPriceOf(p))) {
          updates.push({
            id: p.id,
            selling_price: g.draftPack,
            target_unit: "pack",
          });
        }
        if (g.hasBox && g.draftBox != null && !nearlyEqual(g.draftBox, boxPriceOf(p) ?? 0)) {
          updates.push({
            id: p.id,
            selling_price: g.draftBox,
            target_unit: "box",
          });
        }
        // Restore original default unit (RPC sets default to last target_unit).
        const preferred = resolveSaleUnit(p, p.default_sale_unit || defaultPosSaleUnit(p));
        const restorePrice =
          preferred.sale_unit === "box"
            ? g.draftBox ?? preferred.unit_selling_price
            : preferred.sale_unit === "pack"
              ? g.draftPack ?? preferred.unit_selling_price
              : g.draftPiece;
        updates.push({
          id: p.id,
          selling_price: money(restorePrice),
          target_unit: preferred.sale_unit,
        });
        continue;
      }
      for (const p of g.products) {
        if (!nearlyEqual(productSale(p), g.draftPrice)) {
          updates.push({
            id: p.id,
            selling_price: g.draftPrice,
            target_unit: "piece",
          });
        }
      }
    }
    const { updated } = await bulkUpdateSellingPrices(updates);
    message.success(`Updated ${updated} price row(s)`);
    drafts.value = {};
    multiDrafts.value = {};
    await load();
  } catch (e) {
    message.error(e.message || "Save failed");
  } finally {
    saving.value = false;
  }
}

function renderMultiPriceEditor(row) {
  const fields = [
    {
      key: "piece",
      label: "Pc",
      value: row.draftPiece,
      show: true,
    },
    {
      key: "pack",
      label: `Pack(${row.packPcs})`,
      value: row.draftPack,
      show: row.hasPack,
    },
    {
      key: "box",
      label: row.boxPcs ? `Box(${row.boxPcs})` : "Box",
      value: row.draftBox,
      show: row.hasBox,
    },
  ];
  return h(
    "div",
    { class: "pg-multi-drafts" },
    fields
      .filter((f) => f.show)
      .map((f) =>
        h("div", { class: "pg-multi-draft-row", key: f.key }, [
          h("span", { class: "pg-multi-draft-label" }, f.label),
          h(NInputNumber, {
            value: f.value,
            min: 0,
            size: "tiny",
            style: "width: 100px",
            status:
              f.key === "piece" && row.belowCostCount > 0 ? "warning" : undefined,
            onUpdateValue: (v) => setMultiDraft(row, f.key, v),
          }),
        ])
      )
  );
}

const columns = computed(() => [
  rowNumberColumn(1, 5000),
  {
    type: "expand",
    renderExpand: (row) => {
      if (row.rowType === "multi") {
        const p = row.products[0];
        const m = marginPercent(row.draftPiece, productCost(p));
        return h("div", { class: "pg-expand" }, [
          h(
            "div",
            { class: "pg-expand-note" },
            `${row.productIdLabel} · purchase ${formatPkr(productCost(p))} · draft pc margin ${
              m != null ? `${m}%` : "—"
            }. Edit Pc / Pack / Box in the New sale column.`
          ),
        ]);
      }
      const head = h("div", { class: "pg-expand-head" }, [
        h("span", "Product ID"),
        h("span", "Name"),
        h("span", "Stock"),
        h("span", "Purchase"),
        h("span", "Sale now"),
        h("span", "Margin*"),
      ]);
      const body = row.products.map((p) => {
        const stock = Number(p.current_stock) || 0;
        const cost = productCost(p);
        const saleNow = productSalePerPiece(p);
        const preview = row.hasExplicitDraft ? money(row.draftPrice) : saleNow;
        const m = marginPercent(preview, cost);
        const below = preview + 0.009 < cost;
        return h("div", { class: "pg-expand-row", key: p.id }, [
          h("span", { class: "pg-expand-id" }, p.external_product_id || "—"),
          h("span", { class: "pg-expand-name", title: p.name }, p.name || "—"),
          h("span", { class: "pg-expand-num" }, String(stock)),
          h("span", { class: "pg-expand-num" }, formatPkr(cost)),
          h("span", { class: "pg-expand-num" }, productSaleLabel(p)),
          h(
            "span",
            { class: ["pg-expand-num", below || (m != null && m < 0) ? "pg-neg" : ""] },
            m != null ? `${m}%` : "—"
          ),
        ]);
      });
      const note = h(
        "div",
        { class: "pg-expand-note" },
        row.hasExplicitDraft
          ? "* Margin uses your New sale draft vs purchase cost."
          : "* Margin uses each product’s current sale vs purchase cost. Mixed groups: type a New sale to set all."
      );
      return h("div", { class: "pg-expand" }, [head, ...body, note]);
    },
  },
  {
    title: "Purchase group",
    key: "sortKey",
    width: 200,
    ellipsis: { tooltip: true },
    ...tableSorter("number", "sortKey"),
    render: (r) =>
      h("div", [
        h("span", { class: "pg-group-label" }, r.label),
        r.rowType === "multi"
          ? h(
              "div",
              { class: "pg-group-sub" },
              `${r.productIdLabel} · cost ${formatPkr(r.purchaseCost)} · pack/box`
            )
          : r.outsideRange
            ? h("div", { class: "pg-group-sub" }, "Outside your ranges")
            : null,
      ]),
  },
  {
    title: "Sale now",
    key: "saleSort",
    width: 150,
    ...tableSorter("number", "saleSort"),
    render: (r) =>
      h(
        "span",
        {
          class: r.mixedSales ? "pg-muted" : "",
          style: r.saleLabelMulti
            ? "white-space: pre-line; font-size: 12px; line-height: 1.35"
            : undefined,
        },
        r.saleLabel
      ),
  },
  {
    title: "Products",
    key: "productCount",
    width: 84,
    align: "center",
    ...tableSorter("number", "productCount"),
  },
  {
    title: "Qty",
    key: "qty",
    width: 64,
    align: "center",
    ...tableSorter("number", "qty"),
  },
  {
    title: "Cost value",
    key: "costValue",
    width: 110,
    ...tableSorter("number", "costValue"),
    render: (r) => formatPkr(r.costValue),
  },
  {
    title: "Sale value",
    key: "saleValueBefore",
    width: 130,
    ...tableSorter("number", "saleValueBefore"),
    render: (r) => {
      if (!r.changed) return formatPkr(r.saleValueBefore);
      return h("span", [
        h("span", { class: "pg-muted" }, formatPkr(r.saleValueBefore)),
        " → ",
        h("strong", formatPkr(r.saleValue)),
      ]);
    },
  },
  {
    title: "Profit",
    key: "profitSort",
    width: 100,
    ...tableSorter("number", "profitSort"),
    render: (r) =>
      h(
        "span",
        { class: (r.changed ? r.profit : r.profitBefore) < 0 ? "pg-neg" : "" },
        formatPkr(r.changed ? r.profit : r.profitBefore)
      ),
  },
  {
    title: "New sale price",
    key: "draftPrice",
    width: 200,
    ...tableSorter("number", "draftPrice"),
    render: (row) =>
      row.rowType === "multi"
        ? renderMultiPriceEditor(row)
        : h(NInputNumber, {
            value: row.draftPrice,
            min: 0,
            size: "small",
            style: "width: 100%",
            placeholder: row.mixedSales ? "Set all…" : undefined,
            status: row.belowCostCount > 0 ? "warning" : undefined,
            onUpdateValue: (v) => setDraft(row.key, v),
          }),
  },
  {
    title: "",
    key: "actions",
    width: 168,
    render: (row) =>
      h(NSpace, { size: 4, wrap: false }, () => [
        h(NButton, { size: "tiny", secondary: true, onClick: () => bumpGroup(row, 5) }, () => "+5%"),
        h(NButton, { size: "tiny", secondary: true, onClick: () => bumpGroup(row, -5) }, () => "−5%"),
        h(NButton, { size: "tiny", quaternary: true, onClick: () => roundGroup(row, 10) }, () => "÷10"),
      ]),
  },
]);

onMounted(() => {
  window.addEventListener(PRODUCT_CATALOG_UPDATED, load);
  load();
});
onUnmounted(() => window.removeEventListener(PRODUCT_CATALOG_UPDATED, load));
</script>

<template>
  <div>
    <h1 style="margin-top: 0">Price groups</h1>
    <SupabaseRequiredAlert />
    <OfflinePendingBanner />
    <NText depth="3" style="display: block; margin-bottom: 12px; font-size: 13px">
      <strong>Piece-only</strong> products group by purchase cost. Set one
      <strong>New sale price</strong> for the whole group.
      <strong>Pack / box</strong> products stay as their own rows — edit Pc, Pack, and Box prices
      separately. Sale value always uses piece price × stock.
    </NText>

    <PricingHelperCard @apply-suggestions="applyPricingSuggestions" />

    <NCard size="small" title="How to group" style="margin-bottom: 12px">
      <NRadioGroup v-model:value="groupMode" name="group_mode">
        <NSpace>
          <NRadio v-for="o in modeOptions" :key="o.value" :value="o.value">{{ o.label }}</NRadio>
        </NSpace>
      </NRadioGroup>
      <NText depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        <template v-if="groupMode === 'exact'">
          Piece-only: one group per exact purchase cost. Pack/box products are listed separately
          below the groups (not merged).
        </template>
        <template v-else>
          Piece-only products join your cost ranges. Pack/box products stay as independent rows
          (edit Pc / Pack / Box). Outside-range piece products still appear as exact-cost groups.
        </template>
      </NText>

      <div v-if="groupMode === 'ranges'" class="pg-ranges">
        <div v-for="r in customRanges" :key="r.id" class="pg-range-row">
          <NInputNumber
            :value="r.min"
            :min="0"
            size="small"
            placeholder="Min"
            style="width: 120px"
            @update:value="(v) => updateRange(r.id, 'min', v)"
            @keydown.enter.prevent="onRangeEnter"
          />
          <span class="pg-range-sep">to</span>
          <NInputNumber
            :value="r.max"
            :min="0"
            size="small"
            placeholder="Max"
            style="width: 120px"
            @update:value="(v) => updateRange(r.id, 'max', v)"
            @keydown.enter.prevent="onRangeEnter"
          />
          <NButton size="tiny" quaternary type="error" @click="removeRange(r.id)">Remove</NButton>
        </div>
        <NSpace align="center">
          <NButton size="small" secondary @click="addRange">Add range</NButton>
          <NText depth="3" style="font-size: 12px">or press Enter in min/max</NText>
        </NSpace>
      </div>
    </NCard>

    <div class="app-toolbar app-toolbar--tight">
      <NSpace class="app-filter-stack" align="center" wrap>
        <NInput
          v-model:value="search"
          clearable
          placeholder="Search name / product ID"
          style="width: 220px"
        />
        <NSelect
          v-model:value="vendorFilter"
          :options="vendorOptions"
          multiple
          clearable
          filterable
          max-tag-count="responsive"
          placeholder="Vendor"
          style="min-width: 200px; max-width: 320px"
        />
        <NButton :type="moreFiltersCount ? 'warning' : 'default'" @click="showMoreFilters = true">
          More filters{{ moreFiltersCount ? ` (${moreFiltersCount})` : "" }}
        </NButton>
        <NButton :disabled="!supabaseConfigured" :loading="loading" @click="load">Refresh</NButton>
        <ClearFiltersButton v-if="hasActiveFilters" :disabled="false" @clear="clearFilters" />
      </NSpace>
    </div>

    <NDrawer v-model:show="showMoreFilters" :width="360" placement="right">
      <NDrawerContent title="More filters" closable :native-scrollbar="false">
        <div class="pg-more-filters">
          <NSelect
            v-model:value="unitFilter"
            :options="unitFilterOptions"
            placeholder="Unit"
            style="width: 100%"
          />
          <NSwitch v-model:value="activeOnly">
            <template #checked>Active only</template>
            <template #unchecked>Include inactive</template>
          </NSwitch>
          <NSwitch v-model:value="includeZeroStock">
            <template #checked>Include 0 stock</template>
            <template #unchecked>Hide 0 stock</template>
          </NSwitch>
          <NText depth="3" style="font-size: 12px">
            New sale applies to pack price when pack is set, else piece.
          </NText>
        </div>
      </NDrawerContent>
    </NDrawer>

    <div class="pg-sticky" :class="{ 'pg-sticky--pending': summary.changedGroups }">
      <div class="pg-sticky-metrics">
        <div class="pg-sticky-metric">
          <span class="pg-sticky-label">Cost</span>
          <span class="pg-sticky-value">{{ formatPkr(summary.cost) }}</span>
        </div>
        <div class="pg-sticky-metric">
          <span class="pg-sticky-label">Sale</span>
          <span class="pg-sticky-value">{{ formatPkr(summary.sale) }}</span>
          <span v-if="summary.hasDraftDelta" class="pg-sticky-was">
            was {{ formatPkr(summary.saleBefore) }}
          </span>
        </div>
        <div class="pg-sticky-metric">
          <span class="pg-sticky-label">Profit</span>
          <span class="pg-sticky-value" :class="{ 'pg-neg': summary.profit < 0 }">
            {{ formatPkr(summary.profit) }}
          </span>
          <span v-if="summary.hasDraftDelta" class="pg-sticky-was">
            was {{ formatPkr(summary.profitBefore) }}
          </span>
        </div>
        <div class="pg-sticky-metric">
          <span class="pg-sticky-label">Margin</span>
          <span class="pg-sticky-value">
            {{ summary.margin != null ? `${summary.margin}%` : "—" }}
          </span>
        </div>
        <div v-if="summary.changedGroups" class="pg-sticky-metric">
          <span class="pg-sticky-label">Pending</span>
          <span class="pg-sticky-value">
            {{ summary.changedGroups }}
            <span class="pg-sticky-pending-sub">grp</span>
            · {{ summary.changedProducts || 0 }}
            <span class="pg-sticky-pending-sub">prod</span>
          </span>
        </div>
      </div>
      <div class="pg-sticky-actions">
        <NButton size="small" :disabled="!summary.changedGroups" @click="resetDrafts">
          Reset drafts
        </NButton>
        <NButton
          size="small"
          type="primary"
          :disabled="!supabaseConfigured || !summary.changedGroups"
          :loading="saving"
          @click="confirmSave"
        >
          Save{{ summary.changedGroups ? ` (${summary.changedGroups})` : "" }}
        </NButton>
      </div>
    </div>

    <div class="app-table-scroll">
      <NDataTable
        :loading="loading"
        :columns="columns"
        :data="groups"
        :row-key="(r) => r.key"
        :scroll-x="1280"
        size="small"
        :row-class-name="(r) =>
          r.changed
            ? 'pg-row-changed'
            : r.rowType === 'multi'
              ? 'pg-row-multi'
              : r.outsideRange
                ? 'pg-row-outside'
                : ''
        "
      />
    </div>
  </div>
</template>

<style scoped>
.pg-more-filters {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 16px;
}
.pg-sticky {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  margin: 0 0 12px;
  padding: 10px 14px;
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
}
.pg-sticky--pending {
  border-color: var(--app-warning-border, #fb923c);
  background: var(--app-warning-bg-soft, #fff7ed);
}
.pg-sticky-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
  align-items: baseline;
  min-width: 0;
  flex: 1 1 240px;
}
.pg-sticky-metric {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
}
.pg-sticky-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #6b7280;
}
.pg-sticky-value {
  font-size: 1.05rem;
  font-weight: 800;
  color: #111827;
  font-variant-numeric: tabular-nums;
}
.pg-sticky-was {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-warning-accent, #c2410c);
}
.pg-sticky-pending-sub {
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  text-transform: none;
  letter-spacing: 0;
}
.pg-sticky-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  flex: 0 0 auto;
}
.pg-ranges {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.pg-range-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.pg-range-sep {
  color: #6b7280;
  font-size: 13px;
}
.pg-muted {
  color: #9ca3af;
}
.pg-group-label {
  font-weight: 700;
  color: #111827;
}
.pg-group-sub {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 1px;
}
.pg-pos {
  color: #0f766e;
  font-weight: 700;
}
.pg-neg {
  color: #dc2626;
  font-weight: 700;
}
:deep(.pg-row-changed td) {
  background: #fffbeb !important;
}
:deep(.pg-row-outside td) {
  background: #f8fafc !important;
}
:deep(.pg-row-multi td) {
  background: #f0fdfa !important;
}
.pg-multi-drafts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 0;
}
.pg-multi-draft-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pg-multi-draft-label {
  flex: 0 0 64px;
  font-size: 11px;
  font-weight: 700;
  color: #6b7280;
}
:deep(.pg-expand) {
  margin: 4px 8px 12px 36px;
  padding: 10px 12px;
  max-width: 820px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
  display: flex;
  flex-direction: column;
  gap: 0;
}
:deep(.pg-expand-head),
:deep(.pg-expand-row) {
  display: grid;
  grid-template-columns: 100px minmax(120px, 1.3fr) 56px 96px 96px 80px;
  gap: 10px 14px;
  align-items: center;
  font-size: 13px;
  padding: 8px 4px;
}
:deep(.pg-expand-head) {
  font-size: 11px;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 8px;
  margin-bottom: 2px;
}
:deep(.pg-expand-row) {
  border-bottom: 1px solid #eef2f7;
}
:deep(.pg-expand-row:last-of-type) {
  border-bottom: none;
}
:deep(.pg-expand-id) {
  font-weight: 700;
  color: #0f766e;
  font-variant-numeric: tabular-nums;
}
:deep(.pg-expand-name) {
  font-weight: 600;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:deep(.pg-expand-num) {
  font-variant-numeric: tabular-nums;
  color: #374151;
}
:deep(.pg-expand-note) {
  margin-top: 8px;
  font-size: 11px;
  color: #9ca3af;
}
@media (max-width: 900px) {
  .pg-sticky-metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
    width: 100%;
  }
}
@media (max-width: 768px) {
  .pg-sticky {
    top: 0;
    padding: 10px 12px;
  }
  .pg-sticky-actions {
    width: 100%;
  }
  .pg-sticky-actions :deep(.n-button) {
    flex: 1 1 auto;
  }
  :deep(.pg-expand) {
    margin-left: 8px;
    max-width: none;
  }
  :deep(.pg-expand-head),
  :deep(.pg-expand-row) {
    grid-template-columns: 80px 1fr;
    gap: 4px 10px;
  }
  :deep(.pg-expand-head span:nth-child(n + 3)),
  :deep(.pg-expand-row span:nth-child(n + 3)) {
    display: none;
  }
}
</style>
