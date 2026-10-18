-- HOJI-NAIM CARGO — security hardening for an EXISTING database.
-- Safe for the current app: the frontend has no profile-edit feature.
-- This removes the legacy policy that could let a user update their own role.
drop policy if exists "profile update own basic" on public.profiles;
