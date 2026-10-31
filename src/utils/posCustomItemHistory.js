/** POS custom item name helpers + local cache (offline / before first sync). */

import { toTitleCase } from "./titleCase.js";

const STORAGE_KEY = "dw_pos_custom_items_v1";
const MAX_ITEMS = 80;

function formatPriceToken(price) {
  const n = Math.max(0, Number(price) || 0);
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded) || Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded));
  }
  return String(rounded);
}

/**
 * Parse typed/saved custom name.
 * Accepts "jwelley", "Jwelley(300)", or legacy "jwelley · Rs 300".
 * @returns {{ base: string, price: number | null }}
 */
export function parseCustomItemName(raw) {
  let s = String(raw ?? "")
    .replace(/\s*·\s*Rs[\s\d,]*(?:\.\d+)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return { base: "", price: null };

  const m = s.match(/^(.*?)\((\d+(?:\.\d+)?)\)$/);
  if (m) {
    return {
      base: toTitleCase(m[1].trim()),
      price: Math.max(0, Number(m[2]) || 0),
    };
  }
  return { base: toTitleCase(s), price: null };
}

/** Title-cased base name only (no price suffix). */
export function sanitizeCustomItemName(name) {
  return parseCustomItemName(name).base;
}

/** Cart / receipt label: `Jewellery(300)`. */
export function formatCustomItemName(name, unit_selling_price = 0) {
  const { base, price: fromName } = parseCustomItemName(name);
  if (!base) return "";
  const price =
    unit_selling_price != null && unit_selling_price !== ""
      ? Math.max(0, Number(unit_selling_price) || 0)
      : fromName != null
        ? fromName
        : 0;
  return `${base}(${formatPriceToken(price)})`;
}

function loadRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const byKey = new Map();
    for (const x of parsed) {
      if (!x) continue;
      const parsedName = parseCustomItemName(x.name);
      const name = parsedName.base;
      if (!name) continue;
      const priceFromStore = Number(x.unit_selling_price);
      const unit_selling_price = Math.max(
        0,
        Number.isFinite(priceFromStore) ? priceFromStore : parsedName.price || 0
      );
      const row = {
        id: x.id || null,
        name,
        unit_selling_price,
        usedAt: Number(x.usedAt) || 0,
      };
      const key = name.toLowerCase();
      const prev = byKey.get(key);
      if (!prev || row.usedAt >= prev.usedAt) byKey.set(key, row);
    }
    return [...byKey.values()];
  } catch {
    return [];
  }
}

function saveRaw(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
  } catch {
    /* quota */
  }
}

export function listCustomItemHistory() {
  return loadRaw().sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0));
}

/**
 * Replace local cache with server active items (for POS autocomplete + offline).
 * @param {Array<{ id?: string, name: string, unit_selling_price?: number, usedAt?: number }>} rows
 */
export function replaceCustomItemHistoryCache(rows) {
  const mapped = (Array.isArray(rows) ? rows : [])
    .map((x) => {
      const name = sanitizeCustomItemName(x?.name);
      if (!name) return null;
      return {
        id: x.id || null,
        name,
        unit_selling_price: Math.max(0, Number(x.unit_selling_price) || 0),
        usedAt: Number(x.usedAt) || Date.now(),
      };
    })
    .filter(Boolean);
  saveRaw(mapped);
  return listCustomItemHistory();
}

/** Upsert by base name (case-insensitive), bump to top — local draft until sale sync. */
export function rememberCustomItem({ name, unit_selling_price = 0, id = null } = {}) {
  const parsed = parseCustomItemName(name);
  const label = parsed.base;
  if (!label) return listCustomItemHistory();
  const price = Math.max(
    0,
    unit_selling_price != null && unit_selling_price !== ""
      ? Number(unit_selling_price) || 0
      : parsed.price || 0
  );
  const key = label.toLowerCase();
  const next = loadRaw().filter((x) => x.name.toLowerCase() !== key);
  next.unshift({ id, name: label, unit_selling_price: price, usedAt: Date.now() });
  saveRaw(next);
  return next;
}

export function findCustomItemHistory(name) {
  const key = sanitizeCustomItemName(name).toLowerCase();
  if (!key) return null;
  return loadRaw().find((x) => x.name.toLowerCase() === key) || null;
}
