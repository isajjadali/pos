/**
 * Width ≈ longest name in `rows` so Name does not steal leftover table space.
 * @param {Array} rows
 * @param {string|((row: any) => string)} [keyOrGetter="name"]
 * @param {{ min?: number, charPx?: number, pad?: number, headerChars?: number }} [opts]
 */
export function fitNameColumnWidth(rows, keyOrGetter = "name", opts = {}) {
  const min = opts.min ?? 72;
  const charPx = opts.charPx ?? 7.4;
  const pad = opts.pad ?? 24;
  let maxChars = opts.headerChars ?? 4;
  const get =
    typeof keyOrGetter === "function" ? keyOrGetter : (r) => r?.[keyOrGetter];
  for (const r of rows || []) {
    const n = String(get(r) ?? "").length;
    if (n > maxChars) maxChars = n;
  }
  return Math.max(min, Math.ceil(maxChars * charPx) + pad);
}

/**
 * First-column row numbers (1-based). Supports paginated tables.
 * @param {number|{value:number}|(() => number)} page
 * @param {number|{value:number}|(() => number)} pageSize
 */
export function rowNumberColumn(page = 1, pageSize = 20) {
  const pageOf = () => {
    if (typeof page === "function") return page();
    if (page && typeof page === "object" && "value" in page) return page.value;
    return Number(page) || 1;
  };
  const sizeOf = () => {
    if (typeof pageSize === "function") return pageSize();
    if (pageSize && typeof pageSize === "object" && "value" in pageSize) return pageSize.value;
    return Number(pageSize) || 20;
  };

  return {
    title: "#",
    key: "_rownum",
    width: 52,
    align: "center",
    render(_row, index) {
      return (pageOf() - 1) * sizeOf() + index + 1;
    },
  };
}

/**
 * Naive UI pagination `prefix` — shows range + total (e.g. "1–20 of 150").
 * @param {{ startIndex?: number, endIndex?: number, itemCount?: number }} info
 */
export function paginationTotalPrefix(info = {}) {
  const total = Math.max(0, Number(info.itemCount) || 0);
  if (total <= 0) return "Total 0";
  const start = Math.max(1, (Number(info.startIndex) || 0) + 1);
  const end = Math.min(total, Math.max(start, Number(info.endIndex) || 0));
  return `${start}–${end} of ${total}`;
}

export function compareStrings(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

export function compareNumbers(a, b) {
  return (Number(a) || 0) - (Number(b) || 0);
}

export function compareBooleans(a, b) {
  if (a === b) return 0;
  return a ? -1 : 1;
}

export function compareDates(a, b) {
  const ta = a ? new Date(a).getTime() : 0;
  const tb = b ? new Date(b).getTime() : 0;
  const na = Number.isFinite(ta) ? ta : 0;
  const nb = Number.isFinite(tb) ? tb : 0;
  return na - nb;
}

/** Table cells: DD/MM/YYYY hh:mm AM/PM */
export function formatCreatedAt(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  const hh = String(h).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min} ${ampm}`;
}

/**
 * Sortable "Created" column for list tables.
 * @param {{ key?: string, title?: string, width?: number, remote?: boolean }} [opts]
 *   remote: true when parent uses @update:sorter + server/query sort (no client sorter fn)
 */
export function createdAtColumn(opts = {}) {
  const key = opts.key || "created_at";
  const col = {
    title: opts.title || "Created",
    key,
    width: opts.width ?? 158,
    render: (row) => formatCreatedAt(row?.[key]),
  };
  if (opts.remote) {
    col.sorter = true;
  } else {
    Object.assign(col, tableSorter("date", key));
  }
  return col;
}

/**
 * Naive UI column sorter.
 * @param {"string"|"number"|"boolean"|"date"} type
 * @param {string|((a,b)=>number)} keyOrCompare — field key or custom compare
 */
export function tableSorter(type = "string", keyOrCompare) {
  if (typeof keyOrCompare === "function") {
    return { sorter: keyOrCompare };
  }
  const key = keyOrCompare;
  if (type === "number") {
    return { sorter: (a, b) => compareNumbers(a[key], b[key]) };
  }
  if (type === "boolean") {
    return { sorter: (a, b) => compareBooleans(a[key], b[key]) };
  }
  if (type === "date") {
    return { sorter: (a, b) => compareDates(a[key], b[key]) };
  }
  return { sorter: (a, b) => compareStrings(a[key], b[key]) };
}

export function sortRowsByColumn(rows, sorter, getCompareValue) {
  if (!sorter?.columnKey || !sorter?.order) return rows;
  const key = sorter.columnKey;
  const dir = sorter.order === "descend" ? -1 : 1;
  const list = [...rows];
  list.sort((a, b) => {
    const va = getCompareValue ? getCompareValue(a, key) : a[key];
    const vb = getCompareValue ? getCompareValue(b, key) : b[key];
    if (typeof va === "number" || typeof vb === "number") {
      return dir * compareNumbers(va, vb);
    }
    if (typeof va === "boolean" || typeof vb === "boolean") {
      return dir * compareBooleans(Boolean(va), Boolean(vb));
    }
    return dir * compareStrings(va, vb);
  });
  return list;
}
