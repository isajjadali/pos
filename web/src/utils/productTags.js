import { toTitleCase } from "./titleCase.js";

/** Normalize tag for storage and filtering (lowercase, trimmed). */
export function normalizeProductTag(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!s) return "";
  return s.slice(0, 48);
}

export function normalizeProductTags(list) {
  const out = [];
  const seen = new Set();
  for (const item of list ?? []) {
    const t = normalizeProductTag(item);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function formatProductTagLabel(tag) {
  const t = normalizeProductTag(tag);
  if (!t) return "";
  return toTitleCase(t);
}
