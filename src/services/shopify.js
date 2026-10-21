import { requireSupabase } from "../lib/supabase.js";
import { invokeEdgeFunction } from "../utils/edgeFunction.js";

const BATCH = 12;

export async function shopifyTestConnection(shopDomain) {
  const sb = requireSupabase();
  return invokeEdgeFunction(sb, "shopify-sync", {
    action: "test_connection",
    shop_domain: shopDomain,
  });
}

export async function shopifySaveSettings(payload) {
  const sb = requireSupabase();
  return invokeEdgeFunction(sb, "shopify-sync", {
    action: "save_settings",
    shopify_enabled: Boolean(payload.shopify_enabled),
    shopify_shop_domain: payload.shopify_shop_domain,
    shopify_location_id: payload.shopify_location_id,
  });
}

/**
 * Push in small batches so Edge Function stays under resource limits.
 * @param {{ onProgress?: (info: { done: number, total: number, batch: number }) => void }} [opts]
 */
export async function shopifyPushAll(opts = {}) {
  const sb = requireSupabase();
  let offset = 0;
  let total = null;
  const allResults = [];
  let batch = 0;
  for (;;) {
    batch += 1;
    const res = await invokeEdgeFunction(sb, "shopify-sync", {
      action: "push_batch",
      offset,
      limit: BATCH,
      sync_name: batch === 1,
    });
    allResults.push(...(res.results || []));
    total = res.total ?? total ?? allResults.length;
    offset = res.nextOffset ?? offset + BATCH;
    opts.onProgress?.({
      done: Math.min(offset, total ?? offset),
      total: total ?? offset,
      batch,
    });
    if (res.done || !(res.results || []).length) break;
  }
  return { ok: true, results: allResults, total };
}

export async function shopifyPushOne(productId) {
  const sb = requireSupabase();
  return invokeEdgeFunction(sb, "shopify-sync", {
    action: "push_one",
    product_id: productId,
  });
}

/**
 * Pull stock in batches.
 * @param {{ onProgress?: (info: { done: number, total: number, batch: number }) => void }} [opts]
 */
export async function shopifyPullStock(opts = {}) {
  const sb = requireSupabase();
  let offset = 0;
  let total = null;
  const allResults = [];
  let batch = 0;
  for (;;) {
    batch += 1;
    const res = await invokeEdgeFunction(sb, "shopify-sync", {
      action: "pull_batch",
      offset,
      limit: BATCH,
    });
    allResults.push(...(res.results || []));
    total = res.total ?? total ?? allResults.length;
    offset = res.nextOffset ?? offset + BATCH;
    opts.onProgress?.({
      done: Math.min(offset, total ?? offset),
      total: total ?? offset,
      batch,
    });
    if (res.done || !(res.results || []).length) break;
  }
  return { ok: true, results: allResults, total };
}

export async function shopifyRegisterWebhooks() {
  const sb = requireSupabase();
  return invokeEdgeFunction(sb, "shopify-sync", { action: "register_webhooks" });
}

/** Fire-and-forget inventory adjust after a POS sale (pieces delta, usually negative). */
export async function shopifyInventoryAdjust(productId, delta) {
  const sb = requireSupabase();
  try {
    return await invokeEdgeFunction(sb, "shopify-sync", {
      action: "inventory_adjust",
      product_id: productId,
      delta: Math.floor(Number(delta) || 0),
    });
  } catch (e) {
    console.warn("[shopify] inventory_adjust failed", e);
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function shopifyNotifySaleLines(lines) {
  const list = Array.isArray(lines) ? lines : [];
  await Promise.all(
    list.map((line) => {
      const productId = line.product_id;
      const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
      const ppu = Math.max(1, Math.floor(Number(line.pieces_per_unit) || 1));
      const pieces = qty * ppu;
      if (!productId || pieces <= 0) return Promise.resolve();
      return shopifyInventoryAdjust(productId, -pieces);
    })
  );
}
