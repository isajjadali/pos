import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  adjustInventoryAvailable,
  attachProductMedia,
  createProductWithBarcode,
  createStagedUpload,
  findVariantByBarcode,
  getInventoryAvailableAtLocation,
  getOrder,
  getVariantPrice,
  listLocations,
  listOrders,
  listRecentOrdersWithLines,
  normalizeShopDomain,
  resolveAdminToken,
  setInventoryAvailable,
  setVariantPrice,
  shopifyGraphql,
  toLocationGid,
  updateVariantBarcodeAndTitle,
  type ShopifyConfig,
} from "./_shopify.ts";
import { adjustStockFromOrderLines } from "./_order_stock.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ordersAccessHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/access denied.*orders|orders field/i.test(msg)) {
    return (
      "Shopify denied orders access. In Dev Dashboard → your app → API scopes, enable " +
      "read_orders (and write_files if using images). Then uninstall & reinstall the app on " +
      "the shop so the token picks up new scopes. After that, Settings → Register webhooks."
    );
  }
  return msg;
}

async function requireAdmin(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) throw new Error("Server misconfigured");

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!jwt || (anonKey && jwt === anonKey)) throw Object.assign(new Error("Not authenticated"), { status: 401 });

  const adminDb = createClient(supabaseUrl, serviceKey);
  const {
    data: { user },
    error: userErr,
  } = await adminDb.auth.getUser(jwt);
  if (userErr || !user) throw Object.assign(new Error(userErr?.message || "Not authenticated"), { status: 401 });

  const { data: profile } = await adminDb.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw Object.assign(new Error("Admin only"), { status: 403 });

  return { adminDb, user };
}

/** Allow inventory_adjust from any authenticated user (POS sales staff). */
async function requireAuth(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) throw new Error("Server misconfigured");

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!jwt || (anonKey && jwt === anonKey)) throw Object.assign(new Error("Not authenticated"), { status: 401 });

  const adminDb = createClient(supabaseUrl, serviceKey);
  const {
    data: { user },
    error: userErr,
  } = await adminDb.auth.getUser(jwt);
  if (userErr || !user) throw Object.assign(new Error(userErr?.message || "Not authenticated"), { status: 401 });
  return { adminDb, user };
}

async function loadShopifyConfig(adminDb: ReturnType<typeof createClient>): Promise<ShopifyConfig> {
  const { data: settings } = await adminDb
    .from("app_settings")
    .select("shopify_shop_domain, shopify_location_id, shopify_enabled")
    .limit(1)
    .maybeSingle();

  const envDomain = Deno.env.get("SHOPIFY_SHOP_DOMAIN")?.trim();
  const domain = normalizeShopDomain(settings?.shopify_shop_domain || envDomain || "");
  if (!domain) throw new Error("Shopify shop domain is not configured (Settings or SHOPIFY_SHOP_DOMAIN)");

  const token = await resolveAdminToken(domain);
  const locationId = String(settings?.shopify_location_id || Deno.env.get("SHOPIFY_LOCATION_ID") || "").trim();
  return {
    shopDomain: domain,
    adminToken: token,
    locationId,
  };
}

async function logSync(
  adminDb: ReturnType<typeof createClient>,
  row: {
    direction: "outbound" | "inbound";
    kind: string;
    product_id?: string | null;
    inventory_item_id?: string | null;
    qty_delta?: number | null;
    external_ref?: string | null;
    notes?: string | null;
  }
) {
  await adminDb.from("shopify_sync_log").insert({
    direction: row.direction,
    kind: row.kind,
    product_id: row.product_id ?? null,
    inventory_item_id: row.inventory_item_id ?? null,
    qty_delta: row.qty_delta ?? null,
    external_ref: row.external_ref ?? null,
    notes: row.notes ?? null,
  });
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function pushProduct(
  adminDb: ReturnType<typeof createClient>,
  cfg: ShopifyConfig,
  product: {
    id: string;
    name: string;
    barcode: string | null;
    current_stock: number;
    shopify_variant_id: string | null;
    shopify_inventory_item_id: string | null;
    shopify_product_id: string | null;
  },
  opts: { syncName?: boolean } = {}
) {
  const barcode = String(product.barcode || "").trim();
  if (!barcode) return { skipped: true, reason: "no_barcode" };
  if (!cfg.locationId) throw new Error("Set Shopify location in Settings before pushing");

  const stock = Math.max(0, Math.floor(Number(product.current_stock) || 0));
  let variantId = product.shopify_variant_id;
  let inventoryItemId = product.shopify_inventory_item_id;
  let productId = product.shopify_product_id;

  // Fast path: already linked → only set stock (1 Shopify call)
  if (inventoryItemId) {
    await setInventoryAvailable(cfg, inventoryItemId, stock);
    await adminDb
      .from("products")
      .update({ shopify_last_synced_at: new Date().toISOString() })
      .eq("id", product.id);
    await logSync(adminDb, {
      direction: "outbound",
      kind: "inventory_set",
      product_id: product.id,
      inventory_item_id: inventoryItemId,
      qty_delta: stock,
      notes: "push stock (linked)",
    });
    return { skipped: false, variantId, inventoryItemId, productId, stock, fast: true };
  }

  const existing = await findVariantByBarcode(cfg, barcode);
  if (existing) {
    variantId = existing.id;
    inventoryItemId = existing.inventoryItem?.id ?? inventoryItemId;
    productId = existing.product?.id ?? productId;
    if (opts.syncName && productId && variantId) {
      await updateVariantBarcodeAndTitle(cfg, {
        productId,
        variantId,
        title: product.name || existing.product.title,
        barcode,
      });
    }
  } else {
    const created = await createProductWithBarcode(cfg, {
      title: product.name || barcode,
      barcode,
      stock,
    });
    variantId = created.variantId;
    inventoryItemId = created.inventoryItemId;
    productId = created.productId;
  }

  if (inventoryItemId) {
    // createProductWithBarcode already set stock for new products; still set for matched existing
    if (existing) {
      await setInventoryAvailable(cfg, inventoryItemId, stock);
    }
    await logSync(adminDb, {
      direction: "outbound",
      kind: "inventory_set",
      product_id: product.id,
      inventory_item_id: inventoryItemId,
      qty_delta: stock,
      notes: existing ? "push match barcode" : "push create",
    });
  }

  await adminDb
    .from("products")
    .update({
      shopify_variant_id: variantId,
      shopify_inventory_item_id: inventoryItemId,
      shopify_product_id: productId,
      shopify_last_synced_at: new Date().toISOString(),
    })
    .eq("id", product.id);

  return { skipped: false, variantId, inventoryItemId, productId, stock };
}

async function applyPulledStock(
  adminDb: ReturnType<typeof createClient>,
  productId: string,
  qty: number,
  inventoryItemId: string | null,
  extraPatch: Record<string, unknown> = {}
) {
  const { data: prevRow } = await adminDb
    .from("products")
    .select("current_stock")
    .eq("id", productId)
    .single();
  const prev = Math.floor(Number(prevRow?.current_stock) || 0);
  const patch: Record<string, unknown> = {
    ...extraPatch,
    current_stock: qty,
    shopify_last_synced_at: new Date().toISOString(),
  };
  await adminDb.from("products").update(patch).eq("id", productId);
  if (prev !== qty) {
    await adminDb.from("stock_movements").insert({
      product_id: productId,
      movement_type: "shopify_sync",
      quantity_change: qty - prev,
      previous_quantity: prev,
      new_quantity: qty,
      notes: "Stock pulled from Shopify",
    });
  }
  await logSync(adminDb, {
    direction: "inbound",
    kind: "pull",
    product_id: productId,
    inventory_item_id: inventoryItemId,
    qty_delta: qty,
  });
}

async function pullProduct(
  adminDb: ReturnType<typeof createClient>,
  cfg: ShopifyConfig,
  product: {
    id: string;
    barcode: string | null;
    shopify_inventory_item_id: string | null;
    shopify_variant_id: string | null;
    shopify_product_id: string | null;
  }
) {
  const barcode = String(product.barcode || "").trim();
  if (!barcode) return { skipped: true, reason: "no_barcode" };

  // Fast path: linked → only read inventory at location
  if (product.shopify_inventory_item_id && cfg.locationId) {
    const atLoc = await getInventoryAvailableAtLocation(cfg, product.shopify_inventory_item_id);
    if (atLoc == null) return { skipped: true, reason: "no_inventory_level" };
    await applyPulledStock(adminDb, product.id, atLoc, product.shopify_inventory_item_id);
    return { skipped: false, stock: atLoc, fast: true };
  }

  const existing = await findVariantByBarcode(cfg, barcode);
  if (!existing) return { skipped: true, reason: "not_on_shopify" };

  let stock = existing.inventoryQuantity;
  if (existing.inventoryItem?.id && cfg.locationId) {
    const atLoc = await getInventoryAvailableAtLocation(cfg, existing.inventoryItem.id);
    if (atLoc != null) stock = atLoc;
  }
  if (stock == null || !Number.isFinite(Number(stock))) {
    return { skipped: true, reason: "no_stock" };
  }
  const qty = Math.max(0, Math.floor(Number(stock)));
  await applyPulledStock(adminDb, product.id, qty, existing.inventoryItem?.id ?? null, {
    name: existing.product?.title || undefined,
    barcode: existing.barcode || barcode,
    shopify_variant_id: existing.id,
    shopify_inventory_item_id: existing.inventoryItem?.id ?? null,
    shopify_product_id: existing.product?.id ?? null,
  });
  return { skipped: false, stock: qty, name: existing.product?.title };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();

    if (action === "inventory_adjust") {
      const { adminDb } = await requireAuth(req);
      const { data: settings } = await adminDb
        .from("app_settings")
        .select("shopify_enabled")
        .limit(1)
        .maybeSingle();
      if (!settings?.shopify_enabled) return json({ ok: true, skipped: true, reason: "disabled" });

      const cfg = await loadShopifyConfig(adminDb);
      if (!cfg.locationId) return json({ ok: true, skipped: true, reason: "no_location" });

      const productId = String(body.product_id || "").trim();
      const delta = Math.floor(Number(body.delta) || 0);
      if (!productId || delta === 0) return json({ ok: true, skipped: true });

      const { data: product, error } = await adminDb
        .from("products")
        .select("id, shopify_inventory_item_id, barcode")
        .eq("id", productId)
        .maybeSingle();
      if (error) throw error;
      if (!product) return json({ error: "Product not found" }, 404);

      let inventoryItemId = product.shopify_inventory_item_id;
      if (!inventoryItemId && product.barcode) {
        const v = await findVariantByBarcode(cfg, product.barcode);
        inventoryItemId = v?.inventoryItem?.id ?? null;
        if (v) {
          await adminDb
            .from("products")
            .update({
              shopify_variant_id: v.id,
              shopify_inventory_item_id: inventoryItemId,
              shopify_product_id: v.product?.id ?? null,
            })
            .eq("id", productId);
        }
      }
      if (!inventoryItemId) return json({ ok: true, skipped: true, reason: "not_linked" });

      await adjustInventoryAvailable(cfg, inventoryItemId, delta);
      await logSync(adminDb, {
        direction: "outbound",
        kind: "inventory_adjust",
        product_id: productId,
        inventory_item_id: inventoryItemId,
        qty_delta: delta,
        notes: "POS sale adjust",
      });
      return json({ ok: true, inventoryItemId, delta });
    }

    // Remaining actions: admin only
    const { adminDb, user: adminUser } = await requireAdmin(req);

    if (action === "test_connection") {
      const domain = normalizeShopDomain(
        body.shop_domain ||
          (await adminDb.from("app_settings").select("shopify_shop_domain").limit(1).maybeSingle()).data
            ?.shopify_shop_domain ||
          Deno.env.get("SHOPIFY_SHOP_DOMAIN") ||
          ""
      );
      if (!domain) return json({ error: "Shop domain required" }, 400);
      const token = await resolveAdminToken(domain);
      const cfg: ShopifyConfig = { shopDomain: domain, adminToken: token, locationId: "" };
      const locations = await listLocations(cfg);
      return json({
        ok: true,
        shop: domain,
        locations: locations.map((l) => ({
          id: l.id,
          numericId: l.id.replace(/.*\//, ""),
          name: l.name,
          gid: toLocationGid(l.id),
        })),
      });
    }

    if (action === "save_settings") {
      const enabled = Boolean(body.shopify_enabled);
      const domain = normalizeShopDomain(body.shopify_shop_domain || "");
      const locationId = String(body.shopify_location_id || "").trim();
      const { data: current } = await adminDb.from("app_settings").select("id").limit(1).maybeSingle();
      const row = {
        shopify_enabled: enabled,
        shopify_shop_domain: domain || null,
        shopify_location_id: locationId || null,
        updated_at: new Date().toISOString(),
      };
      if (current?.id) {
        const { error } = await adminDb.from("app_settings").update(row).eq("id", current.id);
        if (error) throw error;
      } else {
        const { error } = await adminDb.from("app_settings").insert(row);
        if (error) throw error;
      }
      return json({ ok: true, ...row });
    }

    if (action === "push_one" || action === "push_all" || action === "push_batch") {
      const cfg = await loadShopifyConfig(adminDb);
      const syncName = Boolean(body.sync_name);
      const limit = Math.min(25, Math.max(1, Math.floor(Number(body.limit) || 12)));
      const offset = Math.max(0, Math.floor(Number(body.offset) || 0));

      if (action === "push_one") {
        const id = String(body.product_id || "").trim();
        if (!id) return json({ error: "product_id required" }, 400);
        const { data: p, error } = await adminDb
          .from("products")
          .select(
            "id, name, barcode, current_stock, shopify_variant_id, shopify_inventory_item_id, shopify_product_id"
          )
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (!p) return json({ error: "Product not found" }, 404);
        try {
          return json({
            ok: true,
            results: [{ id: p.id, ...(await pushProduct(adminDb, cfg, p, { syncName: true })) }],
            done: true,
          });
        } catch (e) {
          return json({
            ok: true,
            results: [{ id: p.id, error: e instanceof Error ? e.message : String(e) }],
            done: true,
          });
        }
      }

      // Count + page of barcode products
      const base = adminDb
        .from("products")
        .select(
          "id, name, barcode, current_stock, shopify_variant_id, shopify_inventory_item_id, shopify_product_id",
          { count: "exact" }
        )
        .eq("is_active", true)
        .not("barcode", "is", null)
        .neq("barcode", "")
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1);

      const { data: products, error, count } = await base;
      if (error) throw error;
      const list = products ?? [];
      const total = count ?? list.length;
      const results = await mapPool(list, 3, async (p) => {
        if (!String(p.barcode || "").trim()) {
          return { id: p.id, skipped: true, reason: "no_barcode" };
        }
        try {
          return { id: p.id, ...(await pushProduct(adminDb, cfg, p, { syncName })) };
        } catch (e) {
          return { id: p.id, error: e instanceof Error ? e.message : String(e) };
        }
      });
      const nextOffset = offset + list.length;
      return json({
        ok: true,
        results,
        offset,
        limit,
        nextOffset,
        total,
        done: nextOffset >= total || list.length === 0,
      });
    }

    if (action === "pull_one" || action === "pull_stock" || action === "pull_batch") {
      const cfg = await loadShopifyConfig(adminDb);
      const limit = Math.min(25, Math.max(1, Math.floor(Number(body.limit) || 12)));
      const offset = Math.max(0, Math.floor(Number(body.offset) || 0));

      if (action === "pull_one") {
        const id = String(body.product_id || "").trim();
        if (!id) return json({ error: "product_id required" }, 400);
        const { data: p, error } = await adminDb
          .from("products")
          .select("id, barcode, shopify_inventory_item_id, shopify_variant_id, shopify_product_id")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (!p) return json({ error: "Product not found" }, 404);
        try {
          return json({
            ok: true,
            results: [{ id: p.id, ...(await pullProduct(adminDb, cfg, p)) }],
            done: true,
          });
        } catch (e) {
          return json({
            ok: true,
            results: [{ id: p.id, error: e instanceof Error ? e.message : String(e) }],
            done: true,
          });
        }
      }

      const { data: products, error, count } = await adminDb
        .from("products")
        .select("id, barcode, shopify_inventory_item_id, shopify_variant_id, shopify_product_id", {
          count: "exact",
        })
        .eq("is_active", true)
        .not("barcode", "is", null)
        .neq("barcode", "")
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      const list = products ?? [];
      const total = count ?? list.length;
      const results = await mapPool(list, 3, async (p) => {
        try {
          return { id: p.id, ...(await pullProduct(adminDb, cfg, p)) };
        } catch (e) {
          return { id: p.id, error: e instanceof Error ? e.message : String(e) };
        }
      });
      const nextOffset = offset + list.length;
      return json({
        ok: true,
        results,
        offset,
        limit,
        nextOffset,
        total,
        done: nextOffset >= total || list.length === 0,
      });
    }

    if (action === "register_webhooks") {
      const cfg = await loadShopifyConfig(adminDb);
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET")?.trim();
      if (!supabaseUrl) throw new Error("SUPABASE_URL missing");
      const webhookUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/shopify-webhooks`;
      const topics = [
        "INVENTORY_LEVELS_UPDATE",
        "PRODUCTS_UPDATE",
        "ORDERS_CREATE",
        "ORDERS_CANCELLED",
        "ORDERS_DELETE",
      ];

      // List existing so "already taken" is treated as OK
      const existingData = await shopifyGraphql<{
        webhookSubscriptions: {
          edges: Array<{
            node: {
              id: string;
              topic: string;
              endpoint: { __typename?: string; callbackUrl?: string } | null;
            };
          }>;
        };
      }>(
        cfg,
        `query {
          webhookSubscriptions(first: 50) {
            edges {
              node {
                id
                topic
                endpoint {
                  __typename
                  ... on WebhookHttpEndpoint { callbackUrl }
                }
              }
            }
          }
        }`
      );
      const existingByTopic = new Map<string, { id: string; callbackUrl: string }>();
      for (const e of existingData.webhookSubscriptions?.edges ?? []) {
        const topic = String(e.node.topic || "").toUpperCase();
        const callbackUrl = String(e.node.endpoint?.callbackUrl || "");
        if (topic) existingByTopic.set(topic, { id: e.node.id, callbackUrl });
      }

      const created = [];
      for (const topic of topics) {
        const already = existingByTopic.get(topic);
        if (already?.callbackUrl && already.callbackUrl.replace(/\/$/, "") === webhookUrl.replace(/\/$/, "")) {
          created.push({
            topic,
            id: already.id,
            error: null,
            status: "already_registered",
            note: "Webhook already points at this POS edge function",
          });
          continue;
        }

        const data = await shopifyGraphql<{
          webhookSubscriptionCreate: {
            webhookSubscription: { id: string } | null;
            userErrors: Array<{ message: string }>;
          };
        }>(
          cfg,
          `mutation ($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
            webhookSubscriptionCreate(
              topic: $topic
              webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
            ) {
              webhookSubscription { id }
              userErrors { message }
            }
          }`,
          { topic, callbackUrl: webhookUrl }
        );
        const errs = data.webhookSubscriptionCreate?.userErrors ?? [];
        const errMsg = errs.map((e) => e.message).join("; ");
        const alreadyTaken = /already been taken|already exists/i.test(errMsg);
        created.push({
          topic,
          id: data.webhookSubscriptionCreate?.webhookSubscription?.id ?? (alreadyTaken ? already?.id ?? "existing" : null),
          error: alreadyTaken || !errMsg ? null : errMsg,
          status: alreadyTaken ? "already_registered" : data.webhookSubscriptionCreate?.webhookSubscription?.id ? "created" : "error",
          note: secret
            ? "Ensure SHOPIFY_WEBHOOK_SECRET matches the app webhook signing secret"
            : "Set SHOPIFY_WEBHOOK_SECRET for HMAC verification",
        });
      }
      return json({ ok: true, webhookUrl, created });
    }

    if (action === "orders_list") {
      const cfg = await loadShopifyConfig(adminDb);
      const query = String(body.query || "").trim();
      const first = Math.min(50, Math.max(1, Math.floor(Number(body.first) || 25)));
      try {
        const orders = await listOrders(cfg, { first, query });
        return json({ ok: true, orders, shop: cfg.shopDomain });
      } catch (e) {
        throw Object.assign(new Error(ordersAccessHint(e)), {
          status: (e as { status?: number })?.status || 403,
        });
      }
    }

    /**
     * Poll Shopify for recent orders when webhooks don't deliver.
     * Inserts shopify_order_events + deducts/restocks POS stock for new/cancelled orders.
     */
    if (action === "orders_poll_sync") {
      const { data: settings } = await adminDb
        .from("app_settings")
        .select("shopify_enabled")
        .limit(1)
        .maybeSingle();
      if (!settings?.shopify_enabled) {
        return json({ ok: true, skipped: true, reason: "disabled", newOrders: [] });
      }

      const cfg = await loadShopifyConfig(adminDb);
      let orders;
      try {
        orders = await listRecentOrdersWithLines(cfg, Math.min(20, Math.max(5, Number(body.first) || 12)));
      } catch (e) {
        throw Object.assign(new Error(ordersAccessHint(e)), {
          status: (e as { status?: number })?.status || 403,
        });
      }

      const newOrders: Array<Record<string, unknown>> = [];
      const liveIds = new Set(orders.map((o) => o.id));

      for (const order of orders) {
        const { data: existing } = await adminDb
          .from("shopify_order_events")
          .select("id, read_at")
          .eq("shopify_order_id", order.id)
          .maybeSingle();

        if (!existing) {
          const total = order.total != null ? Number(order.total) : null;
          await adminDb.from("shopify_order_events").insert({
            shopify_order_id: order.id,
            order_name: order.name,
            total_amount: Number.isFinite(total as number) ? total : null,
            currency: order.currency,
            customer_name: order.customerName,
            financial_status: order.financialStatus,
            fulfillment_status: order.fulfillmentStatus,
            payload: {
              source: "poll_sync",
              line_items_count: order.lineItems.length,
              line_items: order.lineItems,
            },
            created_at: order.createdAt || new Date().toISOString(),
          });

          if (!order.cancelledAt) {
            await adjustStockFromOrderLines(adminDb, {
              shopifyOrderId: order.id,
              orderName: order.name,
              lineItems: order.lineItems,
              direction: -1,
              reason: "created",
            });
          }

          newOrders.push({
            shopify_order_id: order.id,
            order_name: order.name,
            customer_name: order.customerName,
            total_amount: total,
          });
        } else {
          // Keep latest line items for delete/restock fallback
          await adminDb
            .from("shopify_order_events")
            .update({
              payload: {
                source: "poll_sync",
                line_items_count: order.lineItems.length,
                line_items: order.lineItems,
              },
            })
            .eq("id", existing.id);
        }

        // Cancelled orders still in Shopify: restock
        if (order.cancelledAt) {
          await adjustStockFromOrderLines(adminDb, {
            shopifyOrderId: order.id,
            orderName: order.name,
            lineItems: order.lineItems,
            direction: 1,
            reason: "cancelled",
          });
        }
      }

      // Deleted orders disappear from Shopify list — restock from saved deduct logs / event payload
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data: deductRows } = await adminDb
        .from("shopify_sync_log")
        .select("external_ref, product_id, qty_delta, notes")
        .eq("direction", "inbound")
        .eq("kind", "order_deduct")
        .gte("created_at", since)
        .limit(200);

      const deductByOrder = new Map<string, Array<{ product_id: string | null; qty: number }>>();
      for (const row of deductRows ?? []) {
        const ref = String(row.external_ref || "");
        const m = ref.match(/^deduct:order:(.+)$/);
        if (!m) continue;
        const orderId = m[1];
        if (!deductByOrder.has(orderId)) deductByOrder.set(orderId, []);
        const qty = Math.abs(Math.floor(Number(row.qty_delta) || 0));
        if (row.product_id && qty > 0) {
          deductByOrder.get(orderId)!.push({ product_id: row.product_id, qty });
        }
      }

      const restockedDeleted: string[] = [];
      for (const [orderId, lines] of deductByOrder) {
        const restockRef = `restock:order:${orderId}`;
        const { data: already } = await adminDb
          .from("shopify_sync_log")
          .select("id")
          .eq("direction", "inbound")
          .eq("kind", "order_restock")
          .eq("external_ref", restockRef)
          .limit(1)
          .maybeSingle();
        if (already) continue;

        const live = orders.find((o) => o.id === orderId);
        if (live && !live.cancelledAt) continue; // still open on Shopify

        // Prefer line items from event payload; else reverse per-product deduct rows
        const { data: ev } = await adminDb
          .from("shopify_order_events")
          .select("order_name, payload")
          .eq("shopify_order_id", orderId)
          .maybeSingle();
        const savedLines = Array.isArray((ev?.payload as { line_items?: unknown })?.line_items)
          ? ((ev!.payload as { line_items: Array<Record<string, unknown>> }).line_items)
          : [];

        if (savedLines.length) {
          await adjustStockFromOrderLines(adminDb, {
            shopifyOrderId: orderId,
            orderName: ev?.order_name || orderId,
            lineItems: savedLines.map((li) => ({
              variant_id: (li.variant_id as string) || null,
              sku: (li.sku as string) || null,
              barcode: (li.barcode as string) || null,
              quantity: Number(li.quantity) || 0,
            })),
            direction: 1,
            reason: live?.cancelledAt ? "cancelled" : "deleted",
          });
        } else if (lines.length) {
          // Reverse each product qty from deduct logs
          for (const line of lines) {
            if (!line.product_id) continue;
            const { data: product } = await adminDb
              .from("products")
              .select("id, name, current_stock, shopify_inventory_item_id")
              .eq("id", line.product_id)
              .maybeSingle();
            if (!product) continue;
            const prev = Math.floor(Number(product.current_stock) || 0);
            const next = prev + line.qty;
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
              quantity_change: line.qty,
              previous_quantity: prev,
              new_quantity: next,
              notes: `Restock from deleted Shopify order ${ev?.order_name || orderId}`,
            });
          }
          await adminDb.from("shopify_sync_log").insert({
            direction: "inbound",
            kind: "order_restock",
            qty_delta: lines.reduce((s, l) => s + l.qty, 0),
            external_ref: restockRef,
            notes: `deleted ${ev?.order_name || orderId} (from deduct log)`,
          });
        } else {
          continue;
        }
        restockedDeleted.push(orderId);
      }

      return json({
        ok: true,
        shop: cfg.shopDomain,
        checked: orders.length,
        newOrders,
        restockedDeleted,
        liveCount: liveIds.size,
      });
    }

    if (action === "order_get") {
      const cfg = await loadShopifyConfig(adminDb);
      const orderId = String(body.order_id || "").trim();
      if (!orderId) return json({ error: "order_id required" }, 400);
      try {
        const order = await getOrder(cfg, orderId);
        return json({ ok: true, order, shop: cfg.shopDomain });
      } catch (e) {
        throw Object.assign(new Error(ordersAccessHint(e)), {
          status: (e as { status?: number })?.status || 403,
        });
      }
    }

    if (action === "variant_set_price") {
      const cfg = await loadShopifyConfig(adminDb);
      const productId = String(body.product_id || "").trim();
      const price = Number(body.price);
      if (!productId) return json({ error: "product_id required" }, 400);
      if (!Number.isFinite(price) || price < 0) return json({ error: "Invalid price" }, 400);

      const { data: product, error } = await adminDb
        .from("products")
        .select("id, shopify_product_id, shopify_variant_id, barcode")
        .eq("id", productId)
        .maybeSingle();
      if (error) throw error;
      if (!product) return json({ error: "Product not found" }, 404);

      let shopifyProductId = product.shopify_product_id;
      let shopifyVariantId = product.shopify_variant_id;
      if ((!shopifyProductId || !shopifyVariantId) && product.barcode) {
        const v = await findVariantByBarcode(cfg, product.barcode);
        if (v) {
          shopifyProductId = v.product?.id ?? shopifyProductId;
          shopifyVariantId = v.id;
          await adminDb
            .from("products")
            .update({
              shopify_product_id: shopifyProductId,
              shopify_variant_id: shopifyVariantId,
              shopify_inventory_item_id: v.inventoryItem?.id ?? null,
            })
            .eq("id", productId);
        }
      }
      if (!shopifyProductId || !shopifyVariantId) {
        return json({ error: "Product is not linked to Shopify. Push it first." }, 400);
      }

      const updated = await setVariantPrice(cfg, {
        productId: shopifyProductId,
        variantId: shopifyVariantId,
        price,
      });
      await adminDb
        .from("products")
        .update({
          shopify_price: price,
          shopify_last_synced_at: new Date().toISOString(),
        })
        .eq("id", productId);
      await logSync(adminDb, {
        direction: "outbound",
        kind: "price_set",
        product_id: productId,
        notes: `price=${price}`,
      });
      return json({ ok: true, ...updated, shopify_price: price });
    }

    if (action === "variant_get_price") {
      const cfg = await loadShopifyConfig(adminDb);
      const productId = String(body.product_id || "").trim();
      if (!productId) return json({ error: "product_id required" }, 400);
      const { data: product, error } = await adminDb
        .from("products")
        .select("id, shopify_variant_id, shopify_price, barcode")
        .eq("id", productId)
        .maybeSingle();
      if (error) throw error;
      if (!product) return json({ error: "Product not found" }, 404);

      let variantId = product.shopify_variant_id;
      if (!variantId && product.barcode) {
        const v = await findVariantByBarcode(cfg, product.barcode);
        variantId = v?.id ?? null;
      }
      if (!variantId) return json({ ok: true, price: product.shopify_price ?? null, linked: false });

      const price = await getVariantPrice(cfg, variantId);
      if (price != null) {
        await adminDb.from("products").update({ shopify_price: price }).eq("id", productId);
      }
      return json({ ok: true, price, linked: true });
    }

    if (action === "push_prices_batch") {
      const cfg = await loadShopifyConfig(adminDb);
      const ids = Array.isArray(body.product_ids) ? body.product_ids.map(String) : [];
      if (!ids.length) return json({ error: "product_ids required" }, 400);
      const { data: products, error } = await adminDb
        .from("products")
        .select("id, shopify_product_id, shopify_variant_id, shopify_price, barcode")
        .in("id", ids.slice(0, 50));
      if (error) throw error;
      const results = await mapPool(products ?? [], 3, async (p) => {
        if (p.shopify_price == null) return { id: p.id, skipped: true, reason: "no_shopify_price" };
        try {
          let shopifyProductId = p.shopify_product_id;
          let shopifyVariantId = p.shopify_variant_id;
          if ((!shopifyProductId || !shopifyVariantId) && p.barcode) {
            const v = await findVariantByBarcode(cfg, p.barcode);
            shopifyProductId = v?.product?.id ?? null;
            shopifyVariantId = v?.id ?? null;
          }
          if (!shopifyProductId || !shopifyVariantId) {
            return { id: p.id, skipped: true, reason: "not_linked" };
          }
          await setVariantPrice(cfg, {
            productId: shopifyProductId,
            variantId: shopifyVariantId,
            price: Number(p.shopify_price),
          });
          return { id: p.id, ok: true, price: Number(p.shopify_price) };
        } catch (e) {
          return { id: p.id, error: e instanceof Error ? e.message : String(e) };
        }
      });
      return json({ ok: true, results });
    }

    if (action === "product_image_stage") {
      const cfg = await loadShopifyConfig(adminDb);
      const productId = String(body.product_id || "").trim();
      const filename = String(body.filename || "image.jpg").trim();
      const mimeType = String(body.mime_type || "image/jpeg").trim();
      const fileSize = Math.max(1, Math.floor(Number(body.file_size) || 1));
      if (!productId) return json({ error: "product_id required" }, 400);

      const { data: product, error } = await adminDb
        .from("products")
        .select("id, name, shopify_product_id, barcode")
        .eq("id", productId)
        .maybeSingle();
      if (error) throw error;
      if (!product) return json({ error: "Product not found" }, 404);

      let shopifyProductId = product.shopify_product_id;
      if (!shopifyProductId && product.barcode) {
        const v = await findVariantByBarcode(cfg, product.barcode);
        shopifyProductId = v?.product?.id ?? null;
        if (v) {
          await adminDb
            .from("products")
            .update({
              shopify_product_id: v.product?.id ?? null,
              shopify_variant_id: v.id,
              shopify_inventory_item_id: v.inventoryItem?.id ?? null,
            })
            .eq("id", productId);
        }
      }
      if (!shopifyProductId) {
        return json({ error: "Product is not linked to Shopify. Push it first." }, 400);
      }

      const target = await createStagedUpload(cfg, { filename, mimeType, fileSize });
      return json({
        ok: true,
        product_id: productId,
        shopify_product_id: shopifyProductId,
        url: target.url,
        resourceUrl: target.resourceUrl,
        parameters: target.parameters,
      });
    }

    if (action === "product_image_finish") {
      const cfg = await loadShopifyConfig(adminDb);
      const productId = String(body.product_id || "").trim();
      const shopifyProductId = String(body.shopify_product_id || "").trim();
      const resourceUrl = String(body.resource_url || "").trim();
      const filename = String(body.filename || "image.jpg").trim();
      const alt = String(body.alt || "").trim();
      if (!productId || !shopifyProductId || !resourceUrl) {
        return json({ error: "product_id, shopify_product_id, resource_url required" }, 400);
      }

      try {
        const media = await attachProductMedia(cfg, {
          productId: shopifyProductId,
          resourceUrl,
          alt: alt || undefined,
        });
        await adminDb.from("shopify_media_log").insert({
          product_id: productId,
          filename,
          status: "ok",
          notes: media?.id || null,
        });
        return json({ ok: true, media });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await adminDb.from("shopify_media_log").insert({
          product_id: productId,
          filename,
          status: "error",
          notes: msg,
        });
        return json({ error: msg }, 400);
      }
    }

    if (action === "push_vapid_public") {
      const key = Deno.env.get("SHOPIFY_VAPID_PUBLIC_KEY")?.trim() || null;
      return json({ ok: true, vapid_public_key: key, configured: Boolean(key) });
    }

    if (action === "push_subscribe") {
      const endpoint = String(body.endpoint || "").trim();
      const keys = body.keys || {};
      const p256dh = String(keys.p256dh || "").trim();
      const auth = String(keys.auth || "").trim();
      if (!endpoint || !p256dh || !auth) {
        return json({ error: "endpoint and keys.p256dh / keys.auth required" }, 400);
      }
      const { error } = await adminDb.from("shopify_push_subscriptions").upsert(
        {
          endpoint,
          p256dh,
          auth,
          user_id: adminUser.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      );
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const status = (e as { status?: number })?.status || 500;
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, status);
  }
});
