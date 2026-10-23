<script setup>
import { computed } from "vue";
import { buildReceiptViewModel, receiptPaperStyle } from "../utils/receipt.js";
import { formatPkr } from "../utils/format.js";

const props = defineProps({
  sale: { type: Object, required: true },
  items: { type: Array, default: () => [] },
  settings: { type: Object, default: () => ({}) },
});

const vm = computed(() => buildReceiptViewModel(props.sale, props.items, props.settings));
const paperStyle = computed(() => receiptPaperStyle(props.settings));
const titleFs = computed(() => vm.value.settings.receipt_title_font_size);
const footerFs = computed(() => vm.value.settings.receipt_footer_font_size);

const titleParts = computed(() => {
  const raw = String(vm.value.storeName || "").trim();
  const m = raw.match(/^(.*?)\s+by\s+(.+)$/i);
  if (m) return { main: m[1].toUpperCase(), sub: `by ${m[2]}` };
  return { main: raw.toUpperCase(), sub: "" };
});

const storeStyle = computed(() => ({
  fontSize: `${titleFs.value}px`,
}));

const storeSubStyle = computed(() => ({
  fontSize: `${Math.max(10, Math.round(titleFs.value * 0.68))}px`,
}));

const footerStyle = computed(() => ({
  fontSize: `${footerFs.value}px`,
}));
</script>

<template>
  <div class="receipt-wrap">
    <div class="receipt-paper" :style="paperStyle">
      <div class="store" :style="storeStyle">{{ titleParts.main }}</div>
      <div v-if="titleParts.sub" class="store-sub" :style="storeSubStyle">{{ titleParts.sub }}</div>
      <div v-if="vm.headerLine" class="header-line">{{ vm.headerLine }}</div>
      <div class="meta">
        <div>{{ vm.reference }}</div>
        <div>{{ vm.dateLabel }}</div>
      </div>
      <hr class="dash" />
      <div v-for="(line, idx) in vm.lines" :key="idx" class="line-item">
        <span class="line-left">
          <span class="line-name">{{ line.name }}</span>
          <span v-if="line.qty > 1" class="line-detail"> · {{ line.qty }} x {{ Math.round(Number(line.unitPrice) || 0) }}</span>
        </span>
        <span class="line-total">{{ formatPkr(line.lineTotal) }}</span>
      </div>
      <hr class="dash" />
      <div class="totals">
        <div class="row">
          <span>Subtotal</span>
          <span>{{ formatPkr(vm.subtotal) }}</span>
        </div>
        <div v-if="vm.discount > 0" class="row">
          <span>Discount</span>
          <span>-{{ formatPkr(vm.discount) }}</span>
        </div>
        <div class="row grand">
          <span>Total</span>
          <span>{{ formatPkr(vm.total) }}</span>
        </div>
      </div>
      <div v-if="vm.showPayment && vm.amountReceived != null" class="pay row">
        <span>Received</span>
        <span>{{ formatPkr(vm.amountReceived) }}</span>
      </div>
      <div v-if="vm.showChange && vm.changeDue != null" class="pay row">
        <span>Change</span>
        <span>{{ formatPkr(vm.changeDue) }}</span>
      </div>
      <div v-if="vm.footer" class="footer" :style="footerStyle">{{ vm.footer }}</div>
    </div>
  </div>
</template>

<style scoped>
.receipt-wrap {
  display: flex;
  justify-content: center;
  padding: 8px 0;
  background: #e5e7eb;
  border-radius: 8px;
}
.receipt-paper {
  text-align: left;
}
.store {
  font-weight: 800;
  letter-spacing: 0.06em;
  line-height: 1.15;
  text-align: center;
  margin-bottom: 2px;
}
.store-sub {
  font-weight: 700;
  text-align: center;
  margin-bottom: 6px;
}
.header-line {
  text-align: center;
  color: #374151;
  margin-bottom: 8px;
}
.meta {
  font-size: 0.92em;
  color: #4b5563;
  margin-bottom: 6px;
}
.dash {
  border: none;
  border-top: 1px dashed #9ca3af;
  margin: 8px 0;
}
.line-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 4px;
}
.line-left {
  flex: 1;
  min-width: 0;
}
.line-name {
  font-weight: 600;
}
.line-detail {
  font-size: 0.88em;
  font-weight: 400;
  color: #6b7280;
}
.line-total {
  flex-shrink: 0;
  font-weight: 600;
  text-align: right;
}
.totals {
  margin-top: 4px;
}
.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.grand {
  font-weight: 700;
  font-size: 1.08em;
  margin-top: 4px;
}
.pay {
  margin-top: 4px;
}
.footer {
  margin-top: 18px;
  text-align: center;
  white-space: pre-wrap;
  color: #374151;
}
</style>
