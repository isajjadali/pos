import { formatPkr } from "./format.js";
import { estimateWrappedLines, maxNameLinesForLabel, wrapLabelLines } from "./labelText.js";
import {
  DEFAULT_LABEL_FONT_FAMILY,
  DEFAULT_LABEL_FONT_SIZE,
  normalizeLabelFontFamily,
  normalizeLabelFontSize,
} from "../config/printFonts.js";

/** ZD220 default resolution */
export const LABEL_DPI = 203;

/**
 * @param {Record<string, unknown> | null | undefined} raw
 */
export function normalizeLabelFontOptions(raw = {}) {
  const r = raw || {};
  const legacy = normalizeLabelFontSize(r.label_font_size ?? r.fontSize ?? DEFAULT_LABEL_FONT_SIZE);
  return {
    fontFamily: normalizeLabelFontFamily(
      r.label_font_family ?? r.fontFamily ?? DEFAULT_LABEL_FONT_FAMILY
    ),
    titleSize: normalizeLabelFontSize(r.label_title_font_size ?? r.titleSize ?? legacy),
    nameSize: normalizeLabelFontSize(r.label_name_font_size ?? r.nameSize ?? legacy),
    barcodeSize: normalizeLabelFontSize(r.label_barcode_font_size ?? r.barcodeSize ?? legacy),
    priceSize: normalizeLabelFontSize(r.label_price_font_size ?? r.priceSize ?? legacy),
  };
}

function dots(mm, dpi = LABEL_DPI) {
  return Math.round((mm * dpi) / 25.4);
}

export function dotsToMm(dotCount, dpi = LABEL_DPI) {
  return (dotCount / dpi) * 25.4;
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

/**
 * Code 128 symbol modules (approx): start + data + check + stop + quiet zones.
 * Quiet zones (~10 modules each side) are required for scanners to read.
 */
function code128Modules(charLen) {
  const n = Math.max(1, charLen);
  const symbol = 11 + n * 11 + 11 + 13;
  const quiet = 20; // 10 left + 10 right
  return symbol + quiet;
}

/** Pick module width (1–2) so barcode + quiet zones fit inside maxWidth dots */
function fitBarcodeModule(charLen, maxWidth) {
  const mods = code128Modules(charLen);
  if (mods * 2 <= maxWidth) return 2;
  return 1;
}

function barcodeWidthDots(charLen, moduleW) {
  return code128Modules(charLen) * moduleW;
}

/** Printed above product name on every barcode label */
export const LABEL_STORE_TITLE = "Discount World by WABz";

/**
 * Shared layout math for ZPL print and on-screen preview (203 dpi).
 * @param {{ name?: string, barcode?: string, price?: number }} label
 * @param {number} widthMm
 * @param {number} heightMm
 * @param {number} [dpi]
 * @param {Record<string, unknown>} [fontOpts]
 */
export function computeRetailLabelLayout(label, widthMm, heightMm, dpi = LABEL_DPI, fontOpts = {}) {
  const fonts = normalizeLabelFontOptions(fontOpts);
  const titleScale = fonts.titleSize / 100;
  const nameScale = fonts.nameSize / 100;
  const barcodeScale = fonts.barcodeSize / 100;
  const priceScale = fonts.priceSize / 100;

  const pw = dots(widthMm, dpi);
  const ll = dots(heightMm, dpi);
  const sideM = Math.max(4, dots(1.2, dpi));
  const innerW = pw - 2 * sideM;
  const gap = Math.max(2, dots(0.3, dpi));
  /** Space between store title and product name */
  const titleGap = Math.max(4, dots(1.0, dpi));
  const priceGap = Math.max(gap + 12, dots(2.6, dpi));

  const rawCode = String(label.barcode ?? "").trim();
  const priceText = formatPkr(label.price);

  if (!rawCode) {
    return {
      dpi,
      pw,
      ll,
      hasBarcode: false,
      title: LABEL_STORE_TITLE,
      name: String(label.name ?? ""),
      priceText,
      barcode: "",
      fontFamily: fonts.fontFamily,
      titleSize: fonts.titleSize,
      nameSize: fonts.nameSize,
      barcodeSize: fonts.barcodeSize,
      priceSize: fonts.priceSize,
    };
  }

  const maxNameLines = maxNameLinesForLabel(widthMm, heightMm);
  let nameFont = clamp(
    Math.round(ll * 0.16 * nameScale),
    Math.round(16 * nameScale),
    Math.round(24 * nameScale)
  );
  nameFont = Math.max(10, nameFont);
  let nameLines = Math.min(maxNameLines, estimateWrappedLines(label.name, innerW, nameFont));

  let needed = estimateWrappedLines(label.name, innerW, nameFont);
  const minNameFont = Math.max(10, Math.round(13 * nameScale));
  while (needed > maxNameLines && nameFont > minNameFont) {
    nameFont -= 1;
    needed = estimateWrappedLines(label.name, innerW, nameFont);
  }
  nameLines = Math.min(maxNameLines, Math.max(1, needed));

  // Title sized independently (at 100% ≈ previous nameFont+1 relationship on base layout)
  const baseNameForTitle = clamp(Math.round(ll * 0.16), 16, 24);
  let titleFont = clamp(
    Math.round((baseNameForTitle + 1) * titleScale),
    Math.round(15 * titleScale),
    Math.round(22 * titleScale)
  );
  titleFont = Math.max(10, titleFont);
  const titleMaxLines = widthMm < 44 ? 2 : 1;

  function resolveTitleLayout(font = titleFont) {
    let tf = font;
    let lineGap = Math.max(0, Math.round(tf * 0.08));
    let lineCount = estimateWrappedLines(LABEL_STORE_TITLE, innerW, tf);
    while (lineCount > titleMaxLines && tf > 10) {
      tf -= 1;
      lineGap = Math.max(0, Math.round(tf * 0.08));
      lineCount = estimateWrappedLines(LABEL_STORE_TITLE, innerW, tf);
    }
    const texts = wrapLabelLines(LABEL_STORE_TITLE, innerW, tf, titleMaxLines);
    const h = tf * texts.length + Math.max(0, texts.length - 1) * lineGap;
    return { font: tf, lineGap, texts, h };
  }

  let priceFont = clamp(
    Math.round(ll * 0.14 * priceScale),
    Math.round(14 * priceScale),
    Math.round(22 * priceScale)
  );
  priceFont = Math.max(10, priceFont);

  const baseId = clamp(Math.round(ll * 0.16) - 1, 13, 20);
  let idFont = Math.max(10, Math.round(baseId * barcodeScale));
  const idGap = Math.max(1, dots(0.2, dpi));
  let barH = clamp(Math.round(ll * 0.26 * barcodeScale), Math.round(24 * barcodeScale), Math.round(50 * barcodeScale));
  barH = Math.max(16, barH);

  function nameBlockHeight() {
    const lineGap = Math.max(0, Math.round(nameFont * 0.08));
    return nameLines * nameFont + (nameLines - 1) * lineGap;
  }

  function totalBlockHeight() {
    return (
      resolveTitleLayout().h +
      titleGap +
      nameBlockHeight() +
      gap +
      barH +
      idGap +
      idFont +
      priceGap +
      priceFont
    );
  }

  let blockH = totalBlockHeight();
  const maxBlock = Math.round(ll * 0.97);
  while (blockH > maxBlock && barH > 20) {
    barH -= 2;
    blockH = totalBlockHeight();
  }
  while (blockH > maxBlock && nameFont > Math.max(10, Math.round(12 * nameScale))) {
    nameFont -= 1;
    nameLines = Math.min(maxNameLines, estimateWrappedLines(label.name, innerW, nameFont));
    blockH = totalBlockHeight();
  }
  const nameLineGap = Math.max(0, Math.round(nameFont * 0.08));
  const nameHFinal = nameBlockHeight();

  const titleLayout = resolveTitleLayout();
  titleFont = titleLayout.font;
  const titleLineGap = titleLayout.lineGap;
  const titleLineTexts = titleLayout.texts;
  const titleH = titleLayout.h;
  const idH = idFont;

  blockH = totalBlockHeight();
  let startY = Math.round((ll - blockH) / 2);
  startY = Math.max(dots(0.35, dpi), startY);

  const titleY = startY;
  const nameY = titleY + titleH + titleGap;
  const barY = nameY + nameHFinal + gap;
  const hriY = barY + barH + idGap;
  const priceY = hriY + idH + priceGap;

  const moduleW = fitBarcodeModule(rawCode.length, innerW);
  const barW = barcodeWidthDots(rawCode.length, moduleW);
  const barX = Math.max(sideM, Math.round((pw - barW) / 2));

  const nameLineTexts = wrapLabelLines(label.name, innerW, nameFont, nameLines);

  return {
    dpi,
    pw,
    ll,
    hasBarcode: true,
    widthMm,
    heightMm,
    sideM,
    innerW,
    title: LABEL_STORE_TITLE,
    titleLineTexts,
    titleLineGap,
    name: String(label.name ?? ""),
    nameLineTexts,
    priceText,
    barcode: rawCode,
    titleFont,
    nameFont,
    priceFont,
    idFont,
    nameLines,
    nameLineGap,
    titleY,
    nameY,
    barY,
    hriY,
    priceY,
    barH,
    barW,
    barX,
    moduleW,
    titleH,
    nameHFinal,
    idH,
    fontFamily: fonts.fontFamily,
    titleSize: fonts.titleSize,
    nameSize: fonts.nameSize,
    barcodeSize: fonts.barcodeSize,
    priceSize: fonts.priceSize,
  };
}

function buildRetailLabelZpl(label, widthMm, heightMm, dpi, fontOpts) {
  const layout = computeRetailLabelLayout(label, widthMm, heightMm, dpi, fontOpts);
  const { pw, ll, sideM, innerW, hasBarcode } = layout;

  if (!hasBarcode) {
    return `^XA^PW${pw}^LL${ll}^LH0,0^FO${sideM},${Math.round(ll / 2)}^A0N,18,18^FB${innerW},1,0,C,0^FDNo barcode^FS^XZ`;
  }

  const code = zplField(layout.barcode);
  const title = zplField(layout.title);
  const name = zplField(label.name);
  const price = zplField(layout.priceText);

  const {
    titleFont,
    nameFont,
    priceFont,
    idFont,
    nameLines,
    nameLineGap,
    titleY,
    nameY,
    barY,
    hriY,
    priceY,
    barH,
    barX,
    moduleW,
  } = layout;

  return `^XA
^MMT
^PW${pw}
^LL${ll}
^LH0,0
^FO${sideM},${titleY}^A0N,${titleFont},${titleFont}^FB${innerW},${layout.titleLineTexts.length},${layout.titleLineGap},C,0^FD${title}^FS
^FO${sideM},${nameY}^A0N,${nameFont},${nameFont}^FB${innerW},${nameLines},${nameLineGap},C,0^FD${name}^FS
^FO${barX},${barY}^BY${moduleW},2,${barH}^BCN,${barH},N,N,N^FD${code}^FS
^FO${sideM},${hriY}^A0N,${idFont},${idFont}^FB${innerW},1,0,C,0^FD${code}^FS
^FO${sideM},${priceY}^A0N,${priceFont},${priceFont}^FB${innerW},1,0,C,0^FD${price}^FS
^XZ`;
}

export function buildLabelZpl(label, widthMm = 40, heightMm = 25, dpi = LABEL_DPI, fontOpts = {}) {
  return buildRetailLabelZpl(label, widthMm, heightMm, dpi, fontOpts);
}

export function buildBatchZpl(labels, widthMm = 40, heightMm = 25, dpi = LABEL_DPI, fontOpts = {}) {
  return labels.map((l) => buildLabelZpl(l, widthMm, heightMm, dpi, fontOpts)).join("\n");
}
