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
