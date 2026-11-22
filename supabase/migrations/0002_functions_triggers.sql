-- =============================================================================
-- 0002_functions_triggers.sql
-- Access helpers, first-user-is-admin trigger, safeguards, PO bookkeeping,
-- and the admin-only "Reset Test Data" function.
-- =============================================================================

-- ------------------------------------------------------------ RLS helpers ---
-- SECURITY DEFINER so policies on public.profiles can call them without recursion.
create or replace function public.current_user_is_active()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
  );
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role = 'admin'
  );
$$;

-- --------------------------------------------------------- updated_at stamp ---
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ------------------------------------------- new auth user  ->  profile row ---
-- * Everybody starts as staff / pending ...
-- * ... except the very first account in the system: admin / active.
-- Role and status are NEVER read from user-supplied metadata (only full_name is).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  -- Serialise concurrent sign-ups so two "first" users cannot both become admin.
  perform pg_advisory_xact_lock(hashtext('public.profiles.first_user'));

  select not exists (select 1 from public.profiles) into is_first;

  insert into public.profiles (id, full_name, email, role, status)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    case when is_first then 'admin'  else 'staff'   end,
    case when is_first then 'active' else 'pending' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------- profile update safeguards ---
-- * id / email are immutable through the API.
-- * The last active admin can never be demoted or suspended (no lock-out).
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.id <> old.id then
    raise exception 'profiles.id is immutable';
  end if;

  if new.email is distinct from old.email and auth.uid() is not null then
    raise exception 'profiles.email cannot be changed here';
  end if;

  if old.role = 'admin' and old.status = 'active'
     and (new.role <> 'admin' or new.status <> 'active')
     and not exists (
       select 1 from public.profiles p
       where p.id <> old.id and p.role = 'admin' and p.status = 'active'
     )
  then
    raise exception 'You cannot demote or suspend the last active admin';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- -------------------------------------------------- purchase order bookkeeping
create or replace function public.refresh_po_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  po_id uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders po
     set total_estimated_gbp = coalesce(
           (select sum(i.line_total_gbp) from public.purchase_order_items i where i.purchase_order_id = po_id), 0)
   where po.id = po_id;
  return null;
end;
$$;

create trigger purchase_order_items_total
  after insert or update or delete on public.purchase_order_items
  for each row execute function public.refresh_po_total();

create or replace function public.log_po_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.purchase_order_events (purchase_order_id, event, actor_id)
    values (new.id, 'created', new.created_by);
  elsif new.status is distinct from old.status then
    insert into public.purchase_order_events (purchase_order_id, event, actor_id)
    values (new.id, new.status, auth.uid());
    if new.status = 'approved' then
      new.approved_by := coalesce(new.approved_by, auth.uid());
      new.approved_at := coalesce(new.approved_at, now());
    elsif new.status = 'sent' then
      new.sent_at := coalesce(new.sent_at, now());
    end if;
  end if;
  return new;
end;
$$;

-- BEFORE UPDATE so approved_by / approved_at / sent_at can be stamped on the row;
-- AFTER INSERT for the "created" event (FK needs the row to exist).
create trigger purchase_orders_event_insert
  after insert on public.purchase_orders
  for each row execute function public.log_po_event();

create trigger purchase_orders_event_update
  before update on public.purchase_orders
  for each row execute function public.log_po_event();

-- ---------------------------------------------------- session / PO edit gates
create or replace function public.can_edit_session(sid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_is_active() and exists (
    select 1 from public.inventory_sessions s
    where s.id = sid
      and s.status = 'draft'
      and (s.counted_by = auth.uid() or public.current_user_is_admin())
  );
$$;

create or replace function public.po_is_draft(pid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_is_active() and exists (
    select 1 from public.purchase_orders po where po.id = pid and po.status = 'draft'
  );
$$;

-- ------------------------------------------------- admin: reset test data ---
-- Wipes ALL operational history (counts, sessions, POs) and every row flagged
-- is_test_data (products + suppliers). Zones and real data are kept.
-- Callable only by an active admin (checked against the caller's JWT).
-- NB: "where true" keeps pg_safeupdate-style guards happy.
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
  delete from public.purchase_orders where true;           -- cascades to events
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

revoke all on function public.admin_reset_test_data() from public, anon;
grant execute on function public.admin_reset_test_data() to authenticated;

