import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sendWebPushToAll } from "./_webpush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shopify-hmac-sha256, x-shopify-topic, x-shopify-shop-domain",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function verifyHmac(rawBody: string, hmacHeader: string | null, secret: string): Promise<boolean> {
  if (!hmacHeader || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const digest = btoa(bin);
  if (digest.length !== hmacHeader.length) return false;
  let ok = 0;
  for (let i = 0; i < digest.length; i++) ok |= digest.charCodeAt(i) ^ hmacHeader.charCodeAt(i);
  return ok === 0;
}

function toInventoryItemGid(id: string | number): string {
  const s = String(id ?? "").trim();
  if (!s) return "";
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/InventoryItem/${s}`;
}

function toVariantGid(id: string | number): string {
  const s = String(id ?? "").trim();
  if (!s) return "";
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/ProductVariant/${s}`;
}

type AdminDb = ReturnType<typeof createClient>;

type LinkedProduct = {
  id: string;
  name: string | null;
  current_stock: number;
  shopify_inventory_item_id: string | null;
};

async function findProductForLineItem(
  adminDb: AdminDb,
  li: Record<string, unknown>
): Promise<LinkedProduct | null> {
  const variantId = li.variant_id != null ? toVariantGid(li.variant_id as string | number) : "";
  const sku = String(li.sku || "").trim();
  const barcode = String(li.barcode || sku || "").trim();

  if (variantId) {
    const { data } = await adminDb
      .from("products")
      .select("id, name, current_stock, shopify_inventory_item_id")
      .eq("shopify_variant_id", variantId)
      .maybeSingle();
    if (data) return data;
    const { data: bySuffix } = await adminDb
      .from("products")
      .select("id, name, current_stock, shopify_inventory_item_id")
      .ilike("shopify_variant_id", `%/${String(li.variant_id)}`)
      .limit(1)
      .maybeSingle();
    if (bySuffix) return bySuffix;
  }
  if (barcode) {
    const { data } = await adminDb
      .from("products")
      .select("id, name, current_stock, shopify_inventory_item_id")
      .eq("barcode", barcode)
      .maybeSingle();
    if (data) return data;
  }
  if (sku) {
    const { data } = await adminDb
      .from("products")
      .select("id, name, current_stock, shopify_inventory_item_id")
      .eq("sku", sku)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

async function alreadyLoggedOrderStock(
  adminDb: AdminDb,
  kind: "order_deduct" | "order_restock",
  externalRef: string
) {
  const { data: prior } = await adminDb
    .from("shopify_sync_log")
    .select("id")
    .eq("direction", "inbound")
    .eq("kind", kind)
    .eq("external_ref", externalRef)
    .limit(1)
    .maybeSingle();
  return Boolean(prior);
}

/** Skip line adjust if inventory_levels/update already applied the same delta (race). */
async function recentInventoryWebhookMatched(
  adminDb: AdminDb,
  productId: string,
  qtyDelta: number
) {
  const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data } = await adminDb
    .from("shopify_sync_log")
    .select("id, qty_delta")
    .eq("direction", "inbound")
    .eq("kind", "inventory_webhook")
    .eq("product_id", productId)
    .gte("created_at", since)
    .limit(10);
  return (data ?? []).some((r) => Number(r.qty_delta) === qtyDelta);
}

/**
 * Apply +/- pieces from Shopify order line items.
 * direction -1 = order created (deduct), +1 = cancelled/deleted (restock).
 */
async function adjustStockFromShopifyOrder(
  adminDb: AdminDb,
  payload: Record<string, unknown>,
  direction: -1 | 1,
  reason: "created" | "cancelled" | "deleted"
) {
  const numericId = String(payload.id ?? "").trim();
  const shopifyOrderId = numericId
    ? `gid://shopify/Order/${numericId}`
    : String(payload.admin_graphql_api_id || "").trim();
  const orderName = String(payload.name || "").trim() || numericId || "order";
  const kind = direction < 0 ? "order_deduct" : "order_restock";
  const externalRef = `${kind === "order_deduct" ? "deduct" : "restock"}:order:${
    shopifyOrderId || numericId || orderName
  }`;

  if (await alreadyLoggedOrderStock(adminDb, kind, externalRef)) {
    return { skipped: true, reason: "already_applied", adjusted: [] as unknown[] };
  }

  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  const adjusted: Array<{ product_id: string; qty: number; name?: string }> = [];

  for (const raw of lineItems) {
    const li = raw as Record<string, unknown>;
    const qty = Math.max(0, Math.floor(Number(li.quantity) || 0));
    if (qty <= 0) continue;

    const product = await findProductForLineItem(adminDb, li);
    if (!product) continue;

    const signed = direction * qty;
    if (await recentInventoryWebhookMatched(adminDb, product.id, signed)) {
      // Inventory webhook already moved stock for this change
      await adminDb.from("shopify_sync_log").insert({
        direction: "inbound",
        kind,
        product_id: product.id,
        inventory_item_id: product.shopify_inventory_item_id,
        qty_delta: signed,
        external_ref: externalRef,
        notes: `${reason} ${orderName} skipped (inventory webhook already applied)`,
      });
      continue;
    }

    const prev = Math.floor(Number(product.current_stock) || 0);
    const next = Math.max(0, prev + signed);
    if (next === prev) continue;

    await adminDb
      .from("products")
      .update({
        current_stock: next,
        shopify_last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", product.id);

    await adminDb.from("stock_movements").insert({
      product_id: product.id,
      movement_type: "shopify_sync",
      quantity_change: next - prev,
      previous_quantity: prev,
      new_quantity: next,
      notes:
        direction < 0
          ? `Deduct from Shopify order ${orderName}`
          : `Restock from Shopify order ${orderName} (${reason})`,
    });

    await adminDb.from("shopify_sync_log").insert({
      direction: "inbound",
      kind,
      product_id: product.id,
      inventory_item_id: product.shopify_inventory_item_id,
      qty_delta: next - prev,
      external_ref: externalRef,
      notes: `${reason} ${orderName}`,
    });

    adjusted.push({ product_id: product.id, qty: Math.abs(next - prev), name: product.name || undefined });
  }

  // Mark order handled even if no lines matched (avoids retries re-processing empties)
  if (!adjusted.length) {
    await adminDb.from("shopify_sync_log").insert({
      direction: "inbound",
      kind,
      qty_delta: 0,
      external_ref: externalRef,
      notes: `${reason} ${orderName} (no linked line items)`,
    });
  }

  return { skipped: false, adjusted, order: orderName };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET")?.trim() || "";
    if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfigured" }, 500);

    const rawBody = await req.text();
    const hmac = req.headers.get("X-Shopify-Hmac-Sha256");
    const secrets = [
      secret,
      Deno.env.get("SHOPIFY_CLIENT_SECRET")?.trim() || "",
    ].filter(Boolean);
    // Dedupe
    const uniqueSecrets = [...new Set(secrets)];
    if (uniqueSecrets.length) {
      let ok = false;
      for (const s of uniqueSecrets) {
        if (await verifyHmac(rawBody, hmac, s)) {
          ok = true;
          break;
        }
      }
      if (!ok) return json({ error: "Invalid HMAC" }, 401);
    }

    const topic = (req.headers.get("X-Shopify-Topic") || "").toLowerCase();
    const payload = JSON.parse(rawBody || "{}");
    const adminDb = createClient(supabaseUrl, serviceKey);

    const { data: settings } = await adminDb
      .from("app_settings")
      .select("shopify_enabled, shopify_location_id")
      .limit(1)
      .maybeSingle();

    const syncOn = Boolean(settings?.shopify_enabled);
    // Order notify / restock still run when sync is on; inventory topics require syncOn below.

    if (topic === "inventory_levels/update") {
      if (!syncOn) return json({ ok: true, skipped: true, reason: "disabled" });
      const numericId = String(payload.inventory_item_id ?? "").trim();
      const inventoryItemId = toInventoryItemGid(numericId);
      const available = Math.max(0, Math.floor(Number(payload.available) || 0));
      const locationId = String(payload.location_id ?? "");
      const configuredLoc = String(settings.shopify_location_id || "").replace(/.*\//, "");
      if (configuredLoc && locationId && String(locationId) !== configuredLoc) {
        return json({ ok: true, skipped: true, reason: "other_location" });
      }

      let row: { id: string; current_stock: number; shopify_inventory_item_id: string | null } | null =
        null;
      {
        const { data } = await adminDb
          .from("products")
          .select("id, current_stock, shopify_inventory_item_id")
          .eq("shopify_inventory_item_id", inventoryItemId)
          .maybeSingle();
        row = data;
      }
      if (!row && numericId) {
        const { data } = await adminDb
          .from("products")
          .select("id, current_stock, shopify_inventory_item_id")
          .eq("shopify_inventory_item_id", numericId)
          .maybeSingle();
        row = data;
      }
      if (!row && numericId) {
        const { data } = await adminDb
          .from("products")
          .select("id, current_stock, shopify_inventory_item_id")
          .ilike("shopify_inventory_item_id", `%/${numericId}`)
          .limit(1)
          .maybeSingle();
        row = data;
      }

      if (!row) return json({ ok: true, skipped: true, reason: "unlinked" });

      const prev = Math.floor(Number(row.current_stock) || 0);
      const delta = available - prev;
      if (delta === 0) return json({ ok: true, skipped: true, reason: "no_change" });

      const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const itemKey = row.shopify_inventory_item_id || inventoryItemId;

      // Order create/cancel already adjusted local stock — don't apply twice
      const { data: recentOrderAdj } = await adminDb
        .from("shopify_sync_log")
        .select("id, kind, qty_delta")
        .eq("direction", "inbound")
        .eq("product_id", row.id)
        .in("kind", ["order_deduct", "order_restock"])
        .gte("created_at", since)
        .limit(10);
      if ((recentOrderAdj ?? []).some((r) => Number(r.qty_delta) === delta)) {
        return json({ ok: true, skipped: true, reason: "order_handler_already_applied" });
      }

      const { data: recent } = await adminDb
        .from("shopify_sync_log")
        .select("id, kind, qty_delta")
        .eq("direction", "outbound")
        .eq("inventory_item_id", itemKey)
        .gte("created_at", since)
        .limit(10);
      const echo = (recent ?? []).some((r) => {
        if (r.kind === "inventory_set" && Number(r.qty_delta) === available) return true;
        if (r.kind === "inventory_adjust" && Number(r.qty_delta) === delta) return true;
        return false;
      });
      if (echo) return json({ ok: true, skipped: true, reason: "echo" });

      await adminDb
        .from("products")
        .update({
          current_stock: available,
          shopify_inventory_item_id: inventoryItemId,
          shopify_last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      await adminDb.from("stock_movements").insert({
        product_id: row.id,
        movement_type: "shopify_sync",
        quantity_change: delta,
        previous_quantity: prev,
        new_quantity: available,
        notes: "Inventory updated from Shopify webhook",
      });

      await adminDb.from("shopify_sync_log").insert({
        direction: "inbound",
        kind: "inventory_webhook",
        product_id: row.id,
        inventory_item_id: inventoryItemId,
        qty_delta: delta,
        external_ref: String(payload.updated_at || ""),
        notes: `available=${available}`,
      });

      return json({ ok: true, product_id: row.id, available, delta });
    }

    if (topic === "products/update") {
      if (!syncOn) return json({ ok: true, skipped: true, reason: "disabled" });
      const variants = payload.variants ?? [];
      let updated = 0;
      for (const v of variants) {
        const barcode = String(v.barcode || "").trim();
        if (!barcode) continue;
        const { data: product } = await adminDb
          .from("products")
          .select("id")
          .eq("barcode", barcode)
          .maybeSingle();
        if (!product) continue;
        const patch: Record<string, unknown> = {
          barcode,
          shopify_last_synced_at: new Date().toISOString(),
        };
        const title = String(payload.title || "").trim();
        if (title) patch.name = title;
        if (v.id) patch.shopify_variant_id = `gid://shopify/ProductVariant/${v.id}`;
        if (v.inventory_item_id) patch.shopify_inventory_item_id = toInventoryItemGid(v.inventory_item_id);
        if (payload.id) patch.shopify_product_id = `gid://shopify/Product/${payload.id}`;
        await adminDb.from("products").update(patch).eq("id", product.id);
        updated += 1;
      }
      return json({ ok: true, updated });
    }

    if (topic === "orders/create") {
      if (!syncOn) return json({ ok: true, skipped: true, reason: "disabled" });
      const numericId = String(payload.id ?? "").trim();
      const shopifyOrderId = numericId
        ? `gid://shopify/Order/${numericId}`
        : String(payload.admin_graphql_api_id || "").trim();
      if (!shopifyOrderId) return json({ ok: true, skipped: true, reason: "no_order_id" });

      const total = Number(payload.total_price ?? payload.current_total_price ?? 0);
      const customer =
        payload.customer?.first_name || payload.customer?.last_name
          ? [payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(" ")
          : payload.shipping_address?.name || payload.email || null;

      const orderName = String(payload.name || "").trim() || null;
      const { error } = await adminDb.from("shopify_order_events").upsert(
        {
          shopify_order_id: shopifyOrderId,
          order_name: orderName,
          total_amount: Number.isFinite(total) ? total : null,
          currency: String(payload.currency || payload.presentment_currency || "").trim() || null,
          customer_name: customer ? String(customer).trim() : null,
          financial_status: String(payload.financial_status || "").trim() || null,
          fulfillment_status: String(payload.fulfillment_status || "").trim() || null,
          payload: {
            id: payload.id,
            name: payload.name,
            email: payload.email,
            line_items_count: Array.isArray(payload.line_items) ? payload.line_items.length : 0,
            line_items: Array.isArray(payload.line_items)
              ? payload.line_items.map((raw: Record<string, unknown>) => ({
                  variant_id: raw.variant_id ?? null,
                  sku: raw.sku ?? null,
                  barcode: raw.barcode ?? null,
                  quantity: raw.quantity ?? 0,
                }))
              : [],
          },
          created_at: payload.created_at ? new Date(payload.created_at).toISOString() : new Date().toISOString(),
        },
        { onConflict: "shopify_order_id", ignoreDuplicates: true }
      );
      if (error) throw error;

      // Deduct POS stock from line items (inventory_levels/update is unreliable alone)
      let stock = { skipped: false, adjusted: [] as unknown[] };
      try {
        stock = await adjustStockFromShopifyOrder(adminDb, payload, -1, "created");
      } catch (e) {
        console.warn("[orders/create] stock deduct failed", e);
      }

      // System / desktop push (works even if POS tab is closed — needs VAPID + client subscribe)
      let push = { sent: 0, failed: 0 };
      try {
        const { data: subs } = await adminDb
          .from("shopify_push_subscriptions")
          .select("endpoint, p256dh, auth")
          .limit(50);
        const totalLabel = Number.isFinite(total) ? ` · ${total}` : "";
        const who = customer ? String(customer).trim() : "Customer";
        push = await sendWebPushToAll(subs ?? [], {
          title: `Shopify ${orderName || "order"}`,
          body: `${who}${totalLabel}`,
          order_name: orderName,
          shopify_order_id: shopifyOrderId,
          url: "/shopify-orders",
          tag: `shopify-order-${numericId || shopifyOrderId}`,
        });
      } catch (e) {
        console.warn("[orders/create] push failed", e);
      }

      return json({ ok: true, shopify_order_id: shopifyOrderId, stock, push });
    }

    if (topic === "orders/cancelled" || topic === "orders/delete") {
      if (!syncOn) return json({ ok: true, skipped: true, reason: "disabled" });
      const reason = topic === "orders/cancelled" ? "cancelled" : "deleted";
      const result = await adjustStockFromShopifyOrder(adminDb, payload, 1, reason);
      return json({ ok: true, topic, ...result });
    }

    return json({ ok: true, skipped: true, reason: `unhandled_topic:${topic}` });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
});
