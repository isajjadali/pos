<script setup>
import { ref, computed, watch, nextTick, h } from "vue";
import {
  NModal,
  NButton,
  NSpace,
  NSelect,
  NInput,
  NInputNumber,
  NDataTable,
  NText,
  NAlert,
  NIcon,
  NSpin,
  useMessage,
} from "naive-ui";
import { ArrowDownOutline } from "@vicons/ionicons5";
import { formatPkr, marginPercent } from "../utils/format.js";
import { fitNameColumnWidth } from "../utils/tableColumns.js";
import { updateProductsBulk } from "../services/products.js";
import CreatableVendorSelect from "./CreatableVendorSelect.vue";

const props = defineProps({
  show: { type: Boolean, default: false },
  products: { type: Array, default: () => [] },
  /** Parent is still paging catalog into `products`. */
  loading: { type: Boolean, default: false },
  vendorOptions: { type: Array, default: () => [] },
  categoryOptions: { type: Array, default: () => [] },
});

const emit = defineEmits(["update:show", "updated", "vendor-created"]);

const message = useMessage();

const step = ref("entry");
const vendorId = ref(null);
const categoryId = ref(null);
const saving = ref(false);
const reviewRows = ref([]);
const draftRows = ref([]);
/** Filter grid by name / barcode / SKU / product ID (local FE only — no API). */
const rowSearch = ref("");
/** Last edited cell — used as source for "copy to all rows". */
const lastEdit = ref({ field: null, rowIndex: 0 });

/**
 * Virtual list: fixed row stride + absolute rows (no flex gap/pads — those caused
 * blank space + blink on small scrolls).
 */
const ROW_H = 44;
const OVERSCAN = 10;
const gridEl = ref(null);
const gridScrollTop = ref(0);
const gridViewportH = ref(480);
let scrollRaf = 0;

function rowSearchHay(row) {
  return [row.name, row.barcode, row.sku, row.external_product_id]
    .map((v) => String(v ?? "").toLowerCase())
    .join("\0");
}

function touchSearchHay(row) {
  row._q = rowSearchHay(row);
  return row;
}

/** All matches (or all rows). Indices are into `draftRows`. */
const visibleDraftRows = computed(() => {
  const q = rowSearch.value.trim().toLowerCase();
  const mapped = draftRows.value.map((row, index) => ({ row, index }));
  if (!q) return mapped;
  return mapped.filter(({ row }) => (row._q || rowSearchHay(row)).includes(q));
});

const windowedDraft = computed(() => {
  const all = visibleDraftRows.value;
  const total = all.length;
  const start = Math.max(0, Math.floor(gridScrollTop.value / ROW_H) - OVERSCAN);
  const count = Math.ceil(gridViewportH.value / ROW_H) + OVERSCAN * 2;
  const end = Math.min(total, start + count);
  return {
    start,
    end,
    bodyH: total * ROW_H,
    rows: all.slice(start, end).map((item, i) => ({
      ...item,
      top: (start + i) * ROW_H,
    })),
  };
});

function onGridScroll(e) {
  const top = e.target.scrollTop;
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    gridScrollTop.value = top;
  });
}

function syncGridViewport() {
  nextTick(() => {
    const el = gridEl.value;
    if (!el) return;
    gridViewportH.value = el.clientHeight || 480;
    gridScrollTop.value = el.scrollTop || 0;
  });
}

watch(rowSearch, () => {
  gridScrollTop.value = 0;
  if (gridEl.value) gridEl.value.scrollTop = 0;
});

function markEdit(field, rowIndex) {
  lastEdit.value = { field, rowIndex };
  const row = draftRows.value[rowIndex];
  if (row && (field === "name" || field === "barcode" || field === "sku" || field === "external_product_id")) {
    touchSearchHay(row);
  }
}

function copyFieldToAll(field) {
  const filtered = Boolean(rowSearch.value.trim());
  const targets = filtered
    ? visibleDraftRows.value.map((v) => v.row)
    : draftRows.value;
  if (!targets.length) return;
  let src = lastEdit.value.field === field ? lastEdit.value.rowIndex : 0;
  if (src < 0 || src >= draftRows.value.length) src = 0;
  const value = draftRows.value[src]?.[field];
  for (const row of targets) {
    row[field] = value;
  }
  message.success(
    filtered
      ? `Copied to ${targets.length} filtered row(s)`
      : `Copied to all ${targets.length} row(s)`
  );
}

function productToDraft(p) {
  const external_product_id = p.external_product_id || "";
  const name = p.name || "";
  const current_stock = Math.max(0, Math.floor(Number(p.current_stock) || 0));
  const purchase_price = Number(p.weighted_avg_cost) || 0;
  const selling_price = Number(p.selling_price) || 0;
  const pieces_per_pack = Math.max(1, Math.floor(Number(p.pieces_per_pack) || 1));
  const barcode = p.barcode || "";
  return touchSearchHay({
    id: p.id,
    external_product_id,
    name,
    current_stock,
    stock_at_open: current_stock,
    purchase_price,
    selling_price,
    pieces_per_pack,
    pieces_per_box: p.pieces_per_box ?? null,
    piece_selling_price: Number(p.piece_selling_price ?? p.selling_price) || 0,
    pack_selling_price: Number(p.pack_selling_price ?? p.selling_price) || 0,
    box_selling_price: p.box_selling_price != null ? Number(p.box_selling_price) : null,
    default_sale_unit: p.default_sale_unit || "piece",
    sku: p.sku || null,
    barcode,
    vendor_id: p.vendor_id || null,
    category_id: p.category_id || null,
    low_stock_threshold: Math.max(0, Math.floor(Number(p.low_stock_threshold) || 5)),
    is_active: p.is_active !== false,
    /** Snapshot for dirty detection — review only lists changed rows. */
    _orig: {
      external_product_id,
      name,
      current_stock,
      purchase_price,
      selling_price,
      pieces_per_pack,
      barcode,
    },
  });
}

function isRowDirty(row) {
  const o = row._orig;
  if (!o) return true;
  return (
    String(row.external_product_id ?? "") !== String(o.external_product_id ?? "") ||
    String(row.barcode ?? "") !== String(o.barcode ?? "") ||
    String(row.name ?? "") !== String(o.name ?? "") ||
    Number(row.current_stock) !== Number(o.current_stock) ||
    Number(row.purchase_price) !== Number(o.purchase_price) ||
    Number(row.pieces_per_pack) !== Number(o.pieces_per_pack) ||
    Number(row.selling_price) !== Number(o.selling_price)
  );
}

function resetFromProducts() {
  step.value = "entry";
  vendorId.value = null;
  categoryId.value = null;
  rowSearch.value = "";
  reviewRows.value = [];
  draftRows.value = (props.products || []).map(productToDraft);
}

function appendProducts(list) {
  if (!list?.length) return;
  const have = new Set(draftRows.value.map((r) => r.id));
  for (const p of list) {
    if (!p?.id || have.has(p.id)) continue;
    have.add(p.id);
    draftRows.value.push(productToDraft(p));
  }
}

watch(
  () => props.show,
  (open) => {
    if (!open) return;
    resetFromProducts();
    syncGridViewport();
  }
);

/** Stream batches into the grid while the modal is already open. */
watch(
  () => props.products,
  (list, prev) => {
    if (!props.show) return;
    const next = list || [];
    const prevLen = Array.isArray(prev) ? prev.length : 0;
    if (next.length > prevLen) {
      appendProducts(next.slice(prevLen));
    } else if (!props.loading && next.length && !draftRows.value.length) {
      draftRows.value = next.map(productToDraft);
    }
  }
);

const vendorName = computed(
  () => props.vendorOptions.find((o) => o.value === vendorId.value)?.label || ""
);

function focusCell(rowIndex, colIndex) {
  const visPos = visibleDraftRows.value.findIndex((v) => v.index === rowIndex);
  if (visPos >= 0 && gridEl.value) {
    const el = gridEl.value;
    const targetTop = visPos * ROW_H;
    const viewBottom = el.scrollTop + el.clientHeight - ROW_H;
    if (targetTop < el.scrollTop || targetTop > viewBottom) {
      el.scrollTop = Math.max(0, targetTop - ROW_H);
      gridScrollTop.value = el.scrollTop;
    }
  }
  nextTick(() => {
    const root = document.querySelector(
      `.bulk-edit-grid [data-bulk-row="${rowIndex}"][data-bulk-col="${colIndex}"]`
    );
    const input = root?.querySelector("input");
    input?.focus?.();
    input?.select?.();
  });
}

const COL_COUNT = 7;

function onEnter(draftIndex, colIndex) {
  const visible = visibleDraftRows.value;
  const visPos = visible.findIndex((v) => v.index === draftIndex);
  if (colIndex < COL_COUNT - 1) {
    focusCell(draftIndex, colIndex + 1);
    return;
  }
  if (visPos >= 0 && visPos < visible.length - 1) {
    focusCell(visible[visPos + 1].index, 0);
  }
}

function removeRow(draftIndex) {
  draftRows.value.splice(draftIndex, 1);
}

function goToReview() {
  if (props.loading) {
    message.warning("Still loading products — wait a moment");
    return;
  }
  if (!draftRows.value.length) {
    message.warning("No products to update");
    return;
  }
  if (String(vendorId.value || "").startsWith("__pending__")) {
    message.warning("Wait a moment — new vendor is still being created");
    return;
  }
  const dirty = draftRows.value.filter(isRowDirty);
  if (!dirty.length) {
    message.warning(
      vendorId.value || categoryId.value
        ? "Edit at least one product — vendor/category apply only to changed rows"
        : "No edits to review"
    );
    return;
  }
  for (const row of dirty) {
    if (!String(row.name ?? "").trim()) {
      message.warning("Every edited row needs a product name");
      return;
    }
  }
  const ids = dirty.map((r) => String(r.external_product_id ?? "").trim().toLowerCase());
  const filled = ids.filter(Boolean);
  if (new Set(filled).size !== filled.length) {
    message.warning("Duplicate Product IDs among edited rows");
    return;
  }
  reviewRows.value = dirty.map((r) => {
    const pack = Math.max(1, Math.floor(Number(r.pieces_per_pack) || 1));
    const sale = Number(r.selling_price) || 0;
    return {
      ...r,
      pieces_per_pack: pack,
      piece_selling_price: sale,
      pack_selling_price: sale,
      default_sale_unit: pack > 1 ? "pack" : r.default_sale_unit || "piece",
    };
  });
  step.value = "review";
}

function backToEntry() {
  step.value = "entry";
}

const reviewColumns = computed(() => {
  const nameW = fitNameColumnWidth(reviewRows.value);
  return [
    { title: "#", key: "_n", width: 44, render: (_row, index) => index + 1 },
    {
      title: "Product ID",
      key: "external_product_id",
      width: 100,
      render: (row) => row.external_product_id || "—",
    },
    {
      title: "Barcode",
      key: "barcode",
      width: 120,
      render: (row) => row.barcode || "—",
    },
    { title: "Name", key: "name", width: nameW, ellipsis: { tooltip: true } },
    { title: "Qty pcs", key: "current_stock", width: 70 },
    {
      title: "Purchase",
      key: "purchase_price",
      width: 100,
      render: (r) => formatPkr(r.purchase_price),
    },
    { title: "Pack pcs", key: "pieces_per_pack", width: 72 },
    {
      title: "Sale",
      key: "selling_price",
      width: 100,
      render: (r) => formatPkr(r.selling_price),
    },
    {
      title: "Gross %",
      key: "margin",
      width: 80,
      render: (r) => {
        const m = marginPercent(r.selling_price, r.purchase_price);
        if (m == null) return "—";
        const below = Number(r.selling_price) + 0.009 < Number(r.purchase_price);
        return h(
          "span",
          { style: below || m < 0 ? "color:#dc2626;font-weight:700" : undefined },
          `${m}%`
        );
      },
    },
  ];
});

function rowMarginLabel(row) {
  const m = marginPercent(row.selling_price, row.purchase_price);
  if (m == null) return "—";
  return `${m}%`;
}

function rowMarginNeg(row) {
  const m = marginPercent(row.selling_price, row.purchase_price);
  if (m == null) return false;
  return m < 0 || Number(row.selling_price) + 0.009 < Number(row.purchase_price);
}

async function confirmUpdate() {
  if (!reviewRows.value.length) return;
  saving.value = true;
  try {
    const { updated, errors } = await updateProductsBulk(reviewRows.value, {
      vendorId: vendorId.value || undefined,
      categoryId: categoryId.value || undefined,
    });
    if (updated.length) message.success(`Updated ${updated.length} product(s)`);
    if (errors.length) {
      message.error(
        errors.length === 1
          ? `${errors[0].name}: ${errors[0].message}`
          : `${errors.length} row(s) failed — first: ${errors[0].message}`
      );
    }
    if (updated.length) {
      emit("updated");
      emit("update:show", false);
    }
  } catch (e) {
    message.error(e.message || "Bulk edit failed");
  } finally {
    saving.value = false;
  }
}

function close() {
  emit("update:show", false);
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="step === 'entry' ? 'Bulk edit products' : 'Review bulk edit'"
    style="width: min(1120px, 98vw)"
    @update:show="(v) => !v && close()"
  >
    <template v-if="step === 'entry'">
      <NText depth="3" style="display: block; margin-bottom: 12px; font-size: 13px">
        Edit products below — press <strong>Enter</strong> to move across cells. Search is local.
        <strong>Review &amp; update</strong> only saves rows you changed (vendor/category apply to
        those). Qty = on-hand; Purchase = avg cost.
      </NText>
      <NAlert v-if="loading" type="info" style="margin-bottom: 12px">
        Loading products in batches… {{ draftRows.length }} loaded so far. You can search/edit rows
        as they appear.
      </NAlert>
      <NAlert v-else-if="!draftRows.length" type="warning" style="margin-bottom: 12px">
        No products loaded. Close and select rows, or use Bulk edit all.
      </NAlert>
      <NSpace style="margin-bottom: 12px" wrap>
        <NInput
          v-model:value="rowSearch"
          clearable
          placeholder="Search name or barcode…"
          style="width: min(320px, 100%)"
        />
        <CreatableVendorSelect
          v-model:value="vendorId"
          :options="vendorOptions"
          placeholder="Vendor — type name, Enter/Tab to create"
          style="width: 280px"
          @vendor-created="(v) => emit('vendor-created', v)"
        />
        <NSelect
          v-model:value="categoryId"
          :options="categoryOptions"
          placeholder="Category (optional — apply to all)"
          clearable
          filterable
          style="width: 240px"
        />
        <NText depth="3" style="font-size: 12px">
          Showing {{ visibleDraftRows.length }} / {{ draftRows.length }}
          <template v-if="loading"> · loading…</template>
        </NText>
      </NSpace>
      <NSpin :show="loading && !draftRows.length">
      <div class="bulk-edit-wrap">
        <div class="bulk-edit-head">
          <span class="bulk-col-head">
            Product ID
            <button
              type="button"
              class="bulk-copy-all"
              title="Copy this column to all rows (uses last edited cell, else first row)"
              @click="copyFieldToAll('external_product_id')"
            >
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="bulk-col-head">
            Barcode
            <button
              type="button"
              class="bulk-copy-all"
              title="Copy this column to all rows"
              @click="copyFieldToAll('barcode')"
            >
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="bulk-col-head">
            Name
            <button
              type="button"
              class="bulk-copy-all"
              title="Copy this column to all rows"
              @click="copyFieldToAll('name')"
            >
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="bulk-col-head">
            Qty pcs
            <button
              type="button"
              class="bulk-copy-all"
              title="Copy this column to all rows"
              @click="copyFieldToAll('current_stock')"
            >
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="bulk-col-head">
            Purchase
            <button
              type="button"
              class="bulk-copy-all"
              title="Copy this column to all rows"
              @click="copyFieldToAll('purchase_price')"
            >
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="bulk-col-head">
            Pack pcs
            <button
              type="button"
              class="bulk-copy-all"
              title="Copy this column to all rows"
              @click="copyFieldToAll('pieces_per_pack')"
            >
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span class="bulk-col-head">
            Sale
            <button
              type="button"
              class="bulk-copy-all"
              title="Copy this column to all rows"
              @click="copyFieldToAll('selling_price')"
            >
              <NIcon :component="ArrowDownOutline" :size="14" />
            </button>
          </span>
          <span title="Gross margin (default unit)">Gross %</span>
          <span />
        </div>
        <div ref="gridEl" class="bulk-edit-grid" @scroll.passive="onGridScroll">
          <div class="bulk-edit-body" :style="{ height: windowedDraft.bodyH + 'px' }">
            <div
              v-for="{ row, index: rowIndex, top } in windowedDraft.rows"
              :key="row.id"
              class="bulk-edit-row"
              :style="{ top: top + 'px' }"
            >
              <div :data-bulk-row="rowIndex" :data-bulk-col="0">
                <NInput
                  v-model:value="row.external_product_id"
                  size="small"
                  @focus="markEdit('external_product_id', rowIndex)"
                  @update:value="markEdit('external_product_id', rowIndex)"
                  @keydown.enter.prevent="onEnter(rowIndex, 0)"
                />
              </div>
              <div :data-bulk-row="rowIndex" :data-bulk-col="1">
                <NInput
                  v-model:value="row.barcode"
                  placeholder="Barcode"
                  size="small"
                  @focus="markEdit('barcode', rowIndex)"
                  @update:value="markEdit('barcode', rowIndex)"
                  @keydown.enter.prevent="onEnter(rowIndex, 1)"
                />
              </div>
              <div :data-bulk-row="rowIndex" :data-bulk-col="2">
                <NInput
                  v-model:value="row.name"
                  placeholder="Product name"
                  size="small"
                  @focus="markEdit('name', rowIndex)"
                  @update:value="markEdit('name', rowIndex)"
                  @keydown.enter.prevent="onEnter(rowIndex, 2)"
                />
              </div>
              <div :data-bulk-row="rowIndex" :data-bulk-col="3">
                <NInputNumber
                  v-model:value="row.current_stock"
                  :min="0"
                  :precision="0"
                  :show-button="false"
                  size="small"
                  style="width: 100%"
                  @focus="markEdit('current_stock', rowIndex)"
                  @update:value="markEdit('current_stock', rowIndex)"
                  @keydown.enter.prevent="onEnter(rowIndex, 3)"
                />
              </div>
              <div :data-bulk-row="rowIndex" :data-bulk-col="4">
                <NInputNumber
                  v-model:value="row.purchase_price"
                  :min="0"
                  :show-button="false"
                  size="small"
                  style="width: 100%"
                  @focus="markEdit('purchase_price', rowIndex)"
                  @update:value="markEdit('purchase_price', rowIndex)"
                  @keydown.enter.prevent="onEnter(rowIndex, 4)"
                />
              </div>
              <div :data-bulk-row="rowIndex" :data-bulk-col="5">
                <NInputNumber
                  v-model:value="row.pieces_per_pack"
                  :min="1"
                  :precision="0"
                  :show-button="false"
                  size="small"
                  style="width: 100%"
                  @focus="markEdit('pieces_per_pack', rowIndex)"
                  @update:value="markEdit('pieces_per_pack', rowIndex)"
                  @keydown.enter.prevent="onEnter(rowIndex, 5)"
                />
              </div>
              <div :data-bulk-row="rowIndex" :data-bulk-col="6">
                <NInputNumber
                  v-model:value="row.selling_price"
                  :min="0"
                  :show-button="false"
                  size="small"
                  style="width: 100%"
                  @focus="markEdit('selling_price', rowIndex)"
                  @update:value="markEdit('selling_price', rowIndex)"
                  @keydown.enter.prevent="onEnter(rowIndex, 6)"
                />
              </div>
              <span
                class="bulk-margin"
                :class="{ 'bulk-margin--neg': rowMarginNeg(row) }"
                :title="'Gross margin (default unit)'"
              >
                {{ rowMarginLabel(row) }}
              </span>
              <NButton quaternary size="tiny" type="error" @click="removeRow(rowIndex)">×</NButton>
            </div>
          </div>
        </div>
      </div>
      </NSpin>
      <NSpace justify="end" style="margin-top: 16px">
        <NButton @click="close">Cancel</NButton>
        <NButton
          type="primary"
          :disabled="!draftRows.length || loading"
          :loading="loading"
          @click="goToReview"
        >
          {{ loading ? `Loading… (${draftRows.length})` : "Review & update" }}
        </NButton>
      </NSpace>
    </template>

    <template v-else>
      <NAlert type="info" style="margin-bottom: 12px">
        {{ reviewRows.length }} edited product(s) will be updated
        <template v-if="vendorId || categoryId">
          —
          <template v-if="vendorId"> vendor <strong>{{ vendorName }}</strong></template>
          <template v-if="vendorId && categoryId">,</template>
          <template v-if="categoryId"> category</template>
          applied to these rows
        </template>
        .
      </NAlert>
      <div class="bulk-review-wrap">
        <NDataTable
          :columns="reviewColumns"
          :data="reviewRows"
          :row-key="(row) => row.id"
          size="small"
          :bordered="true"
          :max-height="420"
        />
      </div>
      <NSpace justify="end" style="margin-top: 16px">
        <NButton :disabled="saving" @click="backToEntry">Back</NButton>
        <NButton type="primary" :loading="saving" @click="confirmUpdate">
          Update {{ reviewRows.length }} product(s)
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.bulk-edit-wrap {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
.bulk-review-wrap {
  max-height: min(55vh, 420px);
  overflow: hidden;
}
.bulk-edit-grid {
  max-height: min(55vh, 480px);
  overflow: auto;
  position: relative;
}
.bulk-edit-body {
  position: relative;
  width: 100%;
}
.bulk-edit-head,
.bulk-edit-row {
  display: grid;
  grid-template-columns: 100px 120px minmax(120px, 1fr) 80px 100px 80px 100px 72px 36px;
  gap: 8px;
  align-items: center;
  padding: 0 8px;
  box-sizing: border-box;
}
.bulk-edit-head {
  font-size: 12px;
  font-weight: 650;
  color: #6b7280;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  height: 40px;
}
.bulk-edit-row {
  position: absolute;
  left: 0;
  right: 0;
  height: 44px;
  padding-top: 4px;
  padding-bottom: 4px;
}
.bulk-col-head {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.bulk-copy-all {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 4px;
  line-height: 1;
  flex-shrink: 0;
}
.bulk-copy-all:hover {
  color: #0f766e;
  background: rgba(15, 118, 110, 0.08);
}
.bulk-margin {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #0f766e;
}
.bulk-margin--neg {
  color: #dc2626;
}
</style>
