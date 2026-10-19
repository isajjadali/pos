import { buildEscPosReceipt, escPosToBase64 } from "./escposReceipt.js";
import { openReceiptPrintWindow } from "./receipt.js";

const BRIDGE = "http://127.0.0.1:9288";

/**
 * Print 3" / 80mm receipt to Black Copper via ESC/POS RAW (dark thermal).
 * Avoids Windows Out-Printer GDI path which looks faded / wrong size.
 */
export async function printReceipt(sale, items, settingsInput) {
  const escpos = buildEscPosReceipt(sale, items, settingsInput, { paperMm: 80 });

  try {
    const res = await fetch(`${BRIDGE}/receipt-print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "escpos",
        dataBase64: escPosToBase64(escpos),
        printer: "Black Copper 80",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return { ok: true, method: data.method || "escpos", printerName: data?.printerName };
  } catch (e) {
    const fallback = openReceiptPrintWindow(sale, items, settingsInput);
    if (fallback) {
      return {
        ok: true,
        method: "browser",
        warning: e.message || "Receipt printer unavailable — opened browser print.",
      };
    }
    throw e;
  }
}
