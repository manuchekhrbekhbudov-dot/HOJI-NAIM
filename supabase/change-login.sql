-- HOJI-NAIM CARGO — change a staff account to a short login (e.g. «bakha0101») and set a new password.
-- On the site the login «bakha0101» means the account bakha0101@hoji-naim.local.
-- 1) Change the three values below: old email, new login, new password (8+ characters).
-- 2) Run once in Supabase → SQL Editor. Then sign in with the new login and password.
-- Note: an account on @hoji-naim.local has no real mailbox, so «forgot password» e-mails cannot reach it;
-- the password is changed again with this same file (then write the short login, e.g. 'bakha0101', in v_old too).
do $$
declare
  v_old   text := 'bakhtierbekhbudov@gmail.com';   -- current e-mail of the account
  v_login text := 'bakha0101';                     -- new short login
  v_pass  text := 'ПАРОЛИ_НАВ';                     -- new password
  v_new   text;
  v_id    uuid;
begin
  v_login := lower(trim(v_login));
  v_old := lower(trim(v_old));
  if v_old not like '%@%' then v_old := v_old || '@hoji-naim.local'; end if;   -- a short login works here too
  v_new := case when v_login like '%@%' then v_login else v_login || '@hoji-naim.local' end;
  if v_pass = 'ПАРОЛИ_НАВ' or length(v_pass) < 8 then
    raise exception 'Паролро дар v_pass нависед (ҳадди ақал 8 аломат).';
  end if;
  select id into v_id from auth.users where lower(email) = lower(trim(v_old));
  if v_id is null then raise exception 'Ҳисоб ёфт нашуд: %', v_old; end if;
  if exists (select 1 from auth.users where lower(email) = v_new and id <> v_id) then
    raise exception 'Логини % аллакай ҳаст.', v_login;
  end if;

  update auth.users
     set email = v_new,
         encrypted_password = extensions.crypt(v_pass, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = v_id;

  update auth.identities
     set identity_data = identity_data || jsonb_build_object('email', v_new, 'email_verified', true),
         provider_id = case when lower(provider_id) = lower(trim(v_old)) then v_new else provider_id end,
         updated_at = now()
   where user_id = v_id and provider = 'email';

  raise notice 'Тайёр: логин %, ҳисоб %', v_login, v_new;
end $$;
