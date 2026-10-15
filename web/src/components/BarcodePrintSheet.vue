<script setup>
import { onMounted, ref } from "vue";
import JsBarcode from "jsbarcode";
import { formatPkr } from "../utils/format.js";

const props = defineProps({
  labels: { type: Array, required: true },
  widthMm: { type: Number, default: 50 },
  heightMm: { type: Number, default: 30 },
});

const root = ref(null);

onMounted(() => {
  props.labels.forEach((label, index) => {
    const svg = root.value?.querySelector(`#bc-${index}`);
    if (svg && label.barcode) {
      try {
        JsBarcode(svg, String(label.barcode), {
          format: "CODE128",
          width: 1.5,
          height: 40,
          displayValue: false,
          margin: 2,
        });
      } catch {
        /* invalid barcode value */
      }
    }
  });
  window.print();
});
</script>

<template>
  <div ref="root" class="print-root">
    <div
      v-for="(label, index) in labels"
      :key="index"
      class="label"
      :style="{ width: `${widthMm}mm`, minHeight: `${heightMm}mm` }"
    >
      <div class="name">{{ label.name }}</div>
      <svg :id="`bc-${index}`" class="barcode"></svg>
      <div class="meta">ID: {{ label.barcode }}</div>
      <div class="price">{{ formatPkr(label.price) }}</div>
    </div>
  </div>
</template>

<style>
@media screen {
  .print-root {
    display: none;
  }
}
@media print {
  @page {
    margin: 4mm;
  }
  body * {
    visibility: hidden;
  }
  .print-root,
  .print-root * {
    visibility: visible;
  }
  .print-root {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }
  .label {
    page-break-after: always;
    text-align: center;
    padding: 2mm;
    box-sizing: border-box;
    font-family: Arial, sans-serif;
  }
  .name {
    font-size: 9pt;
    font-weight: bold;
    margin-bottom: 1mm;
  }
  .barcode {
    width: 100%;
    max-height: 14mm;
  }
  .meta {
    font-size: 7pt;
  }
  .price {
    font-size: 11pt;
    font-weight: bold;
    margin-top: 1mm;
  }
}
</style>
