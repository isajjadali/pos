<script setup>
import { NDatePicker, NSelect, NSpace, NText } from "naive-ui";
import { DATE_RANGE_PRESET_OPTIONS } from "../utils/dateRange.js";

const preset = defineModel("preset", { type: String, default: "all" });
const fromYmd = defineModel("from", { type: [String, null], default: null });
const toYmd = defineModel("to", { type: [String, null], default: null });

defineProps({
  /** Compact label shown before / above the select */
  label: { type: String, default: "Created" },
  selectWidth: { type: String, default: "150px" },
  /** Vertical full-width layout for filter drawers */
  stacked: { type: Boolean, default: false },
});
</script>

<template>
  <div v-if="stacked" class="created-date-filter created-date-filter--stacked">
    <NText depth="3" class="created-date-filter__label">{{ label }}</NText>
    <NSelect
      v-model:value="preset"
      :options="DATE_RANGE_PRESET_OPTIONS"
      style="width: 100%"
    />
    <div v-if="preset === 'custom'" class="created-date-filter__custom">
      <NDatePicker
        v-model:formatted-value="fromYmd"
        value-format="yyyy-MM-dd"
        type="date"
        clearable
        placeholder="From"
        style="width: 100%"
      />
      <NDatePicker
        v-model:formatted-value="toYmd"
        value-format="yyyy-MM-dd"
        type="date"
        clearable
        placeholder="To"
        style="width: 100%"
      />
    </div>
  </div>
  <NSpace v-else align="center" wrap :size="8">
    <NText depth="3" style="font-size: 13px; white-space: nowrap">{{ label }}</NText>
    <NSelect
      v-model:value="preset"
      :options="DATE_RANGE_PRESET_OPTIONS"
      :style="{ width: selectWidth }"
    />
    <template v-if="preset === 'custom'">
      <NDatePicker
        v-model:formatted-value="fromYmd"
        value-format="yyyy-MM-dd"
        type="date"
        clearable
        placeholder="From"
        style="width: 140px"
      />
      <NDatePicker
        v-model:formatted-value="toYmd"
        value-format="yyyy-MM-dd"
        type="date"
        clearable
        placeholder="To"
        style="width: 140px"
      />
    </template>
  </NSpace>
</template>

<style scoped>
.created-date-filter--stacked {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.created-date-filter__label {
  font-size: 13px;
}
.created-date-filter__custom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
</style>
