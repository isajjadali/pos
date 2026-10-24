<script setup>
import { ref, onMounted, watch, computed, h } from "vue";
import {
  NButton,
  NSpace,
  NInput,
  NSelect,
  NDataTable,
  NModal,
  NText,
  useMessage,
} from "naive-ui";
import ClearFiltersButton from "../components/ClearFiltersButton.vue";
import CreatedDateFilter from "../components/CreatedDateFilter.vue";
import SupabaseRequiredAlert from "../components/SupabaseRequiredAlert.vue";
import { supabaseConfigured } from "../lib/supabase.js";
import { listAuditLogs } from "../services/auditLogs.js";
import { buildAuditChangeRows } from "../utils/auditDiff.js";
import { dateRangeFilterActive } from "../utils/dateRange.js";
import {
  rowNumberColumn,
  createdAtColumn,
  paginationTotalPrefix,
  fitNameColumnWidth,
} from "../utils/tableColumns.js";

const message = useMessage();

const loading = ref(false);
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);

const search = ref("");
const actionFilter = ref(null);
const entityFilter = ref(null);
const createdRangePreset = ref("week");
const createdFrom = ref(null);
const createdTo = ref(null);

const detailOpen = ref(false);
const detail = ref(null);

const actionOptions = [
  { label: "Create", value: "create" },
  { label: "Update", value: "update" },
  { label: "Soft delete", value: "soft_delete" },
  { label: "Reactivate", value: "reactivate" },
  { label: "Cancel", value: "cancel" },
  { label: "Delete", value: "delete" },
];

const entityOptions = [
  { label: "Products", value: "products" },
  { label: "Vendors", value: "vendors" },
  { label: "Categories", value: "categories" },
  { label: "Sales", value: "sales" },
  { label: "Staff profiles", value: "profiles" },
  { label: "Settings", value: "app_settings" },
  { label: "Scheduled discounts", value: "scheduled_sale_discounts" },
  { label: "Stock movements", value: "stock_movements" },
];

const hasActiveFilters = computed(
  () =>
    Boolean(search.value.trim()) ||
    Boolean(actionFilter.value) ||
    Boolean(entityFilter.value) ||
    dateRangeFilterActive(createdRangePreset.value, createdFrom.value, createdTo.value) ||
    createdRangePreset.value !== "all"
);

function clearFilters() {
  search.value = "";
  actionFilter.value = null;
  entityFilter.value = null;
  createdRangePreset.value = "all";
  createdFrom.value = null;
  createdTo.value = null;
  page.value = 1;
}

const actorWidth = computed(() =>
  fitNameColumnWidth(rows.value, (r) => r.actor_name || r.actor_email || "", {
    min: 120,
    headerChars: 4,
  })
);

const columns = computed(() => [
  rowNumberColumn(page, pageSize),
  createdAtColumn({ width: 168 }),
  {
    title: "User",
    key: "actor",
    width: actorWidth.value,
    ellipsis: { tooltip: true },
    render: (r) => r.actor_name || r.actor_email || "—",
  },
  {
    title: "Action",
    key: "action",
    width: 110,
  },
  {
    title: "Entity",
    key: "entity_type",
    width: 140,
  },
  {
    title: "Summary",
    key: "summary",
    ellipsis: { tooltip: true },
  },
  {
    title: "",
    key: "open",
    width: 80,
    render: (row) =>
      h(NButton, { size: "small", onClick: () => openDetail(row) }, () => "View"),
  },
]);

const tableScrollX = computed(() => 52 + 168 + actorWidth.value + 110 + 140 + 280 + 80 + 24);

const changeRows = computed(() => {
  if (!detail.value) return [];
  return buildAuditChangeRows(
    detail.value.before_data,
    detail.value.after_data,
    detail.value.action
  );
});

const detailWhen = computed(() => {
  if (!detail.value?.created_at) return "—";
  try {
    return new Date(detail.value.created_at).toLocaleString();
  } catch {
    return detail.value.created_at;
  }
});

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  try {
    const res = await listAuditLogs({
      search: search.value,
      action: actionFilter.value,
      entityType: entityFilter.value,
      createdRangePreset: createdRangePreset.value,
      createdFrom: createdFrom.value,
      createdTo: createdTo.value,
      page: page.value,
      pageSize: pageSize.value,
    });
    rows.value = res.rows;
    total.value = res.total;
  } catch (e) {
    message.error(e.message || "Failed to load audit logs");
  } finally {
    loading.value = false;
  }
}

function openDetail(row) {
  detail.value = row;
  detailOpen.value = true;
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
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    load();
  }, 300);
});

watch([actionFilter, entityFilter, createdRangePreset, createdFrom, createdTo], () => {
  page.value = 1;
  load();
});

watch([page, pageSize], () => load());

onMounted(load);
</script>

<template>
  <div class="app-page app-page--fill">
    <h1 style="margin-top: 0">Audit logs</h1>
    <NText depth="2" style="display: block; margin-bottom: 12px; max-width: 720px">
      Who created, updated, soft-deleted, or cancelled records — products, vendors, categories,
      sales, staff, settings, discounts, and stock movements.
    </NText>
    <SupabaseRequiredAlert />

    <div class="app-toolbar">
      <NSpace class="app-filter-stack" align="center" wrap>
        <NInput
          v-model:value="search"
          clearable
          placeholder="Search summary / user"
          style="width: 240px"
        />
        <NSelect
          v-model:value="actionFilter"
          :options="actionOptions"
          placeholder="Action"
          clearable
          style="width: 140px"
        />
        <NSelect
          v-model:value="entityFilter"
          :options="entityOptions"
          placeholder="Entity"
          clearable
          style="width: 180px"
        />
        <CreatedDateFilter
          v-model:preset="createdRangePreset"
          v-model:from="createdFrom"
          v-model:to="createdTo"
        />
        <NButton :disabled="!supabaseConfigured" @click="load">Refresh</NButton>
        <ClearFiltersButton v-if="hasActiveFilters" :disabled="false" @clear="clearFilters" />
      </NSpace>
    </div>

    <div class="app-table-panel">
      <NDataTable
        :loading="loading"
        :columns="columns"
        :data="rows"
        :scroll-x="tableScrollX"
        :remote="true"
        flex-height
        :pagination="{
          page,
          pageSize,
          itemCount: total,
          showSizePicker: true,
          pageSizes: [20, 50, 100],
          prefix: paginationTotalPrefix,
          onUpdatePage: onPageChange,
          onUpdatePageSize: onPageSizeChange,
        }"
      />
    </div>

    <NModal
      v-model:show="detailOpen"
      preset="card"
      class="audit-modal"
      title="Audit detail"
      style="width: min(640px, 96vw)"
    >
      <div v-if="detail" class="audit-modal-body">
        <div class="audit-meta">
          <div class="audit-meta__row">
            <span class="audit-meta__label">When</span>
            <span>{{ detailWhen }}</span>
          </div>
          <div class="audit-meta__row">
            <span class="audit-meta__label">User</span>
            <span>
              {{ detail.actor_name || "—" }}
              <NText v-if="detail.actor_email" depth="3"> ({{ detail.actor_email }})</NText>
            </span>
          </div>
          <div class="audit-meta__row">
            <span class="audit-meta__label">Action</span>
            <span>{{ detail.action }} · {{ detail.entity_type }}</span>
          </div>
          <div v-if="detail.summary" class="audit-meta__row">
            <span class="audit-meta__label">Summary</span>
            <span>{{ detail.summary }}</span>
          </div>
        </div>

        <div class="audit-changes">
          <div class="audit-changes__title">
            {{
              detail.action === "create"
                ? "Values set"
                : detail.action === "delete"
                  ? "Removed values"
                  : "What changed"
            }}
          </div>
          <div v-if="!changeRows.length" class="audit-changes__empty">
            No field-level changes recorded.
          </div>
          <ul v-else class="audit-change-list">
            <li v-for="row in changeRows" :key="row.key" class="audit-change-item">
              <div class="audit-change-item__field">{{ row.label }}</div>
              <div v-if="row.kind === 'changed'" class="audit-change-item__diff">
                <span class="audit-change-item__from">{{ row.from }}</span>
                <span class="audit-change-item__arrow">→</span>
                <span class="audit-change-item__to">{{ row.to }}</span>
              </div>
              <div v-else-if="row.kind === 'added'" class="audit-change-item__diff">
                <span class="audit-change-item__badge">Added</span>
                <span class="audit-change-item__to">{{ row.value }}</span>
              </div>
              <div v-else-if="row.kind === 'removed'" class="audit-change-item__diff">
                <span class="audit-change-item__badge audit-change-item__badge--out">Removed</span>
                <span class="audit-change-item__from">{{ row.value }}</span>
              </div>
              <div v-else class="audit-change-item__diff">
                <span class="audit-change-item__to">{{ row.value }}</span>
              </div>
            </li>
          </ul>
        </div>
      </div>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="detailOpen = false">Close</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.audit-modal-body {
  max-height: min(560px, calc(100vh - 180px));
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 6px;
  -webkit-overflow-scrolling: touch;
}
.audit-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.audit-meta__row {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 8px;
  font-size: 13px;
  line-height: 1.4;
}
.audit-meta__label {
  color: #6b7280;
  font-weight: 500;
}
.audit-changes__title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
.audit-changes__empty {
  font-size: 13px;
  color: #6b7280;
}
.audit-change-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.audit-change-item {
  padding: 10px 12px;
  border-radius: 8px;
  background: #f5f5f7;
  border: 1px solid rgba(0, 0, 0, 0.06);
}
.audit-change-item__field {
  font-size: 12px;
  font-weight: 600;
  color: #4b5563;
  margin-bottom: 4px;
}
.audit-change-item__diff {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  line-height: 1.35;
  word-break: break-word;
}
.audit-change-item__from {
  color: #9f1239;
  text-decoration: line-through;
  opacity: 0.85;
}
.audit-change-item__to {
  color: #0f766e;
  font-weight: 600;
}
.audit-change-item__arrow {
  color: #9ca3af;
  font-size: 12px;
}
.audit-change-item__badge {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: #0f766e;
  background: #ecfdf5;
  border: 1px solid #99f6e4;
  border-radius: 4px;
  padding: 1px 6px;
}
.audit-change-item__badge--out {
  color: #9f1239;
  background: #fff1f2;
  border-color: #fecdd3;
}
</style>

<style>
.audit-modal.n-card {
  max-height: calc(100vh - 24px) !important;
  display: flex !important;
  flex-direction: column;
}
.audit-modal.n-card .n-card__content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.audit-modal.n-card .n-card__footer {
  flex-shrink: 0;
}
.audit-modal.n-card .n-card__header {
  flex-shrink: 0;
}
</style>
