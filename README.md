# Discount World by WABz (POS)

Vue 3 + Vite frontend with Supabase backend. App lives at the **repository root** (not a `web/` subfolder).

## Setup

1. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. Apply Supabase migrations (`supabase db push` or your usual flow).
3. From the repo root:

```bash
npm install
npm run dev
```

- `npm run build` — production build to `dist/`
- `npm run preview` — preview build (includes Zebra bridge like dev)

See `IMPLEMENTATION.md` for feature status.

## Shopify Hub Lite (optional)

**Feature flag (default OFF):** set `VITE_FEATURE_SHOPIFY=true` in `.env` and restart Vite to show Shopify UI / sync. Code stays in the repo while the flag is off.

Selective hub — **not** a full Shopify Admin clone.

| In this POS | Stays in Shopify Admin |
|-------------|------------------------|
| Stock + barcode sync | Fulfill / cancel / refund |
| View orders + in-app bell | Shipping labels |
| Shopify online price (separate from POS unit prices) | Theme / collections |
| Product images → Shopify CDN only | |

**POS sell prices are never overwritten by Shopify.** Matching key is always **barcode**.

### 1. Create a Shopify app (Dev Dashboard is fine)

1. Create/install the app on your shop with Admin API scopes:
   - `read_products`, `write_products`
   - `read_inventory`, `write_inventory`
   - `read_locations`
   - `read_orders` (orders list + `orders/create` webhook)
   - `write_files` (staged image uploads)
2. After changing scopes, **uninstall then reinstall** the app on the shop (required — otherwise you get `Access denied for orders field`).
3. In Dev Dashboard → your app → **Settings**, copy:
   - **Client ID**
   - **Client secret** (Reveal)
4. Shop domain looks like `your-store.myshopify.com`.
5. Do **not** use “Open app” in Admin — that UI is unused; sync runs from this POS via API.

You do **not** need an `shpat_...` token if you have Client ID + Secret.

### 2. Edge Function secrets

```bash
# Preferred (Dev Dashboard Client ID + Secret):
npx supabase secrets set SHOPIFY_CLIENT_ID="your_client_id"
npx supabase secrets set SHOPIFY_CLIENT_SECRET="your_client_secret"
npx supabase secrets set SHOPIFY_WEBHOOK_SECRET="your_client_secret"   # same secret often works for HMAC

# Optional legacy: static Admin API token instead of Client ID/Secret
# npx supabase secrets set SHOPIFY_ADMIN_TOKEN="shpat_..."

npx supabase functions deploy shopify-sync
npx supabase functions deploy shopify-webhooks
```

### 3. First sync in the app

1. **Settings → Shopify sync**: enter shop domain → **Test connection** → pick location → enable sync → **Save**.
2. **Push all** to create/update Shopify products by barcode and set stock.
3. **Register webhooks** (inventory + products + **orders/create** for the bell + **orders/cancelled** & **orders/delete** to restock POS when an online order is voided).
4. **Shopify Orders** page: view recent orders (fulfill in Admin).
5. Product edit: set **Shopify online price** (does not change piece/pack/box POS prices).
6. **Products → Shopify images**: multi-select files named by barcode (`890123.jpg`) — uploads go to Shopify only (nothing stored on POS).

Pack/box sales deduct **pieces** locally and the same piece delta is sent to Shopify when sync is enabled.

### Desktop / system notifications

1. In the app: **Settings → Enable desktop notifications** → Allow in the browser prompt.  
   You get an **OS toast** even when another tab is focused (POS tab can stay open in the background).
2. Optional — notify when the **browser is fully closed** (Web Push, free):

```bash
npx web-push generate-vapid-keys
npx supabase secrets set SHOPIFY_VAPID_PUBLIC_KEY="BNxxxx..."
npx supabase secrets set SHOPIFY_VAPID_PRIVATE_KEY="xxxxx"
# optional: npx supabase secrets set SHOPIFY_VAPID_SUBJECT="mailto:you@example.com"
npx supabase functions deploy shopify-webhooks --no-verify-jwt
npx supabase functions deploy shopify-sync --no-verify-jwt
```

Then click **Enable desktop notifications** again (registers this browser for push).

HTTPS (or localhost) is required for notifications.
