/**
 * New internal barcodes: DW{purchasePrice}C{10 hex}
 * e.g. purchase 270 → DW270C43C441C6A2
 * Only for newly generated codes — never rewrite existing barcodes.
 */
export function generateInternalBarcode(purchasePrice = 0) {
  const cost = Math.max(0, Math.floor(Number(purchasePrice) || 0));
  const hex = (crypto.randomUUID() || "").replace(/-/g, "").slice(0, 10).toUpperCase();
  return `DW${cost}C${hex}`;
}
