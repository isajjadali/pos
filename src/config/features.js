/**
 * Feature flags — flip via .env without deleting Shopify code.
 *
 * Shopify hub (orders, sync UI, product Shopify actions, POS inventory push):
 *   VITE_FEATURE_SHOPIFY=true
 *
 * Default: OFF
 */
export const FEATURE_SHOPIFY = String(import.meta.env.VITE_FEATURE_SHOPIFY || "")
  .trim()
  .toLowerCase() === "true";
