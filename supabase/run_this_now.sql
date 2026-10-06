-- Run this once in Supabase Dashboard → SQL Editor.
-- Safe to re-run (every statement is guarded).

-- 1. Allow anon to READ profiles
DROP POLICY IF EXISTS "Public read access for profiles" ON public.profiles;
CREATE POLICY "Public read access for profiles"
  ON public.profiles FOR SELECT
  TO anon
  USING (true);

-- 2. Allow anon to INSERT/UPDATE profiles (guest model, no auth.users FK)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;

DROP POLICY IF EXISTS "Public insert access for profiles" ON public.profiles;
CREATE POLICY "Public insert access for profiles"
  ON public.profiles FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public update access for profiles" ON public.profiles;
CREATE POLICY "Public update access for profiles"
  ON public.profiles FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- 3. Add the missing email column (this is what "Something went wrong" was hitting)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_idx
  ON public.profiles (email)
  WHERE email IS NOT NULL;

-- 4. Fix leftover strict "authenticated" policies (auth.uid() = user_id).
--    Guest IDs never match a real auth.uid(), so the moment a real Supabase
--    Auth session exists (e.g. after using "Verify Email"), those old
--    policies block guest reads/writes with:
--    42501 "new row violates row-level security policy for table profiles"
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
