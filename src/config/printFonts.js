/** Receipt / label font choices. Keys are stored in app_settings; stacks are for CSS. */

export const RECEIPT_FONT_OPTIONS = [
  {
    value: "consolas",
    label: "Consolas (default)",
    stack: '"Consolas", "Courier New", monospace',
  },
  {
    value: "courier",
    label: "Courier New",
    stack: '"Courier New", Courier, monospace',
  },
  {
    value: "monaco",
    label: "Monaco / Menlo",
    stack: 'Monaco, Menlo, "Ubuntu Mono", monospace',
  },
  {
    value: "arial",
    label: "Arial",
    stack: "Arial, Helvetica, sans-serif",
  },
  {
    value: "helvetica",
    label: "Helvetica",
    stack: "Helvetica, Arial, sans-serif",
  },
  {
    value: "verdana",
    label: "Verdana",
    stack: "Verdana, Geneva, sans-serif",
  },
  {
    value: "times",
    label: "Times New Roman",
    stack: '"Times New Roman", Times, serif',
  },
];

export const LABEL_FONT_OPTIONS = [
  {
    value: "arial",
    label: "Arial (default)",
    stack: "Arial, Helvetica, sans-serif",
  },
  {
    value: "helvetica",
    label: "Helvetica",
    stack: "Helvetica, Arial, sans-serif",
  },
  {
    value: "verdana",
    label: "Verdana",
    stack: "Verdana, Geneva, sans-serif",
  },
  {
    value: "tahoma",
    label: "Tahoma",
    stack: "Tahoma, Geneva, sans-serif",
  },
  {
    value: "times",
    label: "Times New Roman",
    stack: '"Times New Roman", Times, serif',
  },
  {
    value: "consolas",
    label: "Consolas",
    stack: '"Consolas", "Courier New", monospace',
  },
];

/** Default matches current receipt.js hardcode */
export const DEFAULT_RECEIPT_FONT_FAMILY = "consolas";
/** Body / line items — previous receipt_font_size default */
export const DEFAULT_RECEIPT_FONT_SIZE = 13;
/** Store title was effectively fs+4 in print HTML */
export const DEFAULT_RECEIPT_TITLE_FONT_SIZE = 17;
/** Footer was effectively fs-1 in print HTML */
export const DEFAULT_RECEIPT_FOOTER_FONT_SIZE = 12;

/** Default matches LabelLayoutPreview CSS */
export const DEFAULT_LABEL_FONT_FAMILY = "arial";
/** 100 = current auto layout sizes in zebraZpl */
export const DEFAULT_LABEL_FONT_SIZE = 100;

export function receiptFontStack(key) {
  const hit = RECEIPT_FONT_OPTIONS.find((o) => o.value === key);
  return hit?.stack || RECEIPT_FONT_OPTIONS[0].stack;
}

export function labelFontStack(key) {
  const hit = LABEL_FONT_OPTIONS.find((o) => o.value === key);
  return hit?.stack || LABEL_FONT_OPTIONS[0].stack;
}

export function normalizeReceiptFontFamily(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase();
  return RECEIPT_FONT_OPTIONS.some((o) => o.value === key) ? key : DEFAULT_RECEIPT_FONT_FAMILY;
}

export function normalizeLabelFontFamily(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase();
  return LABEL_FONT_OPTIONS.some((o) => o.value === key) ? key : DEFAULT_LABEL_FONT_FAMILY;
}

export function normalizeLabelFontSize(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_LABEL_FONT_SIZE;
  return Math.min(140, Math.max(70, n));
}

export function normalizeReceiptBodyFontSize(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_RECEIPT_FONT_SIZE;
  return Math.min(18, Math.max(10, n));
}

export function normalizeReceiptTitleFontSize(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_RECEIPT_TITLE_FONT_SIZE;
  return Math.min(28, Math.max(10, n));
}

export function normalizeReceiptFooterFontSize(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_RECEIPT_FOOTER_FONT_SIZE;
  return Math.min(18, Math.max(8, n));
}
