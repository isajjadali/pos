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
import { previewBulkExternalProductIds, createProductsBulk } from "../services/products.js";
import CreatableVendorSelect from "./CreatableVendorSelect.vue";

const props = defineProps({
  show: { type: Boolean, default: false },
  vendorOptions: { type: Array, default: () => [] },
  categoryOptions: { type: Array, default: () => [] },
});

const emit = defineEmits(["update:show", "created", "vendor-created"]);

const message = useMessage();

const step = ref("entry");
const vendorId = ref(null);
const categoryId = ref(null);
const saving = ref(false);
const reviewRows = ref([]);

let rowSeq = 0;
function newDraftRow() {
  return {
    _key: ++rowSeq,
    external_product_id: "",
    name: "",
    initial_qty: 0,
    purchase_price: 0,
    pieces_per_pack: 1,
    selling_price: 0,
  };
}

const draftRows = ref([newDraftRow()]);
/** Last edited cell — used as source for "copy to all rows". */
const lastEdit = ref({ field: null, rowIndex: 0 });

const vendorName = computed(
  () => props.vendorOptions.find((o) => o.value === vendorId.value)?.label || ""
);

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

const filledDraftRows = computed(() =>
  draftRows.value.filter((r) => String(r.name ?? "").trim())
);

function resetForm() {
  step.value = "entry";
  vendorId.value = null;
  categoryId.value = null;
  reviewRows.value = [];
  rowSeq = 0;
  draftRows.value = [newDraftRow()];
}

watch(
  () => props.show,
  (open) => {
    if (open) resetForm();
  }
);

function focusCell(rowIndex, colIndex) {
  nextTick(() => {
    const root = document.querySelector(
      `.bulk-create-grid [data-bulk-row="${rowIndex}"][data-bulk-col="${colIndex}"]`
    );
    const input = root?.querySelector("input");
    input?.focus?.();
    input?.select?.();
  });
}

const COL_COUNT = 6;

function onEnter(rowIndex, colIndex) {
  if (colIndex < COL_COUNT - 1) {
    focusCell(rowIndex, colIndex + 1);
    return;
  }
  const row = draftRows.value[rowIndex];
  if (!String(row.name ?? "").trim()) {
    message.warning("Product name is required before adding another row");
    focusCell(rowIndex, 1);
    return;
  }
  if (rowIndex === draftRows.value.length - 1) {
    draftRows.value.push(newDraftRow());
  }
  focusCell(rowIndex + 1, 0);
}

function removeRow(index) {
  if (draftRows.value.length <= 1) {
    draftRows.value = [newDraftRow()];
    return;
  }
  draftRows.value.splice(index, 1);
}

async function goToReview() {
  const rows = filledDraftRows.value;
  if (!rows.length) {
    message.warning("Add at least one product with a name");
    return;
  }
  if (String(vendorId.value || "").startsWith("__pending__")) {
    message.warning("Wait a moment — new vendor is still being created");
    return;
  }
  const needsVendor = rows.some((r) => !String(r.external_product_id ?? "").trim());
  if (needsVendor && !vendorId.value) {
    message.warning("Select a vendor for auto product IDs (or enter IDs on each row)");
    return;
  }
  try {
    reviewRows.value = await previewBulkExternalProductIds(vendorName.value, rows);
    step.value = "review";
  } catch (e) {
    message.error(e.message || "Could not prepare review");
  }
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
      key: "resolved_external_product_id",
      width: 100,
      render: (row) =>
        row.id_source === "auto"
          ? `${row.resolved_external_product_id} (auto)`
          : row.resolved_external_product_id,
    },
    { title: "Name", key: "name", width: nameW, ellipsis: { tooltip: true } },
    { title: "Qty", key: "initial_qty", width: 70 },
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

async function confirmCreate() {
  if (!reviewRows.value.length) return;
  saving.value = true;
  try {
    const { created, errors } = await createProductsBulk(reviewRows.value, {
      vendorId: vendorId.value,
      vendorName: vendorName.value,
      categoryId: categoryId.value,
    });
    if (created.length) message.success(`Created ${created.length} product(s)`);
    if (errors.length) {
      message.error(
        errors.length === 1
          ? `${errors[0].name}: ${errors[0].message}`
          : `${errors.length} row(s) failed — first: ${errors[0].message}`
      );
    }
    if (created.length) {
      emit("created");
      emit("update:show", false);
    }
  } catch (e) {
    message.error(e.message || "Bulk create failed");
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
    :title="step === 'entry' ? 'Bulk create products' : 'Review bulk create'"
    style="width: min(1120px, 98vw)"
    @update:show="(v) => !v && close()"
  >
    <template v-if="step === 'entry'">
      <NText depth="3" style="display: block; margin-bottom: 12px; font-size: 13px">
        Fill each row and press <strong>Enter</strong> to move across — Enter on sale price adds the
        next row. Leave product ID empty for auto IDs (same as Add product).
      </NText>
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
          placeholder="Category (optional)"
          clearable
          filterable
          style="width: 200px"
        />
      </NSpace>
      <div class="bulk-create-grid">
        <div class="bulk-create-head">
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
              @click="copyFieldToAll('initial_qty')"
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
        <div
          v-for="(row, rowIndex) in draftRows"
          :key="row._key"
          class="bulk-create-row"
        >
          <div :data-bulk-row="rowIndex" :data-bulk-col="0">
            <NInput
              v-model:value="row.external_product_id"
              placeholder="Auto"
              size="small"
              @focus="markEdit('external_product_id', rowIndex)"
              @update:value="markEdit('external_product_id', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 0)"
            />
          </div>
          <div :data-bulk-row="rowIndex" :data-bulk-col="1">
            <NInput
              v-model:value="row.name"
              placeholder="Product name"
              size="small"
              @focus="markEdit('name', rowIndex)"
              @update:value="markEdit('name', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 1)"
            />
          </div>
          <div :data-bulk-row="rowIndex" :data-bulk-col="2">
            <NInputNumber
              v-model:value="row.initial_qty"
              :min="0"
              :precision="0"
              :show-button="false"
              size="small"
              style="width: 100%"
              @focus="markEdit('initial_qty', rowIndex)"
              @update:value="markEdit('initial_qty', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 2)"
            />
          </div>
          <div :data-bulk-row="rowIndex" :data-bulk-col="3">
            <NInputNumber
              v-model:value="row.purchase_price"
              :min="0"
              :show-button="false"
              size="small"
              style="width: 100%"
              @focus="markEdit('purchase_price', rowIndex)"
              @update:value="markEdit('purchase_price', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 3)"
            />
          </div>
          <div :data-bulk-row="rowIndex" :data-bulk-col="4">
            <NInputNumber
              v-model:value="row.pieces_per_pack"
              :min="1"
              :precision="0"
              :show-button="false"
              size="small"
              style="width: 100%"
              @focus="markEdit('pieces_per_pack', rowIndex)"
              @update:value="markEdit('pieces_per_pack', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 4)"
            />
          </div>
          <div :data-bulk-row="rowIndex" :data-bulk-col="5">
            <NInputNumber
              v-model:value="row.selling_price"
              :min="0"
              :show-button="false"
              size="small"
              style="width: 100%"
              @focus="markEdit('selling_price', rowIndex)"
              @update:value="markEdit('selling_price', rowIndex)"
              @keydown.enter.prevent="onEnter(rowIndex, 5)"
            />
          </div>
          <span
            class="bulk-margin"
            :class="{ 'bulk-margin--neg': rowMarginNeg(row) }"
            title="Gross margin (default unit)"
          >
            {{ rowMarginLabel(row) }}
          </span>
          <NButton
            quaternary
            size="tiny"
            type="error"
            :disabled="draftRows.length <= 1 && !row.name"
            @click="removeRow(rowIndex)"
          >
            ×
          </NButton>
        </div>
      </div>
      <NSpace justify="end" style="margin-top: 16px">
        <NButton @click="draftRows.push(newDraftRow())">Add row</NButton>
        <NButton @click="close">Cancel</NButton>
        <NButton type="primary" @click="goToReview">Review & create</NButton>
      </NSpace>
    </template>

    <template v-else>
      <NAlert type="info" style="margin-bottom: 12px">
        {{ reviewRows.length }} product(s) will be created for
        <strong>{{ vendorName || "—" }}</strong
        >. Barcodes are assigned automatically.
      </NAlert>
      <NDataTable
        :columns="reviewColumns"
        :data="reviewRows"
        :row-key="(_row, index) => index"
        size="small"
        :bordered="true"
      />
      <NSpace justify="end" style="margin-top: 16px">
        <NButton :disabled="saving" @click="backToEntry">Back</NButton>
        <NButton type="primary" :loading="saving" @click="confirmCreate">
          Create {{ reviewRows.length }} product(s)
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.bulk-create-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(52vh, 420px);
  overflow: auto;
}
.bulk-create-head,
.bulk-create-row {
  display: grid;
  grid-template-columns: 110px minmax(140px, 1fr) 88px 110px 88px 110px 72px 36px;
  gap: 8px;
  align-items: center;
}
.bulk-create-head {
  font-size: 12px;
  font-weight: 650;
  color: #6b7280;
  position: sticky;
  top: 0;
  z-index: 2;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 2px;
  box-shadow: 0 1px 0 #e5e7eb;
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
