-- Layer labels, part 2: training consent belongs to the venue and is decided
-- by an authorized person; export checks consent as it is NOW; how a layer
-- was confirmed is recorded. Run after 20261010090000_layer_labels.sql.
--
-- Consent
--   * One decision per venue, made by the venue's institution owner
--     (institutions.owner_id, or an institution member with role 'owner').
--     Venues without an institution are Yet New's own: platform admins decide.
--     Editors see the decision but cannot make it.
--   * History is kept: the latest row is the current decision. Revoking is a
--     new row with accepted = false.
--   * Export uses the CURRENT decision: after a revoke, that venue's rows are
--     left out of every future export. A model already trained on earlier
--     exports cannot unlearn them — the notice says so.
--   * Consent given on 20261010090000's per-editor table is not carried over:
--     it was not given by an authorized person. That table is dropped.
--
-- Confirmation
--   layer_labels.confirmed_via = individual | group | bulk (null while not
--   confirmed). Export takes only individual and group confirmations: a bulk
--   "confirm all" is not a reliable label.
--
-- Export
--   layer_label_training_rows(include_texts) — platform admins / service role.
--   Text samples from the drawing are removed unless include_texts is true.
--
-- Idempotent: safe to re-run.

-- 1. Consent per venue ----------------------------------------------------------
DROP TABLE IF EXISTS public.layer_label_consents CASCADE;

CREATE TABLE IF NOT EXISTS public.layer_training_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq            bigint GENERATED ALWAYS AS IDENTITY,  -- decision order (timestamps can tie)
  building_id    uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  decided_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  notice_version integer NOT NULL CHECK (notice_version > 0),  -- which wording was shown
  accepted       boolean NOT NULL,                              -- false = declined or revoked
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS layer_training_consents_current
  ON public.layer_training_consents (building_id, seq DESC);

-- Who may decide for a venue.
CREATE OR REPLACE FUNCTION public.user_can_consent_for_building(b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.buildings bl
    WHERE bl.id = b
      AND CASE WHEN bl.institution_id IS NULL THEN public.user_is_platform_admin()
               ELSE EXISTS (SELECT 1 FROM public.institutions i WHERE i.id = bl.institution_id AND i.owner_id = auth.uid())
                 OR EXISTS (SELECT 1 FROM public.institution_members m
                            WHERE m.institution_id = bl.institution_id AND m.user_id = auth.uid() AND m.role = 'owner')
          END
  );
$$;
REVOKE EXECUTE ON FUNCTION public.user_can_consent_for_building(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_consent_for_building(uuid) TO authenticated;

-- The venue's current decision (false when none was ever made).
CREATE OR REPLACE FUNCTION public.layer_training_consent_current(b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT c.accepted FROM public.layer_training_consents c
                   WHERE c.building_id = b ORDER BY c.seq DESC LIMIT 1), false);
$$;
REVOKE EXECUTE ON FUNCTION public.layer_training_consent_current(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.layer_training_consent_current(uuid) TO authenticated, service_role;

ALTER TABLE public.layer_training_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.layer_training_consents FROM anon;
REVOKE UPDATE, DELETE ON public.layer_training_consents FROM authenticated;  -- history is append-only

DROP POLICY IF EXISTS "Authorized people decide training consent" ON public.layer_training_consents;
DROP POLICY IF EXISTS "Venue editors read training consent" ON public.layer_training_consents;
CREATE POLICY "Authorized people decide training consent" ON public.layer_training_consents FOR INSERT TO authenticated
  WITH CHECK (decided_by = auth.uid() AND public.user_can_consent_for_building(building_id));
CREATE POLICY "Venue editors read training consent" ON public.layer_training_consents FOR SELECT TO authenticated
  USING (public.user_can_edit_building(building_id));

-- 2. layer_labels: no consent snapshot; how each layer was confirmed ------------
ALTER TABLE public.layer_labels DROP COLUMN IF EXISTS training_consent;  -- also drops its partial index
ALTER TABLE public.layer_labels ADD COLUMN IF NOT EXISTS confirmed_via text;
ALTER TABLE public.layer_labels DROP CONSTRAINT IF EXISTS layer_labels_confirmed_via_valid;
ALTER TABLE public.layer_labels ADD CONSTRAINT layer_labels_confirmed_via_valid CHECK (
  confirmed_via IS NULL OR confirmed_via IN ('individual', 'group', 'bulk'));
-- Rows confirmed before this column existed: how is unknown, so treat them as
-- bulk (kept, but never exported).
UPDATE public.layer_labels SET confirmed_via = 'bulk' WHERE human_verified AND confirmed_via IS NULL;
ALTER TABLE public.layer_labels DROP CONSTRAINT IF EXISTS layer_labels_confirmed_when_verified;
ALTER TABLE public.layer_labels ADD CONSTRAINT layer_labels_confirmed_when_verified CHECK (
  human_verified = (confirmed_via IS NOT NULL));
CREATE INDEX IF NOT EXISTS layer_labels_exportable ON public.layer_labels (building_id, created_at)
  WHERE human_verified AND confirmed_via IN ('individual', 'group');

-- Same guard as before, minus the consent snapshot.
CREATE OR REPLACE FUNCTION public.layer_labels_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    NEW.id := OLD.id;
    NEW.building_id := OLD.building_id;
    NEW.import_id := OLD.import_id;
    NEW.file_name := OLD.file_name;
    NEW.source_path := OLD.source_path;
    NEW.layer_name := OLD.layer_name;
    NEW.layer_summary := OLD.layer_summary;
    NEW.summarizer_version := OLD.summarizer_version;
    NEW.prompt_version := OLD.prompt_version;
    NEW.ai_model := OLD.ai_model;
    NEW.ai_label := OLD.ai_label;
    NEW.ai_confidence := OLD.ai_confidence;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.was_corrected := NEW.final_label IS NOT NULL AND NEW.final_label <> NEW.ai_label;
  RETURN NEW;
END $$;

-- 3. Training export --------------------------------------------------------------
-- Rows confirmed one by one or by group, on venues whose consent is accepted
-- NOW. Text samples are removed unless include_texts. (Synthetic fixtures are
-- refused again by the export script.)
DROP FUNCTION IF EXISTS public.layer_label_training_rows();
DROP FUNCTION IF EXISTS public.layer_label_training_rows(boolean);
CREATE FUNCTION public.layer_label_training_rows(include_texts boolean DEFAULT false)
RETURNS TABLE (
  id uuid, building_id uuid, import_id uuid, file_name text, layer_name text,
  layer_summary jsonb, summarizer_version integer, prompt_version integer,
  ai_model text, ai_label text, ai_confidence real, final_label text,
  was_corrected boolean, confirmed_via text, created_at timestamptz
) LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF NOT (public.user_is_platform_admin() OR current_user = 'service_role') THEN
    RAISE EXCEPTION 'Only platform admins can export training data' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT l.id, l.building_id, l.import_id, l.file_name, l.layer_name,
           CASE WHEN include_texts THEN l.layer_summary
                ELSE jsonb_set(l.layer_summary, '{texts}', '[]'::jsonb, true) END,
           l.summarizer_version, l.prompt_version, l.ai_model, l.ai_label, l.ai_confidence,
           l.final_label, l.was_corrected, l.confirmed_via, l.created_at
    FROM public.layer_labels l
    WHERE l.human_verified
      AND l.confirmed_via IN ('individual', 'group')
      AND l.final_label IS NOT NULL
      AND public.layer_training_consent_current(l.building_id)
    ORDER BY l.building_id, l.created_at, l.layer_name;
END $$;
REVOKE EXECUTE ON FUNCTION public.layer_label_training_rows(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.layer_label_training_rows(boolean) TO authenticated, service_role;
