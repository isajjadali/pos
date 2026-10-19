<script setup>
import { ref, onMounted, onUnmounted, watch, h, computed, nextTick } from "vue";
import {
  NButton,
  NSpace,
  NInput,
  NInputNumber,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NSwitch,
  NTag,
  NSelect,
  NAlert,
  NText,
  useMessage,
  useDialog,
} from "naive-ui";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
import ProductBulkCreateModal from "../components/ProductBulkCreateModal.vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { formatPkr, marginPercent } from "../utils/format.js";
import { listActiveVendorOptions } from "../services/vendors.js";
import { listCategories, createCategory } from "../services/categories.js";
import {
  listProducts,
  createProduct,
  updateProduct,
  deactivateProduct,
  deleteProductsBulk,
  deactivateProductsBulk,
  nextExternalProductId,
} from "../services/products.js";
import { receiveStock, setProductStock } from "../services/inventory.js";
import { shouldBlockShortcut } from "../utils/hotkeys.js";
import { refreshProductCatalog } from "../services/productCatalog.js";
import { usePermissions } from "../composables/usePermissions.js";
import { rowNumberColumn, tableSorter, compareStrings } from "../utils/tableColumns.js";
import { toTitleCase } from "../utils/titleCase.js";
import { formatProductTagLabel, normalizeProductTags } from "../utils/productTags.js";
import { isProductTagsDbReady, listProductTagOptions } from "../services/productTags.js";
import { useRouteQuerySync, routeQuery } from "../composables/useRouteQuerySync.js";

const message = useMessage();
const dialog = useDialog();
const { canManageProducts, canSeePurchasePrices } = usePermissions();

const loading = ref(false);
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const sortKey = ref(null);
const sortOrder = ref(null);
const search = ref("");
const vendorFilter = ref(null);
const categoryFilter = ref(null);
const tagFilter = ref(null);
const tagOptions = ref([]);
const tagsDbReady = ref(false);
const lowStockOnly = ref(false);
const activeOnly = ref(true);
const hasActiveFilters = computed(
  () =>
    Boolean(search.value.trim()) ||
    vendorFilter.value != null ||
    categoryFilter.value != null ||
    (tagsDbReady.value && tagFilter.value != null) ||
    lowStockOnly.value ||
    !activeOnly.value
);
function clearFilters() {
  search.value = "";
  vendorFilter.value = null;
  categoryFilter.value = null;
  tagFilter.value = null;
  lowStockOnly.value = false;
  activeOnly.value = true;
  sortKey.value = null;
  sortOrder.value = null;
  page.value = 1;
}
const checkedRowKeys = ref([]);

let loadFromQuery = () => {};
const { routeSyncing } = useRouteQuerySync(
  {
    q: { ...routeQuery.string(search), debounceMs: 300 },
    page: routeQuery.positiveInt(page, 1),
    pageSize: routeQuery.positiveInt(pageSize, 20),
    vendor: routeQuery.optionalString(vendorFilter),
    category: routeQuery.optionalString(categoryFilter),
    tag: routeQuery.optionalString(tagFilter),
    lowStock: routeQuery.booleanFlag(lowStockOnly, false),
    active: {
      ref: activeOnly,
      default: true,
      parse: (s) => s !== "all",
      serialize: (v) => (v ? undefined : "all"),
    },
    sort: routeQuery.optionalString(sortKey),
    order: routeQuery.optionalString(sortOrder),
  },
  { onApplied: () => loadFromQuery() }
);
const searchInputRef = ref(null);

const vendorOptions = ref([]);
const categoryOptions = ref([]);
const newCategoryName = ref("");

const showModal = ref(false);
const showBulkCreate = ref(false);
const editing = ref(null);
const saving = ref(false);
const isCreate = computed(() => !editing.value?.id);

const form = ref(emptyForm());

function emptyForm() {
  return {
    external_product_id: "",
    name: "",
    sku: "",
    barcode: "",
    category_id: null,
    vendor_id: null,
    initial_qty: 0,
    purchase_price: 0,
    selling_price: 0,
    weighted_avg_cost: 0,
    current_stock: 0,
    stock_at_open: 0,
    low_stock_threshold: 5,
    is_active: true,
    tags: [],
    add_stock_qty: 0,
    add_stock_unit_cost: 0,
  };
}

const suggestedTagOptions = [
  { label: "Missing", value: "missing" },
  { label: "Pending Vendor", value: "pending vendor" },
  { label: "Damaged", value: "damaged" },
  { label: "Recall", value: "recall" },
];

const tagSelectOptions = computed(() => {
  const map = new Map();
  for (const o of suggestedTagOptions) map.set(o.value, o);
  for (const o of tagOptions.value) map.set(o.value, { label: formatProductTagLabel(o.value), value: o.value });
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
});

const belowCost = computed(() => {
  const s = Number(form.value.selling_price);
  const c = Number(isCreate.value ? form.value.purchase_price : form.value.weighted_avg_cost);
  return Number.isFinite(s) && Number.isFinite(c) && s > 0 && s < c;
});

function stockTagProps(row) {
  const qty = Number(row.current_stock) || 0;
  const threshold = Number(row.low_stock_threshold) || 5;
  if (qty === 0) {
    return {
      bordered: true,
      round: true,
      size: "small",
      color: { color: "#fef2f2", textColor: "#111827", borderColor: "#f87171" },
    };
  }
  if (row.is_low_stock || qty <= threshold) {
    return {
      bordered: true,
      round: true,
      size: "small",
      color: { color: "#fde68a", textColor: "#111827", borderColor: "#b45309" },
    };
  }
  return {
    bordered: true,
    round: true,
    size: "small",
    color: { color: "#ecfdf5", textColor: "#111827", borderColor: "#34d399" },
  };
}

const columns = computed(() => {
  const cols = [rowNumberColumn(page, pageSize)];
  if (canManageProducts.value) cols.push({ type: "selection" });
  cols.push(
    {
      title: "ID",
      key: "external_product_id",
      width: 90,
      ...tableSorter("string", "external_product_id"),
      render: (row) => row.external_product_id || "—",
    },
    { title: "Name", key: "name", ellipsis: { tooltip: true }, ...tableSorter("string", "name") },
    {
      title: "Tags",
      key: "tags",
      width: 160,
      render: (row) => {
        const tags = row.tags ?? [];
        if (!tags.length) return "—";
        return h(
          NSpace,
          { size: 4, wrap: true },
          () =>
            tags.map((t) =>
              h(
                NTag,
                { size: "small", round: true, bordered: false, type: t === "missing" ? "warning" : "default" },
                () => formatProductTagLabel(t)
              )
            )
        );
      },
    },
    { title: "Barcode", key: "barcode", width: 120, ...tableSorter("string", "barcode") },
    {
      title: "Stock",
      key: "current_stock",
      width: 88,
      align: "center",
      ...tableSorter("number", "current_stock"),
      render: (row) =>
        h(
          NTag,
          {
            ...stockTagProps(row),
            style: "font-weight: 600; min-width: 2.25rem; justify-content: center",
          },
          () => String(row.current_stock)
        ),
    }
  );
  if (canSeePurchasePrices.value) {
    cols.push(
      {
        title: "Purchase",
        key: "weighted_avg_cost",
        width: 100,
        ...tableSorter("number", "weighted_avg_cost"),
        render: (row) => formatPkr(row.weighted_avg_cost),
      }
    );
  }
  cols.push({
    title: "Sale",
    key: "selling_price",
    width: 100,
    ...tableSorter("number", "selling_price"),
    render: (row) => formatPkr(row.selling_price),
  });
  if (canManageProducts.value) {
    cols.push(
      {
        title: "Vendor",
        key: "vendor",
        width: 120,
        ...tableSorter("string", (a, b) => compareStrings(a.vendors?.name, b.vendors?.name)),
        render: (row) => row.vendors?.name || "—",
      },
      {
        title: "Status",
        key: "is_active",
        width: 90,
        ...tableSorter("boolean", "is_active"),
        render: (row) =>
          h(NTag, { type: row.is_active ? "success" : "default", size: "small" }, () =>
            row.is_active ? "Active" : "Inactive"
          ),
      },
      {
        title: "",
        key: "actions",
        width: 150,
        render: (row) =>
          h(NSpace, { size: 4 }, () => [
            h(NButton, { size: "tiny", onClick: () => openEdit(row) }, () => "Edit"),
            row.is_active
              ? h(
                  NButton,
                  { size: "tiny", type: "warning", onClick: () => confirmDeactivate(row) },
                  () => "Deactivate"
                )
              : null,
          ]),
      }
    );
  }
  return cols;
});

async function loadMeta() {
  if (!supabaseConfigured) return;
  vendorOptions.value = (await listActiveVendorOptions()).map((v) => ({
    label: v.name,
    value: v.id,
  }));
  categoryOptions.value = (await listCategories()).map((c) => ({
    label: c.name,
    value: c.id,
  }));
  tagsDbReady.value = await isProductTagsDbReady();
  try {
    tagOptions.value = tagsDbReady.value ? await listProductTagOptions() : [];
  } catch {
    tagOptions.value = [];
  }
}

async function reloadTableAndCatalog() {
  await refreshProductCatalog().catch(() => {});
  await load();
}

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    const res = await listProducts({
      search: search.value,
      vendorId: vendorFilter.value,
      categoryId: categoryFilter.value,
      lowStockOnly: lowStockOnly.value,
      activeOnly: activeOnly.value,
      tag: tagFilter.value,
      page: page.value,
      pageSize: pageSize.value,
      sortKey: sortKey.value,
      sortOrder: sortOrder.value,
    });
    rows.value = res.rows;
    total.value = res.total;
  } catch (e) {
    message.error(e.message || "Failed to load products");
  } finally {
    loading.value = false;
  }
}

async function refreshSuggestedProductId() {
  if (!isCreate.value) return;
  const vendorId = form.value.vendor_id;
  if (!vendorId) {
    form.value.external_product_id = "";
    return;
  }
  const opt = vendorOptions.value.find((o) => o.value === vendorId);
  const name = opt?.label || "";
  if (!name) return;
  try {
    form.value.external_product_id = await nextExternalProductId(name);
  } catch (e) {
    message.warning(e.message || "Could not generate product ID");
  }
}

watch(
  () => form.value.vendor_id,
  () => {
    if (showModal.value && isCreate.value) refreshSuggestedProductId();
  }
);

function openCreate() {
  editing.value = null;
  form.value = emptyForm();
  showModal.value = true;
}

function openEdit(row) {
  editing.value = row;
  form.value = {
    external_product_id: row.external_product_id || "",
    name: row.name,
    sku: row.sku || "",
    barcode: row.barcode || "",
    category_id: row.category_id,
    vendor_id: row.vendor_id,
    initial_qty: 0,
    purchase_price: row.weighted_avg_cost,
    selling_price: row.selling_price,
    weighted_avg_cost: row.weighted_avg_cost,
    current_stock: row.current_stock,
    stock_at_open: row.current_stock,
    low_stock_threshold: row.low_stock_threshold,
    is_active: row.is_active,
    tags: [...(row.tags ?? [])],
    add_stock_qty: 0,
    add_stock_unit_cost: row.weighted_avg_cost ?? 0,
  };
  showModal.value = true;
}

function confirmBulkDeactivate() {
  const ids = checkedRowKeys.value;
  if (!ids.length) {
    message.warning("Select products first");
    return;
  }
  dialog.warning({
    title: "Deactivate selected?",
    content: `${ids.length} product(s) will be hidden from POS. Stock history is kept.`,
    positiveText: "Deactivate",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      await deactivateProductsBulk(ids);
      message.success("Products deactivated");
      checkedRowKeys.value = [];
      await load();
    },
  });
}

function confirmBulkDelete() {
  const ids = checkedRowKeys.value;
  if (!ids.length) {
    message.warning("Select products first");
    return;
  }
  dialog.error({
    title: "Delete selected permanently?",
    content: `${ids.length} product(s) will be removed from the database. This cannot be undone. Sale receipts keep product name snapshots.`,
    positiveText: "Delete",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      try {
        const res = await deleteProductsBulk(ids);
        if (res.failed?.length) {
          message.warning(`Deleted ${res.deleted}; ${res.failed.length} failed`);
        } else {
          message.success(`Deleted ${res.deleted} product(s)`);
        }
        checkedRowKeys.value = [];
        await load();
      } catch (e) {
        message.error(e.message || "Delete failed");
      }
    },
  });
}

function confirmDeactivate(row) {
  dialog.warning({
    title: "Deactivate product?",
    content: `"${row.name}" will be hidden from POS. Stock history is kept.`,
    positiveText: "Deactivate",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      await deactivateProduct(row.id);
      message.success("Product deactivated");
      await load();
    },
  });
}

function onCreateTag(label) {
  const value = normalizeProductTags([label])[0];
  if (!value) return false;
  return { label: formatProductTagLabel(value), value };
}

async function addCategory() {
  if (!newCategoryName.value.trim()) return;
  try {
    const cat = await createCategory(newCategoryName.value);
    categoryOptions.value.push({ label: cat.name, value: cat.id });
    form.value.category_id = cat.id;
    newCategoryName.value = "";
    message.success("Category added");
  } catch (e) {
    message.error(e.message || "Could not add category");
  }
}

async function save() {
  if (!supabaseConfigured) return;
  form.value.name = toTitleCase(form.value.name);
  if (!form.value.name.trim()) {
    message.warning("Product name is required");
    return;
  }
  if (isCreate.value && !form.value.external_product_id?.trim()) {
    await refreshSuggestedProductId();
  }
  form.value.tags = normalizeProductTags(form.value.tags);
  saving.value = true;
  try {
    if (isCreate.value) {
      const vendorName = vendorOptions.value.find((o) => o.value === form.value.vendor_id)?.label;
      await createProduct({ ...form.value, vendor_name: vendorName });
      message.success("Product created");
    } else {
      await updateProduct(editing.value.id, form.value);
      const stockNow = Math.floor(Number(form.value.current_stock) || 0);
      const stockWas = Math.floor(Number(form.value.stock_at_open) || 0);
      let stockMsg = "";
      if (stockNow !== stockWas) {
        await setProductStock(editing.value.id, stockNow);
        stockMsg = ` Stock set to ${stockNow}.`;
      }
      const addQty = Math.floor(Number(form.value.add_stock_qty) || 0);
      if (addQty > 0) {
        await receiveStock({
          productId: editing.value.id,
          quantity: addQty,
          unitCost: Number(form.value.add_stock_unit_cost) || form.value.weighted_avg_cost || 0,
          vendorId: form.value.vendor_id,
          notes: "Stock added from product edit",
        });
        message.success(`Product updated.${stockMsg} Received ${addQty} more unit(s).`);
      } else {
        message.success(`Product updated.${stockMsg || ""}`.trim());
      }
    }
    showModal.value = false;
    await loadMeta();
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

watch([vendorFilter, categoryFilter, tagFilter, lowStockOnly, activeOnly], () => {
  if (routeSyncing.value) return;
  page.value = 1;
  load();
});

let searchTimer;
watch(search, () => {
  if (routeSyncing.value) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    load();
  }, 300);
});

watch([page, pageSize, sortKey, sortOrder], () => {
  if (routeSyncing.value) return;
  load();
});

loadFromQuery = load;

function onProductsKeyDown(e) {
  if (showModal.value) return;
  if (e.key === "/" && !shouldBlockShortcut(e)) {
    e.preventDefault();
    nextTick(() => searchInputRef.value?.focus?.());
    return;
  }
  if (shouldBlockShortcut(e)) return;
  if (e.key === "n" || e.key === "N") {
    if (!canManageProducts.value) return;
    e.preventDefault();
    openCreate();
  } else if (e.key === "r" || e.key === "R") {
    e.preventDefault();
    reloadTableAndCatalog();
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onProductsKeyDown);
  await loadMeta();
  await load();
});

onUnmounted(() => window.removeEventListener("keydown", onProductsKeyDown));
</script>

<template>
  <div>
    <h1 style="margin-top: 0">Products</h1>
    <NText v-if="!canManageProducts" depth="2" style="display: block; margin-bottom: 12px">
      Catalog view — sale prices only. Use POS to place orders.
    </NText>
    <SupabaseRequiredAlert />
    <NSpace style="margin-bottom: 16px" wrap>
      <NInput
        ref="searchInputRef"
        v-model:value="search"
        placeholder="Search (press /)"
        clearable
        style="width: 280px"
      />
      <NSelect
        v-model:value="vendorFilter"
        :options="vendorOptions"
        placeholder="Vendor"
        clearable
        filterable
        style="width: 200px"
      />
      <NSelect
        v-model:value="categoryFilter"
        :options="categoryOptions"
        placeholder="Category"
        clearable
        style="width: 160px"
      />
      <NSelect
        v-if="tagsDbReady"
        v-model:value="tagFilter"
        :options="tagOptions"
        placeholder="Tag"
        clearable
        filterable
        style="width: 200px"
      />
      <NSwitch v-model:value="lowStockOnly">
        <template #checked>Low stock</template>
        <template #unchecked>All stock</template>
      </NSwitch>
      <NSwitch v-model:value="activeOnly">
        <template #checked>Active only</template>
        <template #unchecked>Include inactive</template>
      </NSwitch>
      <ClearFiltersButton :disabled="!hasActiveFilters" @clear="clearFilters" />
      <NButton
        v-if="canManageProducts"
        type="primary"
        :disabled="!supabaseConfigured"
        @click="openCreate"
      >
        Add product
      </NButton>
      <NButton
        v-if="canManageProducts"
        :disabled="!supabaseConfigured"
        @click="showBulkCreate = true"
      >
        Bulk create
      </NButton>
      <NButton
        v-if="canManageProducts"
        type="error"
        :disabled="!supabaseConfigured || !checkedRowKeys.length"
        @click="confirmBulkDelete"
      >
        Delete selected ({{ checkedRowKeys.length }})
      </NButton>
      <NButton
        v-if="canManageProducts"
        :disabled="!supabaseConfigured || !checkedRowKeys.length"
        @click="confirmBulkDeactivate"
      >
        Deactivate selected
      </NButton>
      <NButton :disabled="!supabaseConfigured" @click="reloadTableAndCatalog">Refresh</NButton>
    </NSpace>
    <NDataTable
      v-model:checked-row-keys="checkedRowKeys"
      :row-key="(row) => row.id"
      :loading="loading"
      :columns="columns"
      :data="rows"
      :scroll-x="1420"
      :remote="true"
      @update:sorter="onTableSorterUpdate"
      :pagination="{
        page,
        pageSize,
        itemCount: total,
        showSizePicker: true,
        pageSizes: [10, 20, 50, 100],
        onUpdatePage: onPageChange,
        onUpdatePageSize: onPageSizeChange,
      }"
    />

    <NModal
      v-model:show="showModal"
      preset="card"
      :title="isCreate ? 'Add product' : 'Edit product'"
      style="width: min(920px, 96vw)"
    >
      <NAlert v-if="belowCost" type="warning" style="margin-bottom: 12px">
        Selling price is below purchase cost.
      </NAlert>
      <NForm label-placement="top" class="product-form-grid">
        <NFormItem label="Vendor" class="span-2">
          <NSelect
            v-model:value="form.vendor_id"
            :options="vendorOptions"
            clearable
            filterable
            :placeholder="isCreate ? 'Select vendor (sets Product ID)' : 'Vendor'"
          />
        </NFormItem>
        <NFormItem label="Product ID">
          <NInput
            v-model:value="form.external_product_id"
            :disabled="isCreate"
            :placeholder="isCreate ? 'Auto from vendor' : ''"
          />
        </NFormItem>
        <NFormItem label="Product name" required class="span-3">
          <NInput v-model:value="form.name" placeholder="Title Case on save" />
        </NFormItem>
        <NFormItem label="SKU">
          <NInput v-model:value="form.sku" />
        </NFormItem>
        <NFormItem label="Barcode">
          <NInput v-model:value="form.barcode" :placeholder="isCreate ? 'Auto if empty' : ''" />
        </NFormItem>
        <NFormItem label="Category">
          <NSelect v-model:value="form.category_id" :options="categoryOptions" clearable filterable />
        </NFormItem>
        <NFormItem v-if="canManageProducts && tagsDbReady" label="Tags" class="span-3">
          <NSelect
            v-model:value="form.tags"
            :options="tagSelectOptions"
            multiple
            filterable
            tag
            placeholder="Type a tag and press Enter (e.g. missing)"
            :on-create="onCreateTag"
          />
        </NFormItem>
        <NFormItem label="New category" class="span-3">
          <NSpace style="width: 100%">
            <NInput v-model:value="newCategoryName" placeholder="New category name" style="flex: 1" />
            <NButton :disabled="!newCategoryName.trim()" @click="addCategory">Add</NButton>
          </NSpace>
        </NFormItem>
        <template v-if="isCreate">
          <NFormItem label="Initial quantity">
            <NInputNumber v-model:value="form.initial_qty" :min="0" :precision="0" style="width: 100%" />
          </NFormItem>
          <NFormItem label="Purchase price (PKR)">
            <NInputNumber v-model:value="form.purchase_price" :min="0" style="width: 100%" />
          </NFormItem>
          <NFormItem label="Selling price (PKR)">
            <NInputNumber v-model:value="form.selling_price" :min="0" style="width: 100%" />
          </NFormItem>
        </template>
        <template v-else>
          <NFormItem label="Stock quantity">
            <NInputNumber v-model:value="form.current_stock" :min="0" :precision="0" style="width: 100%" />
          </NFormItem>
          <NFormItem label="Add stock (qty)">
            <NInputNumber v-model:value="form.add_stock_qty" :min="0" :precision="0" style="width: 100%" />
          </NFormItem>
          <NFormItem label="Cost / new qty (PKR)">
            <NInputNumber v-model:value="form.add_stock_unit_cost" :min="0" style="width: 100%" />
          </NFormItem>
          <NFormItem label="Avg purchase cost (PKR)">
            <NInputNumber v-model:value="form.weighted_avg_cost" :min="0" style="width: 100%" />
          </NFormItem>
          <NFormItem label="Selling price (PKR)">
            <NInputNumber v-model:value="form.selling_price" :min="0" style="width: 100%" />
          </NFormItem>
          <NFormItem
            v-if="marginPercent(form.selling_price, form.weighted_avg_cost) !== null"
            label="Gross margin"
          >
            <span>{{ marginPercent(form.selling_price, form.weighted_avg_cost) }}%</span>
          </NFormItem>
        </template>
        <NFormItem label="Low-stock threshold">
          <NInputNumber v-model:value="form.low_stock_threshold" :min="0" :precision="0" style="width: 100%" />
        </NFormItem>
        <NFormItem v-if="!isCreate" label="Active">
          <NSwitch v-model:value="form.is_active" />
        </NFormItem>
      </NForm>
      <NText v-if="!isCreate" depth="3" style="font-size: 12px; display: block; margin-top: 4px">
        Set <strong>Stock quantity</strong> to fix on-hand count (logged in Inventory). Use <strong>Add stock</strong> for
        new purchases on top of that.
      </NText>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showModal = false">Cancel</NButton>
          <NButton type="primary" :loading="saving" @click="save">Save</NButton>
        </NSpace>
      </template>
    </NModal>

    <ProductBulkCreateModal
      v-model:show="showBulkCreate"
      :vendor-options="vendorOptions"
      :category-options="categoryOptions"
      @created="reloadTableAndCatalog"
    />
  </div>
</template>

<style scoped>
.product-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px 16px;
}
.product-form-grid :deep(.n-form-item) {
  margin-bottom: 8px;
}
.span-2 {
  grid-column: span 2;
}
.span-3 {
  grid-column: span 3;
}
@media (max-width: 720px) {
  .product-form-grid {
    grid-template-columns: 1fr;
  }
  .span-2,
  .span-3 {
    grid-column: span 1;
  }
}
</style>
