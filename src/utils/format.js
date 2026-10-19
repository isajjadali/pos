export function formatPkr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

export function marginPercent(selling, cost) {
  const s = Number(selling);
  const c = Number(cost);
  if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(c)) return null;
  return Math.round(((s - c) / s) * 10000) / 100;
}
