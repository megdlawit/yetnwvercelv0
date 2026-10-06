-- The app (EmailGateDialog, CreateProfilePrompt, useUserProfile.updateEmail)
-- has always tried to read/write a `profiles.email` column, but no prior
-- migration ever created it. Every attempt to save an email — verified via
-- magic link or entered directly — has been failing with a Postgres
-- "column profiles.email does not exist" error.
--
-- Unique (partial) index so two profiles can't claim the same email, while
-- still allowing many guest profiles with a NULL email.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_idx
  ON public.profiles (email)
  WHERE email IS NOT NULL;
