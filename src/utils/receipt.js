import { formatPkr } from "./format.js";

export const SAMPLE_RECEIPT_SALE = {
  sale_reference: "S20261015-00421",
  completed_at: new Date().toISOString(),
  subtotal: 650,
  discount_amount: 50,
  total_amount: 600,
  payment_method: "cash",
  amount_received: 1000,
  change_due: 400,
};

export const SAMPLE_RECEIPT_ITEMS = [
  {
    id: "1",
    product_name_snapshot: "12Pcs Jungle Zoo",
    quantity: 2,
    unit_selling_price: 250,
    line_total: 500,
  },
  {
    id: "2",
    product_name_snapshot: "4Pcs Figure Bag S",
    quantity: 1,
    unit_selling_price: 150,
    line_total: 150,
  },
];

export function normalizeReceiptSettings(raw = {}) {
  return {
    store_name: raw.store_name?.trim() || "Discount World by WABz",
    receipt_header: raw.receipt_header?.trim() || "",
    receipt_footer: raw.receipt_footer?.trim() || "",
    currency_code: raw.currency_code || "PKR",
    receipt_paper_width: clamp(Number(raw.receipt_paper_width) || 300, 240, 400),
    receipt_font_size: clamp(Number(raw.receipt_font_size) || 13, 10, 18),
    receipt_show_change: raw.receipt_show_change !== false,
    receipt_show_payment: raw.receipt_show_payment !== false,
  };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildReceiptViewModel(sale, items, settingsInput) {
  const settings = normalizeReceiptSettings(settingsInput);
  const list = items ?? [];
  const subtotal =
    Number(sale?.subtotal) ||
    list.reduce((s, i) => s + Number(i.line_total || 0), 0);
  const discount = Number(sale?.discount_amount) || 0;
  const total = Number(sale?.total_amount) ?? Math.max(subtotal - discount, 0);
  const completedAt = sale?.completed_at ? new Date(sale.completed_at) : new Date();

  return {
    settings,
    storeName: settings.store_name,
    headerLine: settings.receipt_header,
    reference: sale?.sale_reference || "—",
    dateLabel: completedAt.toLocaleString(),
    lines: list.map((i) => ({
      name: i.product_name_snapshot || i.name || "Item",
      qty: Number(i.quantity) || 0,
      unitPrice: Number(i.unit_selling_price) || 0,
      lineTotal: Number(i.line_total) || 0,
    })),
    subtotal,
    discount,
    total,
    paymentMethod: (sale?.payment_method || "cash").toUpperCase(),
    amountReceived: sale?.amount_received != null ? Number(sale.amount_received) : null,
    changeDue: sale?.change_due != null ? Number(sale.change_due) : null,
    footer: settings.receipt_footer,
    showPayment: settings.receipt_show_payment,
    showChange: settings.receipt_show_change,
  };
}

export function receiptPaperStyle(settingsInput) {
  const s = normalizeReceiptSettings(settingsInput);
  return {
    width: `${s.receipt_paper_width}px`,
    maxWidth: "100%",
    fontSize: `${s.receipt_font_size}px`,
    fontFamily: '"Consolas", "Courier New", monospace',
    lineHeight: "1.45",
    color: "#111827",
    background: "#fff",
    padding: "16px 14px",
    border: "1px dashed #9ca3af",
    borderRadius: "8px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
  };
}

export function buildReceiptPrintHtml(sale, items, settingsInput) {
  const vm = buildReceiptViewModel(sale, items, settingsInput);
  const s = vm.settings;
  const w = s.receipt_paper_width;
  const fs = s.receipt_font_size;

  const lineRows = vm.lines
    .map((line) => {
      const qtyPart =
        line.qty > 1
          ? ` <span class="muted">· ${line.qty}×${formatPkr(line.unitPrice)}</span>`
          : "";
      return `<div class="item">
        <span class="item-left"><span class="item-name">${escapeHtml(line.name)}</span>${qtyPart}</span>
        <span class="item-total">${formatPkr(line.lineTotal)}</span>
      </div>`;
    })
    .join("");

  const totals = `
    <div class="row"><span>Subtotal</span><span>${formatPkr(vm.subtotal)}</span></div>
    ${vm.discount > 0 ? `<div class="row"><span>Discount</span><span>-${formatPkr(vm.discount)}</span></div>` : ""}
    <div class="row total"><span>Total</span><span>${formatPkr(vm.total)}</span></div>
  `;

  const payment =
    vm.showPayment && vm.amountReceived != null
      ? `<div class="row"><span>Received</span><span>${formatPkr(vm.amountReceived)}</span></div>`
      : "";
  const change =
    vm.showChange && vm.changeDue != null
      ? `<div class="row"><span>Change</span><span>${formatPkr(vm.changeDue)}</span></div>`
      : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Receipt ${escapeHtml(vm.reference)}</title>
<style>
  @page { margin: 4mm; }
  body { margin: 0; padding: 8px; font-family: Consolas, "Courier New", monospace; font-size: ${fs}px; color: #111; }
  .paper { width: ${w}px; margin: 0 auto; }
  h1 { font-size: ${fs + 4}px; margin: 0 0 4px; text-align: center; }
  .sub { text-align: center; margin: 0 0 8px; font-size: ${fs - 1}px; color: #374151; }
  .meta { font-size: ${fs - 1}px; color: #4b5563; margin-bottom: 8px; }
  hr { border: none; border-top: 1px dashed #9ca3af; margin: 8px 0; }
  .item { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 4px; }
  .item-left { flex: 1; min-width: 0; }
  .item-name { font-weight: 600; }
  .muted { font-size: ${fs - 1}px; color: #6b7280; font-weight: 400; }
  .item-total { flex-shrink: 0; font-weight: 600; text-align: right; }
  .row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
  .total { font-weight: 700; font-size: ${fs + 1}px; margin-top: 4px; }
  .footer { text-align: center; margin-top: 10px; font-size: ${fs - 1}px; white-space: pre-wrap; }
  .pay { margin-top: 6px; }
</style></head><body>
<div class="paper">
  <h1>${escapeHtml(vm.storeName)}</h1>
  ${vm.headerLine ? `<div class="sub">${escapeHtml(vm.headerLine)}</div>` : ""}
  <div class="meta">${escapeHtml(vm.reference)}<br/>${escapeHtml(vm.dateLabel)}</div>
  <hr/>
  ${lineRows}
  <hr/>
  ${totals}
  <div class="pay">${payment}${change}</div>
  ${vm.footer ? `<div class="footer">${escapeHtml(vm.footer)}</div>` : ""}
</div>
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;
}

export function openReceiptPrintWindow(sale, items, settingsInput) {
  const html = buildReceiptPrintHtml(sale, items, settingsInput);
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
