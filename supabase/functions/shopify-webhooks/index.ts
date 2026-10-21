import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET")?.trim() || "";
    if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfigured" }, 500);

    const rawBody = await req.text();
    const hmac = req.headers.get("X-Shopify-Hmac-Sha256");
    if (secret) {
      if (!(await verifyHmac(rawBody, hmac, secret))) {
        return json({ error: "Invalid HMAC" }, 401);
      }
    }

    const topic = (req.headers.get("X-Shopify-Topic") || "").toLowerCase();
    const payload = JSON.parse(rawBody || "{}");
    const adminDb = createClient(supabaseUrl, serviceKey);

    const { data: settings } = await adminDb
      .from("app_settings")
      .select("shopify_enabled, shopify_location_id")
      .limit(1)
      .maybeSingle();

    if (!settings?.shopify_enabled) {
      return json({ ok: true, skipped: true, reason: "disabled" });
    }

    if (topic === "inventory_levels/update") {
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

      const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const itemKey = row.shopify_inventory_item_id || inventoryItemId;
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

    return json({ ok: true, skipped: true, reason: `unhandled_topic:${topic}` });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
});
