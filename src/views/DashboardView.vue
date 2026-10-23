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
  CalendarOutline,
  SparklesOutline,
  ArrowUpOutline,
  ArrowDownOutline,
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
    year: "numeric",
  })
);

function fmtMargin(m) {
  if (m == null || !Number.isFinite(m)) return "—";
  return `${m}%`;
}

function periodTone(profit) {
  if (profit > 0) return "up";
  if (profit < 0) return "down";
  return "flat";
}

const heroKpis = computed(() => {
  if (!stats.value) return [];
  const o = stats.value.overall;
  return [
    {
      key: "orev",
      label: "Overall revenue",
      value: formatPkr(o.revenue),
      meta: `${o.salesCount} sale${o.salesCount === 1 ? "" : "s"} all time`,
    },
    {
      key: "opro",
      label: "Overall profit",
      value: formatPkr(o.profit),
      meta: `Gross margin ${fmtMargin(o.marginPct)}`,
      tone: periodTone(o.profit),
    },
    {
      key: "omargin",
      label: "Overall margin",
      value: fmtMargin(o.marginPct),
      meta: "Profit ÷ revenue",
    },
  ];
});

const periodCards = computed(() => {
  if (!stats.value) return [];
  const { today, week, month } = stats.value;
  return [
    {
      key: "today",
      title: "Today",
      icon: SparklesOutline,
      sales: today.salesCount,
      revenue: today.revenue,
      profit: today.profit,
      margin: today.marginPct,
    },
    {
      key: "week",
      title: "This week",
      icon: CalendarOutline,
      sales: week.salesCount,
      revenue: week.revenue,
      profit: week.profit,
      margin: week.marginPct,
    },
    {
      key: "month",
      title: "This month",
      icon: TrendingUpOutline,
      sales: month.salesCount,
      revenue: month.revenue,
      profit: month.profit,
      margin: month.marginPct,
    },
  ];
});

const stockCards = computed(() => {
  if (!stats.value) return [];
  return [
    {
      key: "products",
      label: "Active products",
      value: String(stats.value.activeCount),
      hint: "In catalog",
      icon: CubeOutline,
    },
    {
      key: "stock",
      label: "Units in stock",
      value: Number(stats.value.unitsInStock).toLocaleString("en-PK"),
      hint: "On hand (pieces)",
      icon: LayersOutline,
    },
    {
      key: "value",
      label: "Inventory at cost",
      value: formatPkr(stats.value.inventoryValue),
      hint: "Tied-up capital",
      icon: CashOutline,
    },
  ];
});

const chartDays = computed(() => {
  if (!stats.value?.last7Days) return [];
  const peak = stats.value.peakDayRevenue || 0;
  return stats.value.last7Days.map((d) => ({
    ...d,
    heightPct: peak > 0 ? Math.max(4, Math.round((d.revenue / peak) * 100)) : 4,
    isToday: d.date === dayKeyLocal(new Date()),
  }));
});

function dayKeyLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

function formatSaleTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

onMounted(load);
</script>

<template>
  <div class="dash">
    <header class="dash-hero">
      <div class="dash-hero-glow" aria-hidden="true" />
      <div class="dash-hero-main">
        <p class="dash-hero-date">{{ todayLabel }}</p>
        <h1 class="dash-hero-title">Command center</h1>
        <p class="dash-hero-sub">
          Live P&amp;L across today, this week, this month, and all-time — built for operators who
          live in the numbers.
        </p>
      </div>
      <NSpace class="dash-hero-actions" :size="8">
        <NButton type="primary" @click="go('pos')">Open POS</NButton>
        <NButton class="dash-ghost-btn" :loading="loading" @click="load">Refresh</NButton>
      </NSpace>

      <div v-if="stats" class="dash-hero-kpis">
        <div v-for="k in heroKpis" :key="k.key" class="dash-hero-kpi" :data-tone="k.tone || ''">
          <span class="dash-hero-kpi-label">{{ k.label }}</span>
          <span class="dash-hero-kpi-value">{{ k.value }}</span>
          <span class="dash-hero-kpi-meta">{{ k.meta }}</span>
        </div>
      </div>
    </header>

    <NAlert v-if="!supabaseConfigured" type="warning" style="margin-bottom: 16px">
      Connect Supabase for live data.
    </NAlert>
    <NAlert v-if="error" type="error" style="margin-bottom: 16px">{{ error }}</NAlert>

    <NSpin :show="loading">
      <template v-if="stats">
        <section class="period-grid">
          <article v-for="p in periodCards" :key="p.key" class="period-card">
            <div class="period-card-top">
              <div class="period-card-title">
                <component :is="p.icon" class="period-card-icon" />
                <h2>{{ p.title }}</h2>
              </div>
              <span class="period-sales">{{ p.sales }} sales</span>
            </div>
            <div class="period-metrics">
              <div class="period-metric">
                <span class="period-metric-label">Revenue</span>
                <span class="period-metric-value">{{ formatPkr(p.revenue) }}</span>
              </div>
              <div class="period-metric">
                <span class="period-metric-label">Profit</span>
                <span
                  class="period-metric-value"
                  :class="{
                    'is-up': p.profit > 0,
                    'is-down': p.profit < 0,
                  }"
                >
                  <component
                    :is="p.profit >= 0 ? ArrowUpOutline : ArrowDownOutline"
                    class="period-trend-icon"
                  />
                  {{ formatPkr(p.profit) }}
                </span>
              </div>
              <div class="period-metric">
                <span class="period-metric-label">Margin</span>
                <span class="period-metric-value period-margin">{{ fmtMargin(p.margin) }}</span>
              </div>
            </div>
          </article>
        </section>

        <section class="chart-panel">
          <div class="chart-head">
            <div>
              <h2>Last 7 days · revenue</h2>
              <p>Daily cash-in from completed sales</p>
            </div>
            <NButton size="small" quaternary @click="go('sales')">Sales history</NButton>
          </div>
          <div class="chart-bars" role="img" aria-label="Revenue by day for the last 7 days">
            <div
              v-for="d in chartDays"
              :key="d.date"
              class="chart-col"
              :class="{ 'is-today': d.isToday }"
              :title="`${d.label} ${d.dayNum}: ${formatPkr(d.revenue)} · profit ${formatPkr(d.profit)}`"
            >
              <span class="chart-bar-wrap">
                <span
                  class="chart-bar"
                  :style="{ height: `${d.heightPct}%` }"
                />
              </span>
              <span class="chart-day">{{ d.label }}</span>
              <span class="chart-amt">{{ d.revenue > 0 ? formatPkr(d.revenue) : "—" }}</span>
            </div>
          </div>
        </section>

        <section class="stock-grid">
          <article v-for="card in stockCards" :key="card.key" class="stock-card">
            <div class="stock-icon-wrap">
              <component :is="card.icon" class="stock-icon" />
            </div>
            <div>
              <span class="stock-label">{{ card.label }}</span>
              <span class="stock-value">{{ card.value }}</span>
              <span class="stock-hint">{{ card.hint }}</span>
            </div>
          </article>
        </section>

        <section class="panels">
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
                <div class="panel-row-stack">
                  <span class="panel-row-name">{{ s.sale_reference }}</span>
                  <span class="panel-row-time">{{ formatSaleTime(s.completed_at) }}</span>
                </div>
                <span class="panel-row-amount">{{ formatPkr(s.total_amount) }}</span>
              </li>
            </ul>
            <p v-else class="panel-empty">No sales yet.</p>
          </div>
        </section>
      </template>
    </NSpin>
  </div>
</template>

<style scoped>
.dash {
  max-width: 1180px;
  padding-bottom: 28px;
}

.dash-hero {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px 24px;
  margin-bottom: 22px;
  padding: 26px 28px 22px;
  border-radius: 18px;
  background:
    radial-gradient(1200px 280px at 10% -20%, rgba(45, 212, 191, 0.28), transparent 55%),
    linear-gradient(145deg, #042f2e 0%, #0f766e 42%, #134e4a 72%, #0c1b2a 100%);
  color: #fff;
  box-shadow:
    0 18px 40px rgba(15, 118, 110, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.dash-hero-glow {
  position: absolute;
  right: -40px;
  top: -60px;
  width: 220px;
  height: 220px;
  border-radius: 50%;
  background: rgba(94, 234, 212, 0.18);
  filter: blur(8px);
  pointer-events: none;
}

.dash-hero-main {
  position: relative;
  z-index: 1;
  grid-column: 1;
}

.dash-hero-date {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.78;
}

.dash-hero-title {
  margin: 0;
  font-size: clamp(1.6rem, 2.4vw, 2.05rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.dash-hero-sub {
  margin: 8px 0 0;
  max-width: 42rem;
  font-size: 14px;
  line-height: 1.45;
  opacity: 0.88;
}

.dash-hero-actions {
  position: relative;
  z-index: 1;
  align-self: start;
}

.dash-hero-actions :deep(.n-button--primary-type) {
  background: #fff;
  color: #0f766e;
  font-weight: 700;
  border: none;
}

.dash-ghost-btn {
  color: #fff !important;
  background: rgba(255, 255, 255, 0.1) !important;
  border: 1px solid rgba(255, 255, 255, 0.22) !important;
}

.dash-hero-kpis {
  position: relative;
  z-index: 1;
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 6px;
}

.dash-hero-kpi {
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(8px);
}

.dash-hero-kpi-label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.72;
}

.dash-hero-kpi-value {
  display: block;
  margin-top: 4px;
  font-size: clamp(1.15rem, 2vw, 1.45rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.dash-hero-kpi[data-tone="up"] .dash-hero-kpi-value {
  color: #a7f3d0;
}

.dash-hero-kpi[data-tone="down"] .dash-hero-kpi-value {
  color: #fecaca;
}

.dash-hero-kpi-meta {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  opacity: 0.7;
}

.period-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.period-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.period-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(15, 118, 110, 0.1);
}

.period-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}

.period-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.period-card-title h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 750;
  color: #111827;
}

.period-card-icon {
  width: 18px;
  height: 18px;
  color: #0f766e;
}

.period-sales {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  background: #f3f4f6;
  padding: 3px 8px;
  border-radius: 999px;
}

.period-metrics {
  display: grid;
  gap: 10px;
}

.period-metric-label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #9ca3af;
}

.period-metric-value {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: 1.15rem;
  font-weight: 800;
  color: #111827;
  font-variant-numeric: tabular-nums;
}

.period-metric-value.is-up {
  color: #047857;
}

.period-metric-value.is-down {
  color: #b91c1c;
}

.period-trend-icon {
  width: 14px;
  height: 14px;
}

.period-margin {
  color: #0f766e;
}

.chart-panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 16px 18px 18px;
  margin-bottom: 16px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.chart-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.chart-head h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 750;
  color: #111827;
}

.chart-head p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #9ca3af;
}

.chart-bars {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 10px;
  align-items: end;
  min-height: 180px;
}

.chart-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.chart-bar-wrap {
  width: 100%;
  height: 140px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  border-radius: 10px 10px 4px 4px;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  padding: 6px 8px 0;
}

.chart-bar {
  width: 100%;
  max-width: 36px;
  border-radius: 8px 8px 3px 3px;
  background: linear-gradient(180deg, #2dd4bf 0%, #0f766e 100%);
  box-shadow: 0 6px 14px rgba(15, 118, 110, 0.25);
  transition: height 0.35s ease;
}

.chart-col.is-today .chart-bar {
  background: linear-gradient(180deg, #fbbf24 0%, #d97706 100%);
  box-shadow: 0 6px 14px rgba(217, 119, 6, 0.28);
}

.chart-col.is-today .chart-day {
  color: #b45309;
  font-weight: 800;
}

.chart-day {
  font-size: 11px;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.chart-amt {
  font-size: 10px;
  font-weight: 600;
  color: #9ca3af;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  font-variant-numeric: tabular-nums;
}

.stock-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.stock-card {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 16px 18px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
}

.stock-icon-wrap {
  width: 42px;
  height: 42px;
  border-radius: 11px;
  background: #ecfdf5;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stock-icon {
  width: 20px;
  height: 20px;
  color: #0f766e;
}

.stock-label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #9ca3af;
}

.stock-value {
  display: block;
  margin-top: 2px;
  font-size: 1.2rem;
  font-weight: 800;
  color: #111827;
  font-variant-numeric: tabular-nums;
}

.stock-hint {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: #9ca3af;
}

.panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 16px 18px;
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
  font-weight: 750;
  color: #111827;
}

.panel-icon {
  width: 20px;
  height: 20px;
  color: #0f766e;
}

.panel-icon.warn {
  color: #b45309;
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

.panel-row-stack {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.panel-row-name {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-row-time {
  font-size: 11px;
  color: #9ca3af;
}

.panel-row-amount {
  font-weight: 800;
  color: #0f766e;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.panel-empty {
  margin: 0;
  padding: 12px 0;
  color: #9ca3af;
  font-size: 14px;
}

@media (max-width: 960px) {
  .period-grid,
  .stock-grid,
  .dash-hero-kpis {
    grid-template-columns: 1fr;
  }
  .dash-hero {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .panels {
    grid-template-columns: 1fr;
  }
  .dash-hero {
    padding: 18px 16px;
  }
  .chart-amt {
    font-size: 9px;
  }
}
</style>
