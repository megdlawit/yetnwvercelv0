-- Allow unauthenticated (anon) users to read profiles.
-- This is needed because the app does not have a login flow yet —
-- profile data is fetched directly without an auth session.
-- Remove this policy once you add proper authentication.

CREATE POLICY "Public read access for profiles"
  ON public.profiles FOR SELECT
  TO anon
  USING (true);
