import { requireSupabase } from "../lib/supabase.js";

export async function listSales({ page = 1, pageSize = 20 } = {}) {
  const sb = requireSupabase();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await sb
    .from("sales")
    .select("*", { count: "exact" })
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function getSale(id) {
  const sb = requireSupabase();
  const { data: sale, error } = await sb.from("sales").select("*").eq("id", id).single();
  if (error) throw error;
  const { data: items, error: ie } = await sb.from("sale_items").select("*").eq("sale_id", id);
  if (ie) throw ie;
  return { sale, items: items ?? [] };
}

export function saleGrossProfit(items) {
  return items.reduce((sum, i) => {
    const rev = Number(i.line_total) - Number(i.discount_amount || 0);
    const cost = Number(i.unit_cost) * Number(i.quantity);
    return sum + (rev - cost);
  }, 0);
}
