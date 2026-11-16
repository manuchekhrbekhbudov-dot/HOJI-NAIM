-- HOJI-NAIM CARGO — Telegram bot v4: language, operator chat, weekly debt reminder.
-- Run once in Supabase → SQL Editor (after telegram.sql and telegram-batches.sql). Safe to run again.

-- 1. Each customer's language in the bot (tg = тоҷикӣ, ru = русский)
alter table public.telegram_subscribers add column if not exists lang text not null default 'tg';

-- 2. The bot saves the staff group when an admin links it with «/link КОД»
grant select, insert, update on public.app_settings to service_role;

-- 3. Weekly debt reminder: every Monday 10:00 Dushanbe time (05:00 UTC).
--    Turn it off/on in Админ-панел → Telegram (setting tg_remind).
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'hn-tg-remind';
  perform cron.schedule('hn-tg-remind', '0 5 * * 1', $job$select public.hn_tg_post('{"event":"remind"}'::jsonb)$job$);
exception when others then
  raise notice 'Weekly reminder not scheduled (pg_cron): %. Turn on pg_cron in Database → Extensions and run this file again.', sqlerrm;
end $$;

notify pgrst, 'reload schema';
