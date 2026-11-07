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
