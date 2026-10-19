<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { NAlert, NButton, NSpace, NSpin, NTag } from "naive-ui";
import {
  CubeOutline,
  LayersOutline,
  CashOutline,
  TrendingUpOutline,
  ReceiptOutline,
  WarningOutline,
} from "@vicons/ionicons5";
import { supabaseConfigured } from "../lib/supabase.js";
import { fetchDashboardStats } from "../services/dashboard.js";
import { formatPkr } from "../utils/format.js";

const router = useRouter();
const loading = ref(false);
const stats = ref(null);
const error = ref("");

const todayLabel = computed(() =>
  new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
);

const metricCards = computed(() => {
  if (!stats.value) return [];
  return [
    {
      key: "products",
      label: "Active products",
      value: String(stats.value.activeCount),
      hint: "In catalog",
      icon: CubeOutline,
      accent: "#0f766e",
      bg: "#ecfdf5",
    },
    {
      key: "stock",
      label: "Units in stock",
      value: String(stats.value.unitsInStock),
      hint: "On hand",
      icon: LayersOutline,
      accent: "#0369a1",
      bg: "#e0f2fe",
    },
    {
      key: "value",
      label: "Inventory value",
      value: formatPkr(stats.value.inventoryValue),
      hint: "At cost",
      icon: CashOutline,
      accent: "#7c3aed",
      bg: "#f3e8ff",
    },
    {
      key: "sales",
      label: "Today's sales",
      value: String(stats.value.todaySalesCount),
      hint: "Completed",
      icon: ReceiptOutline,
      accent: "#c2410c",
      bg: "#ffedd5",
    },
    {
      key: "revenue",
      label: "Today's revenue",
      value: formatPkr(stats.value.todayRevenue),
      hint: "Cash in",
      icon: TrendingUpOutline,
      accent: "#15803d",
      bg: "#dcfce7",
    },
    {
      key: "profit",
      label: "Today's profit",
      value: formatPkr(stats.value.todayProfit),
      hint: "Gross",
      icon: TrendingUpOutline,
      accent: "#0f766e",
      bg: "#ccfbf1",
    },
  ];
});

async function load() {
  if (!supabaseConfigured) return;
  loading.value = true;
  error.value = "";
  try {
    stats.value = await fetchDashboardStats();
  } catch (e) {
    error.value = e.message || "Failed to load dashboard";
  } finally {
    loading.value = false;
  }
}

function go(name) {
  router.push({ name });
}

onMounted(load);
</script>

<template>
  <div class="dash">
    <header class="dash-hero">
      <div>
        <p class="dash-hero-date">{{ todayLabel }}</p>
        <h1 class="dash-hero-title">Dashboard</h1>
        <p class="dash-hero-sub">Quick snapshot of stock and today’s sales.</p>
      </div>
      <NSpace class="dash-hero-actions" :size="8">
        <NButton type="primary" @click="go('pos')">Open POS</NButton>
        <NButton quaternary @click="load">Refresh</NButton>
      </NSpace>
    </header>

    <NAlert v-if="!supabaseConfigured" type="warning" style="margin-bottom: 16px">
      Connect Supabase for live data.
    </NAlert>
    <NAlert v-if="error" type="error" style="margin-bottom: 16px">{{ error }}</NAlert>

    <NSpin :show="loading">
      <section v-if="stats" class="metrics">
        <article
          v-for="card in metricCards"
          :key="card.key"
          class="metric-card"
          :style="{ '--accent': card.accent, '--bg': card.bg }"
        >
          <div class="metric-icon-wrap">
            <component :is="card.icon" class="metric-icon" />
          </div>
          <div class="metric-body">
            <span class="metric-label">{{ card.label }}</span>
            <span class="metric-value">{{ card.value }}</span>
            <span class="metric-hint">{{ card.hint }}</span>
          </div>
        </article>
      </section>

      <section v-if="stats" class="panels">
        <div class="panel">
          <div class="panel-head">
            <div class="panel-title-row">
              <WarningOutline class="panel-icon warn" />
              <h2>Low stock</h2>
            </div>
            <NButton size="small" quaternary @click="go('inventory')">Inventory</NButton>
          </div>
          <ul v-if="stats.lowStock?.length" class="panel-list">
            <li v-for="p in stats.lowStock" :key="p.id" class="panel-row">
              <span class="panel-row-name">{{ p.name }}</span>
              <NTag size="small" type="warning" round>
                {{ p.current_stock }} / {{ p.low_stock_threshold }}
              </NTag>
            </li>
          </ul>
          <p v-else class="panel-empty">All good — no low-stock alerts.</p>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div class="panel-title-row">
              <ReceiptOutline class="panel-icon" />
              <h2>Recent sales</h2>
            </div>
            <NButton size="small" quaternary @click="go('sales')">All sales</NButton>
          </div>
          <ul v-if="stats.recentSales?.length" class="panel-list">
            <li v-for="s in stats.recentSales" :key="s.id" class="panel-row">
              <span class="panel-row-name">{{ s.sale_reference }}</span>
              <span class="panel-row-amount">{{ formatPkr(s.total_amount) }}</span>
            </li>
          </ul>
          <p v-else class="panel-empty">No sales yet today or earlier.</p>
        </div>
      </section>
    </NSpin>
  </div>
</template>

<style scoped>
.dash {
  max-width: 1200px;
}
.dash-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
  padding: 20px 22px;
  border-radius: 14px;
  background: linear-gradient(135deg, #0f766e 0%, #134e4a 55%, #1e3a5f 100%);
  color: #fff;
  box-shadow: 0 8px 24px rgba(15, 118, 110, 0.25);
}
.dash-hero-date {
  margin: 0 0 4px;
  font-size: 13px;
  opacity: 0.9;
}
.dash-hero-title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.dash-hero-sub {
  margin: 6px 0 0;
  font-size: 14px;
  opacity: 0.88;
}
.dash-hero-actions :deep(.n-button--primary-type) {
  background: #fff;
  color: #0f766e;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}
.metric-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.metric-icon-wrap {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.metric-icon {
  width: 22px;
  height: 22px;
  color: var(--accent);
}
.metric-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.metric-label {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.metric-value {
  font-size: 1.35rem;
  font-weight: 800;
  color: #111827;
  line-height: 1.2;
  margin-top: 2px;
}
.metric-hint {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 2px;
}
.panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 16px 18px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.panel-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.panel-title-row h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: #111827;
}
.panel-icon {
  width: 20px;
  height: 20px;
  color: #0f766e;
}
.panel-icon.warn {
  color: #d97706;
}
.panel-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.panel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f3f4f6;
}
.panel-row:last-child {
  border-bottom: none;
}
.panel-row-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel-row-amount {
  font-weight: 700;
  color: #0f766e;
  font-size: 14px;
}
.panel-empty {
  margin: 0;
  padding: 12px 0;
  color: #9ca3af;
  font-size: 14px;
}
@media (max-width: 900px) {
  .metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .metrics {
    grid-template-columns: 1fr;
  }
  .panels {
    grid-template-columns: 1fr;
  }
}
</style>
