<script setup>
import { computed } from "vue";
import { formatPkr } from "../utils/format.js";

const props = defineProps({
  widthMm: { type: Number, default: 40 },
  heightMm: { type: Number, default: 25 },
  name: { type: String, default: "Sample Product Name" },
  barcode: { type: String, default: "AR-1001" },
  price: { type: Number, default: 250 },
});

const boxStyle = computed(() => {
  const maxPx = 200;
  const ratio = props.widthMm / props.heightMm;
  if (ratio >= 1) {
    return { width: `${maxPx}px`, height: `${Math.round(maxPx / ratio)}px` };
  }
  return { height: `${maxPx}px`, width: `${Math.round(maxPx * ratio)}px` };
});
</script>

<template>
  <div class="wrap">
    <div class="label" :style="boxStyle">
      <div class="name">{{ name }}</div>
      <div class="mid">
        <div class="bars" aria-hidden="true">
          <span v-for="i in 28" :key="i" class="bar" :style="{ height: `${30 + (i % 5) * 8}%` }" />
        </div>
        <div class="id">{{ barcode }}</div>
      </div>
      <div class="price">{{ formatPkr(price) }}</div>
    </div>
    <p class="hint">Preview — same layout on the physical label</p>
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.label {
  box-sizing: border-box;
  border: 1px solid #9ca3af;
  border-radius: 4px;
  background: #fff;
  padding: 8px 8px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  text-align: center;
  font-family: Arial, sans-serif;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
.name {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.15;
  color: #111;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.mid {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 2px 0;
}
.bars {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 1px;
  height: 48px;
  width: 95%;
  max-width: 180px;
}
.bar {
  flex: 1;
  max-width: 4px;
  background: #111;
  min-height: 20%;
}
.id {
  margin-top: 3px;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: #374151;
  font-family: "Consolas", monospace;
}
.price {
  font-size: 14px;
  font-weight: 800;
  color: #0f766e;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: #6b7280;
}
</style>
