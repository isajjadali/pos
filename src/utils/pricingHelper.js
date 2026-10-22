/** Pricing helper: break-even sales + suggested sale from cost × target margin. */

export const PRICING_HELPER_LS = "dw_pricing_helper_v1";

export const DEFAULT_PRICING_HELPER = {
  monthlyExpense: 220000,
  targetNetProfit: 80000,
  avgMarginPct: 35,
  trafficMarginPct: 25,
  coreMarginPct: 35,
  heroMarginPct: 50,
  /** Purchase cost below this → traffic band */
  trafficCostMax: 80,
  /** Purchase cost below this (and ≥ traffic) → core; else hero */
  coreCostMax: 250,
};

export function loadPricingHelper() {
  try {
    const raw = localStorage.getItem(PRICING_HELPER_LS);
    if (!raw) return { ...DEFAULT_PRICING_HELPER };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PRICING_HELPER, ...parsed };
  } catch {
    return { ...DEFAULT_PRICING_HELPER };
  }
}

export function savePricingHelper(cfg) {
  try {
    localStorage.setItem(PRICING_HELPER_LS, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

function clampMargin(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0.35;
  return Math.min(0.85, Math.max(0.05, n / 100));
}

/**
 * Sale price from purchase cost + target margin % of sale.
 * sale = cost / (1 - margin)
 */
export function suggestedSaleFromCost(cost, marginPct) {
  const c = Math.max(0, Number(cost) || 0);
  const m = clampMargin(marginPct);
  if (c <= 0) return 0;
  return Math.round((c / (1 - m)) * 100) / 100;
}

export function bandForCost(cost, cfg = DEFAULT_PRICING_HELPER) {
  const c = Number(cost) || 0;
  const trafficMax = Number(cfg.trafficCostMax) || 0;
  const coreMax = Number(cfg.coreCostMax) || 0;
  if (c < trafficMax) {
    return { key: "traffic", label: "Traffic", marginPct: cfg.trafficMarginPct };
  }
  if (c < coreMax) {
    return { key: "core", label: "Core", marginPct: cfg.coreMarginPct };
  }
  return { key: "hero", label: "Hero", marginPct: cfg.heroMarginPct };
}

export function computeBreakEven(cfg) {
  const expense = Math.max(0, Number(cfg.monthlyExpense) || 0);
  const net = Math.max(0, Number(cfg.targetNetProfit) || 0);
  const margin = clampMargin(cfg.avgMarginPct);
  const grossNeeded = expense + net;
  const breakEvenSales = margin > 0 ? expense / margin : null;
  const targetSales = margin > 0 ? grossNeeded / margin : null;
  const days = 30;
  return {
    expense,
    net,
    marginPct: Math.round(margin * 10000) / 100,
    grossNeeded,
    breakEvenSales: breakEvenSales != null ? Math.round(breakEvenSales) : null,
    targetSales: targetSales != null ? Math.round(targetSales) : null,
    dailyBreakEven: breakEvenSales != null ? Math.round(breakEvenSales / days) : null,
    dailyTarget: targetSales != null ? Math.round(targetSales / days) : null,
  };
}
