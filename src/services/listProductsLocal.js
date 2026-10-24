import { toRaw } from "vue";
import { useProductCacheStore } from "../stores/productCache.js";
import { useMetaCacheStore } from "../stores/metaCache.js";
import { matchesSearchFields } from "../utils/textSearch.js";
import { isTimestampInRange, resolveDateRange } from "../utils/dateRange.js";

/**
 * Offline / cache-backed product listing (same shape as listProducts).
 * Uses plain arrays (toRaw) and only enriches the current page — large catalogs stay fast.
 */
function normalizeFilterIds(ids, single) {
  const fromArr = Array.isArray(ids) ? ids : [];
  const fromSingle = single != null && single !== "" ? [single] : [];
  return [...new Set([...fromArr, ...fromSingle].filter(Boolean).map(String))];
}

function normalizeFilterTags(tags, tag) {
  const fromArr = Array.isArray(tags) ? tags : [];
  const fromSingle = tag != null && tag !== "" ? [tag] : [];
  return [
    ...new Set(
      [...fromArr, ...fromSingle]
        .map((t) => String(t ?? "").trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

export function listProductsLocal({
  search = "",
  vendorId = null,
  vendorIds = null,
  categoryId = null,
  categoryIds = null,
  lowStockOnly = false,
  activeOnly = false,
  tag = null,
  tags = null,
  unitFilter = "all",
  createdRangePreset = "all",
  createdFrom = null,
  createdTo = null,
  page = 1,
  pageSize = 20,
  sortKey = null,
  sortOrder = null,
} = {}) {
  const products = toRaw(useProductCacheStore().products) || [];
  const vendors = toRaw(useMetaCacheStore().vendors) || [];
  const categories = toRaw(useMetaCacheStore().categories) || [];
  const createdRange = resolveDateRange(createdRangePreset, createdFrom, createdTo);

  const vendorMap = Object.create(null);
  for (let i = 0; i < vendors.length; i++) {
    const v = vendors[i];
    if (v?.id) vendorMap[v.id] = v.name || null;
  }
  const catMap = Object.create(null);
  for (let i = 0; i < categories.length; i++) {
    const c = categories[i];
    if (c?.id) catMap[c.id] = c.name || null;
  }

  const term = String(search || "").trim().toLowerCase();
  const vendorList = normalizeFilterIds(vendorIds, vendorId);
  const categoryList = normalizeFilterIds(categoryIds, categoryId);
  const tagList = normalizeFilterTags(tags, tag);
  const vendorSet = vendorList.length ? new Set(vendorList) : null;
  const categorySet = categoryList.length ? new Set(categoryList) : null;
  const uf = String(unitFilter || "all");

  const filtered = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (vendorSet && !vendorSet.has(String(p.vendor_id))) continue;
    if (categorySet && !categorySet.has(String(p.category_id))) continue;
    if (activeOnly && p.is_active === false) continue;
    if (!isTimestampInRange(p.created_at, createdRange)) continue;

    const low =
      p.is_low_stock ?? Number(p.current_stock) <= Number(p.low_stock_threshold ?? 5);
    if (lowStockOnly && !low) continue;

    if (tagList.length) {
      const pTags = p.tags;
      if (
        !Array.isArray(pTags) ||
        !tagList.some((t) => pTags.some((pt) => String(pt).toLowerCase() === t))
      ) {
        continue;
      }
    }

    if (uf === "pack" && !(Number(p.pieces_per_pack) > 1)) continue;
    else if (uf === "box" && p.pieces_per_box == null) continue;
    else if (uf === "piece" && !(Number(p.pieces_per_pack || 1) <= 1 && p.pieces_per_box == null))
      continue;
    else if (uf === "multi" && !(Number(p.pieces_per_pack) > 1 || p.pieces_per_box != null))
      continue;

    if (
      term &&
      !matchesSearchFields([p.name, p.sku, p.barcode, p.external_product_id], term)
    ) {
      continue;
    }

    filtered.push(p);
  }

  const ascending = sortOrder === "ascend";
  const key = sortKey || "updated_at";
  filtered.sort((a, b) => {
    let cmp = 0;
    if (key === "vendor") {
      cmp = String(vendorMap[a.vendor_id] || "").localeCompare(
        String(vendorMap[b.vendor_id] || ""),
        undefined,
        { sensitivity: "base" }
      );
    } else if (key === "created_at" || key === "updated_at") {
      cmp = (a[key] ? new Date(a[key]).getTime() : 0) - (b[key] ? new Date(b[key]).getTime() : 0);
    } else if (typeof a[key] === "number" || typeof b[key] === "number") {
      cmp = Number(a[key] || 0) - Number(b[key] || 0);
    } else {
      cmp = String(a[key] ?? "").localeCompare(String(b[key] ?? ""), undefined, {
        sensitivity: "base",
        numeric: true,
      });
    }
    return ascending ? cmp : -cmp;
  });

  const total = filtered.length;
  const from = (page - 1) * pageSize;
  const pageRows = filtered.slice(from, from + pageSize).map((p) => ({
    ...p,
    vendors: p.vendor_id ? { name: vendorMap[p.vendor_id] || null } : null,
    categories: p.category_id ? { name: catMap[p.category_id] || null } : null,
    is_low_stock:
      p.is_low_stock ?? Number(p.current_stock) <= Number(p.low_stock_threshold ?? 5),
  }));

  return { rows: pageRows, total };
}
