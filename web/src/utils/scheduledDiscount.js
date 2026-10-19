/** @param {number} a @param {number} b */
export function moneyClose(a, b, eps = 0.009) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

export function scheduledPromoUsesPercent(promo) {
  const pct = Number(promo?.discount_percent);
  return Number.isFinite(pct) && pct > 0;
}

/** PKR discount for a promo row; percent takes priority when set. */
export function computeScheduledDiscountPkr(promo, subtotal) {
  if (!promo) return 0;
  const sub = Math.max(0, Number(subtotal) || 0);
  if (scheduledPromoUsesPercent(promo)) {
    const pct = Math.min(100, Math.max(0, Number(promo.discount_percent) || 0));
    const raw = (sub * pct) / 100;
    return Math.min(sub, Math.round(raw * 100) / 100);
  }
  return Math.min(sub, Math.max(0, Number(promo.discount_amount) || 0));
}

export function formatScheduledPromoRule(promo, formatPkr) {
  if (!promo) return "";
  if (scheduledPromoUsesPercent(promo)) {
    const pct = Number(promo.discount_percent);
    return `${pct}%`;
  }
  const amt = Number(promo.discount_amount) || 0;
  return typeof formatPkr === "function" ? formatPkr(amt) : String(amt);
}

export function pickBestScheduledDiscount(promos, subtotal) {
  let best = null;
  let bestVal = -1;
  for (const p of promos ?? []) {
    const v = computeScheduledDiscountPkr(p, subtotal);
    if (v > bestVal) {
      bestVal = v;
      best = p;
    }
  }
  return best;
}
