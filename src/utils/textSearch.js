/**
 * Shared search helpers — always substring (contains), never prefix-only.
 * Multi-word queries: every token must appear somewhere in the haystack.
 */

export function normalizeSearchQuery(query) {
  return String(query ?? "")
    .trim()
    .toLowerCase();
}

/**
 * @param {string|null|undefined} haystack
 * @param {string} query
 */
export function matchesSearch(haystack, query) {
  const q = normalizeSearchQuery(query);
  if (!q) return true;
  const hay = String(haystack ?? "").toLowerCase();
  if (hay.includes(q)) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return false;
  return tokens.every((t) => hay.includes(t));
}

/**
 * @param {Array<string|number|null|undefined>} fields
 * @param {string} query
 */
export function matchesSearchFields(fields, query) {
  return matchesSearch(
    (fields || []).map((f) => String(f ?? "")).join(" "),
    query
  );
}

/**
 * Escape a value for PostgREST quoted filter strings.
 * @param {string} value
 */
function escapePostgrestQuoted(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build `col.ilike."%term%",…` for `.or(...)`.
 * Uses quoted `"%…%"` so leading/trailing wildcards survive URL encoding
 * (bare `%` in `.or()` strings can be eaten → accidental prefix-only match).
 *
 * @param {string[]} columns
 * @param {string} term
 * @returns {string|null}
 */
export function postgrestIlikeOr(columns, term) {
  const raw = String(term ?? "").trim();
  if (!raw || !columns?.length) return null;
  const pattern = `"%${escapePostgrestQuoted(raw)}%"`;
  return columns.map((col) => `${col}.ilike.${pattern}`).join(",");
}

/**
 * Naive UI NSelect/NAutoComplete filter — substring on label (and value).
 */
export function naiveSelectSubstringFilter(pattern, option) {
  if (!pattern) return true;
  const q = String(pattern).toLowerCase();
  const label = String(option?.label ?? "").toLowerCase();
  const value = String(option?.value ?? "").toLowerCase();
  return label.includes(q) || value.includes(q);
}
