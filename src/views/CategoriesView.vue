<script setup>
import { ref, onMounted, onUnmounted, computed, h, watch } from "vue";
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
  NDropdown,
  NButtonGroup,
  NIcon,
  useMessage,
  useDialog,
} from "naive-ui";
import { ChevronDownOutline } from "@vicons/ionicons5";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
import RuleFilterBar from "../components/RuleFilterBar.vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import OfflinePendingBanner from "../components/OfflinePendingBanner.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import {
  listCategoriesWithCounts,
  createCategory,
  updateCategory,
  deleteCategory,
  ensureDefaultCategories,
} from "../services/categories.js";
import {
  rowNumberColumn,
  tableSorter,
  createdAtColumn,
  paginationTotalPrefix,
} from "../utils/tableColumns.js";
import { PRODUCT_CATALOG_UPDATED } from "../services/productCatalog.js";
import { matchesSearch } from "../utils/textSearch.js";
import {
  DATE_RANGE_PRESET_OPTIONS,
  dateRangeFilterActive,
  isTimestampInRange,
  resolveDateRange,
} from "../utils/dateRange.js";
import { matchesCompareOp } from "../utils/productAdvancedFilters.js";
import { COMPARE_OPS, createdDateField, opLabel } from "../utils/ruleFilterOps.js";

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

const createdRangePreset = ref("all");
const createdFrom = ref(null);
const createdTo = ref(null);
const activeOnly = ref(false);
const unusedOnly = ref(false);
const productCountEnabled = ref(false);
const productCountOp = ref("eq");
const productCountN = ref(0);

const ruleFields = computed(() => [
  createdDateField({
    preset: createdRangePreset,
    from: createdFrom,
    to: createdTo,
    dateRangeFilterActive,
    DATE_RANGE_PRESET_OPTIONS,
  }),
  {
    id: "unused",
    label: "Unused category",
    hint: "No products linked (safe to clean up)",
    valueType: "flag",
    occupied: () => unusedOnly.value,
    chipText: () => "Unused category is true",
    getDraft: () => ({}),
    apply: () => {
      unusedOnly.value = true;
      productCountEnabled.value = false;
    },
    clear: () => {
      unusedOnly.value = false;
    },
  },
  {
    id: "productCount",
    label: "Product count",
    valueType: "number",
    ops: COMPARE_OPS,
    defaultNumber: 0,
    occupied: () => productCountEnabled.value,
    chipText: () =>
      `Product count ${opLabel(productCountOp.value)} ${productCountN.value ?? ""}`,
    getDraft: () => ({ op: productCountOp.value, number: productCountN.value }),
    apply: (d) => {
      productCountOp.value = d.op;
      productCountN.value = Math.floor(Number(d.number) || 0);
      productCountEnabled.value = true;
      unusedOnly.value = false;
    },
    clear: () => {
      productCountEnabled.value = false;
    },
  },
  {
    id: "activeOnly",
    label: "Active only",
    hint: "Hide inactive categories",
    valueType: "flag",
    occupied: () => activeOnly.value,
    chipText: () => "Active only is true",
    getDraft: () => ({}),
    apply: () => {
      activeOnly.value = true;
    },
    clear: () => {
      activeOnly.value = false;
    },
  },
]);

const hasActiveFilters = computed(
  () =>
    Boolean(search.value.trim()) ||
    dateRangeFilterActive(createdRangePreset.value, createdFrom.value, createdTo.value) ||
    unusedOnly.value ||
    productCountEnabled.value ||
    activeOnly.value
);

function clearFilters() {
  search.value = "";
  createdRangePreset.value = "all";
  createdFrom.value = null;
  createdTo.value = null;
  activeOnly.value = false;
  unusedOnly.value = false;
  productCountEnabled.value = false;
  productCountOp.value = "eq";
  productCountN.value = 0;
  page.value = 1;
}

const categoryActionOptions = computed(() => [
  {
    label: "Add default list",
    key: "seed",
    disabled: !supabaseConfigured || seeding.value,
  },
]);

function onCategoryActionSelect(key) {
  if (key === "seed") seedDefaults();
}

const filtered = computed(() => {
  const range = resolveDateRange(createdRangePreset.value, createdFrom.value, createdTo.value);
  return rows.value.filter((r) => {
    if (search.value.trim() && !matchesSearch(r.name, search.value)) return false;
    if (!isTimestampInRange(r.created_at, range)) return false;
    if (activeOnly.value && r.is_active === false) return false;
    if (unusedOnly.value && Number(r.product_count || 0) !== 0) return false;
    if (
      productCountEnabled.value &&
      !matchesCompareOp(Number(r.product_count || 0), productCountOp.value, Number(productCountN.value))
    ) {
      return false;
    }
    return true;
  });
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
    title: "Status",
    key: "is_active",
    width: 100,
    render: (r) =>
      h(
        NTag,
        { size: "small", type: r.is_active !== false ? "success" : "default" },
        () => (r.is_active !== false ? "Active" : "Inactive")
      ),
  },
  createdAtColumn(),
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
        row.is_active !== false
          ? h(
              NButton,
              {
                size: "tiny",
                type: "error",
                secondary: true,
                onClick: () => confirmDelete(row),
              },
              () => "Delete"
            )
          : null,
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
    content: `“${row.name}” will be soft-deleted (hidden from pickers). Linked products keep this category.`,
    positiveText: "Delete",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      try {
        await deleteCategory(row.id);
        message.success("Category soft-deleted");
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

watch(
  [
    search,
    createdRangePreset,
    createdFrom,
    createdTo,
    activeOnly,
    unusedOnly,
    productCountEnabled,
    productCountOp,
    productCountN,
  ],
  () => {
    page.value = 1;
  }
);

onMounted(async () => {
  window.addEventListener(PRODUCT_CATALOG_UPDATED, load);
  await load();
  // Seed defaults only when online and the list is still empty (skip offline — slow / noisy).
  if (!navigator.onLine || rows.value.length > 0) return;
  try {
    const { added } = await ensureDefaultCategories();
    if (added) await load();
  } catch {
    /* ignore seed errors on load */
  }
});
onUnmounted(() => window.removeEventListener(PRODUCT_CATALOG_UPDATED, load));
</script>

<template>
  <div class="app-page app-page--fill">
    <h1 style="margin-top: 0">Categories</h1>
    <SupabaseRequiredAlert />
    <OfflinePendingBanner />
    <NText depth="3" style="display: block; margin-bottom: 16px; font-size: 13px">
      Create, rename, and soft-delete product categories (inactive stay in history). Assign them on
      the Products page.
    </NText>

    <div class="app-toolbar app-toolbar--tight">
      <NSpace class="app-filter-stack" align="center" wrap>
        <NInput
          v-model:value="search"
          clearable
          placeholder="Search categories"
          style="width: 240px"
        />
        <NButtonGroup>
          <NButton type="primary" :disabled="!supabaseConfigured" @click="openCreate">
            Add category
          </NButton>
          <NDropdown
            trigger="click"
            :options="categoryActionOptions"
            @select="onCategoryActionSelect"
          >
            <NButton
              type="primary"
              :disabled="!supabaseConfigured"
              :loading="seeding"
              aria-label="More category actions"
              style="padding: 0 10px"
            >
              <NIcon :component="ChevronDownOutline" :size="16" />
            </NButton>
          </NDropdown>
        </NButtonGroup>
        <NButton :disabled="!supabaseConfigured" :loading="loading" @click="load">Refresh</NButton>
        <ClearFiltersButton v-if="hasActiveFilters" :disabled="false" @clear="clearFilters" />
      </NSpace>
    </div>

    <RuleFilterBar :fields="ruleFields" />

    <div class="app-table-panel">
      <NDataTable
        :loading="loading"
        :columns="columns"
        :data="paged"
        :row-key="(r) => r.id"
        :scroll-x="640"
        flex-height
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
    </div>

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
