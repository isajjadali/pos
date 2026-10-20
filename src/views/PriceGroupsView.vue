<script setup>
import { ref, computed, onMounted, h, watch, nextTick } from "vue";
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
  NAlert,
  NRadioGroup,
  NRadio,
  useMessage,
  useDialog,
} from "naive-ui";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { formatPkr, marginPercent } from "../utils/format.js";
import { listActiveVendorOptions } from "../services/vendors.js";
import {
  listProductsForPriceGroups,
  bulkUpdateSellingPrices,
  priceGroupKey,
} from "../services/priceGroups.js";
import { rowNumberColumn, tableSorter } from "../utils/tableColumns.js";
import {
  UNIT_LISTING_FILTER_OPTIONS,
  defaultPosSaleUnit,
  formatProductUnitPrices,
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
const vendorFilter = ref(null);
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

const modeOptions = [
  { label: "Exact purchase cost", value: "exact" },
  { label: "Custom cost ranges", value: "ranges" },
];

function loadRanges() {
  try {
    const raw = localStorage.getItem(RANGES_LS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r, i) => ({
        id: String(r.id || `r${i}`),
        min: Math.max(0, Number(r.min) || 0),
        max: Math.max(0, Number(r.max) || 0),
      }))
      .filter((r) => r.max >= r.min);
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
  if (mode === "ranges" && !customRanges.value.length) {
    addRange();
  }
});

const hasActiveFilters = computed(
  () =>
    Boolean(search.value.trim()) ||
    vendorFilter.value != null ||
    !activeOnly.value ||
    !includeZeroStock.value ||
    unitFilter.value !== "all"
);

function clearFilters() {
  search.value = "";
  vendorFilter.value = null;
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

function productSaleLabel(p) {
  return formatProductUnitPrices(p, { multiline: true });
}

const filteredProducts = computed(() => {
  const q = search.value.trim().toLowerCase();
  return (products.value ?? []).filter((p) => {
    if (!includeZeroStock.value && (Number(p.current_stock) || 0) <= 0) return false;
    if (vendorFilter.value && p.vendor_id !== vendorFilter.value) return false;
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

function buildGroupBuckets() {
  /** @type {Map<string, { key: string, label: string, sortKey: number, purchaseCost: number|null, rangeMin: number|null, rangeMax: number|null, products: any[] }>} */
  const map = new Map();

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
    for (const p of filteredProducts.value) {
      const cost = productCost(p);
      const band = findRangeForCost(cost);
      if (band) {
        map.get(`range:${band.id}`)?.products.push(p);
        continue;
      }
      // Outside custom ranges → each exact purchase cost is its own editable group
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

  // Exact purchase cost
  for (const p of filteredProducts.value) {
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

function defaultDraftForGroup(productsInGroup) {
  if (!productsInGroup.length) return 0;
  const first = productSale(productsInGroup[0]);
  const allSame = productsInGroup.every((p) => nearlyEqual(productSale(p), first));
  return allSame ? first : first;
}

const groups = computed(() => {
  const buckets = buildGroupBuckets();

  const list = buckets.map((g) => {
    const baseline = defaultDraftForGroup(g.products);
    const draftRaw = drafts.value[g.key];
    const hasExplicitDraft = draftRaw != null && Number.isFinite(Number(draftRaw));
    const draftPrice = hasExplicitDraft ? money(draftRaw) : baseline;

    let qty = 0;
    let costValue = 0;
    let saleValueBefore = 0;
    let saleValue = 0;
    let belowCostCount = 0;
    let needsUpdateCount = 0;
    const salePrices = new Set();

    for (const p of g.products) {
      const stock = Math.max(0, Number(p.current_stock) || 0);
      const cost = productCost(p);
      const sale = productSale(p);
      salePrices.add(priceGroupKey(sale));
      qty += stock;
      costValue += stock * cost;
      saleValueBefore += stock * sale;
      saleValue += stock * draftPrice;
      if (draftPrice + 0.009 < cost) belowCostCount += 1;
      if (!nearlyEqual(sale, draftPrice)) needsUpdateCount += 1;
    }

    costValue = money(costValue);
    saleValue = money(saleValue);
    saleValueBefore = money(saleValueBefore);
    const profit = money(saleValue - costValue);
    const profitBefore = money(saleValueBefore - costValue);
    const mixedSales = salePrices.size > 1;
    const changed = hasExplicitDraft && needsUpdateCount > 0;
    const saleSort = g.products.length
      ? Math.min(...g.products.map((p) => productSale(p)))
      : 0;
    const profitSort = changed ? profit : profitBefore;

    return {
      ...g,
      draftPrice,
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
      saleSort,
      profitSort,
      saleLabel: mixedSales
        ? "Mixed"
        : g.products.length
          ? productSaleLabel(g.products[0])
          : "—",
      saleLabelMulti:
        !mixedSales &&
        g.products.length > 0 &&
        (productHasPack(g.products[0]) || productHasBox(g.products[0])),
    };
  });

  list.sort((a, b) => a.sortKey - b.sortKey);
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

function bumpGroup(group, pct) {
  const base = group.draftPrice;
  setDraft(group.key, money(base * (1 + pct / 100)));
}

function roundGroup(group, step) {
  const s = Math.max(1, Number(step) || 10);
  setDraft(group.key, Math.round(group.draftPrice / s) * s);
}

function resetDrafts() {
  drafts.value = {};
  message.info("Draft sale prices cleared");
}

function addRange() {
  const last = customRanges.value[customRanges.value.length - 1];
  const min = last ? money(last.max) : 0;
  const max = money(min + 100);
  const id = `r${Date.now()}`;
  customRanges.value = [...customRanges.value, { id, min, max }];
  nextTick(() => {
    const rows = document.querySelectorAll(".pg-range-row");
    const lastRow = rows[rows.length - 1];
    const input = lastRow?.querySelector("input");
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
  customRanges.value = customRanges.value.filter((r) => r.id !== id);
  drafts.value = {};
}

function updateRange(id, field, value) {
  customRanges.value = customRanges.value.map((r) =>
    r.id === id ? { ...r, [field]: Math.max(0, Number(value) || 0) } : r
  );
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
    message.warning("Set a new sale price on a group first (then save)");
    return;
  }
  const below = changed.reduce((s, g) => s + g.belowCostCount, 0);
  const productCount = changed.reduce((s, g) => s + g.needsUpdateCount, 0);
  dialog.warning({
    title: "Save sale prices for groups?",
    content: () =>
      h("div", [
        h(
          "p",
          `Set selling price on ${productCount} product(s) across ${changed.length} purchase-cost group(s).`
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
      for (const p of g.products) {
        if (!nearlyEqual(productSale(p), g.draftPrice)) {
          updates.push({
            id: p.id,
            selling_price: g.draftPrice,
            target_unit: defaultPosSaleUnit(p),
          });
        }
      }
    }
    const { updated } = await bulkUpdateSellingPrices(updates);
    message.success(`Updated ${updated} product(s)`);
    drafts.value = {};
    await load();
  } catch (e) {
    message.error(e.message || "Save failed");
  } finally {
    saving.value = false;
  }
}

const columns = computed(() => [
  rowNumberColumn(1, 5000),
  {
    type: "expand",
    renderExpand: (row) => {
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
        const multi = productHasPack(p) || productHasBox(p);
        const m = marginPercent(row.draftPrice, cost);
        const below = row.draftPrice + 0.009 < cost;
        return h("div", { class: "pg-expand-row", key: p.id }, [
          h("span", { class: "pg-expand-id" }, p.external_product_id || "—"),
          h("span", { class: "pg-expand-name", title: p.name }, p.name || "—"),
          h("span", { class: "pg-expand-num" }, String(stock)),
          h("span", { class: "pg-expand-num" }, formatPkr(cost)),
          h(
            "span",
            {
              class: ["pg-expand-num", multi ? "pg-expand-sale-multi" : ""],
              style: multi ? "white-space: pre-line; font-size: 12px; line-height: 1.35" : undefined,
            },
            productSaleLabel(p)
          ),
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
        "* Margin uses draft new sale price vs each product’s purchase cost"
      );
      return h("div", { class: "pg-expand" }, [head, ...body, note]);
    },
  },
  {
    title: "Purchase group",
    key: "sortKey",
    width: 160,
    ellipsis: { tooltip: true },
    ...tableSorter("number", "sortKey"),
    render: (r) =>
      h("div", [
        h("span", { class: "pg-group-label" }, r.label),
        r.outsideRange
          ? h("div", { class: "pg-group-sub" }, "Outside your ranges")
          : null,
      ]),
  },
  {
    title: "Sale now",
    key: "saleSort",
    width: 140,
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
    width: 140,
    ...tableSorter("number", "draftPrice"),
    render: (row) =>
      h(NInputNumber, {
        value: row.draftPrice,
        min: 0,
        size: "small",
        style: "width: 100%",
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

onMounted(load);
</script>

<template>
  <div class="app-page">
    <h1 style="margin-top: 0">Price groups</h1>
    <SupabaseRequiredAlert />
    <NText depth="3" style="display: block; margin-bottom: 12px; font-size: 13px">
      Groups are based on <strong>purchase cost</strong> (avg cost), not sale price. Set
      <strong>New sale price</strong> on a group to preview profit, then save to apply that sale
      price to every product in the group.
    </NText>

    <div class="pg-cards">
      <NCard size="small" class="pg-card">
        <div class="pg-card-label">Stock at cost</div>
        <div class="pg-card-value">{{ formatPkr(summary.cost) }}</div>
        <div class="pg-card-hint">On-hand × purchase cost</div>
      </NCard>
      <NCard size="small" class="pg-card">
        <div class="pg-card-label">Stock at sale</div>
        <div class="pg-card-value">{{ formatPkr(summary.sale) }}</div>
        <div v-if="summary.hasDraftDelta" class="pg-card-delta">
          was {{ formatPkr(summary.saleBefore) }}
        </div>
        <div class="pg-card-hint">On-hand × draft / current sale</div>
      </NCard>
      <NCard size="small" class="pg-card">
        <div class="pg-card-label">Potential profit</div>
        <div class="pg-card-value" :class="{ 'pg-neg': summary.profit < 0 }">
          {{ formatPkr(summary.profit) }}
        </div>
        <div v-if="summary.hasDraftDelta" class="pg-card-delta">
          was {{ formatPkr(summary.profitBefore) }}
        </div>
        <div class="pg-card-hint">Sale value − cost value</div>
      </NCard>
      <NCard size="small" class="pg-card">
        <div class="pg-card-label">Margin</div>
        <div class="pg-card-value">
          {{ summary.margin != null ? `${summary.margin}%` : "—" }}
        </div>
        <div class="pg-card-hint">Profit ÷ sale value</div>
      </NCard>
    </div>

    <NCard size="small" title="How to group" style="margin-bottom: 12px">
      <NRadioGroup v-model:value="groupMode" name="group_mode">
        <NSpace>
          <NRadio v-for="o in modeOptions" :key="o.value" :value="o.value">{{ o.label }}</NRadio>
        </NSpace>
      </NRadioGroup>
      <NText depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        <template v-if="groupMode === 'exact'">
          One group per exact purchase cost (e.g. all products bought at Rs 50 together). Expand to
          see each product’s current sale price.
        </template>
        <template v-else>
          Define ranges (e.g. Rs 30–150, Rs 150–200). Matching products join those bands; anything
          outside still appears as separate exact-cost groups (editable & savable) below.
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

    <NAlert
      v-if="summary.changedGroups"
      type="warning"
      style="margin-bottom: 12px"
      :bordered="false"
    >
      {{ summary.changedGroups }} group(s) · {{ summary.changedProducts }} product(s) pending save —
      stock at sale {{ formatPkr(summary.saleBefore) }} → {{ formatPkr(summary.sale) }}
    </NAlert>

    <NSpace class="app-filter-stack" style="margin-bottom: 16px" wrap>
      <NInput
        v-model:value="search"
        clearable
        placeholder="Search name / product ID"
        style="width: 220px"
      />
      <NSelect
        v-model:value="vendorFilter"
        :options="vendorOptions"
        clearable
        filterable
        placeholder="Vendor"
        style="width: 200px"
      />
      <NSelect
        v-model:value="unitFilter"
        :options="unitFilterOptions"
        placeholder="Unit"
        style="width: 150px"
      />
      <NSwitch v-model:value="activeOnly">
        <template #checked>Active only</template>
        <template #unchecked>Include inactive</template>
      </NSwitch>
      <NSwitch v-model:value="includeZeroStock">
        <template #checked>Include 0 stock</template>
        <template #unchecked>Hide 0 stock</template>
      </NSwitch>
      <NText depth="3" style="font-size: 12px; max-width: 280px">
        New sale applies to pack price when pack is set, else piece.
      </NText>
      <ClearFiltersButton :disabled="!hasActiveFilters" @clear="clearFilters" />
      <NButton :disabled="!supabaseConfigured" :loading="loading" @click="load">Refresh</NButton>
      <NButton :disabled="!summary.changedGroups" @click="resetDrafts">Reset drafts</NButton>
      <NButton
        type="primary"
        :disabled="!supabaseConfigured || !summary.changedGroups"
        :loading="saving"
        @click="confirmSave"
      >
        Save changed groups{{ summary.changedGroups ? ` (${summary.changedGroups})` : "" }}
      </NButton>
    </NSpace>

    <div class="app-table-scroll">
      <NDataTable
        :loading="loading"
        :columns="columns"
        :data="groups"
        :row-key="(r) => r.key"
        :scroll-x="1180"
        size="small"
        :row-class-name="(r) => (r.changed ? 'pg-row-changed' : r.outsideRange ? 'pg-row-outside' : '')"
      />
    </div>
  </div>
</template>

<style scoped>
.pg-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.pg-card {
  background: linear-gradient(160deg, #fff 0%, #f8fafc 100%);
}
.pg-card-label {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.pg-card-value {
  font-size: 1.35rem;
  font-weight: 800;
  color: #111827;
  margin-top: 4px;
  line-height: 1.2;
}
.pg-card-hint {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
}
.pg-card-delta {
  font-size: 12px;
  color: #b45309;
  font-weight: 600;
  margin-top: 2px;
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
  .pg-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 768px) {
  .pg-cards {
    grid-template-columns: 1fr;
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
