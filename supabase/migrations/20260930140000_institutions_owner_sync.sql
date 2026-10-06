-- Keep institutions.owner_id and the legacy owner_user_id in sync.
--
-- The live project's institutions table predates 20260930090000 and has its
-- own owner_user_id column (NOT NULL). That migration added owner_id, which
-- every RLS check uses, and backfilled it once, but nothing kept the two
-- columns in step afterwards: an insert setting only owner_id failed with
-- "null value in column owner_user_id", and one setting only owner_user_id
-- would leave owner_id NULL and lock the owner out of their own venue.
--
-- Only installed where owner_user_id actually exists (a clean database built
-- from these migrations doesn't have it). Idempotent: safe to re-run.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'owner_user_id') THEN

    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.institutions_sync_owner()
      RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN
        IF TG_OP = 'UPDATE' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id
           AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id THEN
          NEW.owner_user_id := NEW.owner_id;
        ELSIF TG_OP = 'UPDATE' AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
           AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN
          NEW.owner_id := NEW.owner_user_id;
        ELSE
          NEW.owner_id      := COALESCE(NEW.owner_id, NEW.owner_user_id);
          NEW.owner_user_id := COALESCE(NEW.owner_user_id, NEW.owner_id);
        END IF;
        RETURN NEW;
      END
      $body$;
    $f$;

    DROP TRIGGER IF EXISTS institutions_sync_owner ON public.institutions;
    CREATE TRIGGER institutions_sync_owner
      BEFORE INSERT OR UPDATE ON public.institutions
      FOR EACH ROW EXECUTE FUNCTION public.institutions_sync_owner();

    -- Catch up rows written between the original backfill and now.
    EXECUTE 'UPDATE public.institutions SET owner_id = owner_user_id
             WHERE owner_id IS NULL AND owner_user_id IN (SELECT id FROM auth.users)';
  END IF;
END $$;
