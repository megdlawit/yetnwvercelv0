-- The app currently has no login flow, but profile creation (via the
-- "enter your name" prompt) needs to insert a row without an auth.users
-- foreign key match. Drop the FK constraint and allow anon insert/update.
-- If real authentication is added later, re-add the FK and tighten policies
-- to check auth.uid() = user_id instead.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;

CREATE POLICY "Public insert access for profiles"
  ON public.profiles FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Public update access for profiles"
  ON public.profiles FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
