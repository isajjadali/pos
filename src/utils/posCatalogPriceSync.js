/**
 * Apply cashier-overridden POS line prices onto the local product catalog cache
 * (and shape used when syncing). Custom lines are skipped.
 *
 * @param {Array} cartLines
 * @param {{ patchProduct: (id: string, partial: object) => void }} cache
 */
export function applyOverriddenPricesToLocalCatalog(cartLines, cache) {
  if (!cache?.patchProduct) return;
  /** @type {Map<string, { piece?: number, pack?: number, box?: number }>} */
  const byId = new Map();

  for (const l of cartLines || []) {
    if (!l?.price_overridden || l.is_custom || !l.product_id) continue;
    const id = String(l.product_id);
    const price = Math.max(0, Number(l.unit_selling_price) || 0);
    const unit = String(l.sale_unit || "piece").toLowerCase();
    const cur = byId.get(id) || {};
    if (unit === "pack") cur.pack = price;
    else if (unit === "box") cur.box = price;
    else cur.piece = price;
    byId.set(id, cur);
  }

  for (const [id, units] of byId) {
    const partial = {};
    if (units.piece != null) {
      partial.piece_selling_price = units.piece;
      partial.selling_price = units.piece;
    }
    if (units.pack != null) {
      partial.pack_selling_price = units.pack;
    }
    if (units.box != null) {
      partial.box_selling_price = units.box;
    }
    // Prefer catalog selling_price = price of default unit when we know it from the line's product snap
    const line = (cartLines || []).find((l) => String(l.product_id) === id);
    const def = String(line?.products?.default_sale_unit || "piece").toLowerCase();
    if (def === "pack" && units.pack != null) partial.selling_price = units.pack;
    else if (def === "box" && units.box != null) partial.selling_price = units.box;
    else if (units.piece != null) partial.selling_price = units.piece;
    else if (units.pack != null) partial.selling_price = units.pack;
    else if (units.box != null) partial.selling_price = units.box;

    cache.patchProduct(id, partial);
  }
}
