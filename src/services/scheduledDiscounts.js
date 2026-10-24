import { requireSupabase } from "../lib/supabase.js";
import { pickBestScheduledDiscount, normalizeProductScope } from "../utils/scheduledDiscount.js";

/** Local calendar date as YYYY-MM-DD (shop PC timezone). */
export function localDateIso(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeTargetingFields(row) {
  const scope = normalizeProductScope(row);
  if (scope === "by_price") {
    const op = String(row.price_op ?? "lte").toLowerCase() === "gte" ? "gte" : "lte";
    return {
      product_scope: "by_price",
      price_op: op,
      price_threshold: Math.max(0, Number(row.price_threshold) || 0),
      product_ids: [],
    };
  }
  if (scope === "specific") {
    const ids = [...new Set((row.product_ids ?? []).filter(Boolean).map(String))];
    return {
      product_scope: "specific",
      price_op: null,
      price_threshold: null,
      product_ids: ids,
    };
  }
  return {
    product_scope: "all",
    price_op: null,
    price_threshold: null,
    product_ids: [],
  };
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

/**
 * Active promo for a calendar day; if several overlap, highest PKR value wins.
 * @param {string} [onDate]
 * @param {number|Array} [subtotalOrItems] cart items preferred for targeting
 */
export async function getActiveScheduledSaleDiscount(onDate = localDateIso(), subtotalOrItems = 0) {
  const list = await listActiveScheduledSaleDiscounts(onDate);
  return pickBestScheduledDiscount(list, subtotalOrItems);
}

export async function createScheduledSaleDiscount(row) {
  const sb = requireSupabase();
  const targeting = normalizeTargetingFields(row);
  if (targeting.product_scope === "specific" && !targeting.product_ids.length) {
    throw new Error("Select at least one product for specific-product discounts");
  }
  if (targeting.product_scope === "by_price" && targeting.price_threshold == null) {
    throw new Error("Enter a price threshold");
  }
  const payload = {
    name: String(row.name ?? "").trim(),
    discount_amount: Math.max(0, Number(row.discount_amount) || 0),
    discount_percent: Math.min(100, Math.max(0, Number(row.discount_percent) || 0)),
    start_date: row.start_date,
    end_date: row.end_date,
    is_active: row.is_active !== false,
    ...targeting,
  };
  const { data, error } = await sb.from("scheduled_sale_discounts").insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateScheduledSaleDiscount(id, row) {
  const sb = requireSupabase();
  const targeting =
    row.product_scope !== undefined ||
    row.price_op !== undefined ||
    row.price_threshold !== undefined ||
    row.product_ids !== undefined
      ? normalizeTargetingFields(row)
      : null;
  if (targeting?.product_scope === "specific" && !targeting.product_ids.length) {
    throw new Error("Select at least one product for specific-product discounts");
  }
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
    ...(targeting ?? {}),
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

/** Soft-delete scheduled discount (is_active = false). */
export async function deleteScheduledSaleDiscount(id) {
  const sb = requireSupabase();
  const { error } = await sb
    .from("scheduled_sale_discounts")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw error;
}
