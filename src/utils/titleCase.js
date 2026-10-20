/**
 * Title Case: every word's first letter capital (e.g. "al rehman" → "Al Rehman").
 */
export function toTitleCase(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/(^|[\s\-_/]+)([a-z])/g, (_, sep, ch) => `${sep}${ch.toUpperCase()}`);
}

/**
 * Vendor code prefix from name initials.
 * "Al Rehman International" → "AR", "NS Toys" → "NS", "Multan Book Stationery" → "MBS"
 */
export function vendorInitialsPrefix(vendorName) {
  const stop = new Set(["and", "of", "the", "by", "&", "co", "ltd", "llc"]);
  const softSuffix = new Set([
    "international",
    "traders",
    "trading",
    "company",
    "shop",
    "store",
    "market",
  ]);
  const raw = String(vendorName ?? "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !stop.has(t.toLowerCase()));

  if (!raw.length) return "XX";

  // Drop soft suffixes only when ≥2 solid words remain
  // ("Al Rehman International" → AR). Keep them when needed
  // ("Hashmi Traders" → HT, not HA from "Hashmi" alone).
  let core = raw.filter((t) => !softSuffix.has(t.toLowerCase()));
  if (core.length < 2) core = raw;
  const tokens = core;

  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }
  // Prefer 2 initials; use 3 when there are 3+ core words (e.g. Multan Book Stationery)
  const n = tokens.length >= 3 ? 3 : 2;
  return tokens
    .slice(0, n)
    .map((t) => t[0])
    .join("")
    .toUpperCase();
}
