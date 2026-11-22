-- =============================================================================
-- 0003_rls.sql  -  Row Level Security
--   * status = 'active'  -> may read/write operational data
--   * role   = 'admin'   -> may manage users, catalogue, reset & import
--   * pending / suspended users can only read THEIR OWN profile row
-- =============================================================================

alter table public.profiles              enable row level security;
alter table public.zones                 enable row level security;
alter table public.suppliers             enable row level security;
alter table public.products              enable row level security;
alter table public.inventory_sessions    enable row level security;
alter table public.inventory_items       enable row level security;
alter table public.purchase_orders       enable row level security;
alter table public.purchase_order_items  enable row level security;
alter table public.purchase_order_events enable row level security;

-- Anonymous visitors get nothing, ever.
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;

-- ---------------------------------------------------------------- profiles ---
-- (No INSERT/DELETE policy: rows are created by the auth trigger only.)
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.current_user_is_admin());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ---------------------------------------------- catalogue (admin writes) ---
create policy zones_select on public.zones
  for select to authenticated using (public.current_user_is_active());
create policy zones_admin_write on public.zones
  for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy suppliers_select on public.suppliers
  for select to authenticated using (public.current_user_is_active());
create policy suppliers_admin_write on public.suppliers
  for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy products_select on public.products
  for select to authenticated using (public.current_user_is_active());
create policy products_admin_write on public.products
  for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- ------------------------------------------------------ stocktake sessions ---
create policy sessions_select on public.inventory_sessions
  for select to authenticated using (public.current_user_is_active());

create policy sessions_insert on public.inventory_sessions
  for insert to authenticated
  with check (public.current_user_is_active() and counted_by = auth.uid());

create policy sessions_update on public.inventory_sessions
  for update to authenticated
  using (public.current_user_is_active()
         and (counted_by = auth.uid() or public.current_user_is_admin()))
  with check (public.current_user_is_active()
         and (counted_by = auth.uid() or public.current_user_is_admin()));

create policy sessions_delete_admin on public.inventory_sessions
  for delete to authenticated using (public.current_user_is_admin());

-- Items can only change while the parent session is a draft (admins may also fix drafts).
create policy items_select on public.inventory_items
  for select to authenticated using (public.current_user_is_active());

create policy items_insert on public.inventory_items
  for insert to authenticated with check (public.can_edit_session(session_id));

create policy items_update on public.inventory_items
  for update to authenticated
  using (public.can_edit_session(session_id))
  with check (public.can_edit_session(session_id));

create policy items_delete on public.inventory_items
  for delete to authenticated using (public.can_edit_session(session_id));

-- --------------------------------------------------------- purchase orders ---
create policy po_select on public.purchase_orders
  for select to authenticated using (public.current_user_is_active());

create policy po_insert on public.purchase_orders
  for insert to authenticated
  with check (public.current_user_is_active() and created_by = auth.uid() and status = 'draft');

-- Any active team member can approve / mark as sent (1-click flow).
create policy po_update on public.purchase_orders
  for update to authenticated
  using (public.current_user_is_active())
  with check (public.current_user_is_active());

create policy po_delete_draft on public.purchase_orders
  for delete to authenticated
  using (public.current_user_is_active() and status = 'draft');

create policy po_items_select on public.purchase_order_items
  for select to authenticated using (public.current_user_is_active());

create policy po_items_write on public.purchase_order_items
  for all to authenticated
  using (public.po_is_draft(purchase_order_id))
  with check (public.po_is_draft(purchase_order_id));

create policy po_events_select on public.purchase_order_events
  for select to authenticated using (public.current_user_is_active());

