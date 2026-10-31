<script setup>
import { ref, onMounted, computed, h, watch } from "vue";
import { useRouter } from "vue-router";
import {
  NButton,
  NSpace,
  NInput,
  NInputNumber,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NText,
  NTag,
  NSelect,
  useMessage,
  useDialog,
} from "naive-ui";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
import RuleFilterBar from "../components/RuleFilterBar.vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import CreatableVendorSelect from "../components/CreatableVendorSelect.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { formatPkr } from "../utils/format.js";
import { matchesSearch } from "../utils/textSearch.js";
import {
  DATE_RANGE_PRESET_OPTIONS,
  dateRangeFilterActive,
  isTimestampInRange,
  resolveDateRange,
} from "../utils/dateRange.js";
import { IS_OPS, createdDateField, opLabel } from "../utils/ruleFilterOps.js";
import {
  rowNumberColumn,
  tableSorter,
  paginationTotalPrefix,
} from "../utils/tableColumns.js";
import {
  listPosCustomItems,
  archivePosCustomItem,
  reactivatePosCustomItem,
  promotePosCustomItemToProduct,
} from "../services/posCustomItems.js";
import { listCategories } from "../services/categories.js";
import { listVendors } from "../services/vendors.js";
import { toTitleCase } from "../utils/titleCase.js";
import { sanitizeCustomItemName } from "../utils/posCustomItemHistory.js";

const message = useMessage();
const dialog = useDialog();
const router = useRouter();

const loading = ref(false);
const rows = ref([]);
const search = ref("");
const page = ref(1);
const pageSize = ref(20);

const statusFilter = ref("all");
const soldRangePreset = ref("all");
const soldFrom = ref(null);
const soldTo = ref(null);

const STATUS_OPTIONS = [
  { label: "All statuses", value: "all" },
  { label: "Active", value: "active" },
  { label: "Promoted", value: "promoted" },
  { label: "Archived", value: "archived" },
];

const ruleFieldsSold = computed(() => {
  const lastSold = createdDateField({
    preset: soldRangePreset,
    from: soldFrom,
    to: soldTo,
    dateRangeFilterActive,
    DATE_RANGE_PRESET_OPTIONS,
  });
  return [
    {
      id: "status",
      label: "Status",
      valueType: "select",
      ops: IS_OPS,
      options: () => STATUS_OPTIONS.filter((o) => o.value !== "all"),
      occupied: () => statusFilter.value && statusFilter.value !== "all",
      chipText: () => {
        const o = STATUS_OPTIONS.find((x) => x.value === statusFilter.value);
        return `Status ${opLabel("eq")} ${o?.label || statusFilter.value}`;
      },
      getDraft: () => ({ select: statusFilter.value === "all" ? null : statusFilter.value }),
      apply: (d) => {
        statusFilter.value = d.select || "all";
      },
      clear: () => {
        statusFilter.value = "all";
      },
    },
    {
      ...lastSold,
      id: "lastSold",
      label: "Last sold",
      chipText: () => {
        if (soldRangePreset.value === "custom") {
          return `Last sold ${soldFrom.value || "…"} → ${soldTo.value || "…"}`;
        }
        const p = DATE_RANGE_PRESET_OPTIONS.find((o) => o.value === soldRangePreset.value);
        return `Last sold ${p?.label || soldRangePreset.value}`;
      },
    },
  ];
});

const hasActiveFilters = computed(
  () =>
    Boolean(search.value.trim()) ||
    (statusFilter.value && statusFilter.value !== "all") ||
    dateRangeFilterActive(soldRangePreset.value, soldFrom.value, soldTo.value)
);

function clearFilters() {
  search.value = "";
  statusFilter.value = "all";
  soldRangePreset.value = "all";
  soldFrom.value = null;
  soldTo.value = null;
  page.value = 1;
}

const filtered = computed(() => {
  const range = resolveDateRange(soldRangePreset.value, soldFrom.value, soldTo.value);
  return rows.value.filter((r) => {
    if (search.value.trim() && !matchesSearch(r.name, search.value)) return false;
    if (statusFilter.value !== "all" && r.status !== statusFilter.value) return false;
    if (!isTimestampInRange(r.last_sold_at, range)) return false;
    return true;
  });
});

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filtered.value.slice(start, start + pageSize.value);
});

function statusTagType(status) {
  if (status === "promoted") return "success";
  if (status === "archived") return "default";
  return "info";
}

const columns = computed(() => [
  rowNumberColumn(page, pageSize),
  {
    title: "Name",
    key: "name",
    ellipsis: { tooltip: true },
    ...tableSorter("string", "name"),
  },
  {
    title: "Last price",
    key: "last_unit_price",
    width: 110,
    ...tableSorter("number", "last_unit_price"),
    render: (r) => formatPkr(r.last_unit_price),
  },
  {
    title: "Times sold",
    key: "times_sold",
    width: 110,
    ...tableSorter("number", "times_sold"),
  },
  {
    title: "Qty sold",
    key: "qty_sold",
    width: 100,
    ...tableSorter("number", "qty_sold"),
    render: (r) => String(Math.round(Number(r.qty_sold) || 0)),
  },
  {
    title: "Amount sold",
    key: "amount_sold",
    width: 120,
    ...tableSorter("number", "amount_sold"),
    render: (r) => formatPkr(r.amount_sold),
  },
  {
    title: "Last sold",
    key: "last_sold_at",
    width: 160,
    ...tableSorter("string", "last_sold_at"),
    render: (r) => {
      if (!r.last_sold_at) return "—";
      try {
        return new Date(r.last_sold_at).toLocaleString();
      } catch {
        return r.last_sold_at;
      }
    },
  },
  {
    title: "Status",
    key: "status",
    width: 110,
    render: (r) =>
      h(
        NTag,
        { size: "small", type: statusTagType(r.status) },
        () => String(r.status || "active")
      ),
  },
  {
    title: "",
    key: "actions",
    width: 220,
    render: (row) => {
      const btns = [];
      if (row.status === "active") {
        btns.push(
          h(
            NButton,
            {
              size: "tiny",
              type: "primary",
              secondary: true,
              onClick: () => openPromote(row),
            },
            () => "Promote"
          )
        );
        btns.push(
          h(
            NButton,
            {
              size: "tiny",
              secondary: true,
              onClick: () => confirmArchive(row),
            },
            () => "Archive"
          )
        );
      } else if (row.status === "archived") {
        btns.push(
          h(
            NButton,
            {
              size: "tiny",
              secondary: true,
              onClick: () => reactivate(row),
            },
            () => "Reactivate"
          )
        );
      } else if (row.status === "promoted" && row.promoted_product_id) {
        btns.push(
          h(
            NButton,
            {
              size: "tiny",
              secondary: true,
              onClick: () =>
                router.push({ name: "products", query: { q: row.name } }),
            },
            () => "Open product"
          )
        );
      }
      return h(NSpace, { size: 6 }, () => btns);
    },
  },
]);

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    rows.value = await listPosCustomItems({ limit: 1000 });
  } catch (e) {
    message.error(e.message || "Could not load custom items");
  } finally {
    loading.value = false;
  }
}

function confirmArchive(row) {
  dialog.warning({
    title: "Archive custom item?",
    content: `“${row.name}” will hide from POS autocomplete. Past sales stay unchanged.`,
    positiveText: "Archive",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      try {
        await archivePosCustomItem(row.id);
        message.success("Archived");
        await load();
      } catch (e) {
        message.error(e.message || "Archive failed");
      }
    },
  });
}

async function reactivate(row) {
  try {
    await reactivatePosCustomItem(row.id);
    message.success("Reactivated");
    await load();
  } catch (e) {
    message.error(e.message || "Reactivate failed");
  }
}

/* —— Promote —— */
const showPromote = ref(false);
const promoting = ref(false);
const promoteRow = ref(null);
const promoteForm = ref({
  name: "",
  selling_price: 0,
  purchase_price: 0,
  initial_qty: 0,
  vendor_id: null,
  category_id: null,
});
const vendorOptions = ref([]);
const categoryOptions = ref([]);

async function loadPromoteOptions() {
  try {
    const [vendorsRes, cats] = await Promise.all([
      listVendors({ page: 1, pageSize: 500, activeOnly: true }),
      listCategories(),
    ]);
    vendorOptions.value = (vendorsRes?.rows || []).map((v) => ({
      label: v.name,
      value: v.id,
    }));
    categoryOptions.value = (cats || []).map((c) => ({
      label: c.name,
      value: c.id,
    }));
  } catch {
    vendorOptions.value = [];
    categoryOptions.value = [];
  }
}

function onVendorCreated(v) {
  if (!v?.id) return;
  if (!vendorOptions.value.some((o) => o.value === v.id)) {
    vendorOptions.value = [...vendorOptions.value, { label: v.name, value: v.id }];
  }
  promoteForm.value.vendor_id = v.id;
}

function openPromote(row) {
  promoteRow.value = row;
  promoteForm.value = {
    name: sanitizeCustomItemName(row.name),
    selling_price: Math.max(0, Number(row.last_unit_price) || 0),
    purchase_price: 0,
    initial_qty: 0,
    vendor_id: null,
    category_id: null,
  };
  showPromote.value = true;
  loadPromoteOptions();
}

async function submitPromote() {
  if (!promoteRow.value) return;
  const name = toTitleCase(sanitizeCustomItemName(promoteForm.value.name));
  if (!name) {
    message.warning("Name is required");
    return;
  }
  promoting.value = true;
  try {
    const { productId } = await promotePosCustomItemToProduct(promoteRow.value, {
      ...promoteForm.value,
      name,
    });
    message.success(`Product created (${String(productId).slice(0, 8)}…)`);
    showPromote.value = false;
    await load();
  } catch (e) {
    message.error(e.message || "Promote failed");
  } finally {
    promoting.value = false;
  }
}

function onPageChange(p) {
  page.value = p;
}
function onPageSizeChange(s) {
  pageSize.value = s;
  page.value = 1;
}

watch([search, statusFilter, soldRangePreset, soldFrom, soldTo], () => {
  page.value = 1;
});

onMounted(load);
</script>

<template>
  <div class="app-page app-page--fill">
    <h1 style="margin-top: 0">Custom items</h1>
    <SupabaseRequiredAlert />
    <NText depth="3" style="display: block; margin-bottom: 16px; font-size: 13px">
      Names sold from POS as custom lines (not catalog products). Rows appear when a sale completes.
      Promote to create a real product when you want stock and barcodes.
    </NText>

    <div class="app-toolbar app-toolbar--tight">
      <NSpace class="app-filter-stack" align="center" wrap>
        <NInput
          v-model:value="search"
          clearable
          placeholder="Search name"
          style="width: 240px"
        />
        <NButton :disabled="!supabaseConfigured" :loading="loading" @click="load">Refresh</NButton>
        <ClearFiltersButton v-if="hasActiveFilters" :disabled="false" @clear="clearFilters" />
      </NSpace>
    </div>

    <RuleFilterBar :fields="ruleFieldsSold" />

    <div class="app-table-panel">
      <NDataTable
        :loading="loading"
        :columns="columns"
        :data="paged"
        :row-key="(r) => r.id"
        :scroll-x="1100"
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
      v-model:show="showPromote"
      preset="card"
      title="Promote to product"
      style="width: min(480px, 96vw)"
      :mask-closable="false"
    >
      <NText depth="3" style="display: block; margin-bottom: 12px; font-size: 13px">
        Creates a catalog product. Past custom sale lines stay as snapshots (not rewritten).
      </NText>
      <NForm label-placement="top">
        <NFormItem label="Name" required>
          <NInput v-model:value="promoteForm.name" placeholder="Product name" />
        </NFormItem>
        <NFormItem label="Selling price (PKR)" required>
          <NInputNumber
            v-model:value="promoteForm.selling_price"
            :min="0"
            :precision="2"
            style="width: 100%"
          />
        </NFormItem>
        <NFormItem label="Purchase price (PKR)">
          <NInputNumber
            v-model:value="promoteForm.purchase_price"
            :min="0"
            :precision="2"
            style="width: 100%"
          />
        </NFormItem>
        <NFormItem label="Initial stock (pcs)">
          <NInputNumber
            v-model:value="promoteForm.initial_qty"
            :min="0"
            :precision="0"
            style="width: 100%"
          />
        </NFormItem>
        <NFormItem label="Vendor">
          <CreatableVendorSelect
            v-model:value="promoteForm.vendor_id"
            :options="vendorOptions"
            style="width: 100%"
            @vendor-created="onVendorCreated"
          />
        </NFormItem>
        <NFormItem label="Category">
          <NSelect
            v-model:value="promoteForm.category_id"
            :options="categoryOptions"
            clearable
            filterable
            placeholder="Category"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showPromote = false">Cancel</NButton>
          <NButton type="primary" :loading="promoting" @click="submitPromote">
            Create product
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
