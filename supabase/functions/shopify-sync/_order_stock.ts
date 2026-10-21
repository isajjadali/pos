/** Apply +/- POS stock from Shopify order line items (shared by poll + used similarly in webhooks). */

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type AdminDb = ReturnType<typeof createClient>;

function toVariantGid(id: string | number): string {
  const s = String(id ?? "").trim();
  if (!s) return "";
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/ProductVariant/${s}`;
}

type LinkedProduct = {
  id: string;
  name: string | null;
  current_stock: number;
  shopify_inventory_item_id: string | null;
};

export type OrderLineForStock = {
  variant_id?: string | number | null;
  sku?: string | null;
  barcode?: string | null;
  quantity?: number | null;
};

async function findProductForLineItem(
  adminDb: AdminDb,
  li: OrderLineForStock
): Promise<LinkedProduct | null> {
  const variantId = li.variant_id != null ? toVariantGid(li.variant_id) : "";
  const sku = String(li.sku || "").trim();
  const barcode = String(li.barcode || sku || "").trim();

  if (variantId) {
    const { data } = await adminDb
      .from("products")
      .select("id, name, current_stock, shopify_inventory_item_id")
      .eq("shopify_variant_id", variantId)
      .maybeSingle();
    if (data) return data;
    const numeric = String(li.variant_id).replace(/.*\//, "");
    const { data: bySuffix } = await adminDb
      .from("products")
      .select("id, name, current_stock, shopify_inventory_item_id")
      .ilike("shopify_variant_id", `%/${numeric}`)
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

async function alreadyLogged(
  adminDb: AdminDb,
  kind: "order_deduct" | "order_restock",
  externalRef: string
) {
  const { data } = await adminDb
    .from("shopify_sync_log")
    .select("id")
    .eq("direction", "inbound")
    .eq("kind", kind)
    .eq("external_ref", externalRef)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

export async function adjustStockFromOrderLines(
  adminDb: AdminDb,
  opts: {
    shopifyOrderId: string;
    orderName: string;
    lineItems: OrderLineForStock[];
    direction: -1 | 1;
    reason: string;
  }
) {
  const kind = opts.direction < 0 ? "order_deduct" : "order_restock";
  const externalRef = `${kind === "order_deduct" ? "deduct" : "restock"}:order:${opts.shopifyOrderId}`;

  if (await alreadyLogged(adminDb, kind, externalRef)) {
    return { skipped: true as const, reason: "already_applied", adjusted: [] as Array<{ product_id: string; qty: number }> };
  }

  const adjusted: Array<{ product_id: string; qty: number; name?: string }> = [];

  for (const li of opts.lineItems) {
    const qty = Math.max(0, Math.floor(Number(li.quantity) || 0));
    if (qty <= 0) continue;
    const product = await findProductForLineItem(adminDb, li);
    if (!product) continue;

    const signed = opts.direction * qty;
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
        opts.direction < 0
          ? `Deduct from Shopify order ${opts.orderName}`
          : `Restock from Shopify order ${opts.orderName} (${opts.reason})`,
    });

    await adminDb.from("shopify_sync_log").insert({
      direction: "inbound",
      kind,
      product_id: product.id,
      inventory_item_id: product.shopify_inventory_item_id,
      qty_delta: next - prev,
      external_ref: externalRef,
      notes: `${opts.reason} ${opts.orderName}`,
    });

    adjusted.push({
      product_id: product.id,
      qty: Math.abs(next - prev),
      name: product.name || undefined,
    });
  }

  if (!adjusted.length) {
    await adminDb.from("shopify_sync_log").insert({
      direction: "inbound",
      kind,
      qty_delta: 0,
      external_ref: externalRef,
      notes: `${opts.reason} ${opts.orderName} (no linked line items)`,
    });
  }

  return { skipped: false as const, adjusted, order: opts.orderName };
}
