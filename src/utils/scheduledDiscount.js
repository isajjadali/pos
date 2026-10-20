/** @param {number} a @param {number} b */
export function moneyClose(a, b, eps = 0.009) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

export function scheduledPromoUsesPercent(promo) {
  const pct = Number(promo?.discount_percent);
  return Number.isFinite(pct) && pct > 0;
}

export function normalizeProductScope(promo) {
  const s = String(promo?.product_scope ?? "all").toLowerCase();
  if (s === "by_price" || s === "specific") return s;
  return "all";
}

function lineUnitPrice(line) {
  const u = Number(line?.unit_selling_price);
  if (Number.isFinite(u)) return u;
  return Number(line?.products?.selling_price) || 0;
}

function lineTotal(line) {
  const t = Number(line?.line_total);
  if (Number.isFinite(t)) return Math.max(0, t);
  const qty = Math.max(0, Number(line?.quantity) || 0);
  return qty * lineUnitPrice(line);
}

/** Whether a cart line is eligible for this promo. */
export function lineMatchesPromo(promo, line) {
  if (!promo || !line) return false;
  const scope = normalizeProductScope(promo);

  if (scope === "all") return true;

  if (scope === "specific") {
    const ids = promo.product_ids ?? [];
    const pid = line.product_id;
    if (!pid || !Array.isArray(ids) || !ids.length) return false;
    return ids.some((id) => String(id) === String(pid));
  }

  // by_price
  const op = String(promo.price_op ?? "").toLowerCase();
  const threshold = Number(promo.price_threshold);
  if (!Number.isFinite(threshold)) return false;
  const price = lineUnitPrice(line);
  if (op === "gte") return price >= threshold;
  if (op === "lte") return price <= threshold;
  return false;
}

/** Sum of matching line totals (eligible discount base). */
export function eligibleSubtotal(promo, items) {
  if (!promo) return 0;
  if (normalizeProductScope(promo) === "all") {
    return Math.max(
      0,
      (items ?? []).reduce((s, line) => s + lineTotal(line), 0)
    );
  }
  return Math.max(
    0,
    (items ?? []).reduce((s, line) => {
      if (!lineMatchesPromo(promo, line)) return s;
      return s + lineTotal(line);
    }, 0)
  );
}

/**
 * PKR discount for a promo.
 * @param {object} promo
 * @param {number|Array} subtotalOrItems — cart items preferred; number treated as eligible base (legacy)
 */
export function computeScheduledDiscountPkr(promo, subtotalOrItems) {
  if (!promo) return 0;
  let eligible = 0;
  if (Array.isArray(subtotalOrItems)) {
    eligible = eligibleSubtotal(promo, subtotalOrItems);
  } else {
    eligible = Math.max(0, Number(subtotalOrItems) || 0);
  }
  if (eligible <= 0) return 0;

  if (scheduledPromoUsesPercent(promo)) {
    const pct = Math.min(100, Math.max(0, Number(promo.discount_percent) || 0));
    const raw = (eligible * pct) / 100;
    return Math.min(eligible, Math.round(raw * 100) / 100);
  }
  return Math.min(eligible, Math.max(0, Number(promo.discount_amount) || 0));
}

export function formatScheduledPromoScope(promo, formatPkr) {
  if (!promo) return "";
  const scope = normalizeProductScope(promo);
  if (scope === "all") return "all products";
  if (scope === "specific") {
    const n = Array.isArray(promo.product_ids) ? promo.product_ids.length : 0;
    return n === 1 ? "1 product" : `${n} products`;
  }
  const op = String(promo.price_op ?? "").toLowerCase() === "gte" ? "≥" : "≤";
  const thr = Number(promo.price_threshold) || 0;
  const thrLabel = typeof formatPkr === "function" ? formatPkr(thr) : String(thr);
  return `price ${op} ${thrLabel}`;
}

export function formatScheduledPromoRule(promo, formatPkr) {
  if (!promo) return "";
  let rule = "";
  if (scheduledPromoUsesPercent(promo)) {
    rule = `${Number(promo.discount_percent)}%`;
  } else {
    const amt = Number(promo.discount_amount) || 0;
    rule = typeof formatPkr === "function" ? formatPkr(amt) : String(amt);
  }
  const scope = formatScheduledPromoScope(promo, formatPkr);
  return scope ? `${rule} · ${scope}` : rule;
}

export function pickBestScheduledDiscount(promos, subtotalOrItems) {
  let best = null;
  let bestVal = -1;
  for (const p of promos ?? []) {
    const v = computeScheduledDiscountPkr(p, subtotalOrItems);
    if (v > bestVal) {
      bestVal = v;
      best = p;
    }
  }
  return best;
}

/** Short rule label for a line (e.g. "10%" or "Rs 50") — empty if line not eligible. */
export function formatLinePromoRule(promo, line, formatPkr) {
  if (!promo || !lineMatchesPromo(promo, line)) return "";
  if (scheduledPromoUsesPercent(promo)) {
    return `${Number(promo.discount_percent)}%`;
  }
  const amt = Number(promo.discount_amount) || 0;
  return typeof formatPkr === "function" ? formatPkr(amt) : String(amt);
}

/**
 * This line's share of the cart scheduled discount (PKR).
 * Percent → % of line total. Fixed amount → proportional to line among eligible lines.
 */
export function computeLineScheduledDiscountPkr(promo, line, items) {
  if (!promo || !lineMatchesPromo(promo, line)) return 0;
  const lt = lineTotal(line);
  if (lt <= 0) return 0;

  if (scheduledPromoUsesPercent(promo)) {
    const pct = Math.min(100, Math.max(0, Number(promo.discount_percent) || 0));
    return Math.min(lt, Math.round(((lt * pct) / 100) * 100) / 100);
  }

  const eligible = eligibleSubtotal(promo, items);
  if (eligible <= 0) return 0;
  const totalDisc = Math.min(eligible, Math.max(0, Number(promo.discount_amount) || 0));
  if (totalDisc <= 0) return 0;
  return Math.min(lt, Math.round(((lt / eligible) * totalDisc) * 100) / 100);
}
