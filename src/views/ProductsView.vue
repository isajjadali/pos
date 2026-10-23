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
  NDrawer,
  NDrawerContent,
  NDropdown,
  NButtonGroup,
  NIcon,
  useMessage,
  useDialog,
} from "naive-ui";
import { ChevronDownOutline } from "@vicons/ionicons5";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
import ProductBulkCreateModal from "../components/ProductBulkCreateModal.vue";
import ProductBulkEditModal from "../components/ProductBulkEditModal.vue";
import ShopifyBulkImagesModal from "../components/ShopifyBulkImagesModal.vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import OfflinePendingBanner from "../components/OfflinePendingBanner.vue";
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
  reactivateProductsBulk,
  snapshotProductsForUndo,
  restoreProductsFromSnapshots,
  nextExternalProductId,
  fetchAllProductsForBulkEdit,
} from "../services/products.js";
import { useLastActionUndo } from "../composables/useLastActionUndo.js";
import { receiveStock, setProductStock } from "../services/inventory.js";
import {
  shopifyPushOne,
  shopifySetVariantPrice,
  shopifyGetVariantPrice,
  shopifyPushPrices,
  shopifyUploadProductImage,
} from "../services/shopify.js";
import { FEATURE_SHOPIFY } from "../config/features.js";

const shopifyFeatureOn = FEATURE_SHOPIFY;
import { shouldBlockShortcut } from "../utils/hotkeys.js";
import { refreshProductCatalog, PRODUCT_CATALOG_UPDATED } from "../services/productCatalog.js";
import { clearForcedOffline } from "../services/offlineGuard.js";
import { usePermissions } from "../composables/usePermissions.js";
import {
  rowNumberColumn,
  tableSorter,
  compareStrings,
  createdAtColumn,
  fitNameColumnWidth,
  paginationTotalPrefix,
} from "../utils/tableColumns.js";
import { toTitleCase } from "../utils/titleCase.js";
import { formatProductTagLabel, normalizeProductTags } from "../utils/productTags.js";
import { isProductTagsDbReady, listProductTagOptions } from "../services/productTags.js";
import { useRouteQuerySync, routeQuery } from "../composables/useRouteQuerySync.js";
import {
  SALE_UNIT_OPTIONS,
  UNIT_LISTING_FILTER_OPTIONS,
  boxesAvailable,
  formatProductUnitPrices,
  packsAvailable,
  sellingPriceForDefaultUnit,
} from "../utils/saleUnits.js";

const message = useMessage();
const dialog = useDialog();
const { canManageProducts, canSeePurchasePrices } = usePermissions();
const {
  hasUndo,
  register: registerUndo,
  undo: performUndo,
  canUndo,
} = useLastActionUndo();

async function runUndoFromUi() {
  // Avoid Naive message VNode teardown races while the table remounts
  try {
    message.destroyAll();
  } catch {
    /* ignore */
  }
  const res = await performUndo();
  if (!res.ok) {
    if (res.error && res.error !== "Nothing to undo") {
      message.error(res.error);
    }
    return;
  }
  message.success("Undone");
  checkedRowKeys.value = [];
  await reloadTableAndCatalog();
}

/** Plain string only — object-form message content was showing blank toasts. */
function notifyWithUndo(text) {
  message.success(`${String(text || "Done")} — press Undo or Ctrl+Z (30s)`);
}

const loading = ref(false);
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const sortKey = ref(null);
const sortOrder = ref(null);
const search = ref("");
const vendorFilter = ref([]);
const categoryFilter = ref([]);
const tagFilter = ref([]);
const tagOptions = ref([]);
const tagsDbReady = ref(false);
const lowStockOnly = ref(false);
const activeOnly = ref(true);
/** all | piece | pack | box | multi */
const unitFilter = ref("all");
const unitFilterOptions = UNIT_LISTING_FILTER_OPTIONS;
const hasActiveFilters = computed(
  () =>
    Boolean(search.value.trim()) ||
    (vendorFilter.value?.length ?? 0) > 0 ||
    (categoryFilter.value?.length ?? 0) > 0 ||
    (tagsDbReady.value && (tagFilter.value?.length ?? 0) > 0) ||
    lowStockOnly.value ||
    !activeOnly.value ||
    unitFilter.value !== "all"
);
/** Secondary filters only (shown inside More filters) — drives badge count. */
const moreFiltersCount = computed(() => {
  let n = 0;
  if ((categoryFilter.value?.length ?? 0) > 0) n += 1;
  if (tagsDbReady.value && (tagFilter.value?.length ?? 0) > 0) n += 1;
  if (unitFilter.value !== "all") n += 1;
  if (lowStockOnly.value) n += 1;
  if (!activeOnly.value) n += 1;
  return n;
});
const showMoreFilters = ref(false);
function clearFilters() {
  search.value = "";
  vendorFilter.value = [];
  categoryFilter.value = [];
  tagFilter.value = [];
  lowStockOnly.value = false;
  activeOnly.value = true;
  unitFilter.value = "all";
  sortKey.value = null;
  sortOrder.value = null;
  page.value = 1;
  checkedRowKeys.value = [];
}

/** More actions for the split-button dropdown (Add stays on the primary). */
const productActionOptions = computed(() => {
  if (!canManageProducts.value) return [];
  const n = checkedRowKeys.value.length;
  const ready = Boolean(supabaseConfigured);
  const opts = [
    { label: "Bulk create", key: "bulk-create", disabled: !ready },
    { type: "divider", key: "d1" },
    {
      label: n ? `Bulk edit selected (${n})` : "Bulk edit selected",
      key: "bulk-edit",
      disabled: !ready || !n,
    },
    {
      label: bulkEditLoading.value ? "Loading all…" : "Bulk edit all",
      key: "bulk-edit-all",
      disabled: !ready || bulkEditLoading.value,
    },
    {
      label: "Deactivate selected",
      key: "deactivate",
      disabled: !ready || !n,
    },
    {
      label: n ? `Delete selected (${n})` : "Delete selected",
      key: "delete",
      disabled: !ready || !n,
      props: { style: "color: #dc2626" },
    },
  ];
  if (shopifyFeatureOn) {
    opts.push(
      { type: "divider", key: "d2" },
      { label: "Shopify images", key: "shopify-images", disabled: !ready },
      {
        label: "Push Shopify prices",
        key: "shopify-prices",
        disabled: !ready || !n || shopifyPriceBusy.value,
      }
    );
  }
  if (hasUndo.value) {
    opts.push(
      { type: "divider", key: "d3" },
      { label: "Undo (Ctrl+Z)", key: "undo", disabled: !ready }
    );
  }
  return opts;
});

function onProductActionSelect(key) {
  switch (key) {
    case "bulk-create":
      showBulkCreate.value = true;
      break;
    case "bulk-edit":
      openBulkEdit();
      break;
    case "bulk-edit-all":
      openBulkEditAll();
      break;
    case "deactivate":
      confirmBulkDeactivate();
      break;
    case "delete":
      confirmBulkDelete();
      break;
    case "shopify-images":
      showBulkShopifyImages.value = true;
      break;
    case "shopify-prices":
      pushSelectedShopifyPrices();
      break;
    case "undo":
      runUndoFromUi();
      break;
    default:
      break;
  }
}

/** Drop stale selections when the list context changes (filters / page). */
function clearRowSelection() {
  checkedRowKeys.value = [];
}
const checkedRowKeys = ref([]);

let loadFromQuery = () => {};
const { routeSyncing } = useRouteQuerySync(
  {
    q: { ...routeQuery.string(search), debounceMs: 300 },
    page: routeQuery.positiveInt(page, 1),
    pageSize: routeQuery.positiveInt(pageSize, 20),
    vendor: routeQuery.stringList(vendorFilter),
    category: routeQuery.stringList(categoryFilter),
    tag: routeQuery.stringList(tagFilter),
    lowStock: routeQuery.booleanFlag(lowStockOnly, false),
    active: {
      ref: activeOnly,
      default: true,
      parse: (s) => s !== "all",
      serialize: (v) => (v ? undefined : "all"),
    },
    unit: routeQuery.enumValue(unitFilter, "all", ["all", "piece", "pack", "box", "multi"]),
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
const showBulkEdit = ref(false);
const showBulkShopifyImages = ref(false);
const shopifyImageBusy = ref(false);
const shopifyPriceBusy = ref(false);
const bulkEditLoading = ref(false);
const bulkEditProducts = ref([]);
const editing = ref(null);

function openBulkEdit() {
  if (!checkedRowKeys.value.length) {
    message.warning("Select at least one product, or use Bulk edit all");
    return;
  }
  const keys = new Set(checkedRowKeys.value);
  bulkEditProducts.value = rows.value.filter((r) => keys.has(r.id));
  showBulkEdit.value = true;
}

async function openBulkEditAll() {
  if (!supabaseConfigured) return;
  // Clear stale sticky-offline from a prior short-timeout false positive.
  if (typeof navigator !== "undefined" && navigator.onLine) {
    clearForcedOffline();
  }
  // Open modal immediately so the user sees progress while batches load.
  bulkEditProducts.value = [];
  bulkEditLoading.value = true;
  showBulkEdit.value = true;
  try {
    const all = await fetchAllProductsForBulkEdit({
      activeOnly: activeOnly.value,
      pageSize: 200,
      onBatch: (chunk) => {
        if (!showBulkEdit.value || !chunk?.length) return;
        bulkEditProducts.value = bulkEditProducts.value.concat(chunk);
      },
    });
    if (!showBulkEdit.value) return;
    if (!all.length) {
      message.warning("No products to edit");
      showBulkEdit.value = false;
      return;
    }
    message.success(`Loaded ${all.length} product(s)`);
  } catch (e) {
    message.error(e.message || "Failed to load products");
    if (!bulkEditProducts.value.length) showBulkEdit.value = false;
  } finally {
    bulkEditLoading.value = false;
  }
}

async function onBulkEditUpdated() {
  checkedRowKeys.value = [];
  bulkEditProducts.value = [];
  await reloadTableAndCatalog();
}

function onVendorCreatedFromBulk(vendor) {
  if (!vendor?.id) return;
  if (vendorOptions.value.some((o) => o.value === vendor.id)) return;
  vendorOptions.value = [
    ...vendorOptions.value,
    { label: vendor.name, value: vendor.id },
  ].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}
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
    pieces_per_pack: 1,
    pieces_per_box: null,
    piece_selling_price: 0,
    pack_selling_price: 0,
    box_selling_price: null,
    default_sale_unit: "piece",
    weighted_avg_cost: 0,
    current_stock: 0,
    stock_at_open: 0,
    low_stock_threshold: 5,
    is_active: true,
    tags: [],
    add_stock_qty: 0,
    add_stock_unit_cost: 0,
    shopify_price: null,
    shopify_product_id: null,
    shopify_variant_id: null,
  };
}

const saleUnitSelectOptions = SALE_UNIT_OPTIONS;

const unitStockHint = computed(() => {
  const f = form.value;
  const stock = Math.floor(Number(isCreate.value ? f.initial_qty : f.current_stock) || 0);
  const pack = Math.max(1, Math.floor(Number(f.pieces_per_pack) || 1));
  const box = Math.floor(Number(f.pieces_per_box) || 0);
  const parts = [`${stock} pcs`];
  if (pack > 1) parts.push(`${packsAvailable(stock, f)} packs (${pack} pcs)`);
  if (box > 0) parts.push(`${boxesAvailable(stock, f)} boxes (${box} pcs)`);
  return parts.join(" · ");
});

watch(
  () => [
    form.value.piece_selling_price,
    form.value.pack_selling_price,
    form.value.box_selling_price,
    form.value.default_sale_unit,
    form.value.pieces_per_pack,
    form.value.pieces_per_box,
  ],
  () => {
    form.value.selling_price = sellingPriceForDefaultUnit(form.value);
  }
);

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
  const s = Number(sellingPriceForDefaultUnit(form.value));
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

const nameColumnWidth = computed(() => fitNameColumnWidth(rows.value));

const tableScrollX = computed(() => {
  let x = 48; // row #
  if (canManageProducts.value) x += 40; // selection
  x += 90; // ID
  x += nameColumnWidth.value;
  x += 160 + 120 + 88; // tags, barcode, stock
  if (canSeePurchasePrices.value) x += 100;
  x += 140; // sale (multi-line unit prices)
  x += 158; // created
  if (canManageProducts.value) x += 120 + 90 + 210; // vendor, status, actions
  return x + 24;
});

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
    {
      title: "Name",
      key: "name",
      width: nameColumnWidth.value + 56,
      ellipsis: { tooltip: true },
      ...tableSorter("string", "name"),
      render: (row) =>
        h(NSpace, { size: 6, align: "center", wrap: false }, () => [
          h("span", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%" }, row.name || "—"),
          shopifyFeatureOn && row.shopify_variant_id
            ? h(
                NTag,
                { size: "tiny", round: true, bordered: false, type: "info" },
                () => "Shopify"
              )
            : null,
        ]),
    },
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
    width: 140,
    ...tableSorter("number", "selling_price"),
    render: (row) =>
      h(
        "span",
        { style: "font-size: 12px; line-height: 1.35; white-space: pre-line" },
        formatProductUnitPrices(row, { multiline: true })
      ),
  });
  cols.push(createdAtColumn({ remote: true }));
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
        width: 210,
        render: (row) =>
          h(NSpace, { size: 4 }, () => [
            h(NButton, { size: "tiny", onClick: () => openEdit(row) }, () => "Edit"),
            shopifyFeatureOn && row.barcode
              ? h(
                  NButton,
                  {
                    size: "tiny",
                    quaternary: true,
                    onClick: () => pushProductToShopify(row),
                  },
                  () => "Shopify"
                )
              : null,
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
  clearForcedOffline();
  await refreshProductCatalog({ force: true }).catch(() => {});
  await load();
}

function onCatalogUpdated() {
  if (typeof navigator !== "undefined" && navigator.onLine) {
    clearForcedOffline();
  }
  load();
}

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    const res = await listProducts({
      search: search.value,
      vendorIds: vendorFilter.value,
      categoryIds: categoryFilter.value,
      lowStockOnly: lowStockOnly.value,
      activeOnly: activeOnly.value,
      tags: tagFilter.value,
      unitFilter: unitFilter.value,
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

async function pushProductToShopify(row) {
  try {
    const res = await shopifyPushOne(row.id);
    const one = res.results?.[0];
    if (one?.error) throw new Error(one.error);
    if (one?.skipped) {
      message.warning(one.reason === "no_barcode" ? "Barcode required" : "Skipped");
      return;
    }
    message.success("Pushed to Shopify");
    await load();
  } catch (e) {
    message.error(e.message || "Shopify push failed");
  }
}

async function pushSelectedShopifyPrices() {
  const ids = checkedRowKeys.value;
  if (!ids.length) {
    message.warning("Select products first");
    return;
  }
  shopifyPriceBusy.value = true;
  try {
    const res = await shopifyPushPrices(ids);
    const results = res.results || [];
    const ok = results.filter((r) => r.ok).length;
    const skip = results.filter((r) => r.skipped).length;
    const err = results.filter((r) => r.error).length;
    message.success(`Shopify prices: ${ok} updated, ${skip} skipped, ${err} failed`);
    await load();
  } catch (e) {
    message.error(e.message || "Push Shopify prices failed");
  } finally {
    shopifyPriceBusy.value = false;
  }
}

async function onShopifyImagePick(e) {
  const file = e.target?.files?.[0];
  e.target.value = "";
  if (!file || !editing.value?.id) return;
  shopifyImageBusy.value = true;
  try {
    await shopifyUploadProductImage(editing.value.id, file, { alt: form.value.name || "" });
    message.success("Image uploaded to Shopify");
  } catch (err) {
    message.error(err.message || "Image upload failed");
  } finally {
    shopifyImageBusy.value = false;
  }
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
    pieces_per_pack: row.pieces_per_pack ?? 1,
    pieces_per_box: row.pieces_per_box ?? null,
    piece_selling_price: row.piece_selling_price ?? row.selling_price ?? 0,
    pack_selling_price: row.pack_selling_price ?? row.selling_price ?? 0,
    box_selling_price: row.box_selling_price ?? null,
    default_sale_unit: row.default_sale_unit || "piece",
    weighted_avg_cost: row.weighted_avg_cost,
    current_stock: row.current_stock,
    stock_at_open: row.current_stock,
    low_stock_threshold: row.low_stock_threshold,
    is_active: row.is_active,
    tags: [...(row.tags ?? [])],
    add_stock_qty: 0,
    add_stock_unit_cost: row.weighted_avg_cost ?? 0,
    shopify_price: row.shopify_price ?? null,
    shopify_product_id: row.shopify_product_id ?? null,
    shopify_variant_id: row.shopify_variant_id ?? null,
  };
  showModal.value = true;
  if (
    shopifyFeatureOn &&
    (row.shopify_variant_id || row.shopify_product_id || row.barcode)
  ) {
    shopifyGetVariantPrice(row.id)
      .then((res) => {
        if (res?.price != null) form.value.shopify_price = Number(res.price);
      })
      .catch(() => {});
  }
}

function confirmBulkDeactivate() {
  const ids = [...checkedRowKeys.value];
  if (!ids.length) {
    message.warning("Select products first");
    return;
  }
  dialog.warning({
    title: "Deactivate selected?",
    content: `${ids.length} product(s) will be hidden from POS. Stock history is kept. Undo available for 30s.`,
    positiveText: "Deactivate",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      await deactivateProductsBulk(ids);
      registerUndo({
        label: `Reactivate ${ids.length} product(s)`,
        run: async () => {
          await reactivateProductsBulk(ids);
        },
      });
      notifyWithUndo(`Deactivated ${ids.length} product(s)`);
      checkedRowKeys.value = [];
      await load();
    },
  });
}

function confirmBulkDelete() {
  const ids = [...checkedRowKeys.value];
  if (!ids.length) {
    message.warning("Select products first");
    return;
  }
  dialog.error({
    title: "Delete selected permanently?",
    content: `${ids.length} product(s) will be removed from the database. Undo available for 30s (restores catalog + stock qty; movement history is not restored). Sale receipts keep product name snapshots.`,
    positiveText: "Delete",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      try {
        const snapshots = await snapshotProductsForUndo(ids);
        const res = await deleteProductsBulk(ids);
        if (res.deleted > 0 && snapshots.length) {
          registerUndo({
            label: `Restore ${snapshots.length} product(s)`,
            run: async () => {
              const restored = await restoreProductsFromSnapshots(snapshots);
              if (restored.errors?.length) {
                throw new Error(
                  `Restored ${restored.restored}; ${restored.errors.length} failed`
                );
              }
            },
          });
        }
        const deletedCount = Number(res?.deleted) || 0;
        if (res.failed?.length) {
          const tip =
            deletedCount > 0 && snapshots.length
              ? `Deleted ${deletedCount}; ${res.failed.length} failed — press Undo or Ctrl+Z (30s)`
              : `Deleted ${deletedCount}; ${res.failed.length} failed`;
          message.warning(tip);
        } else {
          notifyWithUndo(`Deleted ${deletedCount} product(s)`);
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
    content: `"${row.name}" will be hidden from POS. Stock history is kept. Undo available for 30s.`,
    positiveText: "Deactivate",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      const id = row.id;
      await deactivateProduct(id);
      registerUndo({
        label: `Reactivate “${row.name}”`,
        run: async () => {
          await reactivateProductsBulk([id]);
        },
      });
      notifyWithUndo("Product deactivated");
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
      if (
        shopifyFeatureOn &&
        form.value.shopify_price != null &&
        Number.isFinite(Number(form.value.shopify_price)) &&
        (form.value.shopify_product_id || form.value.shopify_variant_id || form.value.barcode)
      ) {
        try {
          await shopifySetVariantPrice(editing.value.id, form.value.shopify_price);
        } catch (e) {
          message.warning(e.message || "POS saved; Shopify price update failed");
        }
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

watch([vendorFilter, categoryFilter, tagFilter, lowStockOnly, activeOnly, unitFilter], () => {
  if (routeSyncing.value) return;
  clearRowSelection();
  page.value = 1;
  load();
});

let searchTimer;
watch(search, () => {
  if (routeSyncing.value) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    clearRowSelection();
    page.value = 1;
    load();
  }, 300);
});

watch([page, pageSize, sortKey, sortOrder], () => {
  if (routeSyncing.value) return;
  clearRowSelection();
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
  // Ctrl/Cmd+Z — undo last deactivate/delete (skip when typing in a field)
  if (
    (e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    !e.altKey &&
    (e.key === "z" || e.key === "Z")
  ) {
    if (shouldBlockShortcut(e)) return;
    if (!canUndo()) return;
    e.preventDefault();
    runUndoFromUi();
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
  window.addEventListener(PRODUCT_CATALOG_UPDATED, onCatalogUpdated);
  await loadMeta();
  await load();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onProductsKeyDown);
  window.removeEventListener(PRODUCT_CATALOG_UPDATED, onCatalogUpdated);
});
</script>

<template>
  <div class="app-page app-page--fill">
    <h1 style="margin-top: 0">Products</h1>
    <NText v-if="!canManageProducts" depth="2" style="display: block; margin-bottom: 12px">
      Catalog view — sale prices only. Use POS to place orders.
    </NText>
    <SupabaseRequiredAlert />
    <OfflinePendingBanner />
    <div class="app-toolbar">
      <NSpace class="app-filter-stack" align="center" wrap>
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
          multiple
          clearable
          filterable
          max-tag-count="responsive"
          style="min-width: 200px; max-width: 320px"
        />
        <NButton :type="moreFiltersCount ? 'warning' : 'default'" @click="showMoreFilters = true">
          More filters{{ moreFiltersCount ? ` (${moreFiltersCount})` : "" }}
        </NButton>
        <NButtonGroup v-if="canManageProducts">
          <NButton type="primary" :disabled="!supabaseConfigured" @click="openCreate">
            Add product
          </NButton>
          <NDropdown
            trigger="click"
            :options="productActionOptions"
            @select="onProductActionSelect"
          >
            <NButton
              type="primary"
              :disabled="!supabaseConfigured"
              aria-label="More product actions"
              style="padding: 0 10px"
            >
              <NIcon :component="ChevronDownOutline" :size="16" />
            </NButton>
          </NDropdown>
        </NButtonGroup>
        <NButton :disabled="!supabaseConfigured" @click="reloadTableAndCatalog">Refresh</NButton>
        <ClearFiltersButton v-if="hasActiveFilters" :disabled="false" @clear="clearFilters" />
      </NSpace>
    </div>

    <NDrawer v-model:show="showMoreFilters" :width="360" placement="right">
      <NDrawerContent title="More filters" closable :native-scrollbar="false">
        <div class="products-more-filters">
          <NSelect
            v-model:value="categoryFilter"
            :options="categoryOptions"
            placeholder="Category"
            multiple
            clearable
            filterable
            max-tag-count="responsive"
            style="width: 100%"
          />
          <NSelect
            v-if="tagsDbReady"
            v-model:value="tagFilter"
            :options="tagOptions"
            placeholder="Tag"
            multiple
            clearable
            filterable
            max-tag-count="responsive"
            style="width: 100%"
          />
          <NSelect
            v-model:value="unitFilter"
            :options="unitFilterOptions"
            placeholder="Unit"
            style="width: 100%"
          />
          <NSwitch v-model:value="lowStockOnly">
            <template #checked>Low stock</template>
            <template #unchecked>All stock</template>
          </NSwitch>
          <NSwitch v-model:value="activeOnly">
            <template #checked>Active only</template>
            <template #unchecked>Include inactive</template>
          </NSwitch>
        </div>
      </NDrawerContent>
    </NDrawer>
    <div class="app-table-panel">
      <NDataTable
        v-model:checked-row-keys="checkedRowKeys"
        :row-key="(row) => row.id"
        :loading="loading"
        :columns="columns"
        :data="rows"
        :scroll-x="tableScrollX"
        :remote="true"
        flex-height
        @update:sorter="onTableSorterUpdate"
        :pagination="{
          page,
          pageSize,
          itemCount: total,
          showSizePicker: true,
          pageSizes: [10, 20, 50, 100],
          prefix: paginationTotalPrefix,
          onUpdatePage: onPageChange,
          onUpdatePageSize: onPageSizeChange,
        }"
      />
    </div>

    <NModal
      v-model:show="showModal"
      preset="card"
      class="product-modal"
      :title="isCreate ? 'Add product' : 'Edit product'"
      style="width: min(960px, 96vw)"
    >
      <div class="product-modal-body">
        <NAlert v-if="belowCost" type="warning" style="margin-bottom: 10px">
          Selling price is below purchase cost.
        </NAlert>
        <NForm label-placement="top" class="product-form-grid">
          <NFormItem label="Vendor">
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
          <NFormItem label="Category">
            <NSelect
              v-model:value="form.category_id"
              :options="categoryOptions"
              clearable
              filterable
            />
          </NFormItem>
          <NFormItem label="Product name" required class="span-2">
            <NInput v-model:value="form.name" placeholder="Title Case on save" />
          </NFormItem>
          <NFormItem label="Barcode">
            <NInput v-model:value="form.barcode" :placeholder="isCreate ? 'Auto if empty' : ''" />
          </NFormItem>
          <NFormItem label="SKU">
            <NInput v-model:value="form.sku" />
          </NFormItem>
          <NFormItem
            v-if="canManageProducts && tagsDbReady"
            label="Tags"
            class="span-2"
          >
            <NSelect
              v-model:value="form.tags"
              :options="tagSelectOptions"
              multiple
              filterable
              tag
              placeholder="Type a tag and press Enter"
              :on-create="onCreateTag"
            />
          </NFormItem>
          <NFormItem
            label="New category"
            :class="canManageProducts && tagsDbReady ? undefined : 'span-2'"
          >
            <NSpace style="width: 100%" :wrap="false">
              <NInput v-model:value="newCategoryName" placeholder="New category" style="flex: 1" />
              <NButton :disabled="!newCategoryName.trim()" @click="addCategory">Add</NButton>
            </NSpace>
          </NFormItem>
          <template v-if="isCreate">
            <div class="product-form-pair">
              <NFormItem label="Initial qty (pcs)">
                <NInputNumber v-model:value="form.initial_qty" :min="0" :precision="0" style="width: 100%" />
              </NFormItem>
              <NFormItem label="Purchase / piece (PKR)">
                <NInputNumber v-model:value="form.purchase_price" :min="0" style="width: 100%" />
              </NFormItem>
            </div>
            <NFormItem
              v-if="marginPercent(form.selling_price, form.purchase_price) !== null"
              label="Gross margin"
            >
              <span>{{ marginPercent(form.selling_price, form.purchase_price) }}%</span>
            </NFormItem>
          </template>
          <template v-else>
            <div class="product-form-pair">
              <NFormItem label="Stock (pcs)">
                <NInputNumber v-model:value="form.current_stock" :min="0" :precision="0" style="width: 100%" />
              </NFormItem>
              <NFormItem label="Add stock (pcs)">
                <NInputNumber v-model:value="form.add_stock_qty" :min="0" :precision="0" style="width: 100%" />
              </NFormItem>
            </div>
            <div class="product-form-pair">
              <NFormItem label="Cost / new piece (PKR)">
                <NInputNumber v-model:value="form.add_stock_unit_cost" :min="0" style="width: 100%" />
              </NFormItem>
              <NFormItem label="Avg cost / piece">
                <NInputNumber v-model:value="form.weighted_avg_cost" :min="0" style="width: 100%" />
              </NFormItem>
            </div>
            <div class="product-form-pair">
              <NFormItem
                v-if="marginPercent(form.selling_price, form.weighted_avg_cost) !== null"
                label="Gross margin"
              >
                <span>{{ marginPercent(form.selling_price, form.weighted_avg_cost) }}%</span>
              </NFormItem>
              <NFormItem label="Active">
                <NSwitch v-model:value="form.is_active" />
              </NFormItem>
            </div>
          </template>
          <div class="product-form-pair">
            <NFormItem label="Default sell unit">
              <NSelect v-model:value="form.default_sale_unit" :options="saleUnitSelectOptions" />
            </NFormItem>
            <NFormItem label="Piece price (PKR)">
              <NInputNumber v-model:value="form.piece_selling_price" :min="0" style="width: 100%" />
            </NFormItem>
          </div>
          <div class="product-form-pair">
            <NFormItem label="Pcs per pack">
              <NInputNumber v-model:value="form.pieces_per_pack" :min="1" :precision="0" style="width: 100%" />
            </NFormItem>
            <NFormItem label="Pack price (PKR)">
              <NInputNumber v-model:value="form.pack_selling_price" :min="0" style="width: 100%" />
            </NFormItem>
          </div>
          <div class="product-form-pair">
            <NFormItem label="Pcs per box">
              <NInputNumber
                v-model:value="form.pieces_per_box"
                :min="1"
                :precision="0"
                clearable
                placeholder="Optional"
                style="width: 100%"
              />
            </NFormItem>
            <NFormItem label="Box price (PKR)">
              <NInputNumber
                v-model:value="form.box_selling_price"
                :min="0"
                clearable
                :disabled="!form.pieces_per_box"
                style="width: 100%"
              />
            </NFormItem>
          </div>
          <div class="product-form-pair">
            <NFormItem label="Low-stock threshold">
              <NInputNumber v-model:value="form.low_stock_threshold" :min="0" :precision="0" style="width: 100%" />
            </NFormItem>
            <NFormItem label="Stock breakdown">
              <NText depth="3" style="font-size: 13px">{{ unitStockHint }}</NText>
            </NFormItem>
          </div>
          <NFormItem
            v-if="shopifyFeatureOn && !isCreate && canManageProducts"
            label="Shopify price (PKR)"
          >
            <NInputNumber
              v-model:value="form.shopify_price"
              :min="0"
              clearable
              placeholder="POS prices unchanged"
              style="width: 100%"
            />
          </NFormItem>
          <NFormItem
            v-if="shopifyFeatureOn && !isCreate && canManageProducts"
            label="Shopify image"
            class="span-2"
          >
            <NSpace vertical size="small" style="width: 100%">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                :disabled="shopifyImageBusy"
                @change="onShopifyImagePick"
              />
              <NText depth="3" style="font-size: 12px">
                Uploads to Shopify only (push/link product first).
              </NText>
            </NSpace>
          </NFormItem>
        </NForm>
        <NText depth="3" class="product-modal-hint">
          Stock is always in <strong>pieces</strong>. Pack/box sizes only change how POS sells. Default sell unit sets
          the barcode label price.
          <template v-if="!isCreate">
            Set <strong>Stock</strong> to fix on-hand count; use <strong>Add stock</strong> for new purchases.
          </template>
        </NText>
      </div>
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
      @vendor-created="onVendorCreatedFromBulk"
    />
    <ProductBulkEditModal
      v-model:show="showBulkEdit"
      :products="bulkEditProducts"
      :loading="bulkEditLoading"
      :vendor-options="vendorOptions"
      :category-options="categoryOptions"
      @updated="onBulkEditUpdated"
      @vendor-created="onVendorCreatedFromBulk"
    />
    <ShopifyBulkImagesModal
      v-if="shopifyFeatureOn"
      v-model:show="showBulkShopifyImages"
    />
  </div>
</template>

<style scoped>
.products-more-filters {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 16px;
}
.product-modal-body {
  max-height: min(560px, calc(100vh - 180px));
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 6px;
  -webkit-overflow-scrolling: touch;
}
.product-modal-hint {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.4;
}
.product-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 12px;
  align-items: start;
}
.product-form-grid :deep(.n-form-item) {
  margin-bottom: 6px;
}
.product-form-grid :deep(.n-form-item-label) {
  padding-bottom: 2px !important;
  font-size: 12px;
  line-height: 1.2;
}
.product-form-pair {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
  align-items: start;
}
.span-2 {
  grid-column: span 2;
}
.span-3 {
  grid-column: span 3;
}
@media (max-width: 720px) {
  .product-form-grid {
    grid-template-columns: 1fr 1fr;
  }
  .span-2,
  .span-3 {
    grid-column: span 2;
  }
}
@media (max-width: 520px) {
  .product-form-grid {
    grid-template-columns: 1fr;
  }
  .product-form-pair {
    grid-template-columns: 1fr;
  }
  .span-2,
  .span-3 {
    grid-column: span 1;
  }
}
</style>

<!-- Teleported card — clip content so fields never paint outside the white box. -->
<style>
.product-modal.n-card {
  max-height: calc(100vh - 24px) !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
}
.product-modal.n-card .n-card__content {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  overflow: hidden !important;
  padding-bottom: 4px !important;
}
.product-modal.n-card .n-card__footer {
  flex: 0 0 auto !important;
  border-top: 1px solid var(--n-divider-color, #e5e7eb);
  padding-top: 12px;
}
.product-modal.n-card .n-card__header {
  flex: 0 0 auto !important;
}
</style>
