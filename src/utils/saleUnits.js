/** Piece / pack / box sale units. Stock is always tracked in pieces. */

import { formatPkr } from "./format.js";

export const SALE_UNITS = ["piece", "pack", "box"];

export const SALE_UNIT_OPTIONS = [
  { label: "Piece", value: "piece" },
  { label: "Pack", value: "pack" },
  { label: "Box", value: "box" },
];

/** Listing filter: which sell-unit setup a product has */
export const UNIT_LISTING_FILTER_OPTIONS = [
  { label: "All units", value: "all" },
  { label: "Piece only", value: "piece" },
  { label: "Has pack", value: "pack" },
  { label: "Has box", value: "box" },
  { label: "Pack or box", value: "multi" },
];

export function normalizeSaleUnit(raw) {
  const u = String(raw || "")
    .trim()
    .toLowerCase();
  return SALE_UNITS.includes(u) ? u : "piece";
}

export function piecesPerPackOf(product) {
  const n = Math.floor(Number(product?.pieces_per_pack) || 1);
  return Math.max(1, n);
}

export function piecesPerBoxOf(product) {
  const n = Math.floor(Number(product?.pieces_per_box) || 0);
  return n > 0 ? n : null;
}

/** Price for one piece (falls back to selling_price). */
export function piecePriceOf(product) {
  const n = Number(product?.piece_selling_price);
  if (Number.isFinite(n) && n >= 0) return n;
  return Number(product?.selling_price) || 0;
}

export function packPriceOf(product) {
  const n = Number(product?.pack_selling_price);
  if (Number.isFinite(n) && n >= 0) return n;
  return Number(product?.selling_price) || 0;
}

export function boxPriceOf(product) {
  const n = Number(product?.box_selling_price);
  if (Number.isFinite(n) && n >= 0) return n;
  return null;
}

export function boxEnabled(product) {
  return piecesPerBoxOf(product) != null && boxPriceOf(product) != null;
}

/**
 * Resolve unit → pieces per sale unit + unit price.
 * Falls back to piece if pack/box not configured.
 */
export function resolveSaleUnit(product, preferredUnit) {
  const want = normalizeSaleUnit(preferredUnit ?? product?.default_sale_unit);

  if (want === "box" && boxEnabled(product)) {
    return {
      sale_unit: "box",
      pieces_per_unit: piecesPerBoxOf(product),
      unit_selling_price: boxPriceOf(product),
    };
  }
  if (want === "pack" && piecesPerPackOf(product) > 1) {
    return {
      sale_unit: "pack",
      pieces_per_unit: piecesPerPackOf(product),
      unit_selling_price: packPriceOf(product),
    };
  }
  return {
    sale_unit: "piece",
    pieces_per_unit: 1,
    unit_selling_price: piecePriceOf(product),
  };
}

/** Catalog / label price = default unit’s price. */
export function sellingPriceForDefaultUnit(productOrForm) {
  return resolveSaleUnit(productOrForm, productOrForm?.default_sale_unit).unit_selling_price;
}

/** App setting: preferred unit across POS / barcode / price groups. */
let appDefaultLabelUnit = "pack";

export function getAppDefaultLabelUnit() {
  return appDefaultLabelUnit;
}

export function setAppDefaultLabelUnit(raw) {
  appDefaultLabelUnit = normalizeSaleUnit(raw || "pack");
  return appDefaultLabelUnit;
}

/**
 * Preferred unit for POS / labels from app settings.
 * Callers should pass through resolveSaleUnit so unavailable units fall back.
 */
export function defaultPosSaleUnit(_product) {
  return appDefaultLabelUnit;
}

/** Receipt / label suffix e.g. "(2pcs)" or "(box 72pcs)". Empty for piece. */
export function saleUnitSuffix(saleUnit, piecesPerUnit) {
  const unit = normalizeSaleUnit(saleUnit);
  const pcs = Math.max(1, Math.floor(Number(piecesPerUnit) || 1));
  if (unit === "pack" && pcs > 1) return `(${pcs}pcs)`;
  if (unit === "box" && pcs > 1) return `(box ${pcs}pcs)`;
  return "";
}

/** Append unit size to product name for receipts / barcode labels. */
export function formatSaleLineName(baseName, saleUnit, piecesPerUnit) {
  const name = String(baseName ?? "").trim() || "Item";
  const suffix = saleUnitSuffix(saleUnit, piecesPerUnit);
  if (!suffix) return name;
  const re = new RegExp(`\\s*${suffix.replace(/[()]/g, (c) => `\\${c}`)}$`, "i");
  if (re.test(name)) return name;
  return `${name} ${suffix}`;
}

/** Label name + price for a chosen print unit. */
export function labelContentForUnit(product, preferredUnit) {
  const resolved = resolveSaleUnit(product, preferredUnit);
  return {
    ...resolved,
    name: formatSaleLineName(product?.name, resolved.sale_unit, resolved.pieces_per_unit),
    price: resolved.unit_selling_price,
  };
}

/**
 * Normalize multi-unit fields before save. Syncs selling_price to default unit.
 */
export function normalizeProductUnitFields(raw = {}) {
  const pieces_per_pack = Math.max(1, Math.floor(Number(raw.pieces_per_pack) || 1));
  let pieces_per_box = Math.floor(Number(raw.pieces_per_box) || 0);
  if (pieces_per_box <= 0) pieces_per_box = null;

  let piece_selling_price = Number(raw.piece_selling_price);
  let pack_selling_price = Number(raw.pack_selling_price);
  let box_selling_price = Number(raw.box_selling_price);
  const legacy = Number(raw.selling_price);

  if (!Number.isFinite(piece_selling_price) || piece_selling_price < 0) {
    piece_selling_price = Number.isFinite(legacy) ? Math.max(0, legacy) : 0;
  }
  if (!Number.isFinite(pack_selling_price) || pack_selling_price < 0) {
    pack_selling_price = Number.isFinite(legacy) ? Math.max(0, legacy) : piece_selling_price;
  }
  if (pieces_per_box == null || !Number.isFinite(box_selling_price) || box_selling_price < 0) {
    box_selling_price = null;
    pieces_per_box = null;
  }

  let default_sale_unit = normalizeSaleUnit(raw.default_sale_unit);
  if (default_sale_unit === "box" && pieces_per_box == null) default_sale_unit = "pack";
  if (default_sale_unit === "pack" && pieces_per_pack <= 1 && piece_selling_price === pack_selling_price) {
    /* pack of 1 is fine */
  }

  const synced = sellingPriceForDefaultUnit({
    default_sale_unit,
    pieces_per_pack,
    pieces_per_box,
    piece_selling_price,
    pack_selling_price,
    box_selling_price,
  });

  return {
    pieces_per_pack,
    pieces_per_box,
    piece_selling_price,
    pack_selling_price,
    box_selling_price,
    default_sale_unit,
    selling_price: synced,
  };
}

export function unitLabel(unit) {
  const u = normalizeSaleUnit(unit);
  if (u === "pack") return "Pack";
  if (u === "box") return "Box";
  return "Piece";
}

export function availableUnitsOf(product) {
  const units = [{ value: "piece", label: "Piece" }];
  const pack = piecesPerPackOf(product);
  if (pack > 1) {
    units.push({ value: "pack", label: `Pack (${pack} pcs)` });
  }
  if (boxEnabled(product)) {
    units.push({ value: "box", label: `Box (${piecesPerBoxOf(product)} pcs)` });
  }
  return units;
}

export function productHasPack(product) {
  return piecesPerPackOf(product) > 1;
}

export function productHasBox(product) {
  return piecesPerBoxOf(product) != null;
}

/**
 * Lines for listing: piece-only → ["Rs 90"];
 * multi-unit → ["Pc: Rs 96.6", "Pack(3pcs): Rs 290", "Box: Rs 1,000"]
 */
export function productUnitPriceLines(product) {
  const pack = piecesPerPackOf(product);
  const hasPack = pack > 1;
  const hasBox = boxEnabled(product);
  if (!hasPack && !hasBox) {
    return [formatPkr(piecePriceOf(product))];
  }
  const lines = [`Pc: ${formatPkr(piecePriceOf(product))}`];
  if (hasPack) lines.push(`Pack(${pack}pcs): ${formatPkr(packPriceOf(product))}`);
  if (hasBox) lines.push(`Box: ${formatPkr(boxPriceOf(product))}`);
  return lines;
}

/**
 * @param {object} product
 * @param {{ multiline?: boolean }} [opts] — multiline = newline-separated (table); else " · "
 */
export function formatProductUnitPrices(product, { multiline = false } = {}) {
  const lines = productUnitPriceLines(product);
  return multiline ? lines.join("\n") : lines.join(" · ");
}

/** Client-side match for UNIT_LISTING_FILTER_OPTIONS values. */
export function productMatchesUnitFilter(product, filter) {
  const f = String(filter || "all");
  if (f === "all") return true;
  const pack = productHasPack(product);
  const box = productHasBox(product);
  if (f === "piece") return !pack && !box;
  if (f === "pack") return pack;
  if (f === "box") return box;
  if (f === "multi") return pack || box;
  return true;
}

export function packsAvailable(stockPieces, product) {
  const pp = piecesPerPackOf(product);
  return Math.floor(Math.max(0, Number(stockPieces) || 0) / pp);
}

export function boxesAvailable(stockPieces, product) {
  const pb = piecesPerBoxOf(product);
  if (!pb) return 0;
  return Math.floor(Math.max(0, Number(stockPieces) || 0) / pb);
}
