import { requireSupabase } from "../lib/supabase.js";
import { refreshProductCatalog } from "./productCatalog.js";

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

function formatSaleDeleteError(error) {
  const msg = String(error?.message || error || "");
  if (/delete_sale_admin/i.test(msg) && /schema cache|could not find|function/i.test(msg)) {
    return (
      "Sale delete is not set up on the database yet. Run the latest Supabase migration " +
      "(20251017200000 and 20251017210000) then try again."
    );
  }
  if (/admin only/i.test(msg)) {
    return "Only admin can delete sales. Check your profile role in Staff users.";
  }
  return msg || "Delete failed";
}

export async function deleteSale(saleId) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("delete_sale_admin", { p_sale_id: saleId });
  if (error) {
    const wrapped = new Error(formatSaleDeleteError(error));
    wrapped.cause = error;
    throw wrapped;
  }
  await refreshProductCatalog().catch(() => {});
  return data;
}

export async function deleteSalesBulk(saleIds) {
  const sb = requireSupabase();
  const unique = [...new Set((saleIds || []).filter(Boolean))];
  if (!unique.length) return { deleted: 0, failed: [] };
  const { data, error } = await sb.rpc("delete_sales_bulk", { p_sale_ids: unique });
  if (error) {
    const wrapped = new Error(formatSaleDeleteError(error));
    wrapped.cause = error;
    throw wrapped;
  }
  await refreshProductCatalog().catch(() => {});
  return {
    deleted: data?.deleted ?? 0,
    failed: data?.failed ?? [],
  };
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
