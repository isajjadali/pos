<script setup>
import { ref, onMounted, computed, h, watch } from "vue";
import {
  NButton,
  NSpace,
  NInput,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NText,
  NTag,
  useMessage,
  useDialog,
} from "naive-ui";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import {
  listCategoriesWithCounts,
  createCategory,
  updateCategory,
  deleteCategory,
  ensureDefaultCategories,
} from "../services/categories.js";
import { rowNumberColumn, tableSorter, paginationTotalPrefix } from "../utils/tableColumns.js";

const message = useMessage();
const dialog = useDialog();

const loading = ref(false);
const seeding = ref(false);
const rows = ref([]);
const search = ref("");
const page = ref(1);
const pageSize = ref(20);

const showEdit = ref(false);
const editingId = ref(null);
const editName = ref("");
const saving = ref(false);
const newName = ref("");

const hasActiveFilters = computed(() => Boolean(search.value.trim()));

function clearFilters() {
  search.value = "";
  page.value = 1;
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((r) => (r.name || "").toLowerCase().includes(q));
});

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filtered.value.slice(start, start + pageSize.value);
});

const columns = computed(() => [
  rowNumberColumn(page, pageSize),
  {
    title: "Category",
    key: "name",
    ellipsis: { tooltip: true },
    ...tableSorter("string", "name"),
  },
  {
    title: "Products",
    key: "product_count",
    width: 120,
    ...tableSorter("number", "product_count"),
    render: (r) =>
      h(
        NTag,
        {
          size: "small",
          type: r.product_count === 0 ? "warning" : "default",
          round: true,
        },
        () => (r.product_count === 0 ? "0 — unused" : String(r.product_count ?? 0))
      ),
  },
  {
    title: "",
    key: "actions",
    width: 160,
    render: (row) =>
      h(NSpace, { size: 6 }, () => [
        h(
          NButton,
          { size: "tiny", secondary: true, onClick: () => openEdit(row) },
          () => "Edit"
        ),
        h(
          NButton,
          {
            size: "tiny",
            type: "error",
            secondary: true,
            disabled: (row.product_count || 0) > 0,
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
    rows.value = await listCategoriesWithCounts();
  } catch (e) {
    message.error(e.message || "Could not load categories");
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  editName.value = "";
  newName.value = "";
  showEdit.value = true;
}

function openEdit(row) {
  editingId.value = row.id;
  editName.value = row.name;
  showEdit.value = true;
}

async function saveModal() {
  const name = editingId.value ? editName.value : newName.value;
  if (!String(name || "").trim()) {
    message.warning("Name is required");
    return;
  }
  saving.value = true;
  try {
    if (editingId.value) {
      await updateCategory(editingId.value, { name });
      message.success("Category updated");
    } else {
      await createCategory(name);
      message.success("Category created");
    }
    showEdit.value = false;
    await load();
  } catch (e) {
    message.error(e.message || "Save failed");
  } finally {
    saving.value = false;
  }
}

function confirmDelete(row) {
  dialog.warning({
    title: "Delete category?",
    content: `Delete “${row.name}”? Only unused categories can be deleted.`,
    positiveText: "Delete",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      try {
        await deleteCategory(row.id);
        message.success("Category deleted");
        await load();
      } catch (e) {
        message.error(e.message || "Delete failed");
      }
    },
  });
}

async function seedDefaults() {
  seeding.value = true;
  try {
    const { added, skipped } = await ensureDefaultCategories();
    message.success(
      added ? `Added ${added} categor${added === 1 ? "y" : "ies"}` : "All default categories already present"
    );
    if (added && skipped) {
      message.info(`${skipped} already existed`);
    }
    await load();
  } catch (e) {
    message.error(e.message || "Could not add default categories");
  } finally {
    seeding.value = false;
  }
}

function onPageChange(p) {
  page.value = p;
}
function onPageSizeChange(s) {
  pageSize.value = s;
  page.value = 1;
}

watch(search, () => {
  page.value = 1;
});

onMounted(async () => {
  await load();
  // First visit: ensure the store list exists
  try {
    const { added } = await ensureDefaultCategories();
    if (added) await load();
  } catch {
    /* ignore seed errors on load */
  }
});
</script>

<template>
  <div class="app-page">
    <h1 style="margin-top: 0">Categories</h1>
    <SupabaseRequiredAlert />
    <NText depth="3" style="display: block; margin-bottom: 16px; font-size: 13px">
      Create, rename, and delete product categories. Unused categories can be deleted. Assign them on
      the Products page.
    </NText>

    <NSpace class="app-filter-stack" style="margin-bottom: 12px" wrap>
      <NInput
        v-model:value="search"
        clearable
        placeholder="Search categories"
        style="width: 240px"
      />
      <ClearFiltersButton :disabled="!hasActiveFilters" @clear="clearFilters" />
      <NButton :disabled="!supabaseConfigured" :loading="loading" @click="load">Refresh</NButton>
      <NButton
        type="primary"
        :disabled="!supabaseConfigured"
        @click="openCreate"
      >
        Add category
      </NButton>
      <NButton
        secondary
        :disabled="!supabaseConfigured"
        :loading="seeding"
        @click="seedDefaults"
      >
        Add default list
      </NButton>
    </NSpace>

    <NDataTable
      :loading="loading"
      :columns="columns"
      :data="paged"
      :row-key="(r) => r.id"
      :scroll-x="640"
      :pagination="{
        page,
        pageSize,
        itemCount: filtered.length,
        showSizePicker: true,
        pageSizes: [10, 20, 50, 100],
        prefix: paginationTotalPrefix,
        onUpdatePage: onPageChange,
        onUpdatePageSize: onPageSizeChange,
      }"
    />

    <NModal
      v-model:show="showEdit"
      preset="card"
      :title="editingId ? 'Edit category' : 'Add category'"
      style="width: min(480px, 96vw)"
    >
      <NForm label-placement="top">
        <NFormItem label="Name" required>
          <NInput
            v-if="editingId"
            v-model:value="editName"
            placeholder="Category name"
            @keydown.enter.prevent="saveModal"
          />
          <NInput
            v-else
            v-model:value="newName"
            placeholder="Category name"
            @keydown.enter.prevent="saveModal"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showEdit = false">Cancel</NButton>
          <NButton type="primary" :loading="saving" @click="saveModal">Save</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
