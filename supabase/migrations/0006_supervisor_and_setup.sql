-- =============================================================================
-- 0006_supervisor_and_setup.sql
--   1. Add 'supervisor' role: can manage Zones, Categories, Suppliers & Products
--      but has NO access to /admin (users, CSV import, reset test data).
--   2. Dynamic public.categories table (replaces hardcoded CHECK on products.category).
--   3. Audit columns (created_by, updated_by, updated_at) on zones, categories, suppliers.
-- =============================================================================

-- ------------------------------------------ 1. Role: admin | supervisor | staff
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'supervisor', 'staff'));

create or replace function public.current_user_is_supervisor_or_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role in ('admin', 'supervisor')
  );
$$;

-- Make actor stamper handle created_by on all setup tables too.
create or replace function public.stamp_actor_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if tg_table_name in ('products', 'zones', 'categories', 'suppliers') then
      new.created_by := coalesce(new.created_by, auth.uid());
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;

-- ------------------------------------------ 2. Dynamic categories table ------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9_]{2,32}$'),
  name       text not null unique,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

drop trigger if exists categories_stamp_actor on public.categories;
create trigger categories_stamp_actor
  before insert or update on public.categories
  for each row execute function public.stamp_actor_columns();

insert into public.categories (slug, name, sort_order) values
  ('coffee',    'Coffee',    10),
  ('dairy',     'Dairy',     20),
  ('syrups',    'Syrups',    30),
  ('packaging', 'Packaging', 40),
  ('kitchen',   'Kitchen',   50),
  ('bakery',    'Bakery',    60),
  ('drinks',    'Drinks',    70),
  ('other',     'Other',     80)
on conflict (slug) do nothing;

-- Replace hardcoded CHECK constraint with FK to categories(slug)
alter table public.products drop constraint if exists products_category_check;
alter table public.products drop constraint if exists products_category_fkey;
alter table public.products
  add constraint products_category_fkey
  foreign key (category) references public.categories (slug)
  on update cascade on delete restrict;

-- ------------------------------------------ 3. Audit columns on zones & suppliers
alter table public.zones
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists zones_set_updated_at on public.zones;
create trigger zones_set_updated_at
  before update on public.zones
  for each row execute function public.set_updated_at();

drop trigger if exists zones_stamp_actor on public.zones;
create trigger zones_stamp_actor
  before insert or update on public.zones
  for each row execute function public.stamp_actor_columns();

alter table public.suppliers
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

drop trigger if exists suppliers_stamp_actor on public.suppliers;
create trigger suppliers_stamp_actor
  before insert or update on public.suppliers
  for each row execute function public.stamp_actor_columns();

-- ------------------------------------------ 4. RLS for categories, zones, suppliers
alter table public.categories enable row level security;

drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories
  for select to authenticated using (public.current_user_is_active());

drop policy if exists categories_supervisor_write on public.categories;
create policy categories_supervisor_write on public.categories
  for all to authenticated
  using (public.current_user_is_supervisor_or_admin())
  with check (public.current_user_is_supervisor_or_admin());

drop policy if exists zones_admin_write on public.zones;
drop policy if exists zones_supervisor_write on public.zones;
create policy zones_supervisor_write on public.zones
  for all to authenticated
  using (public.current_user_is_supervisor_or_admin())
  with check (public.current_user_is_supervisor_or_admin());

drop policy if exists suppliers_admin_update on public.suppliers;
drop policy if exists suppliers_admin_delete on public.suppliers;
drop policy if exists suppliers_supervisor_update on public.suppliers;
drop policy if exists suppliers_supervisor_delete on public.suppliers;

create policy suppliers_supervisor_update on public.suppliers
  for update to authenticated
  using (public.current_user_is_supervisor_or_admin())
  with check (public.current_user_is_supervisor_or_admin());

create policy suppliers_supervisor_delete on public.suppliers
  for delete to authenticated
  using (public.current_user_is_supervisor_or_admin());

