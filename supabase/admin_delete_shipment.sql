create or replace function public.admin_delete_shipment(target_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if public.current_app_role() not in ('owner','admin') then
    raise exception 'Only owner/admin can delete shipments';
  end if;
  if not exists (select 1 from public.shipments where id = target_shipment_id) then
    raise exception 'Shipment not found';
  end if;
  if exists (select 1 from public.payments where shipment_id = target_shipment_id) then
    raise exception 'Shipment has payments; resolve payments first';
  end if;
  delete from public.shipments where id = target_shipment_id;
end;
$$;
revoke all on function public.admin_delete_shipment(uuid) from public;
grant execute on function public.admin_delete_shipment(uuid) to authenticated;
