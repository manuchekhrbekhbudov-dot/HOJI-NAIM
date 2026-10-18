-- HOJI-NAIM CARGO — schema aligned with the current main.js frontend.
-- IMPORTANT: use only for a NEW/EMPTY Supabase project. It is not a migration
-- for an existing database and must not be run as a way to convert live tables.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  role text not null default 'customer'
    check (role in ('owner','admin','accountant','operator','customer')),
  created_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  client_name text not null default '',
  client_phone text not null default '',
  tracking_no text not null unique,
  shipment_date date not null default current_date,
  billing_type text not null default 'kg' check (billing_type in ('kg','cube')),
  weight_kg numeric(12,3) not null default 0 check (weight_kg >= 0),
  volume_m3 numeric(12,4) not null default 0 check (volume_m3 >= 0),
  currency text not null default 'USD' check (currency in ('TJS','USD','CNY')),
  unit_price numeric(14,4) not null default 0 check (unit_price >= 0),
  fx_rate numeric(16,6) not null default 1 check (fx_rate > 0),
  total_original numeric(14,2) not null default 0 check (total_original >= 0),
  total_tjs numeric(14,2) not null default 0 check (total_tjs >= 0),
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete restrict,
  amount_original numeric(14,2) not null check (amount_original > 0),
  currency text not null default 'TJS' check (currency in ('TJS','USD','CNY')),
  fx_rate numeric(16,6) not null default 1 check (fx_rate > 0),
  amount_tjs numeric(14,2) not null check (amount_tjs > 0),
  payment_date date not null default current_date,
  method text not null default 'other' check (method in ('cash','online','bank_transfer','other')),
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  amount_original numeric(14,2) not null check (amount_original > 0),
  currency text not null default 'TJS' check (currency in ('TJS','USD','CNY')),
  fx_rate numeric(16,6) not null default 1 check (fx_rate > 0),
  amount_tjs numeric(14,2) not null check (amount_tjs > 0),
  expense_date date not null default current_date,
  description text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists shipments_created_at_idx on public.shipments(created_at desc);
create index if not exists shipments_tracking_no_idx on public.shipments(tracking_no);
create index if not exists payments_shipment_id_idx on public.payments(shipment_id);
create index if not exists payments_payment_date_idx on public.payments(payment_date desc);
create index if not exists expenses_expense_date_idx on public.expenses(expense_date desc);

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_app_role() in ('owner','admin','accountant','operator'), false) $$;

alter table public.profiles enable row level security;
alter table public.shipments enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;

drop policy if exists "profile read own or staff" on public.profiles;
create policy "profile read own or staff" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_staff());
-- Intentionally no authenticated UPDATE policy on profiles. Role changes must use
-- the admin_set_profile_role security-definer RPC, preventing self-promotion.

drop policy if exists "staff read shipments" on public.shipments;
drop policy if exists "staff insert shipments" on public.shipments;
drop policy if exists "staff update shipments" on public.shipments;
drop policy if exists "admin delete shipments" on public.shipments;
create policy "staff read shipments" on public.shipments for select to authenticated using (public.is_staff());
create policy "staff insert shipments" on public.shipments for insert to authenticated with check (public.is_staff());
create policy "staff update shipments" on public.shipments for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "admin delete shipments" on public.shipments for delete to authenticated using (public.current_app_role() in ('owner','admin'));

drop policy if exists "staff read payments" on public.payments;
drop policy if exists "staff insert payments" on public.payments;
drop policy if exists "staff update payments" on public.payments;
drop policy if exists "admin delete payments" on public.payments;
create policy "staff read payments" on public.payments for select to authenticated using (public.is_staff());
create policy "staff insert payments" on public.payments for insert to authenticated with check (public.is_staff());
create policy "staff update payments" on public.payments for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "admin delete payments" on public.payments for delete to authenticated using (public.current_app_role() in ('owner','admin'));

drop policy if exists "staff read expenses" on public.expenses;
drop policy if exists "staff insert expenses" on public.expenses;
drop policy if exists "staff update expenses" on public.expenses;
drop policy if exists "admin delete expenses" on public.expenses;
create policy "staff read expenses" on public.expenses for select to authenticated
using (public.current_app_role() in ('owner','admin','accountant'));
create policy "staff insert expenses" on public.expenses for insert to authenticated
with check (public.current_app_role() in ('owner','admin','accountant'));
create policy "staff update expenses" on public.expenses for update to authenticated
using (public.current_app_role() in ('owner','admin','accountant'))
with check (public.current_app_role() in ('owner','admin','accountant'));
create policy "admin delete expenses" on public.expenses for delete to authenticated
using (public.current_app_role() in ('owner','admin'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id, phone, role)
  values (new.id, new.phone, 'customer')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Promote the first owner manually after signup, using that user's auth.users UUID:
-- update public.profiles set role='owner' where id='YOUR-AUTH-USER-UUID';
