-- LEGACY SCHEMA WARNING:
-- This original schema uses older column names and does not match the current main.js.
-- Do NOT use it to set up the current frontend. For a new Supabase project use
-- supabase/schema_app_v2.sql. For the existing live database, review/run only the
-- explicit migration files; never re-create or replace tables containing live cargo data.
-- Original schema retained below for historical reference.
-- HOJI-NAIM CARGO initial schema
-- Run this file in Supabase SQL Editor. Review policies before production use.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  role text not null default 'customer' check (role in ('owner','admin','accountant','operator','customer')),
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  linked_user_id uuid unique references auth.users(id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique(phone)
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  tracking_number text not null unique,
  weight_kg numeric(12,3) not null default 0 check (weight_kg >= 0),
  volume_m3 numeric(12,3) not null default 0 check (volume_m3 >= 0),
  billing_type text not null default 'kg' check (billing_type in ('kg','volume','fixed')),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  currency text not null default 'TJS' check (currency in ('TJS','USD','CNY')),
  exchange_rate numeric(16,6) not null default 1 check (exchange_rate > 0),
  total_tjs numeric(14,2) not null default 0 check (total_tjs >= 0),
  status text not null default 'received' check (status in ('received','in_transit','arrived','delivered','cancelled')),
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'TJS' check (currency in ('TJS','USD','CNY')),
  exchange_rate numeric(16,6) not null default 1 check (exchange_rate > 0),
  amount_tjs numeric(14,2) generated always as (round(amount * exchange_rate, 2)) stored,
  method text not null check (method in ('cash','online','bank_transfer','other')),
  payment_date date not null default current_date,
  notes text not null default '',
  received_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'TJS' check (currency in ('TJS','USD','CNY')),
  exchange_rate numeric(16,6) not null default 1 check (exchange_rate > 0),
  amount_tjs numeric(14,2) generated always as (round(amount * exchange_rate, 2)) stored,
  expense_date date not null default current_date,
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shipments_customer_id_idx on public.shipments(customer_id);
create index if not exists shipments_created_at_idx on public.shipments(created_at desc);
create index if not exists payments_shipment_id_idx on public.payments(shipment_id);
create index if not exists expenses_expense_date_idx on public.expenses(expense_date desc);

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_app_role() in ('owner','admin','accountant','operator'), false) $$;

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.shipments enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists "profile read own or staff" on public.profiles;
create policy "profile read own or staff" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_staff());
drop policy if exists "profile update own basic" on public.profiles;
create policy "profile update own basic" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "staff manage customers" on public.customers;
create policy "staff manage customers" on public.customers for all to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "customer read own customer record" on public.customers;
create policy "customer read own customer record" on public.customers for select to authenticated
using (linked_user_id = auth.uid());

drop policy if exists "staff manage shipments" on public.shipments;
create policy "staff manage shipments" on public.shipments for all to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "customer read own shipments" on public.shipments;
create policy "customer read own shipments" on public.shipments for select to authenticated
using (exists(select 1 from public.customers c where c.id = customer_id and c.linked_user_id = auth.uid()));

drop policy if exists "staff manage payments" on public.payments;
create policy "staff manage payments" on public.payments for all to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "customer read own payments" on public.payments;
create policy "customer read own payments" on public.payments for select to authenticated
using (exists(select 1 from public.shipments s join public.customers c on c.id=s.customer_id where s.id=shipment_id and c.linked_user_id=auth.uid()));

drop policy if exists "staff manage expenses" on public.expenses;
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

drop policy if exists "staff read audit log" on public.audit_log;
create policy "staff read audit log" on public.audit_log for select to authenticated
using (public.current_app_role() in ('owner','admin','accountant'));

-- New profiles default to customer. Promote the first owner manually in SQL Editor
-- after signing up, replacing the UUID with the intended auth.users.id:
-- update public.profiles set role='owner' where id='YOUR-AUTH-USER-UUID';
-- Link a customer login to their customer record:
-- update public.customers set linked_user_id='AUTH-USER-UUID' where phone='+992...';

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

-- Enable realtime for these tables in Supabase dashboard if live refresh is needed.
