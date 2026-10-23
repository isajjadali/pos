import { formatSaleLineName } from "./saleUnits.js";

/**
 * Build a receipt-shaped { sale, items } from the live POS cart so printing
 * works before the sale reaches Supabase.
 */
export function buildOfflineReceiptDetail(cartLines, { discount = 0, amountReceived = 0, clientSaleId }) {
  const id = clientSaleId || crypto.randomUUID();
  const subtotal = (cartLines || []).reduce((s, l) => s + Number(l.line_total || 0), 0);
  const disc = Math.max(0, Number(discount) || 0);
  const total = Math.max(0, subtotal - disc);
  const received = Math.max(0, Number(amountReceived) || 0);
  const short = String(id).replace(/-/g, "").slice(0, 8).toUpperCase();

  const sale = {
    id,
    sale_reference: `OFF-${short}`,
    completed_at: new Date().toISOString(),
    subtotal,
    discount_amount: disc,
    total_amount: total,
    payment_method: "cash",
    amount_received: received,
    change_due: Math.max(0, received - total),
    offline_pending: true,
  };

  const items = (cartLines || []).map((l, i) => {
    const base = l.products?.name || "Item";
    const name = formatSaleLineName(base, l.sale_unit || "piece", l.pieces_per_unit || 1);
    return {
      id: `${id}-${i}`,
      product_id: l.product_id,
      product_name_snapshot: name,
      quantity: l.quantity,
      unit_selling_price: Number(l.unit_selling_price) || 0,
      line_total: Number(l.line_total) || 0,
      sale_unit: l.sale_unit || "piece",
      pieces_per_unit: Math.max(1, Math.floor(Number(l.pieces_per_unit) || 1)),
      discount_amount: 0,
      unit_cost: 0,
    };
  });

  return { sale, items, clientSaleId: id };
}

/** Piece deltas to apply to local catalog after an offline sale. */
export function stockDeltasFromCartLines(cartLines) {
  const map = new Map();
  for (const l of cartLines || []) {
    const pcs =
      Math.max(1, Math.floor(Number(l.quantity) || 0)) *
      Math.max(1, Math.floor(Number(l.pieces_per_unit) || 1));
    map.set(l.product_id, (map.get(l.product_id) || 0) - pcs);
  }
  return [...map.entries()].map(([productId, deltaQty]) => ({ productId, deltaQty }));
}
