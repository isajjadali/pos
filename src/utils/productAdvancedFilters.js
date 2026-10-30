/** Shared advanced product-list filter helpers (online + offline). */

export const COMPARE_OPS = ["lt", "lte", "eq", "gte", "gt"];

export const COMPARE_OP_OPTIONS = [
  { label: "Less than (<)", value: "lt" },
  { label: "At or below (≤)", value: "lte" },
  { label: "Equal (=)", value: "eq" },
  { label: "At or above (≥)", value: "gte" },
  { label: "Greater than (>)", value: "gt" },
];

export const PRESENCE_OPTIONS = [
  { label: "Any", value: "all" },
  { label: "Has value", value: "has" },
  { label: "Missing", value: "missing" },
];

export const KEYWORD_FIELD_OPTIONS = [
  { label: "Name", value: "name" },
  { label: "SKU", value: "sku" },
  { label: "Barcode", value: "barcode" },
];

export const DEFAULT_KEYWORD_FIELDS = ["name", "sku", "barcode"];

/**
 * @param {number} value
 * @param {string} op
 * @param {number} n
 */
export function matchesCompareOp(value, op, n) {
  if (!Number.isFinite(value) || !Number.isFinite(n)) return false;
  switch (op) {
    case "lt":
      return value < n;
    case "lte":
      return value <= n;
    case "eq":
      return value === n;
    case "gte":
      return value >= n;
    case "gt":
      return value > n;
    default:
      return true;
  }
}

/** Apply PostgREST numeric compare on a query builder. */
export function applyPostgrestCompare(query, column, op, n) {
  if (!Number.isFinite(n)) return query;
  switch (op) {
    case "lt":
      return query.lt(column, n);
    case "lte":
      return query.lte(column, n);
    case "eq":
      return query.eq(column, n);
    case "gte":
      return query.gte(column, n);
    case "gt":
      return query.gt(column, n);
    default:
      return query;
  }
}

/**
 * @param {string|null|undefined} value
 * @param {"all"|"has"|"missing"} mode
 */
export function matchesPresence(value, mode) {
  if (mode === "all" || !mode) return true;
  const empty = value == null || String(value).trim() === "";
  if (mode === "has") return !empty;
  if (mode === "missing") return empty;
  return true;
}

/**
 * Keyword must match at least one selected field (OR).
 * @param {Record<string, unknown>} product
 * @param {string} keyword
 * @param {string[]} fields
 */
export function matchesKeywordFields(product, keyword, fields) {
  const q = String(keyword ?? "").trim().toLowerCase();
  if (!q) return true;
  const cols = (fields?.length ? fields : DEFAULT_KEYWORD_FIELDS).map(String);
  return cols.some((col) => String(product?.[col] ?? "").toLowerCase().includes(q));
}

/**
 * Resolve vendor IDs from cached products for vendor-scoped rules.
 * @param {Array<{vendor_id?: string|null, name?: string, sku?: string, barcode?: string}>} products
 * @param {{ catalogKeyword?: string, countOp?: string|null, countN?: number|null }} rules
 * @returns {string[]|null} null = no vendor rule active; [] = match none
 */
export function resolveVendorIdsLocal(products, rules = {}) {
  const kw = String(rules.catalogKeyword ?? "").trim().toLowerCase();
  const countOp = rules.countOp || null;
  const countN = rules.countN;
  const countActive = Boolean(countOp) && Number.isFinite(countN);
  if (!kw && !countActive) return null;

  const byVendor = new Map();
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const vid = p?.vendor_id != null ? String(p.vendor_id) : "";
    if (!vid) continue;
    let entry = byVendor.get(vid);
    if (!entry) {
      entry = { count: 0, catalogHit: false };
      byVendor.set(vid, entry);
    }
    entry.count += 1;
    if (
      kw &&
      !entry.catalogHit &&
      matchesKeywordFields(p, kw, DEFAULT_KEYWORD_FIELDS)
    ) {
      entry.catalogHit = true;
    }
  }

  const out = [];
  for (const [vid, entry] of byVendor) {
    if (kw && !entry.catalogHit) continue;
    if (countActive && !matchesCompareOp(entry.count, countOp, countN)) continue;
    out.push(vid);
  }
  return out;
}
