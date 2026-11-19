-- HOJI-NAIM CARGO — «Ҳисоби ман»: each staff member changes their own name and login on the site.
-- (The password is changed by the site itself through Supabase Auth; no SQL needed for that.)
-- A short login such as «bakha0101» is stored as bakha0101@hoji-naim.local.
-- Run once in Supabase → SQL Editor. Safe to run again.
create or replace function public.hn_update_my_account(new_name text, new_login text)
returns text
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_id    uuid := auth.uid();
  v_login text := lower(trim(coalesce(new_login, '')));
  v_old   text;
  v_email text;
begin
  if v_id is null or not public.is_staff() then
    raise exception 'Барои ин амал иҷозат надоред.' using errcode = '42501';
  end if;
  select email into v_old from auth.users where id = v_id;
  if v_login = '' then
    v_email := v_old;
  elsif v_login like '%@%' then
    if v_login !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'Email нодуруст аст.' using errcode = '22023';
    end if;
    v_email := v_login;
  else
    if v_login !~ '^[a-z0-9._-]{3,40}$' then
      raise exception 'Логин: 3–40 аломат, танҳо ҳарфҳои лотинӣ, рақам ва . _ -' using errcode = '22023';
    end if;
    v_email := v_login || '@hoji-naim.local';
  end if;

  if lower(v_email) <> lower(coalesce(v_old, '')) then
    if exists (select 1 from auth.users where lower(email) = lower(v_email) and id <> v_id) then
      raise exception 'Ин логин аллакай банд аст.' using errcode = '23505';
    end if;
    update auth.users set email = v_email, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = v_id;
    update auth.identities
       set identity_data = identity_data || jsonb_build_object('email', v_email, 'email_verified', true),
           provider_id = case when lower(provider_id) = lower(v_old) then v_email else provider_id end,
           updated_at = now()
     where user_id = v_id and provider = 'email';
  end if;

  if new_name is not null and trim(new_name) <> '' then
    update public.profiles set full_name = left(trim(new_name), 120) where id = v_id;
  end if;
  return v_email;
end;
$$;
revoke all on function public.hn_update_my_account(text, text) from public, anon;
grant execute on function public.hn_update_my_account(text, text) to authenticated;

notify pgrst, 'reload schema';
