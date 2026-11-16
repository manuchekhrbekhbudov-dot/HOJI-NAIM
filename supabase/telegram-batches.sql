-- HOJI-NAIM CARGO — Telegram messages by status (loads are recorded in China, before the road).
--   new load saved            → «📝 Бори шумо қабул ва сабт шуд»
--   batch (мошин) status      → «Бор шуда истодааст» / «🚚 Дар роҳ» / «✅ Дар Душанбе расид» (one message per customer)
--   load without a batch put «Дар анбор» → «Бор расид»;  «Супорида шуд» → «Бор супорида шуд»;  payment → «Пардохт қабул шуд»
-- Run once in Supabase → SQL Editor (after telegram.sql). Safe to run again.

-- the bot reads loads of a batch
grant select on public.batches to service_role;

-- general sender: any JSON body to the bot function (errors never block saving)
create or replace function public.hn_tg_post(p_body jsonb)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare cfg record;
begin
  select * into cfg from public.telegram_config where id = 1;
  if not found or cfg.hook_secret like 'ИВАЗ%' then return; end if;
  perform net.http_post(
    url := cfg.function_url,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', cfg.hook_secret),
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning 'telegram notify skipped: %', sqlerrm;
end;
$$;
revoke all on function public.hn_tg_post(jsonb) from public, anon, authenticated;

create or replace function public.hn_tg_call(p_event text, p_shipment uuid, p_payment uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public.hn_tg_post(jsonb_build_object('event', p_event, 'shipment_id', p_shipment, 'payment_id', p_payment));
end;
$$;
revoke all on function public.hn_tg_call(text, uuid, uuid) from public, anon, authenticated;

create or replace function public.hn_tg_shipments()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.hn_tg_call('registered', new.id, null);
  elsif tg_op = 'UPDATE' and new.warehouse_status is distinct from old.warehouse_status then
    -- loads in a batch get one «расид» message from the batch instead
    if new.warehouse_status = 'in_warehouse' and new.batch_id is null then perform public.hn_tg_call('arrived', new.id, null);
    elsif new.warehouse_status = 'delivered' then perform public.hn_tg_call('delivered', new.id, null);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.hn_tg_shipments() from public;

create or replace function public.hn_tg_batches()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status in ('loading', 'in_transit', 'arrived') then
    perform public.hn_tg_post(jsonb_build_object('event', 'batch', 'batch_id', new.id, 'status', new.status));
  end if;
  return new;
end;
$$;
revoke all on function public.hn_tg_batches() from public;

drop trigger if exists hn_tg_batches on public.batches;
create trigger hn_tg_batches after update of status on public.batches
  for each row execute function public.hn_tg_batches();

notify pgrst, 'reload schema';
