-- Fixes: POST .../partner_keys 403 (Forbidden) from the admin Embed tab.
--
-- The original partner_keys migration turned RLS on but never added a
-- policy. With RLS enabled and zero policies, Postgres denies every request
-- by default -- including from the admin panel itself, which only has the
-- Supabase anon key (this app's admin login is a custom AdminAuthContext,
-- not Supabase Auth, so there's no "authenticated" Supabase session to
-- grant instead). This mirrors the same permissive dev-mode policy already
-- used on every other admin-managed table (see e.g. the buildings
-- migration) rather than inventing a different access model just for this
-- table.
--
-- NOTE: this means anyone with the public anon key can read/write
-- partner_keys, same as buildings/pois/etc. today. If real Supabase Auth
-- roles are ever added for the admin panel, tighten this (and the other
-- tables) to check auth.uid() against an admins table instead of TO anon.

CREATE POLICY "Authenticated users can read partner_keys"
  ON public.partner_keys FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert partner_keys"
  ON public.partner_keys FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update partner_keys"
  ON public.partner_keys FOR UPDATE TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete partner_keys"
  ON public.partner_keys FOR DELETE TO authenticated
  USING (true);

CREATE POLICY "Anon users can read partner_keys"
  ON public.partner_keys FOR SELECT TO anon
  USING (true);

CREATE POLICY "Anon users can insert partner_keys"
  ON public.partner_keys FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Anon users can update partner_keys"
  ON public.partner_keys FOR UPDATE TO anon
  USING (true);

CREATE POLICY "Anon users can delete partner_keys"
  ON public.partner_keys FOR DELETE TO anon
  USING (true);
