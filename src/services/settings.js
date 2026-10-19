import { requireSupabase } from "../lib/supabase.js";

export async function getSettings() {
  const sb = requireSupabase();
  const { data, error } = await sb.from("app_settings").select("*").limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateSettings(payload) {
  const sb = requireSupabase();
  const current = await getSettings();
  const row = {
    store_name: payload.store_name?.trim() || "Discount World by WABz",
    currency_code: "PKR",
    default_low_stock_threshold: Math.max(0, Math.floor(Number(payload.default_low_stock_threshold) || 5)),
    receipt_header: payload.receipt_header?.trim() || null,
    receipt_footer: payload.receipt_footer?.trim() || null,
    receipt_paper_width: Math.min(400, Math.max(240, Math.floor(Number(payload.receipt_paper_width) || 300))),
    receipt_font_size: Math.min(18, Math.max(10, Math.floor(Number(payload.receipt_font_size) || 13))),
    receipt_show_change: Boolean(payload.receipt_show_change),
    receipt_show_payment: Boolean(payload.receipt_show_payment),
    label_width_mm: Number(payload.label_width_mm) || 50,
    label_height_mm: Number(payload.label_height_mm) || 30,
    pos_auto_collapse_sidebar: payload.pos_auto_collapse_sidebar !== false,
    updated_at: new Date().toISOString(),
  };
  if (current?.id) {
    const { data, error } = await sb.from("app_settings").update(row).eq("id", current.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await sb.from("app_settings").insert(row).select().single();
  if (error) throw error;
  return data;
}
