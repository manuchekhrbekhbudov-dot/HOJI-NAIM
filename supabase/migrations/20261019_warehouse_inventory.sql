-- HOJI-NAIM CARGO: warehouse inventory status
-- Existing shipments are left as unknown until staff classify them.
alter table public.shipments add column if not exists warehouse_status text;
update public.shipments set warehouse_status = 'unknown' where warehouse_status is null;
alter table public.shipments alter column warehouse_status set default 'in_warehouse';
alter table public.shipments alter column warehouse_status set not null;
alter table public.shipments drop constraint if exists shipments_warehouse_status_check;
alter table public.shipments add constraint shipments_warehouse_status_check check (warehouse_status in ('unknown', 'in_warehouse', 'delivered'));
create index if not exists shipments_warehouse_status_idx on public.shipments (warehouse_status);
