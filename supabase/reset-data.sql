-- HOJI-NAIM CARGO — start the books from zero (Аз сифр).
-- Deletes ALL accounting data: shipments, payments, expenses, batches, Excel sheets,
-- change history, closed months, Telegram subscribers/messages/keys.
-- KEEPS: staff accounts and roles (profiles), exchange rates (fx_rates), Telegram settings.
-- Cannot be undone — download «Нусха ба Excel» in Админ-панел first.
-- Run once in Supabase → SQL Editor → Run.

begin;

-- 1. Closed months would block deleting old rows → open them first.
delete from public.app_settings where key = 'closed_until';

-- 2. Money first (payments point to shipments), then cargo.
do $$
declare t text;
begin
  foreach t in array array[
    'payments', 'expenses', 'shipments', 'batches', 'customer_sheets',
    'telegram_log', 'telegram_subscribers', 'telegram_invites'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I', t);
    end if;
  end loop;
  -- the deletes above were written to the change history too → clear it last
  if to_regclass('public.audit_log') is not null then
    execute 'delete from public.audit_log';
  end if;
end $$;

-- 3. Tell every browser to forget its saved Excel notebook (Лист1 … are made fresh).
insert into public.app_settings (key, value) values ('data_reset_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'))
on conflict (key) do update set value = excluded.value, updated_at = now();

commit;

-- Check (all should be 0):
select
  (select count(*) from public.shipments) as shipments,
  (select count(*) from public.payments)  as payments,
  (select count(*) from public.expenses)  as expenses;
