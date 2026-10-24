<script setup>
import { NSwitch, NText } from "naive-ui";

const checked = defineModel({ type: Boolean, default: false });

defineProps({
  label: { type: String, required: true },
  hint: { type: String, default: "" },
});
</script>

<template>
  <label class="filter-toggle-row">
    <div class="filter-toggle-row__text">
      <span class="filter-toggle-row__label">{{ label }}</span>
      <NText v-if="hint" depth="3" class="filter-toggle-row__hint">{{ hint }}</NText>
    </div>
    <NSwitch v-model:value="checked" size="small" />
  </label>
</template>

<style scoped>
.filter-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  margin: 0;
  border-radius: 8px;
  background: var(--n-color-target, #f5f5f7);
  border: 1px solid rgba(0, 0, 0, 0.06);
  cursor: pointer;
  user-select: none;
}
.filter-toggle-row__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.filter-toggle-row__label {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--n-text-color, #1f1f1f);
}
.filter-toggle-row__hint {
  font-size: 12px;
  line-height: 1.35;
}
</style>
