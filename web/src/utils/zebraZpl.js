import { formatPkr } from "./format.js";

/** ZD220 default resolution */
const DEFAULT_DPI = 203;

function dots(mm, dpi = DEFAULT_DPI) {
  return Math.round((mm * dpi) / 25.4);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Escape characters special in ZPL ^FD...^FS */
export function zplField(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\^/g, "\\^")
    .replace(/~/g, "\\~")
    .replace(/_/g, "\\_");
}

function truncate(text, maxLen) {
  const s = String(text ?? "");
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function centeredBarcodeX(pw, charLen, moduleW, margin) {
  const estWidth = (charLen * 11 + 35) * moduleW;
  return Math.max(margin, Math.round((pw - estWidth) / 2));
}

/**
 * Retail label — large readable text, vertically centered.
 * Top: product name · Middle: barcode + ID · Bottom: price
 */
function buildRetailLabelZpl(label, widthMm, heightMm, dpi) {
  const pw = dots(widthMm, dpi);
  const ll = dots(heightMm, dpi);
  const sideM = Math.max(3, dots(0.8, dpi));
  const innerW = pw - 2 * sideM;
  const gap = Math.max(2, dots(0.35, dpi));
  /** Extra space between barcode ID (HRI) and price so Rs does not overlap */
  const priceGap = Math.max(gap + 16, dots(3.2, dpi));

  const rawCode = String(label.barcode ?? "").trim();
  const code = zplField(rawCode);
  const nameMax = widthMm < 30 ? 14 : widthMm < 45 ? 22 : 28;
  const name = zplField(truncate(label.name, nameMax));
  const price = zplField(formatPkr(label.price));

  if (!code) {
    return `^XA^PW${pw}^LL${ll}^LH0,0^FO${sideM},${Math.round(ll / 2)}^A0N,18,18^FB${innerW},1,0,C,0^FDNo barcode^FS^XZ`;
  }

  // Larger fonts for readability (40×25 ≈ 200×150 dots @ 203 dpi)
  const nameFont = clamp(Math.round(ll * 0.14), 14, 22);
  const priceFont = clamp(Math.round(ll * 0.16), 16, 26);
  const nameLines = 1;
  const nameH = nameFont * nameLines;
  const hriH = 12;
  let barH = clamp(Math.round(ll * 0.38), 32, 70);

  let blockH = nameH + gap + barH + hriH + priceGap + priceFont;
  const maxBlock = Math.round(ll * 0.94);
  while (blockH > maxBlock && barH > 28) {
    barH -= 2;
    blockH = nameH + gap + barH + hriH + priceGap + priceFont;
  }

  let startY = Math.round((ll - blockH) / 2);
  startY = Math.max(dots(0.6, dpi), startY);

  const nameY = startY;
  const barY = nameY + nameH + gap;
  const priceY = barY + barH + hriH + priceGap;

  // Prefer thicker bars when width allows (more scannable / visible)
  let moduleW = innerW >= 280 ? 2 : 1;
  const barX = centeredBarcodeX(pw, rawCode.length, moduleW, sideM);

  return `^XA
^MMT
^PW${pw}
^LL${ll}
^LH0,0
^FO${sideM},${nameY}^A0N,${nameFont},${nameFont}^FB${innerW},${nameLines},0,C,0^FD${name}^FS
^FO${barX},${barY}^BY${moduleW},2,${barH}^BCN,${barH},Y,N,N^FD${code}^FS
^FO${sideM},${priceY}^A0N,${priceFont},${priceFont}^FB${innerW},1,0,C,0^FD${price}^FS
^XZ`;
}

export function buildLabelZpl(label, widthMm = 40, heightMm = 25, dpi = DEFAULT_DPI) {
  return buildRetailLabelZpl(label, widthMm, heightMm, dpi);
}

export function buildBatchZpl(labels, widthMm = 40, heightMm = 25, dpi = DEFAULT_DPI) {
  return labels.map((l) => buildLabelZpl(l, widthMm, heightMm, dpi)).join("\n");
}
