import { requireSupabase } from "../lib/supabase.js";

/** Page through PostgREST (default max often 1000) so overall totals stay accurate. */
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

function startOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d = new Date()) {
  const x = startOfLocalDay(d);
  const day = x.getDay(); // 0 Sun
  const diff = day === 0 ? 6 : day - 1; // Monday start
  x.setDate(x.getDate() - diff);
  return x;
}

function startOfMonth(d = new Date()) {
  const x = startOfLocalDay(d);
  x.setDate(1);
  return x;
}

function dayKey(isoOrDate) {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lineProfit(item) {
  const rev = Number(item.line_total) - Number(item.discount_amount || 0);
  const cost = Number(item.unit_cost) * Number(item.quantity);
  return rev - cost;
}

function emptyPeriod() {
  return { salesCount: 0, revenue: 0, profit: 0, marginPct: null };
}

function withMargin(period) {
  const rev = period.revenue;
  const profit = period.profit;
  return {
    ...period,
    marginPct: rev > 0 ? Math.round((profit / rev) * 10000) / 100 : null,
  };
}

/**
 * Aggregate sales into today / week / month / overall + last-7-day spark series.
 */
export async function fetchDashboardStats() {
  const sb = requireSupabase();
  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);
  const sevenDaysAgo = startOfLocalDay(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const [productsRes, sales, items, lowStockRes, recentRes] = await Promise.all([
    sb.from("products").select("current_stock, weighted_avg_cost, is_active").eq("is_active", true),
    fetchAllRows(() =>
      sb.from("sales").select("id, total_amount, completed_at").eq("status", "completed")
    ),
    fetchAllRows(() =>
      sb
        .from("sale_items")
        .select("sale_id, line_total, discount_amount, unit_cost, quantity")
    ),
    sb
      .from("products")
      .select("id, name, current_stock, low_stock_threshold")
      .eq("is_active", true)
      .eq("is_low_stock", true)
      .order("current_stock", { ascending: true })
      .limit(12),
    sb
      .from("sales")
      .select("id, sale_reference, total_amount, completed_at")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(10),
  ]);

  if (productsRes.error) throw productsRes.error;
  if (lowStockRes.error) throw lowStockRes.error;
  if (recentRes.error) throw recentRes.error;

  const products = productsRes.data ?? [];
  const activeCount = products.length;
  const unitsInStock = products.reduce((s, p) => s + Number(p.current_stock || 0), 0);
  const inventoryValue = products.reduce(
    (s, p) => s + Number(p.current_stock || 0) * Number(p.weighted_avg_cost || 0),
    0
  );

  /** @type {Map<string, number>} */
  const profitBySale = new Map();
  for (const item of items) {
    const id = item.sale_id;
    profitBySale.set(id, (profitBySale.get(id) || 0) + lineProfit(item));
  }

  const today = emptyPeriod();
  const week = emptyPeriod();
  const month = emptyPeriod();
  const overall = emptyPeriod();

  /** @type {Map<string, { revenue: number, profit: number, salesCount: number }>} */
  const byDay = new Map();
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo);
    d.setDate(sevenDaysAgo.getDate() + i);
    byDay.set(dayKey(d), { revenue: 0, profit: 0, salesCount: 0 });
  }

  for (const sale of sales) {
    const completed = new Date(sale.completed_at);
    const revenue = Number(sale.total_amount || 0);
    const profit = profitBySale.get(sale.id) || 0;

    overall.salesCount += 1;
    overall.revenue += revenue;
    overall.profit += profit;

    if (completed >= monthStart) {
      month.salesCount += 1;
      month.revenue += revenue;
      month.profit += profit;
    }
    if (completed >= weekStart) {
      week.salesCount += 1;
      week.revenue += revenue;
      week.profit += profit;
    }
    if (completed >= todayStart) {
      today.salesCount += 1;
      today.revenue += revenue;
      today.profit += profit;
    }

    const key = dayKey(completed);
    if (byDay.has(key)) {
      const bucket = byDay.get(key);
      bucket.revenue += revenue;
      bucket.profit += profit;
      bucket.salesCount += 1;
    }
  }

  const last7Days = [...byDay.entries()].map(([date, v]) => {
    const d = new Date(`${date}T12:00:00`);
    return {
      date,
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      dayNum: d.getDate(),
      revenue: v.revenue,
      profit: v.profit,
      salesCount: v.salesCount,
    };
  });
  const peakDayRevenue = Math.max(0, ...last7Days.map((d) => d.revenue));

  return {
    activeCount,
    unitsInStock,
    inventoryValue,
    // backward-compatible aliases used by older UI bits
    todaySalesCount: today.salesCount,
    todayRevenue: today.revenue,
    todayProfit: today.profit,
    today: withMargin(today),
    week: withMargin(week),
    month: withMargin(month),
    overall: withMargin(overall),
    last7Days,
    peakDayRevenue,
    lowStock: lowStockRes.data ?? [],
    recentSales: recentRes.data ?? [],
  };
}
