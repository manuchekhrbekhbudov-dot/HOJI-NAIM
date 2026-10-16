-- HOJI-NAIM CARGO: secure role-management RPC for admin panel
-- Run this in Supabase SQL Editor after deploying the frontend.
create or replace function public.admin_set_profile_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare actor_role text;
begin
  actor_role := public.current_app_role();
  if actor_role not in ('owner','admin') then
    raise exception 'Only admin or owner can change staff roles';
  end if;
  if new_role not in ('customer','operator','accountant','admin','owner') then
    raise exception 'Invalid role';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;
  if new_role = 'owner' and actor_role <> 'owner' then
    raise exception 'Only an owner can assign owner role';
  end if;
  update public.profiles set role = new_role where id = target_user_id;
  if not found then raise exception 'Profile not found'; end if;
end;
$$;
revoke all on function public.admin_set_profile_role(uuid,text) from public;
grant execute on function public.admin_set_profile_role(uuid,text) to authenticated;
