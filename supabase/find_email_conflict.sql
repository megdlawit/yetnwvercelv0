-- Run in Supabase SQL Editor to see which profile currently owns an email.
-- Replace the email below with the one you tested.

SELECT id, user_id, full_name, email, created_at
FROM public.profiles
WHERE email = 'you@example.com';

-- If this turns out to be a stale/duplicate row from earlier testing
-- (before the schema fix), and you just want to free up the email so you
-- can re-test, either:
--
-- (a) clear the email off the old row:
-- UPDATE public.profiles SET email = NULL WHERE id = '<old-row-id>';
--
-- (b) or delete the stale test row entirely:
-- DELETE FROM public.profiles WHERE id = '<old-row-id>';
