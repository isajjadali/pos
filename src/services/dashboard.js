import { requireSupabase } from "../lib/supabase.js";

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function fetchDashboardStats() {
  const sb = requireSupabase();
  const today = startOfTodayIso();

  const [productsRes, salesRes, lowStockRes] = await Promise.all([
    sb.from("products").select("current_stock, weighted_avg_cost, is_active").eq("is_active", true),
    sb
      .from("sales")
      .select("id, total_amount, completed_at")
      .eq("status", "completed")
      .gte("completed_at", today),
    sb
      .from("products")
      .select("id, name, current_stock, low_stock_threshold")
      .eq("is_active", true)
      .eq("is_low_stock", true)
      .limit(10),
  ]);

  if (productsRes.error) throw productsRes.error;
  if (salesRes.error) throw salesRes.error;
  if (lowStockRes.error) throw lowStockRes.error;

  const products = productsRes.data ?? [];
  const activeCount = products.length;
  const unitsInStock = products.reduce((s, p) => s + Number(p.current_stock || 0), 0);
  const inventoryValue = products.reduce(
    (s, p) => s + Number(p.current_stock || 0) * Number(p.weighted_avg_cost || 0),
    0
  );

  const todaySales = salesRes.data ?? [];
  const todayRevenue = todaySales.reduce((s, x) => s + Number(x.total_amount || 0), 0);

  const saleIds = todaySales.map((s) => s.id);
  let todayProfit = 0;
  if (saleIds.length) {
    const { data: items, error } = await sb.from("sale_items").select("*").in("sale_id", saleIds);
    if (error) throw error;
    todayProfit = (items ?? []).reduce((sum, i) => {
      const rev = Number(i.line_total) - Number(i.discount_amount || 0);
      const cost = Number(i.unit_cost) * Number(i.quantity);
      return sum + (rev - cost);
    }, 0);
  }

  const { data: recentSales, error: rsErr } = await sb
    .from("sales")
    .select("id, sale_reference, total_amount, completed_at")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(8);
  if (rsErr) throw rsErr;

  return {
    activeCount,
    unitsInStock,
    inventoryValue,
    todaySalesCount: todaySales.length,
    todayRevenue,
    todayProfit,
    lowStock: lowStockRes.data ?? [],
    recentSales: recentSales ?? [],
  };
}
