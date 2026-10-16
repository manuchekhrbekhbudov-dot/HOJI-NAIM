-- HOJI-NAIM CARGO: allow only admins/owners to delete expenses.
-- Run this in Supabase SQL Editor on the existing project.
-- Keep read/create/update access for owner, admin, and accountant.
drop policy if exists "staff manage expenses" on public.expenses;
drop policy if exists "staff read expenses" on public.expenses;
drop policy if exists "staff insert expenses" on public.expenses;
drop policy if exists "staff update expenses" on public.expenses;
drop policy if exists "admin delete expenses" on public.expenses;

create policy "staff read expenses" on public.expenses
for select to authenticated
using (public.current_app_role() in ('owner','admin','accountant'));

create policy "staff insert expenses" on public.expenses
for insert to authenticated
with check (public.current_app_role() in ('owner','admin','accountant'));

create policy "staff update expenses" on public.expenses
for update to authenticated
using (public.current_app_role() in ('owner','admin','accountant'))
with check (public.current_app_role() in ('owner','admin','accountant'));

create policy "admin delete expenses" on public.expenses
for delete to authenticated
using (public.current_app_role() in ('owner','admin'));
