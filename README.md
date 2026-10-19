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
