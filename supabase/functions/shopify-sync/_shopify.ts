/** Shared Shopify Admin GraphQL helpers for Edge Functions. */

export type ShopifyConfig = {
  shopDomain: string;
  adminToken: string;
  locationId: string;
  apiVersion?: string;
};

export function normalizeShopDomain(raw: string): string {
  let d = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (d && !d.includes(".")) d = `${d}.myshopify.com`;
  return d;
}

export function toLocationGid(id: string): string {
  const s = String(id || "").trim();
  if (!s) return "";
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/Location/${s}`;
}

export function toNumericId(gidOrId: string): string {
  const s = String(gidOrId || "").trim();
  const m = s.match(/\/(\d+)\s*$/);
  return m ? m[1] : s;
}

/**
 * Admin token: either static SHOPIFY_ADMIN_TOKEN (shpat_...),
 * or Dev Dashboard Client ID + Secret via client_credentials grant.
 */
export async function resolveAdminToken(shopDomain: string): Promise<string> {
  const staticToken = Deno.env.get("SHOPIFY_ADMIN_TOKEN")?.trim();
  if (staticToken) return staticToken;

  const clientId = Deno.env.get("SHOPIFY_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET")?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Set Edge secrets: SHOPIFY_ADMIN_TOKEN (shpat_...), OR SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET from Dev Dashboard → Settings"
    );
  }

  const domain = normalizeShopDomain(shopDomain);
  if (!domain) throw new Error("Shop domain required to exchange Client ID/Secret for a token");

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description ||
        json.error ||
        `Shopify token exchange failed (HTTP ${res.status}). App must be installed on this shop with Admin API scopes.`
    );
  }
  return String(json.access_token);
}

export async function shopifyGraphql<T = unknown>(
  cfg: ShopifyConfig,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const domain = normalizeShopDomain(cfg.shopDomain);
  const version = cfg.apiVersion || "2025-01";
  const url = `https://${domain}/admin/api/${version}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": cfg.adminToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.errors?.[0]?.message || `Shopify HTTP ${res.status}`);
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  return json.data as T;
}

export async function listLocations(cfg: ShopifyConfig) {
  const data = await shopifyGraphql<{
    locations: { edges: Array<{ node: { id: string; name: string; isActive: boolean } }> };
  }>(
    cfg,
    `query {
      locations(first: 25) {
        edges { node { id name isActive } }
      }
    }`
  );
  return (data.locations?.edges ?? [])
    .map((e) => e.node)
    .filter((n) => n.isActive !== false);
}

export async function findVariantByBarcode(cfg: ShopifyConfig, barcode: string) {
  const q = String(barcode || "").trim().replace(/"/g, "");
  if (!q) return null;
  const data = await shopifyGraphql<{
    productVariants: {
      edges: Array<{
        node: {
          id: string;
          barcode: string | null;
          title: string;
          inventoryQuantity: number | null;
          inventoryItem: { id: string } | null;
          product: { id: string; title: string };
        };
      }>;
    };
  }>(
    cfg,
    `query ($q: String!) {
      productVariants(first: 5, query: $q) {
        edges {
          node {
            id
            barcode
            title
            inventoryQuantity
            inventoryItem { id }
            product { id title }
          }
        }
      }
    }`,
    { q: `barcode:${q}` }
  );
  const edges = data.productVariants?.edges ?? [];
  const exact =
    edges.find((e) => String(e.node.barcode || "").trim() === q) ?? edges[0];
  return exact?.node ?? null;
}

export async function createProductWithBarcode(
  cfg: ShopifyConfig,
  opts: { title: string; barcode: string; stock: number }
) {
  const locationId = toLocationGid(cfg.locationId);
  const stock = Math.max(0, Math.floor(Number(opts.stock) || 0));
  const barcode = String(opts.barcode || "").trim();

  // Modern Admin API: ProductInput no longer accepts variants — use productSet.
  const variantInput: Record<string, unknown> = {
    optionValues: [{ optionName: "Title", name: "Default Title" }],
    sku: barcode,
    barcode,
    inventoryPolicy: "DENY",
    inventoryItem: { tracked: true, sku: barcode },
  };
  if (locationId) {
    variantInput.inventoryQuantities = [
      {
        locationId,
        name: "available",
        quantity: stock,
      },
    ];
  }

  const data = await shopifyGraphql<{
    productSet: {
      product: {
        id: string;
        variants: {
          edges: Array<{
            node: { id: string; barcode: string | null; inventoryItem: { id: string } | null };
          }>;
        };
      } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(
    cfg,
    `mutation ($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product {
          id
          variants(first: 1) {
            edges {
              node {
                id
                barcode
                inventoryItem { id }
              }
            }
          }
        }
        userErrors { field message }
      }
    }`,
    {
      input: {
        title: opts.title || barcode,
        status: "ACTIVE",
        productOptions: [
          {
            name: "Title",
            values: [{ name: "Default Title" }],
          },
        ],
        variants: [variantInput],
      },
    }
  );
  const errs = data.productSet?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
  const product = data.productSet?.product;
  const variant = product?.variants?.edges?.[0]?.node;
  if (!product?.id || !variant?.id) {
    throw new Error("Shopify productSet returned incomplete product/variant");
  }
  let inventoryItemId = variant.inventoryItem?.id ?? null;
  if (!inventoryItemId) {
    // Fallback: refetch inventory item id
    const again = await findVariantByBarcode(cfg, barcode);
    inventoryItemId = again?.inventoryItem?.id ?? null;
  }
  if (!inventoryItemId) {
    throw new Error("Shopify productSet did not return inventoryItem id");
  }
  // Ensure stock is set (in case inventoryQuantities was ignored)
  if (locationId) {
    await setInventoryAvailable(cfg, inventoryItemId, stock);
  }
  return {
    productId: product.id,
    variantId: variant.id,
    inventoryItemId,
  };
}

export async function updateVariantBarcodeAndTitle(
  cfg: ShopifyConfig,
  opts: { productId: string; variantId: string; title: string; barcode: string }
) {
  const data = await shopifyGraphql<{
    productSet: { userErrors: Array<{ message: string }> };
  }>(
    cfg,
    `mutation ($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        userErrors { message }
      }
    }`,
    {
      input: {
        id: opts.productId,
        title: opts.title,
        productOptions: [
          {
            name: "Title",
            values: [{ name: "Default Title" }],
          },
        ],
        variants: [
          {
            id: opts.variantId,
            optionValues: [{ optionName: "Title", name: "Default Title" }],
            sku: opts.barcode,
            barcode: opts.barcode,
          },
        ],
      },
    }
  );
  if (data.productSet?.userErrors?.length) {
    throw new Error(data.productSet.userErrors.map((e) => e.message).join("; "));
  }
}

export async function setInventoryAvailable(
  cfg: ShopifyConfig,
  inventoryItemId: string,
  available: number
) {
  const locationId = toLocationGid(cfg.locationId);
  if (!locationId) throw new Error("Shopify location id is not configured");
  const qty = Math.max(0, Math.floor(Number(available) || 0));
  const data = await shopifyGraphql<{
    inventorySetQuantities: {
      userErrors: Array<{ message: string }>;
    };
  }>(
    cfg,
    `mutation ($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        userErrors { message }
      }
    }`,
    {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: true,
        quantities: [
          {
            inventoryItemId,
            locationId,
            quantity: qty,
          },
        ],
      },
    }
  );
  const errs = data.inventorySetQuantities?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
}

export async function adjustInventoryAvailable(
  cfg: ShopifyConfig,
  inventoryItemId: string,
  delta: number
) {
  const locationId = toLocationGid(cfg.locationId);
  if (!locationId) throw new Error("Shopify location id is not configured");
  const d = Math.floor(Number(delta) || 0);
  if (d === 0) return;
  const data = await shopifyGraphql<{
    inventoryAdjustQuantities: {
      userErrors: Array<{ message: string }>;
    };
  }>(
    cfg,
    `mutation ($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        userErrors { message }
      }
    }`,
    {
      input: {
        reason: "correction",
        name: "available",
        changes: [
          {
            inventoryItemId,
            locationId,
            delta: d,
          },
        ],
      },
    }
  );
  const errs = data.inventoryAdjustQuantities?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
}

export async function getInventoryAvailableAtLocation(
  cfg: ShopifyConfig,
  inventoryItemId: string
): Promise<number | null> {
  const locationId = toLocationGid(cfg.locationId);
  const data = await shopifyGraphql<{
    inventoryItem: {
      inventoryLevel: { quantities: Array<{ name: string; quantity: number }> } | null;
    } | null;
  }>(
    cfg,
    `query ($id: ID!, $locationId: ID!) {
      inventoryItem(id: $id) {
        inventoryLevel(locationId: $locationId) {
          quantities(names: ["available"]) { name quantity }
        }
      }
    }`,
    { id: inventoryItemId, locationId }
  );
  const q = data.inventoryItem?.inventoryLevel?.quantities?.find((x) => x.name === "available");
  return q ? Math.floor(Number(q.quantity) || 0) : null;
}

export type ShopifyOrderSummary = {
  id: string;
  name: string;
  createdAt: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  total: string | null;
  currency: string | null;
  customerName: string | null;
  lineItemCount: number;
};

export async function listOrders(
  cfg: ShopifyConfig,
  opts: { first?: number; query?: string } = {}
): Promise<ShopifyOrderSummary[]> {
  const first = Math.min(50, Math.max(1, Math.floor(Number(opts.first) || 25)));
  const search = String(opts.query || "").trim();
  const data = await shopifyGraphql<{
    orders: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          createdAt: string;
          displayFinancialStatus: string | null;
          displayFulfillmentStatus: string | null;
          totalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
          customer: { displayName: string | null } | null;
          lineItems: { edges: unknown[] };
        };
      }>;
    };
  }>(
    cfg,
    search
      ? `query ($first: Int!, $query: String!) {
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            customer { displayName }
            lineItems(first: 1) { edges { node { id } } }
          }
        }
      }
    }`
      : `query ($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            customer { displayName }
            lineItems(first: 1) { edges { node { id } } }
          }
        }
      }
    }`,
    search ? { first, query: search } : { first }
  );
  return (data.orders?.edges ?? []).map((e) => {
    const n = e.node;
    return {
      id: n.id,
      name: n.name,
      createdAt: n.createdAt,
      financialStatus: n.displayFinancialStatus,
      fulfillmentStatus: n.displayFulfillmentStatus,
      total: n.totalPriceSet?.shopMoney?.amount ?? null,
      currency: n.totalPriceSet?.shopMoney?.currencyCode ?? null,
      customerName: n.customer?.displayName ?? null,
      lineItemCount: n.lineItems?.edges?.length ?? 0,
    };
  });
}

export async function getOrder(cfg: ShopifyConfig, orderId: string) {
  const id = String(orderId || "").trim();
  if (!id) throw new Error("order id required");
  const data = await shopifyGraphql<{
    order: {
      id: string;
      name: string;
      createdAt: string;
      displayFinancialStatus: string | null;
      displayFulfillmentStatus: string | null;
      email: string | null;
      phone: string | null;
      note: string | null;
      totalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
      subtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
      totalShippingPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
      customer: { displayName: string | null; email: string | null } | null;
      shippingAddress: {
        name: string | null;
        address1: string | null;
        address2: string | null;
        city: string | null;
        province: string | null;
        zip: string | null;
        phone: string | null;
      } | null;
      lineItems: {
        edges: Array<{
          node: {
            title: string;
            quantity: number;
            sku: string | null;
            variantTitle: string | null;
            variant: { id: string; barcode: string | null } | null;
            originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
          };
        }>;
      };
    } | null;
  }>(
    cfg,
    `query ($id: ID!) {
      order(id: $id) {
        id
        name
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        email
        phone
        note
        totalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        customer { displayName email }
        shippingAddress { name address1 address2 city province zip phone }
        lineItems(first: 100) {
          edges {
            node {
              title
              quantity
              sku
              variantTitle
              variant { id barcode }
              originalUnitPriceSet { shopMoney { amount currencyCode } }
            }
          }
        }
      }
    }`,
    { id }
  );
  if (!data.order) throw new Error("Order not found");
  const o = data.order;
  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    financialStatus: o.displayFinancialStatus,
    fulfillmentStatus: o.displayFulfillmentStatus,
    email: o.email,
    phone: o.phone,
    note: o.note,
    total: o.totalPriceSet?.shopMoney?.amount ?? null,
    currency: o.totalPriceSet?.shopMoney?.currencyCode ?? null,
    subtotal: o.subtotalPriceSet?.shopMoney?.amount ?? null,
    shipping: o.totalShippingPriceSet?.shopMoney?.amount ?? null,
    customerName: o.customer?.displayName ?? null,
    customerEmail: o.customer?.email ?? null,
    shippingAddress: o.shippingAddress,
    lineItems: (o.lineItems?.edges ?? []).map((e) => ({
      title: e.node.title,
      quantity: e.node.quantity,
      sku: e.node.sku,
      variantTitle: e.node.variantTitle,
      variantId: e.node.variant?.id ?? null,
      barcode: e.node.variant?.barcode ?? null,
      unitPrice: e.node.originalUnitPriceSet?.shopMoney?.amount ?? null,
    })),
  };
}

/** Recent orders with line items — used by poll sync when webhooks don't arrive. */
export async function listRecentOrdersWithLines(cfg: ShopifyConfig, first = 15) {
  const n = Math.min(25, Math.max(1, Math.floor(first)));
  const data = await shopifyGraphql<{
    orders: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          createdAt: string;
          cancelledAt: string | null;
          displayFinancialStatus: string | null;
          displayFulfillmentStatus: string | null;
          totalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
          customer: { displayName: string | null } | null;
          lineItems: {
            edges: Array<{
              node: {
                quantity: number;
                sku: string | null;
                variant: { id: string; barcode: string | null } | null;
              };
            }>;
          };
        };
      }>;
    };
  }>(
    cfg,
    `query ($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            cancelledAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            customer { displayName }
            lineItems(first: 50) {
              edges {
                node {
                  quantity
                  sku
                  variant { id barcode }
                }
              }
            }
          }
        }
      }
    }`,
    { first: n }
  );

  return (data.orders?.edges ?? []).map((e) => {
    const o = e.node;
    return {
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      cancelledAt: o.cancelledAt,
      financialStatus: o.displayFinancialStatus,
      fulfillmentStatus: o.displayFulfillmentStatus,
      total: o.totalPriceSet?.shopMoney?.amount ?? null,
      currency: o.totalPriceSet?.shopMoney?.currencyCode ?? null,
      customerName: o.customer?.displayName ?? null,
      lineItems: (o.lineItems?.edges ?? []).map((li) => ({
        quantity: li.node.quantity,
        sku: li.node.sku,
        variant_id: li.node.variant?.id ?? null,
        barcode: li.node.variant?.barcode ?? null,
      })),
    };
  });
}

export async function setVariantPrice(
  cfg: ShopifyConfig,
  opts: { productId: string; variantId: string; price: number }
) {
  const price = Number(opts.price);
  if (!Number.isFinite(price) || price < 0) throw new Error("Invalid price");
  const data = await shopifyGraphql<{
    productVariantsBulkUpdate: {
      productVariants: Array<{ id: string; price: string }> | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    cfg,
    `mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price }
        userErrors { message }
      }
    }`,
    {
      productId: opts.productId,
      variants: [{ id: opts.variantId, price: String(price) }],
    }
  );
  const errs = data.productVariantsBulkUpdate?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
  const updated = data.productVariantsBulkUpdate?.productVariants?.[0];
  return { variantId: updated?.id ?? opts.variantId, price: updated?.price ?? String(price) };
}

export async function getVariantPrice(cfg: ShopifyConfig, variantId: string): Promise<number | null> {
  const data = await shopifyGraphql<{
    productVariant: { price: string } | null;
  }>(
    cfg,
    `query ($id: ID!) {
      productVariant(id: $id) { price }
    }`,
    { id: variantId }
  );
  const p = data.productVariant?.price;
  if (p == null) return null;
  const n = Number(p);
  return Number.isFinite(n) ? n : null;
}

export async function createStagedUpload(
  cfg: ShopifyConfig,
  opts: { filename: string; mimeType: string; fileSize: number }
) {
  const data = await shopifyGraphql<{
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }> | null;
      userErrors: Array<{ message: string; field: string[] }>;
    };
  }>(
    cfg,
    `mutation ($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }`,
    {
      input: [
        {
          filename: opts.filename,
          mimeType: opts.mimeType,
          httpMethod: "POST",
          resource: "PRODUCT_IMAGE",
          fileSize: String(Math.max(1, Math.floor(opts.fileSize))),
        },
      ],
    }
  );
  const errs = data.stagedUploadsCreate?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
  const target = data.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) throw new Error("Shopify staged upload target missing");
  return target;
}

export async function attachProductMedia(
  cfg: ShopifyConfig,
  opts: { productId: string; resourceUrl: string; alt?: string }
) {
  const data = await shopifyGraphql<{
    productCreateMedia: {
      media: Array<{ id: string; status: string }> | null;
      mediaUserErrors: Array<{ message: string }>;
    };
  }>(
    cfg,
    `mutation ($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { ... on MediaImage { id status } }
        mediaUserErrors { message }
      }
    }`,
    {
      productId: opts.productId,
      media: [
        {
          originalSource: opts.resourceUrl,
          mediaContentType: "IMAGE",
          alt: opts.alt || null,
        },
      ],
    }
  );
  const errs = data.productCreateMedia?.mediaUserErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
  return data.productCreateMedia?.media?.[0] ?? null;
}
