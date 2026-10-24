<script setup>
import { ref, onMounted, computed, h } from "vue";
import {
  NCard,
  NButton,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NDatePicker,
  NSwitch,
  NSpace,
  NText,
  NSelect,
  NRadioGroup,
  NRadio,
  useMessage,
  useDialog,
} from "naive-ui";
import { storeToRefs } from "pinia";
import { supabaseConfigured } from "../lib/supabase.js";
import { formatPkr } from "../utils/format.js";
import {
  formatScheduledPromoRule,
  formatScheduledPromoScope,
  scheduledPromoUsesPercent,
} from "../utils/scheduledDiscount.js";
import {
  localDateIso,
  listScheduledSaleDiscounts,
  createScheduledSaleDiscount,
  updateScheduledSaleDiscount,
  deleteScheduledSaleDiscount,
} from "../services/scheduledDiscounts.js";
import { useProductCacheStore, refreshProductCatalog } from "../stores/productCache.js";
import { fitNameColumnWidth } from "../utils/tableColumns.js";

const message = useMessage();
const dialog = useDialog();
const productCache = useProductCacheStore();
const { activeProducts } = storeToRefs(productCache);

const rows = ref([]);
const loading = ref(false);
const modalOpen = ref(false);
const saving = ref(false);
const editingId = ref(null);

const today = localDateIso();

const scopeOptions = [
  { label: "All products (whole order)", value: "all" },
  { label: "By unit price", value: "by_price" },
  { label: "Specific products", value: "specific" },
];

const priceOpOptions = [
  { label: "≤ Less than or equal to", value: "lte" },
  { label: "≥ Greater than or equal to", value: "gte" },
];

function emptyForm() {
  return {
    name: "",
    discount_amount: 0,
    discount_percent: 10,
    start_date: today,
    end_date: today,
    is_active: true,
    product_scope: "all",
    price_op: "lte",
    price_threshold: 0,
    product_ids: [],
  };
}

const form = ref(emptyForm());

const productSelectOptions = computed(() =>
  (activeProducts.value ?? [])
    .slice()
    .sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, {
        sensitivity: "base",
        numeric: true,
      })
    )
    .map((p) => ({
      label: `${p.external_product_id ? `${p.external_product_id} · ` : ""}${p.name} (${formatPkr(p.selling_price)})`,
      value: p.id,
    }))
);

const startPicker = computed({
  get: () => dateToPicker(form.value.start_date),
  set: (v) => {
    form.value.start_date = pickerToDate(v);
    if (form.value.end_date < form.value.start_date) {
      form.value.end_date = form.value.start_date;
    }
  },
});

const endPicker = computed({
  get: () => dateToPicker(form.value.end_date),
  set: (v) => {
    form.value.end_date = pickerToDate(v);
  },
});

function dateToPicker(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

function pickerToDate(ts) {
  if (!ts) return today;
  const d = new Date(ts);
  return localDateIso(d);
}

function formatRange(row) {
  return `${row.start_date} → ${row.end_date}`;
}

function statusLabel(row) {
  if (!row.is_active) return "Off";
  if (row.end_date < today) return "Ended";
  if (row.start_date > today) return "Scheduled";
  return "Active now";
}

const nameColumnWidth = computed(() => fitNameColumnWidth(rows.value));
const tableScrollX = computed(
  () => nameColumnWidth.value + 120 + 200 + 160 + 100 + 140 + 24
);

const columns = computed(() => [
  {
    title: "Name",
    key: "name",
    width: nameColumnWidth.value,
    ellipsis: { tooltip: true },
    render: (r) => r.name || "—",
  },
  {
    title: "Discount",
    key: "discount",
    width: 120,
    render: (r) => {
      if (scheduledPromoUsesPercent(r)) {
        const amt = Number(r.discount_amount) > 0 ? ` (PKR ignored)` : "";
        return `${r.discount_percent}%${amt}`;
      }
      return formatScheduledPromoRule(r, formatPkr).split(" · ")[0];
    },
  },
  {
    title: "Applies to",
    key: "scope",
    width: 200,
    ellipsis: { tooltip: true },
    render: (r) => formatScheduledPromoScope(r, formatPkr),
  },
  { title: "Dates", key: "dates", width: 160, render: (r) => formatRange(r) },
  { title: "Status", key: "status", width: 100, render: (r) => statusLabel(r) },
  {
    title: "",
    key: "actions",
    width: 140,
    render: (row) =>
      h(NSpace, { size: "small" }, () => [
        h(
          NButton,
          { size: "small", quaternary: true, onClick: () => openEdit(row) },
          () => "Edit"
        ),
        h(
          NButton,
          { size: "small", quaternary: true, type: "error", onClick: () => confirmDelete(row) },
          () => "Delete"
        ),
      ]),
  },
]);

function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  modalOpen.value = true;
}

function openEdit(row) {
  editingId.value = row.id;
  const scope = String(row.product_scope ?? "all").toLowerCase();
  form.value = {
    name: row.name ?? "",
    discount_amount: Number(row.discount_amount) || 0,
    discount_percent: Number(row.discount_percent) || 0,
    start_date: row.start_date,
    end_date: row.end_date,
    is_active: row.is_active !== false,
    product_scope: scope === "by_price" || scope === "specific" ? scope : "all",
    price_op: row.price_op === "gte" ? "gte" : "lte",
    price_threshold: Number(row.price_threshold) || 0,
    product_ids: Array.isArray(row.product_ids) ? [...row.product_ids] : [],
  };
  modalOpen.value = true;
}

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    rows.value = await listScheduledSaleDiscounts();
  } catch (e) {
    message.error(e.message || "Could not load scheduled discounts");
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!form.value.start_date || !form.value.end_date) {
    message.warning("Choose start and end dates");
    return;
  }
  if (form.value.end_date < form.value.start_date) {
    message.warning("End date must be on or after start date");
    return;
  }
  const pct = Number(form.value.discount_percent) || 0;
  const amt = Number(form.value.discount_amount) || 0;
  if (pct <= 0 && amt <= 0) {
    message.warning("Set a discount percent or a fixed PKR amount");
    return;
  }
  if (form.value.product_scope === "by_price") {
    if (!form.value.price_op) {
      message.warning("Choose ≤ or ≥ for the price rule");
      return;
    }
  }
  if (form.value.product_scope === "specific" && !form.value.product_ids?.length) {
    message.warning("Select at least one product");
    return;
  }
  saving.value = true;
  try {
    if (editingId.value) {
      await updateScheduledSaleDiscount(editingId.value, form.value);
      message.success("Discount updated");
    } else {
      await createScheduledSaleDiscount(form.value);
      message.success("Discount created");
    }
    modalOpen.value = false;
    await load();
  } catch (e) {
    message.error(e.message || "Save failed");
  } finally {
    saving.value = false;
  }
}

function confirmDelete(row) {
  dialog.warning({
    title: "Delete scheduled discount?",
    content: `${row.name ? `"${row.name}"` : formatRange(row)} — soft-delete (turned off). Record kept.`,
    positiveText: "Delete",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      try {
        await deleteScheduledSaleDiscount(row.id);
        message.success("Discount soft-deleted");
        await load();
      } catch (e) {
        message.error(e.message || "Delete failed");
      }
    },
  });
}

onMounted(async () => {
  productCache.hydrateFromStorage();
  if (supabaseConfigured && !activeProducts.value.length) {
    refreshProductCatalog({ force: true }).catch(() => {});
  }
  await load();
});
</script>

<template>
  <NCard title="Scheduled sale discounts" class="scheduled-discounts-card">
    <NText depth="3" style="display: block; margin-bottom: 12px; font-size: 13px">
      During the date range, POS applies the discount automatically. Choose all products (whole
      order), a unit-price rule (≤ / ≥), or a specific product list. If percent is set, it wins over
      PKR amount. Cashiers can remove it per sale.
    </NText>
    <NSpace style="margin-bottom: 12px">
      <NButton type="primary" :disabled="!supabaseConfigured" @click="openCreate">
        Add scheduled discount
      </NButton>
    </NSpace>
    <div class="app-table-scroll">
      <NDataTable
        :columns="columns"
        :data="rows"
        :loading="loading"
        size="small"
        :bordered="false"
        :scroll-x="tableScrollX"
      />
    </div>

    <NModal
      v-model:show="modalOpen"
      preset="card"
      :title="editingId ? 'Edit scheduled discount' : 'New scheduled discount'"
      style="width: min(520px, 96vw)"
    >
      <NForm label-placement="top">
        <NFormItem label="Label (optional)">
          <NInput v-model:value="form.name" placeholder="e.g. Eid week sale" />
        </NFormItem>

        <NFormItem label="Applies to">
          <NRadioGroup v-model:value="form.product_scope" name="product_scope">
            <NSpace vertical :size="6">
              <NRadio v-for="o in scopeOptions" :key="o.value" :value="o.value">
                {{ o.label }}
              </NRadio>
            </NSpace>
          </NRadioGroup>
        </NFormItem>

        <template v-if="form.product_scope === 'by_price'">
          <NFormItem label="Unit price rule">
            <NSpace style="width: 100%" :wrap="false">
              <NSelect
                v-model:value="form.price_op"
                :options="priceOpOptions"
                style="width: 220px; flex-shrink: 0"
              />
              <NInputNumber
                v-model:value="form.price_threshold"
                :min="0"
                placeholder="Amount (PKR)"
                style="flex: 1; min-width: 120px"
              />
            </NSpace>
          </NFormItem>
          <NText depth="3" style="font-size: 12px; display: block; margin: -8px 0 12px">
            Discount applies only to cart lines whose unit sale price matches this rule.
          </NText>
        </template>

        <template v-else-if="form.product_scope === 'specific'">
          <NFormItem label="Products">
            <NSelect
              v-model:value="form.product_ids"
              :options="productSelectOptions"
              multiple
              filterable
              clearable
              placeholder="Select products"
              style="width: 100%"
              :max-tag-count="3"
            />
          </NFormItem>
          <NText depth="3" style="font-size: 12px; display: block; margin: -8px 0 12px">
            Discount applies only to the selected products in the cart.
          </NText>
        </template>

        <NText
          v-else
          depth="3"
          style="font-size: 12px; display: block; margin: -4px 0 12px"
        >
          Discount applies to the whole order subtotal.
        </NText>

        <NFormItem label="Discount percent (%)">
          <NInputNumber
            v-model:value="form.discount_percent"
            :min="0"
            :max="100"
            :precision="2"
            style="width: 100%"
          />
        </NFormItem>
        <NFormItem label="Discount amount (PKR)">
          <NInputNumber v-model:value="form.discount_amount" :min="0" style="width: 100%" />
        </NFormItem>
        <NText depth="3" style="font-size: 12px; display: block; margin: -8px 0 12px">
          Percent &gt; 0 uses percent of the eligible total. Both filled → percent only. Only PKR →
          fixed amount (capped at eligible total).
        </NText>
        <NFormItem label="Start date">
          <NDatePicker v-model:value="startPicker" type="date" style="width: 100%" />
        </NFormItem>
        <NFormItem label="End date (inclusive)">
          <NDatePicker v-model:value="endPicker" type="date" style="width: 100%" />
        </NFormItem>
        <NFormItem label="Active">
          <NSwitch v-model:value="form.is_active" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="modalOpen = false">Cancel</NButton>
          <NButton type="primary" :loading="saving" @click="save">Save</NButton>
        </NSpace>
      </template>
    </NModal>
  </NCard>
</template>

<style scoped>
.scheduled-discounts-card {
  width: 100%;
  max-width: none;
}
</style>
