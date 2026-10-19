import { buildReceiptViewModel } from "./receipt.js";

/**
 * 3-inch / 80mm thermal (Black Copper 80):
 * Font A (12×24) ≈ 48 columns across ~72mm printable width.
 */
const COLS_3IN = 48;
const COLS_58 = 32;

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "Rs 0";
  // Avoid locale commas that waste columns; keep ASCII
  const rounded = Math.round(n * 100) / 100;
  return `Rs ${rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2)}`;
}

function ascii(str) {
  return String(str ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?");
}

function padLine(left, right, cols) {
  const L = ascii(left).slice(0, cols - 2);
  const R = ascii(right).slice(0, cols - 2);
  const space = Math.max(1, cols - L.length - R.length);
  return L + " ".repeat(space) + R;
}

function dashLine(cols) {
  return "-".repeat(cols);
}

function center(text, cols) {
  const t = ascii(text).slice(0, cols);
  const pad = Math.max(0, Math.floor((cols - t.length) / 2));
  return " ".repeat(pad) + t;
}

function wrapName(name, cols) {
  const t = ascii(name);
  if (t.length <= cols) return [t];
  const lines = [];
  for (let i = 0; i < t.length; i += cols) lines.push(t.slice(i, i + cols));
  return lines;
}

export function buildPlainTextReceipt(sale, items, settingsInput, { paperMm = 80 } = {}) {
  const vm = buildReceiptViewModel(sale, items, settingsInput);
  const cols = paperMm <= 58 ? COLS_58 : COLS_3IN;
  const lines = [];

  lines.push(center(vm.storeName, cols));
  if (vm.headerLine) lines.push(center(vm.headerLine, cols));
  lines.push(ascii(vm.reference));
  lines.push(ascii(vm.dateLabel));
  lines.push(dashLine(cols));

  for (const item of vm.lines) {
    for (const nl of wrapName(item.name, cols)) lines.push(nl);
    const left = `${item.qty} x ${money(item.unitPrice)}`;
    lines.push(padLine(left, money(item.lineTotal), cols));
  }

  lines.push(dashLine(cols));
  lines.push(padLine("Subtotal", money(vm.subtotal), cols));
  if (vm.discount > 0) lines.push(padLine("Discount", `-${money(vm.discount)}`, cols));
  lines.push(padLine("TOTAL", money(vm.total), cols));

  if (vm.showPayment && vm.amountReceived != null) {
    lines.push(padLine("Received", money(vm.amountReceived), cols));
  }
  if (vm.showChange && vm.changeDue != null) {
    lines.push(padLine("Change", money(vm.changeDue), cols));
  }

  if (vm.footer) {
    lines.push("");
    for (const fl of String(vm.footer).split(/\r?\n/)) lines.push(center(fl, cols));
  }

  lines.push("");
  lines.push("");
  return lines.join("\n") + "\n";
}

/**
 * ESC/POS for 3" (80mm) Black Copper — RAW thermal.
 * Equal small top/bottom margins; feed-then-cut so last lines are not chopped.
 * @returns {Uint8Array}
 */
export function buildEscPosReceipt(sale, items, settingsInput, { paperMm = 80 } = {}) {
  const vm = buildReceiptViewModel(sale, items, settingsInput);
  const cols = paperMm <= 58 ? COLS_58 : COLS_3IN;
  /** Same blank lines above header and below footer (visual balance) */
  const EDGE_LINES = 1;
  const out = [];

  const push = (...bytes) => {
    for (const b of bytes) out.push(b & 0xff);
  };
  const text = (s) => {
    const t = ascii(s);
    for (let i = 0; i < t.length; i++) out.push(t.charCodeAt(i));
  };
  const lf = () => push(0x0a);
  const line = (s = "") => {
    text(s);
    lf();
  };
  const blank = (n) => {
    for (let i = 0; i < n; i++) lf();
  };

  // Init
  push(0x1b, 0x40);
  push(0x1d, 0x7c, 0x0e); // darker density
  push(0x1b, 0x4d, 0x00); // Font A (12×24) — not compressed Font B
  push(0x1b, 0x20, 0x00);
  push(0x1d, 0x21, 0x00);

  blank(EDGE_LINES);

  // Title: split "Dollar World by WABz" → big brand + subtitle (less cramped)
  const rawName = String(vm.storeName || "").trim();
  const byMatch = rawName.match(/^(.*?)\s+by\s+(.+)$/i);
  const titleMain = (byMatch ? byMatch[1] : rawName).toUpperCase();
  const titleSub = byMatch ? `by ${byMatch[2]}` : "";

  push(0x1b, 0x61, 0x01); // center
  push(0x1b, 0x4d, 0x00); // Font A
  push(0x1b, 0x45, 0x01); // bold
  push(0x1b, 0x20, 0x02); // slight letter spacing (less compressed)
  // Double width + double height (0x11) — big open title
  push(0x1d, 0x21, 0x11);
  line(titleMain);
  push(0x1d, 0x21, 0x00);
  push(0x1b, 0x20, 0x00);

  if (titleSub) {
    push(0x1b, 0x45, 0x01);
    push(0x1d, 0x21, 0x01); // double height only for "by WABz"
    line(titleSub);
    push(0x1d, 0x21, 0x00);
  }
  push(0x1b, 0x45, 0x00);

  if (vm.headerLine) line(vm.headerLine);
  push(0x1b, 0x61, 0x00);

  line(vm.reference);
  line(vm.dateLabel);
  line(dashLine(cols));

  for (const item of vm.lines) {
    for (const nl of wrapName(item.name, cols)) {
      push(0x1b, 0x45, 0x01);
      line(nl);
      push(0x1b, 0x45, 0x00);
    }
    const left = `${item.qty} x ${money(item.unitPrice)}`;
    line(padLine(left, money(item.lineTotal), cols));
  }

  line(dashLine(cols));
  line(padLine("Subtotal", money(vm.subtotal), cols));
  if (vm.discount > 0) line(padLine("Discount", `-${money(vm.discount)}`, cols));

  push(0x1b, 0x45, 0x01);
  line(padLine("TOTAL", money(vm.total), cols));
  push(0x1b, 0x45, 0x00);

  if (vm.showPayment && vm.amountReceived != null) {
    line(padLine("Received", money(vm.amountReceived), cols));
  }
  if (vm.showChange && vm.changeDue != null) {
    line(padLine("Change", money(vm.changeDue), cols));
  }

  if (vm.footer) {
    for (const fl of String(vm.footer).split(/\r?\n/)) {
      if (!fl.trim()) continue;
      push(0x1b, 0x61, 0x01);
      line(fl);
      push(0x1b, 0x61, 0x00);
    }
  }

  // Match top margin
  blank(EDGE_LINES);

  // Feed past cutter, then partial cut — so bottom lines are not cut off
  // GS V 66 n = feed n motion units, then cut
  push(0x1d, 0x56, 0x42, 0x60);

  return new Uint8Array(out);
}

export function escPosToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
