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

export async function shopifyOrdersList({ query = "", first = 25 } = {}) {
  const sb = requireSupabase();
  return invokeEdgeFunction(sb, "shopify-sync", {
    action: "orders_list",
    query,
    first,
  });
}

export async function shopifyOrderGet(orderId) {
  const sb = requireSupabase();
  return invokeEdgeFunction(sb, "shopify-sync", {
    action: "order_get",
    order_id: orderId,
  });
}

/** Poll Shopify orders → insert events + adjust stock (webhook fallback). */
export async function shopifyOrdersPollSync() {
  const sb = requireSupabase();
  return invokeEdgeFunction(sb, "shopify-sync", {
    action: "orders_poll_sync",
    first: 12,
  });
}

export async function shopifySetVariantPrice(productId, price) {
  const sb = requireSupabase();
  return invokeEdgeFunction(sb, "shopify-sync", {
    action: "variant_set_price",
    product_id: productId,
    price: Number(price),
  });
}

export async function shopifyGetVariantPrice(productId) {
  const sb = requireSupabase();
  return invokeEdgeFunction(sb, "shopify-sync", {
    action: "variant_get_price",
    product_id: productId,
  });
}

export async function shopifyPushPrices(productIds) {
  const sb = requireSupabase();
  return invokeEdgeFunction(sb, "shopify-sync", {
    action: "push_prices_batch",
    product_ids: productIds,
  });
}

/**
 * Stage → browser POST to Shopify → finish attach. Never stores file on POS.
 */
export async function shopifyUploadProductImage(productId, file, opts = {}) {
  const sb = requireSupabase();
  const filename = file.name || "image.jpg";
  const mimeType = file.type || "image/jpeg";
  const stage = await invokeEdgeFunction(sb, "shopify-sync", {
    action: "product_image_stage",
    product_id: productId,
    filename,
    mime_type: mimeType,
    file_size: file.size,
  });

  const form = new FormData();
  for (const p of stage.parameters || []) {
    form.append(p.name, p.value);
  }
  form.append("file", file, filename);

  const uploadRes = await fetch(stage.url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(`Shopify staged upload failed (HTTP ${uploadRes.status})${text ? `: ${text.slice(0, 120)}` : ""}`);
  }

  return invokeEdgeFunction(sb, "shopify-sync", {
    action: "product_image_finish",
    product_id: productId,
    shopify_product_id: stage.shopify_product_id,
    resource_url: stage.resourceUrl,
    filename,
    alt: opts.alt || "",
  });
}

export async function listShopifyOrderEvents({ unreadOnly = false, limit = 30 } = {}) {
  const sb = requireSupabase();
  let q = sb
    .from("shopify_order_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (unreadOnly) q = q.is("read_at", null);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function countUnreadShopifyOrderEvents() {
  const sb = requireSupabase();
  const { count, error } = await sb
    .from("shopify_order_events")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

export async function markShopifyOrderEventsRead(ids) {
  const sb = requireSupabase();
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return;
  const { error } = await sb
    .from("shopify_order_events")
    .update({ read_at: new Date().toISOString() })
    .in("id", list);
  if (error) throw error;
}

export async function markAllShopifyOrderEventsRead() {
  const sb = requireSupabase();
  const { error } = await sb
    .from("shopify_order_events")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) throw error;
}

/** Map filename stem → barcode (strip extension). */
export function barcodeFromImageFilename(filename) {
  const base = String(filename || "").trim().split(/[/\\]/).pop() || "";
  const stem = base.replace(/\.[^.]+$/, "").trim();
  return stem;
}
