/** Match pack size in product name (same rules as root sheet-io). */
export function parsePiecesFromProductName(productName) {
  const name = String(productName ?? "");
  if (/\b\d+\s*dz\b/i.test(name)) return 12;
  const patterns = [
    /\b(\d+)\s*pcs\b/i,
    /\b(\d+)\s*pc\b/i,
    /\b(\d+)pc\b/i,
    /\b(\d+)p(?=\s|[a-z])/i,
  ];
  for (const re of patterns) {
    const m = name.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0) return n;
    }
  }
  return null;
}

export function computePerPiecePrice(purchasePrice, productName) {
  const pieces = parsePiecesFromProductName(productName);
  const rate = Number(purchasePrice);
  if (!pieces || !Number.isFinite(rate)) return null;
  return Math.round((rate / pieces) * 100) / 100;
}
