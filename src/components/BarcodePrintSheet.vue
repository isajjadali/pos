<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import JsBarcode from "jsbarcode";
import { formatPkr } from "../utils/format.js";

const props = defineProps({
  labels: { type: Array, required: true },
  widthMm: { type: Number, default: 40 },
  heightMm: { type: Number, default: 25 },
  /** When true, call window.print() after barcodes render */
  autoPrint: { type: Boolean, default: true },
});

const emit = defineEmits(["printed", "print-error"]);

const root = ref(null);
const pageStyleEl = ref(null);

const pageCss = computed(
  () => `
@page {
  size: ${Number(props.widthMm) || 40}mm ${Number(props.heightMm) || 25}mm;
  margin: 0;
}
`
);

function injectPageStyle() {
  removePageStyle();
  const el = document.createElement("style");
  el.setAttribute("data-dw-label-print", "1");
  el.textContent = pageCss.value;
  document.head.appendChild(el);
  pageStyleEl.value = el;
}

function removePageStyle() {
  pageStyleEl.value?.remove();
  pageStyleEl.value = null;
  document.querySelectorAll("style[data-dw-label-print]").forEach((n) => n.remove());
}

function renderBarcodes() {
  if (!root.value) return;
  props.labels.forEach((label, index) => {
    const svg = root.value.querySelector(`#bc-${index}`);
    if (!svg || !label?.barcode) return;
    try {
      JsBarcode(svg, String(label.barcode), {
        format: "CODE128",
        width: 1.6,
        height: 44,
        displayValue: false,
        margin: 4,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      /* invalid barcode */
    }
  });
}

let printedEmitted = false;
function emitPrintedOnce() {
  if (printedEmitted) return;
  printedEmitted = true;
  emit("printed");
}

function onAfterPrint() {
  emitPrintedOnce();
}

async function doPrint() {
  try {
    printedEmitted = false;
    injectPageStyle();
    await nextTick();
    renderBarcodes();
    await nextTick();
    // Let SVG layout settle before spooling
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.addEventListener("afterprint", onAfterPrint, { once: true });
    // Fallback if afterprint never fires (some Chromium builds)
    window.setTimeout(() => emitPrintedOnce(), 2000);
    window.print();
  } catch (e) {
    emit("print-error", e);
  }
}

onMounted(() => {
  if (props.autoPrint) doPrint();
  else {
    injectPageStyle();
    nextTick(() => renderBarcodes());
  }
});

watch(
  () => [props.labels, props.widthMm, props.heightMm],
  () => {
    injectPageStyle();
    nextTick(() => renderBarcodes());
  }
);

onBeforeUnmount(() => {
  window.removeEventListener("afterprint", onAfterPrint);
  removePageStyle();
});

defineExpose({ print: doPrint });
</script>

<template>
  <div
    ref="root"
    class="print-root"
    :style="{
      '--dw-label-w': `${widthMm}mm`,
      '--dw-label-h': `${heightMm}mm`,
    }"
  >
    <div v-for="(label, index) in labels" :key="index" class="label">
      <div class="store">Discount World by WABz</div>
      <div class="name">{{ label.name }}</div>
      <svg :id="`bc-${index}`" class="barcode" />
      <div class="meta">{{ label.barcode }}</div>
      <div class="price">{{ formatPkr(label.price) }}</div>
    </div>
  </div>
</template>

<style>
@media screen {
  .print-root {
    position: fixed;
    left: -10000px;
    top: 0;
    width: var(--dw-label-w, 40mm);
    pointer-events: none;
    opacity: 0;
  }
}
@media print {
  html,
  body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
  }
  body * {
    visibility: hidden !important;
  }
  .print-root,
  .print-root * {
    visibility: visible !important;
  }
  .print-root {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: var(--dw-label-w, 40mm) !important;
    opacity: 1 !important;
    pointer-events: auto !important;
  }
  .label {
    width: var(--dw-label-w, 40mm);
    height: var(--dw-label-h, 25mm);
    max-height: var(--dw-label-h, 25mm);
    box-sizing: border-box;
    padding: 1.2mm 1.5mm;
    margin: 0;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
    text-align: center;
    font-family: Arial, Helvetica, sans-serif;
    color: #000;
    background: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4mm;
  }
  .label:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  .store {
    font-size: 7.5pt;
    font-weight: 700;
    line-height: 1.05;
    max-width: 100%;
  }
  .name {
    font-size: 8.5pt;
    font-weight: 700;
    line-height: 1.1;
    max-width: 100%;
    max-height: 6.5mm;
    overflow: hidden;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .barcode {
    width: 100%;
    max-height: 9mm;
    display: block;
  }
  .meta {
    font-size: 7pt;
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: 0.02em;
  }
  .price {
    font-size: 8.5pt;
    font-weight: 700;
    line-height: 1.05;
  }
}
</style>
