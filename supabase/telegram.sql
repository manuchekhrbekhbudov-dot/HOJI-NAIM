-- HOJI-NAIM CARGO — Telegram bot for customers (паёмҳои шахсӣ).
-- Run ONCE in Supabase → SQL Editor, AFTER deploying the Edge Function «telegram-bot».
-- Replace the two values marked «ИВАЗ КУНЕД» below before running.
-- Additive only: new tables + triggers. A failed message NEVER blocks saving a shipment or payment.

create extension if not exists pg_net with schema extensions;

-- Customers who pressed Start and shared their phone.
create table if not exists public.telegram_subscribers (
  chat_id bigint primary key,
  phone text not null default '',
  phone_key text not null default '',        -- last 9 digits, used to match shipments.client_phone
  first_name text not null default '',
  username text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists telegram_subscribers_phone_idx on public.telegram_subscribers(phone_key);

-- Every message the bot sent (or failed to send).
create table if not exists public.telegram_log (
  id bigint generated always as identity primary key,
  chat_id bigint,
  shipment_id uuid,
  event text not null,
  text text not null default '',
  ok boolean not null default false,
  error text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists telegram_log_created_idx on public.telegram_log(created_at desc);

-- Private settings: readable only by the database itself (RLS on, no policies).
create table if not exists public.telegram_config (
  id int primary key default 1 check (id = 1),
  function_url text not null,
  hook_secret text not null
);

alter table public.telegram_subscribers enable row level security;
alter table public.telegram_log enable row level security;
alter table public.telegram_config enable row level security;
drop policy if exists "staff read tg subscribers" on public.telegram_subscribers;
drop policy if exists "staff read tg log" on public.telegram_log;
create policy "staff read tg subscribers" on public.telegram_subscribers for select to authenticated using (public.is_staff());
create policy "staff read tg log" on public.telegram_log for select to authenticated using (public.is_staff());
grant select on public.telegram_subscribers, public.telegram_log to authenticated;
revoke all on public.telegram_config from anon, authenticated;

-- ====== ИВАЗ КУНЕД: суроғаи функсия ва калиди махфӣ (ҳамон HOOK_SECRET, ки дар Edge Function гузоштед) ======
insert into public.telegram_config (id, function_url, hook_secret)
values (1, 'https://wfxbgkasstkxzmyrjwpi.supabase.co/functions/v1/telegram-bot', 'ИВАЗ_КУНЕД_HOOK_SECRET')
on conflict (id) do update set function_url = excluded.function_url, hook_secret = excluded.hook_secret;

-- Sends {event, shipment_id, payment_id} to the Edge Function. Errors are swallowed on purpose.
create or replace function public.hn_tg_call(p_event text, p_shipment uuid, p_payment uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare cfg record;
begin
  select * into cfg from public.telegram_config where id = 1;
  if not found or cfg.hook_secret like 'ИВАЗ%' then return; end if;
  perform net.http_post(
    url := cfg.function_url,
    body := jsonb_build_object('event', p_event, 'shipment_id', p_shipment, 'payment_id', p_payment),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', cfg.hook_secret),
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning 'telegram notify skipped: %', sqlerrm;
end;
$$;
revoke all on function public.hn_tg_call(text, uuid, uuid) from public, anon, authenticated;

create or replace function public.hn_tg_shipments()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' and coalesce(new.warehouse_status, 'in_warehouse') = 'in_warehouse' then
    perform public.hn_tg_call('arrived', new.id, null);
  elsif tg_op = 'UPDATE' and new.warehouse_status is distinct from old.warehouse_status then
    if new.warehouse_status = 'in_warehouse' then perform public.hn_tg_call('arrived', new.id, null);
    elsif new.warehouse_status = 'delivered' then perform public.hn_tg_call('delivered', new.id, null);
    end if;
  end if;
  return new;
end;
$$;
create or replace function public.hn_tg_payments()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.hn_tg_call('paid', new.shipment_id, new.id);
  return new;
end;
$$;
revoke all on function public.hn_tg_shipments() from public;
revoke all on function public.hn_tg_payments() from public;

drop trigger if exists hn_tg_shipments on public.shipments;
create trigger hn_tg_shipments after insert or update of warehouse_status on public.shipments
  for each row execute function public.hn_tg_shipments();
drop trigger if exists hn_tg_payments on public.payments;
create trigger hn_tg_payments after insert on public.payments
  for each row execute function public.hn_tg_payments();

notify pgrst, 'reload schema';

-- Turn off later (if ever needed):
--   drop trigger if exists hn_tg_shipments on public.shipments;
--   drop trigger if exists hn_tg_payments on public.payments;
