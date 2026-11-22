-- HOJI-NAIM CARGO — start the books from zero (Аз сифр), e.g. before handing the platform to its owner.
-- Deletes ALL working data: shipments, payments, expenses, cars (batches), Excel sheets and their archive (Бойгонӣ),
-- customers, exchange rates, change history, closed months, the month of the Excel notebook,
-- Telegram subscribers / messages / keys and the link to the staff group.
-- KEEPS: staff accounts and roles (profiles), the Telegram bot texts (prices, address, operator, payment).
-- Cannot be undone — download «Нусха ба Excel» in Админ-панел first if anything should be kept.
-- Run once in Supabase → SQL Editor → Run.

begin;

-- 1. Closed months would block deleting old rows → open them first; forget the notebook month and the staff group link.
delete from public.app_settings where key in ('closed_until', 'book_month', 'tg_staff_chat', 'tg_link_code');

-- 2. Money first (payments point to shipments), then cargo, sheets, customers, rates, Telegram.
do $$
declare t text;
begin
  foreach t in array array[
    'payments', 'expenses', 'shipments', 'batches', 'customer_sheets', 'customers', 'fx_rates',
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

-- 3. Tell every browser to forget its saved Excel notebooks and archive (Лист1 … are made fresh).
insert into public.app_settings (key, value) values ('data_reset_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'))
on conflict (key) do update set value = excluded.value, updated_at = now();

commit;

-- Check (all should be 0):
select
  (select count(*) from public.shipments) as bor,
  (select count(*) from public.payments) as pardoxt,
  (select count(*) from public.expenses) as xarojot,
  (select count(*) from public.customer_sheets) as varaqho,
  (select count(*) from public.telegram_subscribers) as telegram;
