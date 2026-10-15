<script setup>
import { onMounted, ref } from "vue";
import { NGrid, NGi, NCard, NStatistic, NAlert, NList, NListItem, NText } from "naive-ui";
import { supabaseConfigured } from "../lib/supabase.js";
import { fetchDashboardStats } from "../services/dashboard.js";
import { formatPkr } from "../utils/format.js";

const loading = ref(false);
const stats = ref(null);
const error = ref("");

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

onMounted(load);
</script>

<template>
  <div>
    <h1 style="margin-top: 0">Dashboard</h1>
    <NAlert v-if="!supabaseConfigured" type="warning" style="margin-bottom: 12px">Connect Supabase for live data.</NAlert>
    <NAlert v-if="error" type="error" style="margin-bottom: 12px">{{ error }}</NAlert>
    <NGrid cols="1 s:2 m:3" :x-gap="16" :y-gap="16">
      <NGi>
        <NCard :loading="loading">
          <NStatistic label="Active products" :value="stats?.activeCount ?? '—'" />
        </NCard>
      </NGi>
      <NGi>
        <NCard :loading="loading">
          <NStatistic label="Units in stock" :value="stats?.unitsInStock ?? '—'" />
        </NCard>
      </NGi>
      <NGi>
        <NCard :loading="loading">
          <NStatistic label="Inventory value" :value="stats ? formatPkr(stats.inventoryValue) : '—'" />
        </NCard>
      </NGi>
      <NGi>
        <NCard :loading="loading">
          <NStatistic label="Today's sales" :value="stats?.todaySalesCount ?? '—'" />
        </NCard>
      </NGi>
      <NGi>
        <NCard :loading="loading">
          <NStatistic label="Today's revenue" :value="stats ? formatPkr(stats.todayRevenue) : '—'" />
        </NCard>
      </NGi>
      <NGi>
        <NCard :loading="loading">
          <NStatistic label="Today's gross profit" :value="stats ? formatPkr(stats.todayProfit) : '—'" />
        </NCard>
      </NGi>
    </NGrid>
    <NGrid cols="1 m:2" :x-gap="16" style="margin-top: 16px">
      <NGi>
        <NCard title="Low stock" :loading="loading">
          <NList v-if="stats?.lowStock?.length">
            <NListItem v-for="p in stats.lowStock" :key="p.id">
              {{ p.name }} — {{ p.current_stock }} / threshold {{ p.low_stock_threshold }}
            </NListItem>
          </NList>
          <NText v-else depth="3">No low-stock alerts.</NText>
        </NCard>
      </NGi>
      <NGi>
        <NCard title="Recent sales" :loading="loading">
          <NList v-if="stats?.recentSales?.length">
            <NListItem v-for="s in stats.recentSales" :key="s.id">
              {{ s.sale_reference }} — {{ formatPkr(s.total_amount) }}
            </NListItem>
          </NList>
          <NText v-else depth="3">No sales yet.</NText>
        </NCard>
      </NGi>
    </NGrid>
  </div>
</template>
