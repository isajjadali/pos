/** Shared created/completed date range helpers for list filters. */

export const DATE_RANGE_PRESET_OPTIONS = [
  { label: "All time", value: "all" },
  { label: "Today", value: "today" },
  { label: "This week", value: "week" },
  { label: "This month", value: "month" },
  { label: "Custom range", value: "custom" },
];

function startOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d = new Date()) {
  const x = startOfLocalDay(d);
  const day = x.getDay();
  const diff = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diff);
  return x;
}

function startOfMonth(d = new Date()) {
  const x = startOfLocalDay(d);
  x.setDate(1);
  return x;
}

function toDateOnly(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * @param {'today'|'week'|'month'|'all'|'custom'} preset
 * @param {string|null} fromYmd
 * @param {string|null} toYmd
 * @returns {{ fromIso: string|null, toIso: string|null, fromDate: string|null, toDate: string|null }}
 */
export function resolveDateRange(preset, fromYmd = null, toYmd = null) {
  const now = new Date();
  if (preset === "all" || !preset) {
    return { fromIso: null, toIso: null, fromDate: null, toDate: null };
  }
  if (preset === "custom") {
    const from = fromYmd ? startOfLocalDay(new Date(`${fromYmd}T12:00:00`)) : null;
    let to = toYmd ? startOfLocalDay(new Date(`${toYmd}T12:00:00`)) : null;
    if (to) {
      to = new Date(to);
      to.setHours(23, 59, 59, 999);
    }
    return {
      fromIso: from ? from.toISOString() : null,
      toIso: to ? to.toISOString() : null,
      fromDate: fromYmd || null,
      toDate: toYmd || null,
    };
  }
  let from;
  if (preset === "today") from = startOfLocalDay(now);
  else if (preset === "week") from = startOfWeek(now);
  else from = startOfMonth(now);
  const to = new Date(now);
  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    fromDate: toDateOnly(from),
    toDate: toDateOnly(to),
  };
}

/** True when the user picked a non-default created range. */
export function dateRangeFilterActive(preset, fromYmd = null, toYmd = null) {
  if (!preset || preset === "all") return false;
  if (preset === "custom") return Boolean(fromYmd || toYmd);
  return true;
}

/** Apply gte/lte on a PostgREST query builder. */
export function applyTimestampFilter(query, column, range) {
  if (!range) return query;
  if (range.fromIso) query = query.gte(column, range.fromIso);
  if (range.toIso) query = query.lte(column, range.toIso);
  return query;
}

/** Client-side check for cached/local rows. */
export function isTimestampInRange(iso, range) {
  if (!range || (!range.fromIso && !range.toIso)) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  if (range.fromIso && t < new Date(range.fromIso).getTime()) return false;
  if (range.toIso && t > new Date(range.toIso).getTime()) return false;
  return true;
}
