import { requireSupabase } from "../lib/supabase.js";
import { pickBestScheduledDiscount } from "../utils/scheduledDiscount.js";

/** Local calendar date as YYYY-MM-DD (shop PC timezone). */
export function localDateIso(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function listScheduledSaleDiscounts() {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("scheduled_sale_discounts")
    .select("*")
    .order("start_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listActiveScheduledSaleDiscounts(onDate = localDateIso()) {
  const sb = requireSupabase();
  const day = String(onDate).slice(0, 10);
  const { data, error } = await sb
    .from("scheduled_sale_discounts")
    .select("*")
    .eq("is_active", true)
    .lte("start_date", day)
    .gte("end_date", day)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Active promo for a calendar day; if several overlap, highest PKR value at this subtotal wins. */
export async function getActiveScheduledSaleDiscount(onDate = localDateIso(), subtotal = 0) {
  const list = await listActiveScheduledSaleDiscounts(onDate);
  return pickBestScheduledDiscount(list, subtotal);
}

export async function createScheduledSaleDiscount(row) {
  const sb = requireSupabase();
  const payload = {
    name: String(row.name ?? "").trim(),
    discount_amount: Math.max(0, Number(row.discount_amount) || 0),
    discount_percent: Math.min(100, Math.max(0, Number(row.discount_percent) || 0)),
    start_date: row.start_date,
    end_date: row.end_date,
    is_active: row.is_active !== false,
  };
  const { data, error } = await sb.from("scheduled_sale_discounts").insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateScheduledSaleDiscount(id, row) {
  const sb = requireSupabase();
  const payload = {
    ...(row.name !== undefined ? { name: String(row.name).trim() } : {}),
    ...(row.discount_amount !== undefined
      ? { discount_amount: Math.max(0, Number(row.discount_amount) || 0) }
      : {}),
    ...(row.discount_percent !== undefined
      ? { discount_percent: Math.min(100, Math.max(0, Number(row.discount_percent) || 0)) }
      : {}),
    ...(row.start_date !== undefined ? { start_date: row.start_date } : {}),
    ...(row.end_date !== undefined ? { end_date: row.end_date } : {}),
    ...(row.is_active !== undefined ? { is_active: Boolean(row.is_active) } : {}),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from("scheduled_sale_discounts")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteScheduledSaleDiscount(id) {
  const sb = requireSupabase();
  const { error } = await sb.from("scheduled_sale_discounts").delete().eq("id", id);
  if (error) throw error;
}
