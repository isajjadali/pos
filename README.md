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

## Shopify sync (optional)

Syncs **name, barcode, and stock (pieces)** by barcode. **Prices are never synced** either way. Online orders stay on Shopify only.

### 1. Create a Shopify app (Dev Dashboard is fine)

1. Create/install the app on your shop with Admin API scopes:
   - `read_products`, `write_products`
   - `read_inventory`, `write_inventory`
   - `read_locations`
2. In Dev Dashboard → your app → **Settings**, copy:
   - **Client ID**
   - **Client secret** (Reveal)
3. Shop domain looks like `your-store.myshopify.com`.
4. Do **not** use “Open app” in Admin — that UI is unused; sync runs from this POS via API.

You do **not** need an `shpat_...` token if you have Client ID + Secret (recommended for current Shopify).

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
3. **Register webhooks** so Shopify inventory changes update local stock (and POS sales push adjusts when sync is enabled).
4. Products with a barcode can also use the row **Shopify** button.

Matching key is always **barcode**. Pack/box sales deduct **pieces** locally and the same piece delta is sent to Shopify.
