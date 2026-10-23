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
/** Last edited cell — used as source for "copy to all rows". */
const lastEdit = ref({ field: null, rowIndex: 0 });

function markEdit(field, rowIndex) {
  lastEdit.value = { field, rowIndex };
}

function copyFieldToAll(field) {
  const rows = draftRows.value;
  if (!rows.length) return;
  let src = lastEdit.value.field === field ? lastEdit.value.rowIndex : 0;
  if (src < 0 || src >= rows.length) src = 0;
  const value = rows[src][field];
  for (const row of rows) {
    row[field] = value;
  }
  message.success(`Copied to all ${rows.length} row(s)`);
}

function productToDraft(p) {
  return {
    id: p.id,
    external_product_id: p.external_product_id || "",
    name: p.name || "",
    current_stock: Math.max(0, Math.floor(Number(p.current_stock) || 0)),
    stock_at_open: Math.max(0, Math.floor(Number(p.current_stock) || 0)),
    purchase_price: Number(p.weighted_avg_cost) || 0,
    selling_price: Number(p.selling_price) || 0,
    pieces_per_pack: Math.max(1, Math.floor(Number(p.pieces_per_pack) || 1)),
    pieces_per_box: p.pieces_per_box ?? null,
    piece_selling_price: Number(p.piece_selling_price ?? p.selling_price) || 0,
    pack_selling_price: Number(p.pack_selling_price ?? p.selling_price) || 0,
    box_selling_price: p.box_selling_price != null ? Number(p.box_selling_price) : null,
    default_sale_unit: p.default_sale_unit || "piece",
    sku: p.sku || null,
    barcode: p.barcode || "",
    vendor_id: p.vendor_id || null,
    category_id: p.category_id || null,
    low_stock_threshold: Math.max(0, Math.floor(Number(p.low_stock_threshold) || 5)),
    is_active: p.is_active !== false,
  };
}

function resetFromProducts() {
  step.value = "entry";
  vendorId.value = null;
  categoryId.value = null;
  reviewRows.value = [];
  draftRows.value = (props.products || []).map(productToDraft);
}

watch(
  () => props.show,
  (open) => {
    if (open) resetFromProducts();
  }
);

const vendorName = computed(
  () => props.vendorOptions.find((o) => o.value === vendorId.value)?.label || ""
);

function focusCell(rowIndex, colIndex) {
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

function onEnter(rowIndex, colIndex) {
  if (colIndex < COL_COUNT - 1) {
    focusCell(rowIndex, colIndex + 1);
    return;
  }
  if (rowIndex < draftRows.value.length - 1) {
    focusCell(rowIndex + 1, 0);
  }
}

function removeRow(index) {
  draftRows.value.splice(index, 1);
}

function goToReview() {
  if (!draftRows.value.length) {
    message.warning("No products to update");
    return;
  }
  if (String(vendorId.value || "").startsWith("__pending__")) {
    message.warning("Wait a moment — new vendor is still being created");
    return;
  }
  for (const row of draftRows.value) {
    if (!String(row.name ?? "").trim()) {
      message.warning("Every row needs a product name");
      return;
    }
  }
  const ids = draftRows.value.map((r) => String(r.external_product_id ?? "").trim().toLowerCase());
  const filled = ids.filter(Boolean);
  if (new Set(filled).size !== filled.length) {
    message.warning("Duplicate Product IDs in the list");
    return;
  }
  reviewRows.value = draftRows.value.map((r) => {
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
        Edit the selected products. Same fields as bulk create — press
        <strong>Enter</strong> to move across cells. Qty sets on-hand stock; Purchase is avg cost.
      </NText>
      <NAlert v-if="!draftRows.length" type="warning" style="margin-bottom: 12px">
        No products selected. Close and select rows in the table first.
      </NAlert>
      <NSpace style="margin-bottom: 12px" wrap>
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
      </NSpace>
      <div class="bulk-edit-grid">
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
        <div v-for="(row, rowIndex) in draftRows" :key="row.id" class="bulk-edit-row">
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
      <NSpace justify="end" style="margin-top: 16px">
        <NButton @click="close">Cancel</NButton>
        <NButton type="primary" :disabled="!draftRows.length" @click="goToReview">
          Review & update
        </NButton>
      </NSpace>
    </template>

    <template v-else>
      <NAlert type="info" style="margin-bottom: 12px">
        {{ reviewRows.length }} product(s) will be updated
        <template v-if="vendorId || categoryId">
          —
          <template v-if="vendorId"> vendor <strong>{{ vendorName }}</strong></template>
          <template v-if="vendorId && categoryId">,</template>
          <template v-if="categoryId"> category applied to all</template>
        </template>
        .
      </NAlert>
      <NDataTable
        :columns="reviewColumns"
        :data="reviewRows"
        :row-key="(row) => row.id"
        size="small"
        :bordered="true"
      />
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
.bulk-edit-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(52vh, 420px);
  overflow: auto;
}
.bulk-edit-head,
.bulk-edit-row {
  display: grid;
  grid-template-columns: 100px 120px minmax(120px, 1fr) 80px 100px 80px 100px 72px 36px;
  gap: 8px;
  align-items: center;
}
.bulk-edit-head {
  font-size: 12px;
  font-weight: 600;
  color: var(--n-text-color-3);
  position: sticky;
  top: 0;
  background: var(--n-color);
  padding-bottom: 4px;
  z-index: 1;
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
  color: var(--n-text-color-3);
  cursor: pointer;
  border-radius: 4px;
  line-height: 1;
  flex-shrink: 0;
}
.bulk-copy-all:hover {
  color: var(--n-primary-color);
  background: var(--n-button-color-2, rgba(0, 0, 0, 0.04));
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
