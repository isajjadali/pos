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

/** Map common Unicode → ASCII so thermal (CP437/ASCII) does not print "?" for dashes etc. */
function ascii(str) {
  return String(str ?? "")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u202F\u2007]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "");
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

/** Prefer word boundaries so brand titles don't split mid-word. */
function wrapWords(name, cols) {
  const t = ascii(name).trim();
  if (!t) return [""];
  if (t.length <= cols) return [t];
  const words = t.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      if (w.length <= cols) {
        cur = w;
      } else {
        for (let i = 0; i < w.length; i += cols) lines.push(w.slice(i, i + cols));
      }
      continue;
    }
    if (`${cur} ${w}`.length <= cols) {
      cur = `${cur} ${w}`;
    } else {
      lines.push(cur);
      if (w.length <= cols) cur = w;
      else {
        cur = "";
        for (let i = 0; i < w.length; i += cols) lines.push(w.slice(i, i + cols));
      }
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [t.slice(0, cols)];
}

/** Map px font size → ESC/POS GS ! n. Body default 13 → 1×. */
function escPosBodySize(fontSize) {
  const fs = Number(fontSize) || 13;
  if (fs <= 14) return 0x00;
  if (fs <= 16) return 0x01; // double height
  return 0x11; // double width + height
}

/** Effective column count when GS ! size has double-width bit. */
function colsForSize(baseCols, sizeByte) {
  return sizeByte & 0x10 ? Math.floor(baseCols / 2) : baseCols;
}

function escPosFooterSize(fontSize) {
  return escPosBodySize(fontSize);
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
    const left = `${item.qty} x ${Math.round(Number(item.unitPrice) || 0)}`;
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

  // Init — start printing immediately (minimal top waste)
  push(0x1b, 0x40);
  push(0x1d, 0x7c, 0x0e); // darker density
  push(0x1b, 0x33, 0x2c); // ESC 3 n — tighter line spacing (~44 dots)
  const bodySize = escPosBodySize(vm.settings.receipt_font_size);
  const footerSize = escPosFooterSize(vm.settings.receipt_footer_font_size);
  push(0x1b, 0x4d, 0x00); // Font A (12×24)
  push(0x1b, 0x20, 0x00);
  push(0x1d, 0x21, bodySize);

  // Title: split "Discount World by WABz" → big brand + subtitle (match UI)
  const rawName = String(vm.storeName || "").trim();
  const byMatch = rawName.match(/^(.*?)\s+by\s+(.+)$/i);
  const titleMain = ascii((byMatch ? byMatch[1] : rawName).toUpperCase());
  const titleSub = byMatch ? ascii(`by ${byMatch[2]}`) : "";
  // 0x11 = double width+height (~24 cols on 80mm). "DISCOUNT WORLD" (14) fits on one line.
  const doubleCols = colsForSize(cols, 0x11);

  push(0x1b, 0x61, 0x01); // center
  push(0x1b, 0x4d, 0x00);
  push(0x1b, 0x45, 0x01); // bold
  push(0x1b, 0x20, 0x00); // no letter-spacing (extra spacing was wrapping the title)
  push(0x1d, 0x21, 0x11);
  for (const tl of wrapWords(titleMain, doubleCols)) line(tl);
  push(0x1d, 0x21, bodySize);

  if (titleSub) {
    push(0x1b, 0x45, 0x01);
    push(0x1d, 0x21, 0x00); // subtitle smaller — matches UI
    line(titleSub.slice(0, cols));
    push(0x1d, 0x21, bodySize);
  }
  push(0x1b, 0x45, 0x00);

  if (vm.headerLine) {
    for (const hl of wrapName(vm.headerLine, cols)) line(center(hl, cols));
  }
  push(0x1b, 0x61, 0x00);

  line(vm.reference);
  line(vm.dateLabel);
  line(dashLine(cols));

  for (const item of vm.lines) {
    // Match UI: "Name · qty x price" + total on one logical block
    const qtyBit =
      item.qty > 1
        ? ` - ${item.qty} x ${Math.round(Number(item.unitPrice) || 0)}`
        : "";
    const nameWithQty = `${item.name}${qtyBit}`;
    const totalStr = money(item.lineTotal);
    const nameBudget = Math.max(8, cols - totalStr.length - 1);
    const nameLines = wrapName(nameWithQty, nameBudget);
    nameLines.forEach((nl, i) => {
      push(0x1b, 0x45, 0x01);
      if (i === nameLines.length - 1) line(padLine(nl, totalStr, cols));
      else line(nl);
      push(0x1b, 0x45, 0x00);
    });
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
    blank(2); // breathing room after TOTAL / payment before thank-you
    push(0x1d, 0x21, footerSize);
    const footerCols = colsForSize(cols, footerSize);
    for (const fl of String(vm.footer).split(/\r?\n/)) {
      if (!fl.trim()) continue;
      push(0x1b, 0x61, 0x01);
      for (const part of wrapName(fl, footerCols)) line(center(part, footerCols));
      push(0x1b, 0x61, 0x00);
    }
    push(0x1d, 0x21, bodySize);
  }

  // Minimal feed past cutter — less blank above the *next* receipt's title
  blank(1);
  // GS V 66 n = feed n motion units, then cut (keep n small to save paper)
  push(0x1d, 0x56, 0x42, 0x18);

  return new Uint8Array(out);
}

export function escPosToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
