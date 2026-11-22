-- =============================================================================
-- 0001_schema.sql  -  Core tables
-- Daily Stocktake & Purchase Order app (UK café / kitchen)
-- All quantities are numeric so open boxes can be recorded as decimals (0.7).
-- All money is GBP (£).
-- =============================================================================

-- ---------------------------------------------------------------- profiles ---
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text        not null default '',
  email       text        not null,
  role        text        not null default 'staff'   check (role   in ('admin', 'staff')),
  status      text        not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  created_at  timestamptz not null default now()
);
create index profiles_status_idx on public.profiles (status);

-- ------------------------------------------------------------------- zones ---
create table public.zones (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null unique,
  description text,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);

-- --------------------------------------------------------------- suppliers ---
create table public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text        not null unique,
  contact_email  text,
  contact_phone  text,
  lead_time_days integer     not null default 1 check (lead_time_days >= 0),
  notes          text,
  is_test_data   boolean     not null default false,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- products ---
create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  zone_id             uuid not null references public.zones (id)     on delete restrict,
  supplier_id         uuid          references public.suppliers (id) on delete set null,

  -- Short unique key. For generic cardboard boxes this is the code written on
  -- the box with a marker pen (CP12, TP08, CF01). Always upper-case.
  code_tag            text not null check (code_tag ~ '^[A-Z0-9]{2,8}$'),
  has_handwritten_tag boolean not null default false,

  name                text not null,
  brand               text,
  category            text not null default 'other'
                      check (category in ('coffee','dairy','syrups','packaging','kitchen','bakery','drinks','other')),
  visual_hints        text,

  -- Counting vs ordering units
  count_unit          text not null default 'unit',          -- box, bottle, unit, kg ...
  order_unit          text not null default 'case',          -- case, box, bag ...
  conversion_factor   numeric(12,3) not null default 1 check (conversion_factor > 0),
                      -- how many COUNT units are in ONE ORDER unit

  default_shelf_depth integer not null default 1 check (default_shelf_depth >= 1),
  allow_open_fraction boolean not null default true,

  -- Stock levels, all expressed in COUNT units
  min_stock           numeric(12,3) not null default 0 check (min_stock >= 0),
  target_stock        numeric(12,3) not null default 0 check (target_stock >= 0),
  safety_margin       numeric(12,3) not null default 0 check (safety_margin >= 0),
  round_up_order      boolean not null default true,

  -- Cost in GBP per ONE ORDER unit (what the supplier invoices)
  unit_cost_gbp       numeric(10,2) not null default 0 check (unit_cost_gbp >= 0),

  is_test_data        boolean not null default false,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index products_code_tag_uidx on public.products (upper(code_tag));
create index products_zone_idx     on public.products (zone_id) where active;
create index products_supplier_idx on public.products (supplier_id);

-- ------------------------------------------------------ inventory_sessions ---
create table public.inventory_sessions (
  id           uuid primary key default gen_random_uuid(),
  zone_id      uuid not null references public.zones (id)    on delete restrict,
  counted_by   uuid not null references public.profiles (id) on delete restrict,
  status       text not null default 'draft' check (status in ('draft', 'completed')),
  -- Array of storage object paths inside the private "shelf-photos" bucket.
  photo_urls   jsonb not null default '[]'::jsonb check (jsonb_typeof(photo_urls) = 'array'),
  -- Provider, model, latency, unmatched tags, image-quality issues ...
  ai_meta      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'completed') = (completed_at is not null))
);
create index inventory_sessions_zone_created_idx on public.inventory_sessions (zone_id, created_at desc);

-- ---------------------------------------------------------- inventory_items ---
create table public.inventory_items (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.inventory_sessions (id) on delete cascade,
  product_id    uuid not null references public.products (id)           on delete restrict,

  -- What the vision model reported (null = product was not seen in the photo)
  ai_closed_units          numeric(12,3) check (ai_closed_units  >= 0),
  ai_open_fraction         numeric(4,3)  check (ai_open_fraction >= 0 and ai_open_fraction <= 1),
  ai_hidden_units_estimate numeric(12,3) check (ai_hidden_units_estimate >= 0),
  ai_confidence            numeric(4,3)  check (ai_confidence >= 0 and ai_confidence <= 1),
  ai_occlusion_warning     boolean not null default false,
  ai_open_box_detected     boolean not null default false,
  ai_evidence              text,
  ai_review_reasons        text[] not null default '{}',

  -- What the human confirmed / corrected (the source of truth)
  final_closed_units       numeric(12,3) not null default 0 check (final_closed_units  >= 0),
  final_open_fraction      numeric(4,3)  not null default 0 check (final_open_fraction >= 0 and final_open_fraction <= 1),
  hidden_back_units        numeric(12,3) not null default 0 check (hidden_back_units   >= 0),
  total_counted            numeric(12,3) generated always as
                           (final_closed_units + final_open_fraction + hidden_back_units) stored,
  reviewed                 boolean not null default false,

  -- Deterministic restock suggestion, in ORDER units (see lib/restock.ts)
  suggested_order_qty      numeric(12,3) not null default 0 check (suggested_order_qty >= 0),

  created_at   timestamptz not null default now(),
  unique (session_id, product_id)
);
create index inventory_items_product_idx on public.inventory_items (product_id);

-- --------------------------------------------------------- purchase orders ---
create table public.purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  supplier_id         uuid not null references public.suppliers (id) on delete restrict,
  status              text not null default 'draft' check (status in ('draft', 'approved', 'sent')),
  created_by          uuid not null references public.profiles (id) on delete restrict,
  approved_by         uuid          references public.profiles (id) on delete set null,
  approved_at         timestamptz,
  sent_at             timestamptz,
  source_session_ids  uuid[] not null default '{}',
  total_estimated_gbp numeric(12,2) not null default 0,
  notes               text,
  created_at          timestamptz not null default now()
);
create index purchase_orders_supplier_idx on public.purchase_orders (supplier_id, created_at desc);
create index purchase_orders_status_idx   on public.purchase_orders (status);

create table public.purchase_order_items (
  id               uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  product_id       uuid not null references public.products (id) on delete restrict,
  qty_order_units  numeric(12,3) not null check (qty_order_units > 0),
  order_unit       text not null,
  unit_cost_gbp    numeric(10,2) not null default 0 check (unit_cost_gbp >= 0),
  line_total_gbp   numeric(12,2) generated always as (round(qty_order_units * unit_cost_gbp, 2)) stored,
  unique (purchase_order_id, product_id)
);

-- Status history for each PO
create table public.purchase_order_events (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  event             text not null,           -- created | approved | sent
  actor_id          uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);
create index purchase_order_events_po_idx on public.purchase_order_events (purchase_order_id, created_at);

