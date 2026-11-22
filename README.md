# Daily Stocktake & Purchase Orders (PWA)

Mobile-first stocktake + automated purchase orders for a UK café & kitchen.
Next.js (App Router) · TypeScript · Tailwind · Supabase (Postgres, Auth, Storage, RLS) · Vision AI (Gemini or OpenAI, strict structured outputs).

UI language: **UK English only**. Currency: **GBP (£)**.

## Folder structure

```
supabase/
  migrations/
    0001_schema.sql              tables
    0002_functions_triggers.sql  RLS helpers, first-user-is-admin trigger, safeguards, PO triggers, admin_reset_test_data()
    0003_rls.sql                 Row Level Security policies
    0004_storage.sql             private "shelf-photos" bucket + policies
  seed.sql                       5 zones + 9 TEST products (is_test_data = true)
src/
  middleware.ts                  session refresh + page gate (login / pending / admin)
  app/
    login, signup, pending       auth flow + "Account Pending Approval"
    page.tsx                     zone dashboard with today's stocktake status
    manifest.ts                  PWA manifest
    api/analyze-shelf/route.ts   ✅ photo -> structured AI -> draft session
    api/generate-po/             ⏳ next
    api/admin/import-csv/        ⏳ next
    api/admin/reset-test-data/   ⏳ next (calls rpc admin_reset_test_data + clears storage)
    stocktake/[zoneId]/          ⏳ next (camera, review screen)
    admin/                       ⏳ next (team, CSV import, clear test data)
    purchase-orders/             ⏳ next
  lib/
    auth.ts                      requireActiveUser / requireAdmin API guards
    numbers.ts                   "0,7" / "0.7" parsing, GBP formatting
    restock.ts                   deterministic restock maths (no AI)
    ai/schema.ts                 strict JSON Schema (code_tag = enum of the zone's codes) + zod validation
    ai/prompt.ts                 system prompt + closed-catalogue prompt
    ai/vision.ts                 Gemini / OpenAI adapters
    ai/reconcile.ts              thresholds (>=0.90 green, <0.85 / occlusion / open box -> review)
    supabase/{server,client,admin}.ts
```

## Setup

1. Create a Supabase project; run the migrations in order, then `seed.sql`
   (`supabase db reset` does all of it locally; or paste into the SQL editor).
2. `cp .env.example .env.local` and fill in Supabase + one AI provider key.
3. `npm install && npm run dev`
4. **The first account you register becomes admin + active.** Everyone after is `staff` + `pending`.
   (Tip: disable "Confirm email" in Supabase Auth while testing.)

```
npm run test        # restock maths, decimal parsing, AI reconciliation
npm run typecheck
```

## `POST /api/analyze-shelf`

`multipart/form-data`: `zone_id` (uuid), `photos` (1–4 JPEG/PNG/WebP), optional `session_id` (add photos to an existing draft).

Returns `session_id`, a `summary` (`confirmed` / `needs_review` / `unseen`) and `items[]` sorted
needs-review → confirmed → unseen, each with AI reading, prefilled `final` values, `reasons[]`
(`low_confidence`, `moderate_confidence`, `occlusion`, `open_box`, `no_code_read`, `duplicate_reading`)
and the deterministic `suggested_order_qty`.

## Key rules

- **Order maths (backend only):** `order_needed = max(0, target + safety − total_counted)`; converted to supplier order units with `conversion_factor`, rounded up when `round_up_order`.
- `products.unit_cost_gbp` is the price per **order** unit; stock levels are in **count** units.
- `inventory_sessions.photo_urls` holds storage paths in the private bucket (create signed URLs to display).
- Security: RLS is the authority (`active` for operational data, `admin` for catalogue / users / reset). `requireActiveUser` in the API is a second layer. The service-role key is used only after an admin check.

