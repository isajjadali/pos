import { requireSupabase } from "../lib/supabase.js";
import { resolveDateRange } from "../utils/dateRange.js";

/** @deprecated prefer resolveDateRange from utils/dateRange.js */
export function resolveInsightsDateRange(preset, fromYmd = null, toYmd = null) {
  return resolveDateRange(preset, fromYmd, toYmd);
}

/** Page through PostgREST (default max often 1000). */
async function fetchAllRows(buildQuery, pageSize = 1000) {
  const rows = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw error;
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function marginPct(revenue, profit) {
  const r = Number(revenue);
  if (!Number.isFinite(r) || r <= 0) return null;
  return Math.round(((Number(profit) || 0) / r) * 10000) / 100;
}

function chunkIds(ids, size = 200) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Vendor / category P&L using stock receipts (purchased) and sale_items (sold).
 *
 * @param {{
 *   dimension: 'vendor'|'category',
 *   entityId?: string|null,
 *   entityIds?: string[],
 *   rangePreset?: string,
 *   fromYmd?: string|null,
 *   toYmd?: string|null,
 * }} opts
 */
export async function fetchInsightsReport({
  dimension,
  entityId = null,
  entityIds = null,
  rangePreset = "month",
  fromYmd = null,
  toYmd = null,
} = {}) {
  const ids = [
    ...new Set(
      (Array.isArray(entityIds) && entityIds.length
        ? entityIds
        : entityId
          ? [entityId]
          : []
      )
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    ),
  ];
  if (!ids.length) {
    throw new Error(
      dimension === "vendor" ? "Select at least one vendor" : "Select at least one category"
    );
  }
  if (dimension !== "vendor" && dimension !== "category") {
    throw new Error("Invalid dimension");
  }

  const sb = requireSupabase();
  const range = resolveInsightsDateRange(rangePreset, fromYmd, toYmd);
  const productFilterCol = dimension === "vendor" ? "vendor_id" : "category_id";

  const products = [];
  for (const chunk of chunkIds(ids)) {
    const part = await fetchAllRows(() =>
      sb
        .from("products")
        .select("id, name, external_product_id, current_stock, weighted_avg_cost, is_active")
        .in(productFilterCol, chunk)
    );
    products.push(...part);
  }

  const productIds = products.map((p) => p.id);
  /** @type {Map<string, object>} */
  const productById = new Map(products.map((p) => [p.id, p]));

  // --- Purchases (stock receipts) ---
  let receiptRows = [];
  if (dimension === "vendor") {
    for (const chunk of chunkIds(ids)) {
      const part = await fetchAllRows(() => {
        let q = sb
          .from("stock_receipt_items")
          .select(
            "product_id, quantity, unit_purchase_cost, stock_receipts!inner(id, vendor_id, purchase_date, created_at)"
          )
          .in("stock_receipts.vendor_id", chunk);
        if (range.fromDate) q = q.gte("stock_receipts.purchase_date", range.fromDate);
        if (range.toDate) q = q.lte("stock_receipts.purchase_date", range.toDate);
        return q;
      });
      receiptRows.push(...part);
    }
  } else if (productIds.length) {
    for (const chunk of chunkIds(productIds)) {
      const part = await fetchAllRows(() => {
        let q = sb
          .from("stock_receipt_items")
          .select(
            "product_id, quantity, unit_purchase_cost, stock_receipts!inner(id, vendor_id, purchase_date, created_at)"
          )
          .in("product_id", chunk);
        if (range.fromDate) q = q.gte("stock_receipts.purchase_date", range.fromDate);
        if (range.toDate) q = q.lte("stock_receipts.purchase_date", range.toDate);
        return q;
      });
      receiptRows.push(...part);
    }
  }

  // --- Sales (completed sale_items for products in scope) ---
  let saleRows = [];
  if (productIds.length) {
    for (const chunk of chunkIds(productIds)) {
      const part = await fetchAllRows(() => {
        let q = sb
          .from("sale_items")
          .select(
            "product_id, quantity, unit_cost, line_total, discount_amount, sales!inner(id, status, completed_at)"
          )
          .eq("sales.status", "completed")
          .in("product_id", chunk);
        if (range.fromIso) q = q.gte("sales.completed_at", range.fromIso);
        if (range.toIso) q = q.lte("sales.completed_at", range.toIso);
        return q;
      });
      saleRows.push(...part);
    }
  }

  /** @type {Map<string, { qtyPurchased: number, purchasedValue: number, qtySold: number, revenue: number, soldCost: number }>} */
  const byProduct = new Map();

  function ensureRow(productId) {
    if (!byProduct.has(productId)) {
      byProduct.set(productId, {
        qtyPurchased: 0,
        purchasedValue: 0,
        qtySold: 0,
        revenue: 0,
        soldCost: 0,
      });
    }
    return byProduct.get(productId);
  }

  let purchasedValue = 0;
  let purchasedQty = 0;
  for (const r of receiptRows) {
    const qty = Number(r.quantity) || 0;
    const cost = Number(r.unit_purchase_cost) || 0;
    const line = qty * cost;
    purchasedValue += line;
    purchasedQty += qty;
    const row = ensureRow(r.product_id);
    row.qtyPurchased += qty;
    row.purchasedValue += line;
    if (!productById.has(r.product_id)) {
      productById.set(r.product_id, {
        id: r.product_id,
        name: "(Removed / other product)",
        external_product_id: null,
        current_stock: 0,
        weighted_avg_cost: 0,
        is_active: false,
      });
    }
  }

  let revenue = 0;
  let soldCost = 0;
  let qtySold = 0;
  for (const s of saleRows) {
    const qty = Number(s.quantity) || 0;
    const rev = Number(s.line_total) - Number(s.discount_amount || 0);
    const cost = (Number(s.unit_cost) || 0) * qty;
    revenue += rev;
    soldCost += cost;
    qtySold += qty;
    const row = ensureRow(s.product_id);
    row.qtySold += qty;
    row.revenue += rev;
    row.soldCost += cost;
  }

  let onHandValue = 0;
  let onHandUnits = 0;
  for (const p of products) {
    const stock = Number(p.current_stock) || 0;
    const avg = Number(p.weighted_avg_cost) || 0;
    onHandUnits += stock;
    onHandValue += stock * avg;
  }

  const profit = revenue - soldCost;

  const productRows = [...byProduct.entries()]
    .map(([id, agg]) => {
      const p = productById.get(id) || {
        id,
        name: "Unknown",
        external_product_id: null,
        current_stock: 0,
        weighted_avg_cost: 0,
      };
      const rowProfit = agg.revenue - agg.soldCost;
      return {
        id,
        name: p.name,
        external_product_id: p.external_product_id || "",
        qtySold: agg.qtySold,
        revenue: money(agg.revenue),
        soldCost: money(agg.soldCost),
        profit: money(rowProfit),
        marginPct: marginPct(agg.revenue, rowProfit),
        qtyPurchased: agg.qtyPurchased,
        purchasedValue: money(agg.purchasedValue),
        onHand: Number(p.current_stock) || 0,
      };
    })
    .filter((r) => r.qtySold > 0 || r.qtyPurchased > 0)
    .sort((a, b) => b.revenue - a.revenue || b.qtySold - a.qtySold);

  return {
    dimension,
    entityIds: ids,
    range,
    summary: {
      purchasedValue: money(purchasedValue),
      purchasedQty,
      revenue: money(revenue),
      soldCost: money(soldCost),
      profit: money(profit),
      marginPct: marginPct(revenue, profit),
      qtySold,
      onHandUnits,
      onHandValue: money(onHandValue),
      productCount: products.length,
      productRowsCount: productRows.length,
    },
    products: productRows,
  };
}
