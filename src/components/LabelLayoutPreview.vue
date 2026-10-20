<script setup>
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import JsBarcode from "jsbarcode";
import { labelFontStack } from "../config/printFonts.js";
import { computeRetailLabelLayout, dotsToMm } from "../utils/zebraZpl.js";

const props = defineProps({
  widthMm: { type: Number, default: 40 },
  heightMm: { type: Number, default: 25 },
  name: { type: String, default: "Sample Product Name" },
  barcode: { type: String, default: "DW1A2B3C4D5E" },
  price: { type: Number, default: 250 },
  /** Stored key e.g. arial — preview CSS; Zebra print uses scalable font 0 */
  fontFamily: { type: String, default: "arial" },
  /** Percent of auto layout sizes (100 = previous default) */
  titleFontSize: { type: Number, default: 100 },
  nameFontSize: { type: Number, default: 100 },
  barcodeFontSize: { type: Number, default: 100 },
  priceFontSize: { type: Number, default: 100 },
});

const barcodeSvg = ref(null);

const label = computed(() => ({
  name: props.name,
  barcode: props.barcode,
  price: props.price,
}));

const layout = computed(() =>
  computeRetailLabelLayout(label.value, props.widthMm, props.heightMm, undefined, {
    fontFamily: props.fontFamily,
    titleSize: props.titleFontSize,
    nameSize: props.nameFontSize,
    barcodeSize: props.barcodeFontSize,
    priceSize: props.priceFontSize,
  })
);

const textFontFamily = computed(() => labelFontStack(props.fontFamily));

const MM_TO_PX = 96 / 25.4;
const wrapRef = ref(null);
const containerWidth = ref(320);

let resizeObserver;

onMounted(() => {
  const el = wrapRef.value;
  if (!el || typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width;
    if (w && w > 0) containerWidth.value = w;
  });
  resizeObserver.observe(el);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});

/** Fit preview in pane while keeping true mm proportions */
const previewScale = computed(() => {
  const w = Math.max(20, Number(props.widthMm) || 40);
  const h = Math.max(15, Number(props.heightMm) || 25);
  const availW = Math.max(120, containerWidth.value - 16);
  const scaleByW = availW / (w * MM_TO_PX);
  const scaleByH = 240 / (h * MM_TO_PX);
  return Math.min(3.2, scaleByW, scaleByH);
});

const scaledSizePx = computed(() => ({
  w: props.widthMm * MM_TO_PX * previewScale.value,
  h: props.heightMm * MM_TO_PX * previewScale.value,
}));

const surfaceStyle = computed(() => ({
  width: `${props.widthMm}mm`,
  height: `${props.heightMm}mm`,
  transform: `scale(${previewScale.value})`,
  transformOrigin: "top left",
}));

function mmFromDots(d) {
  return `${dotsToMm(d, layout.value.dpi)}mm`;
}

function pctY(yDots) {
  return `${(yDots / layout.value.ll) * 100}%`;
}

function pctX(xDots) {
  return `${(xDots / layout.value.pw) * 100}%`;
}

function pctW(wDots) {
  return `${(wDots / layout.value.pw) * 100}%`;
}

const titleStyle = computed(() => ({
  top: pctY(layout.value.titleY ?? 0),
  left: pctX(layout.value.sideM ?? 0),
  width: pctW(layout.value.innerW ?? 0),
  fontFamily: textFontFamily.value,
  fontSize: mmFromDots(layout.value.titleFont ?? 18),
  lineHeight: layout.value.titleLineGap
    ? 1 + layout.value.titleLineGap / layout.value.titleFont
    : 1.05,
  maxHeight: mmFromDots(layout.value.titleH ?? layout.value.titleFont ?? 18),
}));

const nameStyle = computed(() => ({
  top: pctY(layout.value.nameY ?? 0),
  left: pctX(layout.value.sideM ?? 0),
  width: pctW(layout.value.innerW ?? 0),
  fontFamily: textFontFamily.value,
  fontSize: mmFromDots(layout.value.nameFont ?? 18),
  lineHeight: layout.value.nameLineGap
    ? 1 + layout.value.nameLineGap / layout.value.nameFont
    : 1.08,
  maxHeight: mmFromDots(layout.value.nameHFinal ?? 0),
}));

const hriStyle = computed(() => ({
  top: pctY(layout.value.hriY ?? 0),
  left: pctX(layout.value.sideM ?? 0),
  width: pctW(layout.value.innerW ?? 0),
  fontFamily: textFontFamily.value,
  fontSize: mmFromDots(layout.value.idFont ?? 16),
  lineHeight: 1.05,
}));

const priceStyle = computed(() => ({
  top: pctY(layout.value.priceY ?? 0),
  left: pctX(layout.value.sideM ?? 0),
  width: pctW(layout.value.innerW ?? 0),
  fontFamily: textFontFamily.value,
  fontSize: mmFromDots(layout.value.priceFont ?? 18),
  lineHeight: 1.05,
}));

const barcodeWrapStyle = computed(() => ({
  top: pctY(layout.value.barY ?? 0),
  left: pctX(layout.value.barX ?? 0),
  width: mmFromDots(layout.value.barW ?? 0),
  height: mmFromDots(layout.value.barH ?? 0),
}));

function renderBarcode() {
  nextTick(() => {
    const svg = barcodeSvg.value;
    if (!svg || !layout.value.hasBarcode) return;
    try {
      JsBarcode(svg, layout.value.barcode, {
        format: "CODE128",
        width: layout.value.moduleW,
        height: Math.max(8, Math.round(dotsToMm(layout.value.barH, layout.value.dpi) * 3.78)),
        displayValue: false,
        margin: 0,
      });
    } catch {
      /* invalid */
    }
  });
}

watch(
  () => [
    props.widthMm,
    props.heightMm,
    props.name,
    props.barcode,
    props.price,
    props.fontFamily,
    props.titleFontSize,
    props.nameFontSize,
    props.barcodeFontSize,
    props.priceFontSize,
  ],
  renderBarcode,
  { immediate: true }
);
</script>

<template>
  <div ref="wrapRef" class="wrap">
    <div
      class="scale-box"
      :style="{ width: `${scaledSizePx.w}px`, height: `${scaledSizePx.h}px` }"
    >
      <div class="label-surface" :style="surfaceStyle">
        <template v-if="layout.hasBarcode">
          <div class="el title" :style="titleStyle">
            <div v-for="(line, i) in layout.titleLineTexts" :key="i">{{ line }}</div>
          </div>
          <div class="el name" :style="nameStyle">
            <div v-for="(line, i) in layout.nameLineTexts" :key="i">{{ line }}</div>
          </div>
          <div class="el barcode-wrap" :style="barcodeWrapStyle">
            <svg ref="barcodeSvg" class="barcode-svg" preserveAspectRatio="none" />
          </div>
          <div class="el hri" :style="hriStyle">{{ layout.barcode }}</div>
          <div class="el price" :style="priceStyle">{{ layout.priceText }}</div>
        </template>
        <div v-else class="no-bc">No barcode</div>
      </div>
    </div>
    <p class="hint">
      Live preview — same positions, fonts, and barcode module width as Zebra ZPL ({{
        widthMm
      }}×{{ heightMm }} mm, {{ layout.dpi }} dpi). Scaled {{ previewScale.toFixed(1) }}× on screen.
    </p>
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}
.scale-box {
  position: relative;
  flex-shrink: 0;
  margin: 0 auto;
  overflow: hidden;
}
.label-surface {
  position: relative;
  box-sizing: border-box;
  border: 1px solid #9ca3af;
  border-radius: 2px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}
.el {
  position: absolute;
  text-align: center;
  color: #111;
  font-weight: 700;
  overflow: hidden;
  box-sizing: border-box;
}
.name {
  font-weight: 700;
}
.price {
  font-weight: 800;
  color: #111;
}
.hri {
  letter-spacing: 0.04em;
}
.barcode-wrap {
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  overflow: hidden;
}
.barcode-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.no-bc {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #6b7280;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: #6b7280;
  text-align: center;
  max-width: 100%;
  line-height: 1.4;
  padding: 0 4px;
  box-sizing: border-box;
}
</style>
