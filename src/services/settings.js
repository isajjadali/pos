import { requireSupabase, supabaseConfigured } from "../lib/supabase.js";
import {
  normalizeLabelFontFamily,
  normalizeLabelFontSize,
  normalizeReceiptBodyFontSize,
  normalizeReceiptFontFamily,
  normalizeReceiptFooterFontSize,
  normalizeReceiptTitleFontSize,
} from "../config/printFonts.js";
import { normalizeSaleUnit, setAppDefaultLabelUnit } from "../utils/saleUnits.js";

const SETTINGS_CACHE_KEY = "dw_app_settings_v1";

function applySettingsSideEffects(data) {
  if (data && "default_label_unit" in data) {
    setAppDefaultLabelUnit(data.default_label_unit);
  }
  return data;
}

function saveSettingsCache(data) {
  if (!data) return;
  try {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify({ data, cachedAt: Date.now() }));
  } catch {
    /* quota */
  }
}

/** Last successfully fetched settings (for offline receipt print). */
export function getCachedSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

export async function getSettings() {
  const cached = getCachedSettings();
  if (!supabaseConfigured) {
    return applySettingsSideEffects(cached);
  }
  const { onlineOrOfflineRead } = await import("./offlineGuard.js");
  return onlineOrOfflineRead(
    async () => {
      const sb = requireSupabase();
      const { data, error } = await sb.from("app_settings").select("*").limit(1).maybeSingle();
      if (error) throw error;
      if (data) saveSettingsCache(data);
      return applySettingsSideEffects(data ?? cached);
    },
    () => applySettingsSideEffects(cached)
  );
}

export async function updateSettings(payload) {
  const { onlineOrOfflineWrite } = await import("./offlineGuard.js");
  const { useAdminOutboxStore } = await import("../stores/adminOutbox.js");

  const rowFromPayload = {
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
    shopify_enabled: Boolean(payload.shopify_enabled),
    shopify_shop_domain: payload.shopify_shop_domain
      ? String(payload.shopify_shop_domain).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")
      : null,
    shopify_location_id: payload.shopify_location_id
      ? String(payload.shopify_location_id).trim()
      : null,
    updated_at: new Date().toISOString(),
  };

  return onlineOrOfflineWrite(
    async () => {
      const sb = requireSupabase();
      // Direct fetch — do not nest onlineOrOfflineRead (avoids sticky-offline on slow settings read)
      const { data: current, error: readErr } = await sb
        .from("app_settings")
        .select("id")
        .limit(1)
        .maybeSingle();
      if (readErr) throw readErr;
      if (current?.id) {
        const { data, error } = await sb
          .from("app_settings")
          .update(rowFromPayload)
          .eq("id", current.id)
          .select()
          .single();
        if (error) throw error;
        saveSettingsCache(data);
        return applySettingsSideEffects(data);
      }
      const { data, error } = await sb.from("app_settings").insert(rowFromPayload).select().single();
      if (error) throw error;
      saveSettingsCache(data);
      return applySettingsSideEffects(data);
    },
    () => {
      const cached = { ...(getCachedSettings() || {}), ...rowFromPayload, id: getCachedSettings()?.id };
      saveSettingsCache(cached);
      useAdminOutboxStore().enqueue({
        type: "settings.update",
        payload: { row: rowFromPayload, id: cached.id || null },
        label: "Settings update",
      });
      return applySettingsSideEffects(cached);
    }
  );
}
