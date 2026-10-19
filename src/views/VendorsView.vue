<script setup>
import { ref, onMounted, watch, h, computed } from "vue";
import {
  NButton,
  NSpace,
  NInput,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NSwitch,
  NTag,
  NSelect,
  NAlert,
  useMessage,
  useDialog,
} from "naive-ui";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import {
  createVendor,
  listVendorsWithProductCounts,
  updateVendor,
  deleteVendor,
} from "../services/vendors.js";
import { rowNumberColumn, tableSorter } from "../utils/tableColumns.js";
import { toTitleCase } from "../utils/titleCase.js";
import { useRouteQuerySync, routeQuery } from "../composables/useRouteQuerySync.js";

const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const search = ref("");
const activeOnly = ref(false);
const productFilter = ref("all");
const sortKey = ref(null);
const sortOrder = ref(null);
const hasActiveFilters = computed(
  () =>
    Boolean(search.value.trim()) ||
    productFilter.value !== "all" ||
    activeOnly.value ||
    sortKey.value ||
    sortOrder.value
);
function clearFilters() {
  search.value = "";
  productFilter.value = "all";
  activeOnly.value = false;
  sortKey.value = null;
  sortOrder.value = null;
  page.value = 1;
}
const summary = ref({ vendorTotal: 0, withProducts: 0, withoutProducts: 0 });

let loadFromQuery = () => {};
const { routeSyncing } = useRouteQuerySync(
  {
    q: { ...routeQuery.string(search), debounceMs: 300 },
    page: routeQuery.positiveInt(page, 1),
    pageSize: routeQuery.positiveInt(pageSize, 20),
    products: routeQuery.enumValue(productFilter, "all", ["all", "none", "has"]),
    active: routeQuery.booleanFlag(activeOnly, false),
    sort: routeQuery.optionalString(sortKey),
    order: routeQuery.optionalString(sortOrder),
  },
  { onApplied: () => loadFromQuery() }
);
const checkedRowKeys = ref([]);

const productFilterOptions = [
  { label: "All vendors", value: "all" },
  { label: "No products (safe to delete)", value: "none" },
  { label: "Has products", value: "has" },
];

const showModal = ref(false);
const editingId = ref(null);
const form = ref(emptyForm());
const saving = ref(false);

function emptyForm() {
  return {
    name: "",
    contact_person: "",
    phone: "",
    address: "",
    notes: "",
    is_active: true,
  };
}

const columns = computed(() => [
  rowNumberColumn(page, pageSize),
  { type: "selection" },
  { title: "Name", key: "name", ...tableSorter("string", "name") },
  {
    title: "Products",
    key: "product_count",
    width: 120,
    ...tableSorter("number", "product_count"),
    render: (row) =>
      h(
        NTag,
        {
          size: "small",
          type: row.product_count === 0 ? "warning" : "default",
          round: true,
        },
        () => (row.product_count === 0 ? "0 — unused" : String(row.product_count))
      ),
  },
  { title: "Contact", key: "contact_person", ...tableSorter("string", "contact_person") },
  { title: "Phone", key: "phone", ...tableSorter("string", "phone") },
  {
    title: "Status",
    key: "is_active",
    ...tableSorter("boolean", "is_active"),
    render: (row) =>
      h(NTag, { type: row.is_active ? "success" : "default", size: "small" }, () =>
        row.is_active ? "Active" : "Inactive"
      ),
  },
  {
    title: "Actions",
    key: "actions",
    width: 160,
    render: (row) =>
      h(NSpace, { size: 4 }, () => [
        h(NButton, { size: "small", onClick: () => openEdit(row) }, () => "Edit"),
        h(
          NButton,
          {
            size: "small",
            type: "error",
            disabled: row.product_count > 0,
            onClick: () => confirmDelete(row),
          },
          () => "Delete"
        ),
      ]),
  },
]);

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    const res = await listVendorsWithProductCounts({
      search: search.value,
      activeOnly: activeOnly.value,
      productFilter: productFilter.value,
      page: page.value,
      pageSize: pageSize.value,
      sortKey: sortKey.value,
      sortOrder: sortOrder.value,
    });
    rows.value = res.rows;
    total.value = res.total;
    if (res.summary) summary.value = res.summary;
  } catch (e) {
    message.error(e.message || "Failed to load vendors");
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  showModal.value = true;
}

function openEdit(row) {
  editingId.value = row.id;
  form.value = {
    name: row.name,
    contact_person: row.contact_person || "",
    phone: row.phone || "",
    address: row.address || "",
    notes: row.notes || "",
    is_active: row.is_active,
  };
  showModal.value = true;
}

function confirmDelete(row) {
  dialog.error({
    title: "Delete vendor?",
    content: `"${row.name}" only deletes if no products are linked to this vendor.`,
    positiveText: "Delete",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      try {
        await deleteVendor(row.id);
        message.success("Vendor deleted");
        checkedRowKeys.value = checkedRowKeys.value.filter((id) => id !== row.id);
        await load();
      } catch (e) {
        message.error(e.message || "Delete failed");
      }
    },
  });
}

function confirmDeleteSelected() {
  const ids = checkedRowKeys.value;
  if (!ids.length) return message.warning("Select vendors first");
  dialog.error({
    title: "Delete selected vendors?",
    content: `${ids.length} vendor(s). Each is skipped if products are still linked.`,
    positiveText: "Delete",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      let ok = 0;
      const errors = [];
      for (const id of ids) {
        try {
          await deleteVendor(id);
          ok += 1;
        } catch (e) {
          errors.push(e.message || "failed");
        }
      }
      if (ok) message.success(`Deleted ${ok} vendor(s)`);
      if (errors.length) message.warning(errors[0]);
      checkedRowKeys.value = [];
      await load();
    },
  });
}

async function save() {
  if (!supabaseConfigured) return;
  form.value.name = toTitleCase(form.value.name);
  form.value.contact_person = form.value.contact_person
    ? toTitleCase(form.value.contact_person)
    : "";
  saving.value = true;
  try {
    if (editingId.value) {
      await updateVendor(editingId.value, form.value);
      message.success("Vendor updated");
    } else {
      await createVendor(form.value);
      message.success("Vendor created");
    }
    showModal.value = false;
    await load();
  } catch (e) {
    message.error(e.message || "Save failed");
  } finally {
    saving.value = false;
  }
}

function onTableSorterUpdate(sorter) {
  sortKey.value = sorter?.columnKey ?? null;
  sortOrder.value = sorter?.order ?? null;
  page.value = 1;
}

function onPageChange(p) {
  page.value = p;
}

function onPageSizeChange(s) {
  pageSize.value = s;
  page.value = 1;
}
let searchTimer;
watch(search, () => {
  if (routeSyncing.value) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    load();
  }, 300);
});
watch(activeOnly, () => {
  if (routeSyncing.value) return;
  page.value = 1;
  load();
});
watch(productFilter, () => {
  if (routeSyncing.value) return;
  page.value = 1;
  load();
});
watch([page, pageSize, sortKey, sortOrder], () => {
  if (routeSyncing.value) return;
  load();
});

loadFromQuery = load;

onMounted(load);
</script>

<template>
  <div>
    <h1 style="margin-top: 0">Vendors</h1>
    <SupabaseRequiredAlert />
    <NAlert
      v-if="supabaseConfigured && summary.withoutProducts > 0"
      type="info"
      style="margin-bottom: 12px"
    >
      {{ summary.withoutProducts }} vendor(s) have no products — use filter
      <strong>No products (safe to delete)</strong> to clean up unused vendors.
    </NAlert>
    <NSpace class="app-filter-stack" style="margin-bottom: 16px" wrap>
      <NInput v-model:value="search" placeholder="Search vendor name" clearable style="width: 260px" />
      <NSelect
        v-model:value="productFilter"
        :options="productFilterOptions"
        style="width: 240px"
      />
      <NSwitch v-model:value="activeOnly">
        <template #checked>Active only</template>
        <template #unchecked>All vendors</template>
      </NSwitch>
      <ClearFiltersButton :disabled="!hasActiveFilters" @clear="clearFilters" />
      <NButton type="primary" :disabled="!supabaseConfigured" @click="openCreate">Add vendor</NButton>
      <NButton
        type="error"
        :disabled="!supabaseConfigured || !checkedRowKeys.length"
        @click="confirmDeleteSelected"
      >
        Delete selected{{ checkedRowKeys.length ? ` (${checkedRowKeys.length})` : "" }}
      </NButton>
      <NButton :disabled="!supabaseConfigured" @click="load">Refresh</NButton>
    </NSpace>
    <NDataTable
      v-model:checked-row-keys="checkedRowKeys"
      :row-key="(r) => r.id"
      :loading="loading"
      :columns="columns"
      :data="rows"
      :scroll-x="720"
      :remote="true"
      @update:sorter="onTableSorterUpdate"
      :pagination="{
        page,
        pageSize,
        itemCount: total,
        showSizePicker: true,
        pageSizes: [10, 20, 50],
        onUpdatePage: onPageChange,
        onUpdatePageSize: onPageSizeChange,
      }"
    />
    <NModal
      v-model:show="showModal"
      preset="card"
      :title="editingId ? 'Edit vendor' : 'Add vendor'"
      style="width: min(720px, 96vw)"
    >
      <NForm label-placement="top" class="vendor-form-grid">
        <NFormItem label="Vendor name" required class="span-2">
          <NInput v-model:value="form.name" />
        </NFormItem>
        <NFormItem label="Contact person">
          <NInput v-model:value="form.contact_person" />
        </NFormItem>
        <NFormItem label="Phone">
          <NInput v-model:value="form.phone" />
        </NFormItem>
        <NFormItem label="Address" class="span-2">
          <NInput v-model:value="form.address" type="textarea" :rows="2" />
        </NFormItem>
        <NFormItem label="Notes" class="span-2">
          <NInput v-model:value="form.notes" type="textarea" :rows="2" />
        </NFormItem>
        <NFormItem label="Active">
          <NSwitch v-model:value="form.is_active" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showModal = false">Cancel</NButton>
          <NButton type="primary" :loading="saving" @click="save">Save</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.vendor-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 16px;
}
.vendor-form-grid :deep(.n-form-item) {
  margin-bottom: 8px;
}
.span-2 {
  grid-column: span 2;
}
@media (max-width: 600px) {
  .vendor-form-grid {
    grid-template-columns: 1fr;
  }
  .span-2 {
    grid-column: span 1;
  }
}
</style>
