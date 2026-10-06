-- The original profiles migration (20260615120000) created strict
-- "authenticated" policies requiring auth.uid() = user_id. That made sense
-- before the app pivoted to a guest-ID (localStorage) model. Guest IDs are
-- random UUIDs that never match a real Supabase Auth user id, so those
-- policies can never pass.
--
-- Normally this is invisible because guest traffic runs as the `anon` role.
-- But the moment a real Supabase Auth session exists in the browser (e.g.
-- after using the "Verify Email" magic-link flow), supabase-js attaches
-- that session to every request automatically, Postgres evaluates it as
-- `authenticated`, and the old strict policy blocks it with:
--   42501 "new row violates row-level security policy for table profiles"
--
-- Fix: make the authenticated-role policies just as permissive as the
-- anon ones, since this app never actually checks auth.uid() ownership.

DROP POLICY IF EXISTS "Authenticated users can read their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can delete their own profile" ON public.profiles;

CREATE POLICY "Authenticated users can read profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert profiles"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete profiles"
  ON public.profiles FOR DELETE TO authenticated
  USING (true);
