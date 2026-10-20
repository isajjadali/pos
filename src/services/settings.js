import { requireSupabase } from "../lib/supabase.js";
import {
  normalizeLabelFontFamily,
  normalizeLabelFontSize,
  normalizeReceiptBodyFontSize,
  normalizeReceiptFontFamily,
  normalizeReceiptFooterFontSize,
  normalizeReceiptTitleFontSize,
} from "../config/printFonts.js";
import { normalizeSaleUnit, setAppDefaultLabelUnit } from "../utils/saleUnits.js";

function applySettingsSideEffects(data) {
  if (data && "default_label_unit" in data) {
    setAppDefaultLabelUnit(data.default_label_unit);
  }
  return data;
}

export async function getSettings() {
  const sb = requireSupabase();
  const { data, error } = await sb.from("app_settings").select("*").limit(1).maybeSingle();
  if (error) throw error;
  return applySettingsSideEffects(data);
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
    receipt_font_size: normalizeReceiptBodyFontSize(payload.receipt_font_size),
    receipt_title_font_size: normalizeReceiptTitleFontSize(payload.receipt_title_font_size),
    receipt_footer_font_size: normalizeReceiptFooterFontSize(payload.receipt_footer_font_size),
    receipt_font_family: normalizeReceiptFontFamily(payload.receipt_font_family),
    receipt_show_change: Boolean(payload.receipt_show_change),
    receipt_show_payment: Boolean(payload.receipt_show_payment),
    label_width_mm: Number(payload.label_width_mm) || 50,
    label_height_mm: Number(payload.label_height_mm) || 30,
    label_font_family: normalizeLabelFontFamily(payload.label_font_family),
    label_font_size: normalizeLabelFontSize(payload.label_font_size ?? 100),
    label_title_font_size: normalizeLabelFontSize(payload.label_title_font_size),
    label_name_font_size: normalizeLabelFontSize(payload.label_name_font_size),
    label_barcode_font_size: normalizeLabelFontSize(payload.label_barcode_font_size),
    label_price_font_size: normalizeLabelFontSize(payload.label_price_font_size),
    pos_auto_collapse_sidebar: payload.pos_auto_collapse_sidebar !== false,
    default_label_unit: normalizeSaleUnit(payload.default_label_unit || "pack"),
    updated_at: new Date().toISOString(),
  };
  if (current?.id) {
    const { data, error } = await sb.from("app_settings").update(row).eq("id", current.id).select().single();
    if (error) throw error;
    return applySettingsSideEffects(data);
  }
  const { data, error } = await sb.from("app_settings").insert(row).select().single();
  if (error) throw error;
  return applySettingsSideEffects(data);
}
