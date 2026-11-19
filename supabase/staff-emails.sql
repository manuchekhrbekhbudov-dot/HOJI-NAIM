-- HOJI-NAIM CARGO — Админ-панел → «Кормандон»: email of each account and editing name/phone.
-- Only owners/admins get data; everyone else gets nothing. Run once in Supabase → SQL Editor. Safe to run again.

-- Email, last sign-in and sign-up time of every account (auth.users is not readable from the browser).
create or replace function public.admin_staff_emails()
returns table (id uuid, email text, last_sign_in_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public, auth
as $$
  select u.id, u.email::text, u.last_sign_in_at, u.created_at
  from auth.users u
  where public.current_app_role() in ('owner', 'admin');
$$;
revoke all on function public.admin_staff_emails() from public, anon;
grant execute on function public.admin_staff_emails() to authenticated;

-- An admin writes the name and phone of a staff member.
create or replace function public.admin_set_profile_info(target_user_id uuid, new_name text, new_phone text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_app_role() not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can change staff data' using errcode = '42501';
  end if;
  update public.profiles
     set full_name = left(coalesce(trim(new_name), ''), 120),
         phone     = left(coalesce(trim(new_phone), ''), 40)
   where id = target_user_id;
end;
$$;
revoke all on function public.admin_set_profile_info(uuid, text, text) from public, anon;
grant execute on function public.admin_set_profile_info(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
