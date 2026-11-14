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
