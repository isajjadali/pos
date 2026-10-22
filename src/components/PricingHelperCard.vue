<script setup>
import { ref, computed, watch } from "vue";
import { NCard, NSpace, NInputNumber, NButton, NText, NCollapse, NCollapseItem } from "naive-ui";
import { formatPkr } from "../utils/format.js";
import {
  loadPricingHelper,
  savePricingHelper,
  computeBreakEven,
  DEFAULT_PRICING_HELPER,
} from "../utils/pricingHelper.js";

const emit = defineEmits(["apply-suggestions"]);

const cfg = ref(loadPricingHelper());
const stats = computed(() => computeBreakEven(cfg.value));

watch(
  cfg,
  (v) => savePricingHelper(v),
  { deep: true }
);

function resetDefaults() {
  cfg.value = { ...DEFAULT_PRICING_HELPER };
}

function apply() {
  emit("apply-suggestions", { ...cfg.value });
}
</script>

<template>
  <NCard size="small" class="ph-card" style="margin-bottom: 12px">
    <NCollapse :default-expanded-names="['helper']">
      <NCollapseItem title="Pricing helper" name="helper">
        <NText depth="3" style="display: block; margin-bottom: 10px; font-size: 12px">
          Monthly expense se break-even / target sales. Bands: Traffic / Core / Hero margins → Price
          Groups pe suggested sale (draft). Review karke Save.
        </NText>

        <NSpace wrap :size="12" style="margin-bottom: 12px">
          <div class="ph-field">
            <span class="ph-label">Monthly expense</span>
            <NInputNumber
              v-model:value="cfg.monthlyExpense"
              :min="0"
              :step="1000"
              size="small"
              style="width: 140px"
            />
          </div>
          <div class="ph-field">
            <span class="ph-label">Target net profit</span>
            <NInputNumber
              v-model:value="cfg.targetNetProfit"
              :min="0"
              :step="5000"
              size="small"
              style="width: 140px"
            />
          </div>
          <div class="ph-field">
            <span class="ph-label">Avg margin %</span>
            <NInputNumber
              v-model:value="cfg.avgMarginPct"
              :min="5"
              :max="85"
              :step="1"
              size="small"
              style="width: 100px"
            />
          </div>
        </NSpace>

        <div class="ph-stats">
          <div class="ph-stat">
            <span class="ph-stat-label">Break-even sales / mo</span>
            <strong>{{ stats.breakEvenSales != null ? formatPkr(stats.breakEvenSales) : "—" }}</strong>
            <span class="ph-stat-sub">~{{ stats.dailyBreakEven != null ? formatPkr(stats.dailyBreakEven) : "—" }}/day</span>
          </div>
          <div class="ph-stat">
            <span class="ph-stat-label">Target sales / mo</span>
            <strong>{{ stats.targetSales != null ? formatPkr(stats.targetSales) : "—" }}</strong>
            <span class="ph-stat-sub">gross need {{ formatPkr(stats.grossNeeded) }}</span>
          </div>
          <div class="ph-stat">
            <span class="ph-stat-label">At {{ stats.marginPct }}% margin</span>
            <strong>Expense + net covered</strong>
            <span class="ph-stat-sub">if you hit target sales</span>
          </div>
        </div>

        <NText depth="3" style="display: block; margin: 12px 0 6px; font-size: 12px; font-weight: 600">
          Band margins (by purchase cost)
        </NText>
        <NSpace wrap :size="12">
          <div class="ph-field">
            <span class="ph-label">Traffic &lt; {{ cfg.trafficCostMax }} → %</span>
            <NInputNumber v-model:value="cfg.trafficMarginPct" :min="5" :max="85" size="small" style="width: 90px" />
          </div>
          <div class="ph-field">
            <span class="ph-label">Core &lt; {{ cfg.coreCostMax }} → %</span>
            <NInputNumber v-model:value="cfg.coreMarginPct" :min="5" :max="85" size="small" style="width: 90px" />
          </div>
          <div class="ph-field">
            <span class="ph-label">Hero ≥ {{ cfg.coreCostMax }} → %</span>
            <NInputNumber v-model:value="cfg.heroMarginPct" :min="5" :max="85" size="small" style="width: 90px" />
          </div>
          <div class="ph-field">
            <span class="ph-label">Traffic cost max</span>
            <NInputNumber v-model:value="cfg.trafficCostMax" :min="1" size="small" style="width: 90px" />
          </div>
          <div class="ph-field">
            <span class="ph-label">Core cost max</span>
            <NInputNumber v-model:value="cfg.coreCostMax" :min="1" size="small" style="width: 90px" />
          </div>
        </NSpace>

        <NSpace style="margin-top: 14px" wrap>
          <NButton type="primary" size="small" @click="apply">
            Fill suggested sale on groups
          </NButton>
          <NButton size="small" quaternary @click="resetDefaults">Reset defaults</NButton>
        </NSpace>
      </NCollapseItem>
    </NCollapse>
  </NCard>
</template>

<style scoped>
.ph-card {
  background: linear-gradient(160deg, #fff 0%, #f8fafc 100%);
}
.ph-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ph-label {
  font-size: 11px;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.ph-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.ph-stat {
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ph-stat-label {
  font-size: 11px;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
}
.ph-stat strong {
  font-size: 1.05rem;
  color: #111827;
}
.ph-stat-sub {
  font-size: 11px;
  color: #9ca3af;
}
@media (max-width: 800px) {
  .ph-stats {
    grid-template-columns: 1fr;
  }
}
</style>
