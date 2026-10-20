<script setup>
import { ref, computed, watch, nextTick } from "vue";
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
  useMessage,
} from "naive-ui";
import { formatPkr } from "../utils/format.js";
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

const vendorName = computed(
  () => props.vendorOptions.find((o) => o.value === vendorId.value)?.label || ""
);

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
  ];
});

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
    style="width: min(960px, 96vw)"
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
          <span>Product ID</span>
          <span>Name</span>
          <span>Qty pcs</span>
          <span>Purchase</span>
          <span>Pack pcs</span>
          <span>Sale</span>
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
              @keydown.enter.prevent="onEnter(rowIndex, 0)"
            />
          </div>
          <div :data-bulk-row="rowIndex" :data-bulk-col="1">
            <NInput
              v-model:value="row.name"
              placeholder="Product name"
              size="small"
              @keydown.enter.prevent="onEnter(rowIndex, 1)"
            />
          </div>
          <div :data-bulk-row="rowIndex" :data-bulk-col="2">
            <NInputNumber
              v-model:value="row.initial_qty"
              :min="0"
              :precision="0"
              size="small"
              style="width: 100%"
              @keydown.enter.prevent="onEnter(rowIndex, 2)"
            />
          </div>
          <div :data-bulk-row="rowIndex" :data-bulk-col="3">
            <NInputNumber
              v-model:value="row.purchase_price"
              :min="0"
              size="small"
              style="width: 100%"
              @keydown.enter.prevent="onEnter(rowIndex, 3)"
            />
          </div>
          <div :data-bulk-row="rowIndex" :data-bulk-col="4">
            <NInputNumber
              v-model:value="row.pieces_per_pack"
              :min="1"
              :precision="0"
              size="small"
              style="width: 100%"
              @keydown.enter.prevent="onEnter(rowIndex, 4)"
            />
          </div>
          <div :data-bulk-row="rowIndex" :data-bulk-col="5">
            <NInputNumber
              v-model:value="row.selling_price"
              :min="0"
              size="small"
              style="width: 100%"
              @keydown.enter.prevent="onEnter(rowIndex, 5)"
            />
          </div>
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
  grid-template-columns: 100px 1fr 64px 88px 64px 88px 36px;
  gap: 8px;
  align-items: center;
}
.bulk-create-head {
  font-size: 12px;
  font-weight: 600;
  color: var(--n-text-color-3);
  position: sticky;
  top: 0;
  background: var(--n-color);
  padding-bottom: 4px;
  z-index: 1;
}
</style>
