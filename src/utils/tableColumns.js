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

/**
 * Naive UI column sorter.
 * @param {"string"|"number"|"boolean"} type
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
