-- HOJI-NAIM CARGO: atomically delete a shipment and its linked payments.
-- Run this migration in Supabase SQL Editor on the EXISTING live database.
-- PostgreSQL RPC calls run in a transaction: if either DELETE fails, both roll back.
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
