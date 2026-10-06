-- Lock down partner_keys.
--
-- 20260727090000_partner_keys_rls.sql opened this table to anon and
-- authenticated with USING (true), on the assumption that the admin panel
-- had no Supabase session. It does now (AdminAuthContext uses
-- signInWithPassword), and the open policies meant anyone holding the public
-- anon key could read every partner's api_key in plain text, or insert an
-- unrestricted key of their own. "authenticated" alone isn't enough either:
-- any visitor gets a session through the email OTP in CreateProfilePrompt.
--
-- Only institution owners/members (the people who also run the admin panel)
-- may read or manage keys. The indoor-maps-api edge function validates keys
-- with the service-role client, which bypasses RLS, so it is unaffected.
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.user_is_institution_editor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.institutions i WHERE i.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.institution_members m WHERE m.user_id = auth.uid())
  );
$$;
GRANT EXECUTE ON FUNCTION public.user_is_institution_editor() TO anon, authenticated;

ALTER TABLE public.partner_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read partner_keys"   ON public.partner_keys;
DROP POLICY IF EXISTS "Authenticated users can insert partner_keys" ON public.partner_keys;
DROP POLICY IF EXISTS "Authenticated users can update partner_keys" ON public.partner_keys;
DROP POLICY IF EXISTS "Authenticated users can delete partner_keys" ON public.partner_keys;
DROP POLICY IF EXISTS "Anon users can read partner_keys"   ON public.partner_keys;
DROP POLICY IF EXISTS "Anon users can insert partner_keys" ON public.partner_keys;
DROP POLICY IF EXISTS "Anon users can update partner_keys" ON public.partner_keys;
DROP POLICY IF EXISTS "Anon users can delete partner_keys" ON public.partner_keys;
DROP POLICY IF EXISTS "Institution editors manage partner_keys" ON public.partner_keys;

CREATE POLICY "Institution editors manage partner_keys" ON public.partner_keys
  FOR ALL TO authenticated
  USING (public.user_is_institution_editor())
  WITH CHECK (public.user_is_institution_editor());

-- After applying: any key that was readable before this ran should be
-- treated as leaked. Rotate them from the admin Embed tab (create a new key,
-- give it to the partner, then deactivate the old one).
