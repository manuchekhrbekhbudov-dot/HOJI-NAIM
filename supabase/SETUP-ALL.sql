-- HOJI-NAIM CARGO — ҲАМАИ SQL-ҲО ДАР ЯК ФАЙЛ (SETUP-ALL)
-- Supabase → SQL Editor → ҳамаи ин матнро гузоред → Run. Як бор кифоя аст; такроран иҷро кардан ҳам бехатар аст.
-- Ҳеҷ сатри маълумотро нест намекунад. Пеш аз иҷро дар Админ-панел нусхаи эҳтиётӣ гиред.



-- ===================== базавӣ: функсияҳои нақш (агар набошанд) =====================
-- Some databases were created without these helpers. They only read profiles.role.
create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_app_role() in ('owner','admin','accountant','operator'), false) $$;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_staff() to authenticated;

-- ===================== admin_delete_shipment.sql =====================
-- HOJI-NAIM CARGO: atomically delete a shipment and its linked payments.
-- Run this migration in Supabase SQL Editor on the EXISTING live database.
-- PostgreSQL RPC calls run in a transaction: if either DELETE fails, both roll back.
-- An older version of this function returned a different type; drop it first (no data is touched).
drop function if exists public.admin_delete_shipment(uuid);

create or replace function public.admin_delete_shipment(target_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_payment_count integer := 0;
  v_payment_total numeric(14,2) := 0;
  v_shipment_count integer := 0;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid();

  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can delete shipments'
      using errcode = '42501';
  end if;

  if target_shipment_id is null then
    raise exception 'Shipment ID is required' using errcode = '22004';
  end if;

  if not exists (select 1 from public.shipments where id = target_shipment_id) then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;

  select count(*)::integer, coalesce(sum(amount_tjs), 0)
    into v_payment_count, v_payment_total
  from public.payments
  where shipment_id = target_shipment_id;

  delete from public.payments where shipment_id = target_shipment_id;
  delete from public.shipments where id = target_shipment_id;

  get diagnostics v_shipment_count = row_count;
  if v_shipment_count <> 1 then
    raise exception 'Shipment could not be deleted';
  end if;

  return jsonb_build_object(
    'shipment_id', target_shipment_id,
    'deleted_payments', v_payment_count,
    'deleted_payment_total_tjs', v_payment_total
  );
end;
$$;

revoke all on function public.admin_delete_shipment(uuid) from public;
revoke all on function public.admin_delete_shipment(uuid) from anon;
grant execute on function public.admin_delete_shipment(uuid) to authenticated;

-- ===================== migrations/20261019_warehouse_inventory.sql =====================
-- HOJI-NAIM CARGO: warehouse inventory status
-- Existing shipments are left as unknown until staff classify them.
alter table public.shipments add column if not exists warehouse_status text;
update public.shipments set warehouse_status = 'unknown' where warehouse_status is null;
alter table public.shipments alter column warehouse_status set default 'in_warehouse';
alter table public.shipments alter column warehouse_status set not null;
alter table public.shipments drop constraint if exists shipments_warehouse_status_check;
alter table public.shipments add constraint shipments_warehouse_status_check check (warehouse_status in ('unknown', 'in_warehouse', 'delivered'));
create index if not exists shipments_warehouse_status_idx on public.shipments (warehouse_status);

-- ===================== migrations/20261107_history_and_sheets.sql =====================
-- HOJI-NAIM CARGO — OPTIONAL migration (2026-11-07)
-- Adds: 1) change history (audit_log + triggers) for shipments, payments, expenses
--       2) customer_sheets: shared sheet names for "Дафтари Excel" (one sheet per customer)
--
-- SAFE FOR THE LIVE DATABASE: it only CREATES new objects. It does not alter, update or
-- delete any existing row or column. The website works without it; after running it,
-- "Таърихи тағйирот" and shared sheet names turn on automatically.
--
-- Before running: Supabase → Database → Backups (or Admin-panel → «Нусха ба Excel/JSON»).
-- Run in: Supabase Dashboard → SQL Editor → paste → Run.

-- ---------- 1. Change history ----------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_record_idx on public.audit_log (table_name, record_id, created_at desc);
alter table public.audit_log enable row level security;

drop policy if exists "finance read audit" on public.audit_log;
create policy "finance read audit" on public.audit_log for select to authenticated
  using (public.current_app_role() in ('owner','admin','accountant'));
-- No insert/update/delete policies: rows are written only by the trigger below
-- and nobody can edit or erase history from the browser.

create or replace function public.hn_log_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_log (actor_id, action, table_name, record_id, details)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    case when tg_op = 'DELETE' then old.id::text else new.id::text end,
    jsonb_build_object(
      'old', case when tg_op = 'INSERT' then null else to_jsonb(old) end,
      'new', case when tg_op = 'DELETE' then null else to_jsonb(new) end
    )
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.hn_log_change() from public;

drop trigger if exists hn_audit_shipments on public.shipments;
create trigger hn_audit_shipments after insert or update or delete on public.shipments
  for each row execute function public.hn_log_change();
drop trigger if exists hn_audit_payments on public.payments;
create trigger hn_audit_payments after insert or update or delete on public.payments
  for each row execute function public.hn_log_change();
drop trigger if exists hn_audit_expenses on public.expenses;
create trigger hn_audit_expenses after insert or update or delete on public.expenses
  for each row execute function public.hn_log_change();

-- ---------- 2. Customer sheets (Дафтари Excel) ----------
create table if not exists public.customer_sheets (
  id uuid primary key default gen_random_uuid(),
  customer_key text not null unique,
  sheet_name text not null check (char_length(sheet_name) between 1 and 31),
  customer_name text not null default '',
  client_code text not null default '',
  phone text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Sheet contents of «Дафтари Excel» (rows of the template), shared by all staff.
alter table public.customer_sheets add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.customer_sheets add column if not exists position integer not null default 0;
alter table public.customer_sheets enable row level security;
drop policy if exists "staff read sheets" on public.customer_sheets;
drop policy if exists "staff insert sheets" on public.customer_sheets;
drop policy if exists "staff update sheets" on public.customer_sheets;
drop policy if exists "staff delete sheets" on public.customer_sheets;
create policy "staff read sheets" on public.customer_sheets for select to authenticated using (public.is_staff());
create policy "staff insert sheets" on public.customer_sheets for insert to authenticated with check (public.is_staff());
create policy "staff update sheets" on public.customer_sheets for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff delete sheets" on public.customer_sheets for delete to authenticated using (public.is_staff());

create or replace function public.hn_touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists hn_customer_sheets_touch on public.customer_sheets;
create trigger hn_customer_sheets_touch before update on public.customer_sheets
  for each row execute function public.hn_touch_updated_at();

-- ---------- Rollback (only if you ever need to undo this file) ----------
-- drop trigger if exists hn_audit_shipments on public.shipments;
-- drop trigger if exists hn_audit_payments on public.payments;
-- drop trigger if exists hn_audit_expenses on public.expenses;
-- drop function if exists public.hn_log_change();
-- drop table if exists public.customer_sheets;
-- (keep audit_log: it only holds history)

-- ===================== migrations/20261115_finance.sql =====================
-- HOJI-NAIM CARGO — migration 2026-11-15: касса, қурби рӯз, партияҳо, пӯшидани давра.
-- ADDITIVE ONLY: new tables / new nullable-or-defaulted columns. No existing row is changed
-- except that every existing expense gets method = 'cash' (the column default).
-- The website keeps working without this file; each feature turns on once it is installed.

-- ---------- 1. Касса: payment method for expenses ----------
alter table public.expenses add column if not exists method text not null default 'cash';
alter table public.expenses drop constraint if exists expenses_method_check;
alter table public.expenses add constraint expenses_method_check check (method in ('cash','online','bank_transfer','other'));

-- ---------- 2. Daily exchange rates (қурби рӯз) ----------
create table if not exists public.fx_rates (
  rate_date date primary key,
  usd numeric(16,6) not null check (usd > 0),
  cny numeric(16,6) check (cny > 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.fx_rates enable row level security;
drop policy if exists "staff read rates" on public.fx_rates;
drop policy if exists "finance write rates" on public.fx_rates;
drop policy if exists "finance update rates" on public.fx_rates;
create policy "staff read rates" on public.fx_rates for select to authenticated using (public.is_staff());
create policy "finance write rates" on public.fx_rates for insert to authenticated with check (public.current_app_role() in ('owner','admin','accountant'));
create policy "finance update rates" on public.fx_rates for update to authenticated
  using (public.current_app_role() in ('owner','admin','accountant')) with check (public.current_app_role() in ('owner','admin','accountant'));

-- ---------- 3. Batches: truck / container (партия, мошин) ----------
create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  vehicle text not null default '',
  status text not null default 'in_transit' check (status in ('loading','in_transit','arrived','closed')),
  sent_date date,
  arrived_date date,
  cost_usd numeric(14,2) not null default 0 check (cost_usd >= 0),
  fx_rate numeric(16,6) not null default 1 check (fx_rate > 0),
  cost_tjs numeric(14,2) not null default 0 check (cost_tjs >= 0),
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.batches enable row level security;
drop policy if exists "staff read batches" on public.batches;
drop policy if exists "staff insert batches" on public.batches;
drop policy if exists "staff update batches" on public.batches;
drop policy if exists "admin delete batches" on public.batches;
create policy "staff read batches" on public.batches for select to authenticated using (public.is_staff());
create policy "staff insert batches" on public.batches for insert to authenticated with check (public.is_staff());
create policy "staff update batches" on public.batches for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "admin delete batches" on public.batches for delete to authenticated using (public.current_app_role() in ('owner','admin'));
alter table public.shipments add column if not exists batch_id uuid references public.batches(id) on delete set null;
alter table public.expenses add column if not exists batch_id uuid references public.batches(id) on delete set null;
create index if not exists shipments_batch_idx on public.shipments(batch_id);
create index if not exists expenses_batch_idx on public.expenses(batch_id);

-- ---------- 4. Closing a period (пӯшидани моҳ) ----------
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "staff read settings" on public.app_settings;
drop policy if exists "admin insert settings" on public.app_settings;
drop policy if exists "admin update settings" on public.app_settings;
drop policy if exists "admin delete settings" on public.app_settings;
create policy "staff read settings" on public.app_settings for select to authenticated using (public.is_staff());
create policy "admin insert settings" on public.app_settings for insert to authenticated with check (public.current_app_role() in ('owner','admin'));
create policy "admin update settings" on public.app_settings for update to authenticated
  using (public.current_app_role() in ('owner','admin')) with check (public.current_app_role() in ('owner','admin'));
create policy "admin delete settings" on public.app_settings for delete to authenticated using (public.current_app_role() in ('owner','admin'));

-- Rejects changes to money records dated on or before the closed date.
-- Warehouse status / notes changes on old shipments stay allowed (goods are still delivered).
create or replace function public.hn_period_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_until date;
  v_old date;
  v_new date;
begin
  select value::date into v_until from public.app_settings where key = 'closed_until';
  if v_until is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'shipments' then
    if tg_op = 'UPDATE'
       and new.total_tjs is not distinct from old.total_tjs
       and new.shipment_date is not distinct from old.shipment_date
       and new.weight_kg is not distinct from old.weight_kg
       and new.volume_m3 is not distinct from old.volume_m3 then
      return new;
    end if;
    if tg_op <> 'INSERT' then v_old := old.shipment_date; end if;
    if tg_op <> 'DELETE' then v_new := new.shipment_date; end if;
  elsif tg_table_name = 'payments' then
    if tg_op <> 'INSERT' then v_old := old.payment_date; end if;
    if tg_op <> 'DELETE' then v_new := new.payment_date; end if;
  else
    if tg_op <> 'INSERT' then v_old := old.expense_date; end if;
    if tg_op <> 'DELETE' then v_new := new.expense_date; end if;
  end if;
  if (v_old is not null and v_old <= v_until) or (v_new is not null and v_new <= v_until) then
    raise exception 'Period closed until %', v_until using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.hn_period_guard() from public;

drop trigger if exists hn_period_shipments on public.shipments;
create trigger hn_period_shipments before insert or update or delete on public.shipments
  for each row execute function public.hn_period_guard();
drop trigger if exists hn_period_payments on public.payments;
create trigger hn_period_payments before insert or update or delete on public.payments
  for each row execute function public.hn_period_guard();
drop trigger if exists hn_period_expenses on public.expenses;
create trigger hn_period_expenses before insert or update or delete on public.expenses
  for each row execute function public.hn_period_guard();

-- ===================== ҳуқуқҳо барои сайт (Data API) =====================
-- Some Supabase projects do not expose tables created in SQL automatically. RLS still applies.
grant select, insert, update, delete on
  public.app_settings, public.audit_log, public.batches, public.customer_sheets, public.fx_rates
to authenticated;
notify pgrst, 'reload schema';
