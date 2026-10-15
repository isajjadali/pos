# Dollar World by WABz — Implementation status

## Stack

- **Frontend:** `web/` — Vue 3, Vite, JavaScript, Naive UI, Pinia, Vue Router
- **Backend:** Supabase (PostgreSQL, Auth, RLS)
- **Legacy tools:** root Node scripts (`products.csv`, PDF barcode labels)

## Database setup (pick one)

### Option A — Supabase CLI (after link)

From repo root:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

`YOUR_PROJECT_REF` = subdomain in `VITE_SUPABASE_URL`  
(e.g. `https://abcdefgh.supabase.co` → `abcdefgh`).

If you see **“Cannot find project ref”**, you have not run `supabase link` yet.

### Option B — SQL Editor (no CLI)

In Dashboard → **SQL Editor**, run each file in order:

1. `supabase/migrations/20251015120000_initial_schema.sql`
2. `supabase/migrations/20251015130000_product_vendor_rpcs.sql`
3. `supabase/migrations/20251015130100_products_low_stock_flag.sql`
4. `supabase/migrations/20251015140000_business_rpcs.sql`

## Phase status

| Phase | Status |
|-------|--------|
| 1 Foundation | Done |
| 2 Products & vendors | Done |
| 3 Inventory + CSV import | Done (UI) |
| 4 Barcode printing | Done (browser print + reconcile) |
| 5 POS + held orders | Done |
| 6 Dashboard + sales history | Done |
| 7 Deploy | `web/vercel.json` ready — set env vars on Vercel |

**Not in MVP:** image/AI receipt import (explicitly deferred).

## Local dev

```bash
cd web && cp .env.example .env   # Supabase URL + anon key
npm install && npm run dev
```

## Vercel deploy

- Root directory: `web`
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Known limitations (honest)

- Barcode print cannot detect physical print success — user confirms reconciled qty.
- CSV import duplicate “create new” on match still follows selected duplicate policy (use skip/update/add).
- POS line qty edit UI minimal — rescan adds qty; use search for new lines.
- FIFO allocation in SQL may fall back to weighted average if batches insufficient.
