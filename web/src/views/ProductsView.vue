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
} from "../services/products.js";
import { receiveStock } from "../services/inventory.js";
import { computePerPiecePrice } from "../utils/perPiece.js";
import { shouldBlockShortcut } from "../utils/hotkeys.js";
import { refreshProductCatalog } from "../services/productCatalog.js";
import { usePermissions } from "../composables/usePermissions.js";

const message = useMessage();
const dialog = useDialog();
const { canManageProducts, canSeePurchasePrices } = usePermissions();

const loading = ref(false);
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const search = ref("");
const vendorFilter = ref(null);
const categoryFilter = ref(null);
const lowStockOnly = ref(false);
const activeOnly = ref(true);
const checkedRowKeys = ref([]);
const searchInputRef = ref(null);

const vendorOptions = ref([]);
const categoryOptions = ref([]);
const newCategoryName = ref("");

const showModal = ref(false);
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
    low_stock_threshold: 5,
    is_active: true,
    add_stock_qty: 0,
    add_stock_unit_cost: 0,
  };
}

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
      color: { color: "#fef2f2", textColor: "#b91c1c", borderColor: "#f87171" },
    };
  }
  if (row.is_low_stock || qty <= threshold) {
    return {
      bordered: true,
      round: true,
      size: "small",
      color: { color: "#fffbeb", textColor: "#b45309", borderColor: "#fbbf24" },
    };
  }
  return {
    bordered: true,
    round: true,
    size: "small",
    color: { color: "#ecfdf5", textColor: "#047857", borderColor: "#34d399" },
  };
}

const columns = computed(() => {
  const cols = [];
  if (canManageProducts.value) cols.push({ type: "selection" });
  cols.push(
    {
      title: "ID",
      key: "external_product_id",
      width: 90,
      render: (row) => row.external_product_id || "—",
    },
    { title: "Name", key: "name", ellipsis: { tooltip: true } },
    { title: "Barcode", key: "barcode", width: 120 },
    {
      title: "Stock",
      key: "current_stock",
      width: 88,
      align: "center",
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
        render: (row) => formatPkr(row.weighted_avg_cost),
      },
      {
        title: "Per piece",
        key: "per_piece_price",
        width: 100,
        render: (row) => {
          const per = computePerPiecePrice(row.weighted_avg_cost, row.name);
          return per != null ? formatPkr(per) : "—";
        },
      }
    );
  }
  cols.push({
    title: "Sale",
    key: "selling_price",
    width: 100,
    render: (row) => formatPkr(row.selling_price),
  });
  if (canManageProducts.value) {
    cols.push(
      {
        title: "Vendor",
        key: "vendor",
        width: 120,
        render: (row) => row.vendors?.name || "—",
      },
      {
        title: "Status",
        key: "is_active",
        width: 90,
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
      page: page.value,
      pageSize: pageSize.value,
    });
    rows.value = res.rows;
    total.value = res.total;
  } catch (e) {
    message.error(e.message || "Failed to load products");
  } finally {
    loading.value = false;
  }
}

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
    low_stock_threshold: row.low_stock_threshold,
    is_active: row.is_active,
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
  if (!form.value.name.trim()) {
    message.warning("Product name is required");
    return;
  }
  saving.value = true;
  try {
    if (isCreate.value) {
      await createProduct(form.value);
      message.success("Product created");
    } else {
      await updateProduct(editing.value.id, form.value);
      const addQty = Math.floor(Number(form.value.add_stock_qty) || 0);
      if (addQty > 0) {
        await receiveStock({
          productId: editing.value.id,
          quantity: addQty,
          unitCost: Number(form.value.add_stock_unit_cost) || form.value.weighted_avg_cost || 0,
          vendorId: form.value.vendor_id,
          notes: "Stock added from product edit",
        });
        message.success("Product updated and stock received");
      } else {
        message.success("Product updated");
      }
    }
    showModal.value = false;
    await load();
  } catch (e) {
    message.error(e.message || "Save failed");
  } finally {
    saving.value = false;
  }
}

function onPageChange(p) {
  page.value = p;
  load();
}

function onPageSizeChange(s) {
  pageSize.value = s;
  page.value = 1;
  load();
}

watch([vendorFilter, categoryFilter, lowStockOnly, activeOnly], () => {
  page.value = 1;
  load();
});

let searchTimer;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    load();
  }, 300);
});

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
        style="width: 180px"
      />
      <NSelect
        v-model:value="categoryFilter"
        :options="categoryOptions"
        placeholder="Category"
        clearable
        style="width: 160px"
      />
      <NSwitch v-model:value="lowStockOnly">
        <template #checked>Low stock</template>
        <template #unchecked>All stock</template>
      </NSwitch>
      <NSwitch v-model:value="activeOnly">
        <template #checked>Active only</template>
        <template #unchecked>Include inactive</template>
      </NSwitch>
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
      :scroll-x="1250"
      :pagination="{
        page,
        pageSize,
        itemCount: total,
        showSizePicker: true,
        pageSizes: [10, 20, 50],
        onChange: onPageChange,
        onUpdatePageSize: onPageSizeChange,
      }"
    />

    <NModal
      v-model:show="showModal"
      preset="card"
      :title="isCreate ? 'Add product' : 'Edit product'"
      style="width: 560px; max-width: 95vw"
    >
      <NAlert v-if="belowCost" type="warning" style="margin-bottom: 12px">
        Selling price is below purchase cost.
      </NAlert>
      <NForm label-placement="top">
        <NFormItem label="Product ID (shop code, e.g. AR-1)">
          <NInput v-model:value="form.external_product_id" placeholder="Optional" />
        </NFormItem>
        <NFormItem label="Product name" required>
          <NInput v-model:value="form.name" />
        </NFormItem>
        <NSpace>
          <NFormItem label="SKU" style="flex: 1">
            <NInput v-model:value="form.sku" />
          </NFormItem>
          <NFormItem label="Barcode" style="flex: 1">
            <NInput v-model:value="form.barcode" :placeholder="isCreate ? 'Auto-generated if empty' : ''" />
          </NFormItem>
        </NSpace>
        <NFormItem label="Vendor">
          <NSelect v-model:value="form.vendor_id" :options="vendorOptions" clearable filterable />
        </NFormItem>
        <NFormItem label="Category">
          <NSpace vertical style="width: 100%">
            <NSelect v-model:value="form.category_id" :options="categoryOptions" clearable filterable />
            <NSpace>
              <NInput v-model:value="newCategoryName" placeholder="New category name" style="flex: 1" />
              <NButton :disabled="!newCategoryName.trim()" @click="addCategory">Add</NButton>
            </NSpace>
          </NSpace>
        </NFormItem>
        <template v-if="isCreate">
          <NFormItem label="Initial quantity">
            <NInputNumber v-model:value="form.initial_qty" :min="0" :precision="0" style="width: 100%" />
          </NFormItem>
          <NFormItem label="Purchase price (per unit) PKR">
            <NInputNumber v-model:value="form.purchase_price" :min="0" style="width: 100%" />
          </NFormItem>
        </template>
        <template v-else>
          <NFormItem label="Current stock (read-only)">
            <NInputNumber :value="form.current_stock" disabled style="width: 100%" />
            <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px">
              Stock is changed via receipts — use “Add stock” below or Inventory → Receive stock.
            </NText>
          </NFormItem>
          <NSpace style="width: 100%">
            <NFormItem label="Add stock (qty)" style="flex: 1">
              <NInputNumber v-model:value="form.add_stock_qty" :min="0" :precision="0" style="width: 100%" />
            </NFormItem>
            <NFormItem label="Cost per unit for new qty (PKR)" style="flex: 1">
              <NInputNumber v-model:value="form.add_stock_unit_cost" :min="0" style="width: 100%" />
            </NFormItem>
          </NSpace>
          <NFormItem label="Avg purchase cost (PKR)">
            <NInputNumber v-model:value="form.weighted_avg_cost" :min="0" style="width: 100%" />
          </NFormItem>
        </template>
        <NFormItem label="Selling price PKR">
          <NInputNumber v-model:value="form.selling_price" :min="0" style="width: 100%" />
        </NFormItem>
        <NFormItem v-if="!isCreate && marginPercent(form.selling_price, form.weighted_avg_cost) !== null" label="Gross margin">
          <span>{{ marginPercent(form.selling_price, form.weighted_avg_cost) }}%</span>
        </NFormItem>
        <NFormItem label="Low-stock threshold">
          <NInputNumber v-model:value="form.low_stock_threshold" :min="0" :precision="0" style="width: 100%" />
        </NFormItem>
        <NFormItem v-if="!isCreate" label="Active">
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
