-- Removes a profile row, not the Supabase Auth account.
create or replace function public.admin_delete_profile(target_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth
as $$
declare actor_role text; target_role text;
begin
  actor_role := public.current_app_role();
  if actor_role not in ('owner','admin') then raise exception 'Only owner/admin can remove profiles'; end if;
  if target_user_id = auth.uid() then raise exception 'You cannot remove your own profile'; end if;
  select role into target_role from public.profiles where id = target_user_id;
  if target_role is null then raise exception 'Profile not found'; end if;
  if target_role = 'owner' and actor_role <> 'owner' then raise exception 'Only owner can remove an owner profile'; end if;
  delete from public.profiles where id = target_user_id;
end;
$$;
revoke all on function public.admin_delete_profile(uuid) from public;
grant execute on function public.admin_delete_profile(uuid) to authenticated;
