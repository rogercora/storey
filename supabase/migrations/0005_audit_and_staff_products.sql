-- =============================================================================
-- 0005_audit_and_staff_products.sql
--   1. Allow ALL active users (staff + admin) to add/edit products & add suppliers
--      and collaborate on draft stocktakes.
--   2. Track who created/updated products & counts, and record an activity_log
--      audit trail (who did what and when).
-- =============================================================================

-- ------------------------------------------ audit columns on existing tables -
alter table public.products
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null;

alter table public.inventory_items
  add column if not exists updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- Automatically stamp created_by / updated_by from the authenticated JWT.
create or replace function public.stamp_actor_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if tg_table_name = 'products' then
      new.created_by := coalesce(new.created_by, auth.uid());
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;

drop trigger if exists products_stamp_actor on public.products;
create trigger products_stamp_actor
  before insert or update on public.products
  for each row execute function public.stamp_actor_columns();

drop trigger if exists inventory_items_stamp_actor on public.inventory_items;
create trigger inventory_items_stamp_actor
  before insert or update on public.inventory_items
  for each row execute function public.stamp_actor_columns();

-- ------------------------------------------------------------ activity_log ---
create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,  -- product_created | product_updated | stocktake_started | stocktake_completed | po_created | po_approved | po_sent | csv_imported | test_data_reset | user_updated
  entity_type text not null,  -- product | session | purchase_order | profile | system
  entity_id   uuid,
  summary     text not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists activity_log_created_idx on public.activity_log (created_at desc);

alter table public.activity_log enable row level security;

drop policy if exists activity_log_select on public.activity_log;
create policy activity_log_select on public.activity_log
  for select to authenticated using (public.current_user_is_active());

drop policy if exists activity_log_insert on public.activity_log;
create policy activity_log_insert on public.activity_log
  for insert to authenticated
  with check (public.current_user_is_active() and (actor_id is null or actor_id = auth.uid()));

-- ------------------------------------- allow active staff to add/edit items --
drop policy if exists suppliers_admin_write on public.suppliers;
drop policy if exists suppliers_active_insert on public.suppliers;
drop policy if exists suppliers_admin_update on public.suppliers;
drop policy if exists suppliers_admin_delete on public.suppliers;

create policy suppliers_active_insert on public.suppliers
  for insert to authenticated with check (public.current_user_is_active());
create policy suppliers_admin_update on public.suppliers
  for update to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy suppliers_admin_delete on public.suppliers
  for delete to authenticated using (public.current_user_is_admin());

drop policy if exists products_admin_write on public.products;
drop policy if exists products_active_insert on public.products;
drop policy if exists products_active_update on public.products;
drop policy if exists products_admin_delete on public.products;

create policy products_active_insert on public.products
  for insert to authenticated with check (public.current_user_is_active());
create policy products_active_update on public.products
  for update to authenticated using (public.current_user_is_active()) with check (public.current_user_is_active());
create policy products_admin_delete on public.products
  for delete to authenticated using (public.current_user_is_admin());

-- Allow any active team member to collaborate on an open draft session (and record updated_by).
create or replace function public.can_edit_session(sid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_is_active() and exists (
    select 1 from public.inventory_sessions s
    where s.id = sid and s.status = 'draft'
  );
$$;

drop policy if exists sessions_update on public.inventory_sessions;
create policy sessions_update on public.inventory_sessions
  for update to authenticated
  using (public.current_user_is_active())
  with check (public.current_user_is_active());

-- Include activity_log in admin_reset_test_data() so test logs are wiped on go-live.
create or replace function public.admin_reset_test_data()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n_po_items int; n_pos int; n_items int; n_sessions int; n_products int; n_suppliers int;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only an active admin can reset test data' using errcode = '42501';
  end if;

  delete from public.purchase_order_items where true;
  get diagnostics n_po_items = row_count;
  delete from public.purchase_orders where true;
  get diagnostics n_pos = row_count;
  delete from public.inventory_items where true;
  get diagnostics n_items = row_count;
  delete from public.inventory_sessions where true;
  get diagnostics n_sessions = row_count;
  delete from public.products where is_test_data;
  get diagnostics n_products = row_count;
  delete from public.suppliers s
   where s.is_test_data
     and not exists (select 1 from public.products p where p.supplier_id = s.id);
  get diagnostics n_suppliers = row_count;
  delete from public.activity_log where true;

  return jsonb_build_object(
    'purchase_order_items', n_po_items,
    'purchase_orders',      n_pos,
    'inventory_items',      n_items,
    'inventory_sessions',   n_sessions,
    'test_products',        n_products,
    'test_suppliers',       n_suppliers
  );
end;
$$;

