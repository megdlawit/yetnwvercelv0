-- AI layer labeling for CAD imports: what the model said about each layer of
-- an imported drawing, what the admin confirmed, and whether those rows may
-- be used to train the labeling model.
--
--   layer_label_consents  the editor's answer to the training notice in the
--                         import dialog (per venue, per user, history kept)
--   layer_labels          one row per layer per import
--   cad-sources (bucket)  the original DXF, at <building id>/<import id>/<file>.dxf
--
-- Access: editors of a venue (user_can_edit_building) add and read that
-- venue's rows and files; nobody reads another venue's. Platform admins can
-- edit every venue, so they read across venues. Training export goes through
-- layer_label_training_rows(): platform admins / service role only, and only
-- rows that are human_verified AND training_consent.
--
-- No personal data: users appear only as auth ids (needed for access rules),
-- and layer summaries hold layer names, entity counts, block names and short
-- text samples from the drawing.
--
-- Idempotent: safe to re-run.

-- 1. Consent to training use ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.layer_label_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id    uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  notice_version integer NOT NULL CHECK (notice_version > 0),  -- which wording of the notice was shown
  accepted       boolean NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS layer_label_consents_lookup
  ON public.layer_label_consents (building_id, user_id, created_at DESC);

-- 2. Layer labels -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.layer_labels (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id        uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  import_id          uuid NOT NULL,                -- groups the rows of one import
  file_name          text NOT NULL,
  source_path        text,                          -- object in cad-sources, when the DXF was stored
  layer_name         text NOT NULL,
  layer_summary      jsonb NOT NULL,                -- {name,total,entity_counts,blocks,texts}
  summarizer_version integer NOT NULL,
  prompt_version     integer,
  ai_model           text,
  ai_label           text NOT NULL,
  ai_confidence      real CHECK (ai_confidence IS NULL OR ai_confidence BETWEEN 0 AND 1),
  final_label        text,
  was_corrected      boolean NOT NULL DEFAULT false, -- set by trigger: final_label <> ai_label
  human_verified     boolean NOT NULL DEFAULT false,
  training_consent   boolean NOT NULL DEFAULT false, -- set by trigger from layer_label_consents
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT layer_labels_ai_label_valid CHECK (ai_label IN (
    'wall','door','window','stairs','elevator','restroom','room','walkable',
    'vegetation','furniture','text','dimension','ignore','unknown')),
  CONSTRAINT layer_labels_final_label_valid CHECK (final_label IS NULL OR final_label IN (
    'wall','door','window','stairs','elevator','restroom','room','walkable',
    'vegetation','furniture','text','dimension','ignore','unknown')),
  -- Confirming means choosing a real label: "unknown" blocks the import until changed.
  CONSTRAINT layer_labels_verified_has_label CHECK (
    NOT human_verified OR (final_label IS NOT NULL AND final_label <> 'unknown'))
);
CREATE INDEX IF NOT EXISTS layer_labels_building ON public.layer_labels (building_id, created_at DESC);
-- (20261010110000 drops training_consent; skip the index when re-run after it.)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
             AND table_name = 'layer_labels' AND column_name = 'training_consent') THEN
    CREATE INDEX IF NOT EXISTS layer_labels_training ON public.layer_labels (created_at)
      WHERE human_verified AND training_consent;
  END IF;
END $$;

-- The server, not the browser, decides who wrote a row, whether it was
-- corrected, and whether training consent applies (the user's latest answer
-- for this venue). On update only the review fields may change.
CREATE OR REPLACE FUNCTION public.layer_labels_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
    NEW.training_consent := COALESCE((
      SELECT c.accepted FROM public.layer_label_consents c
      WHERE c.building_id = NEW.building_id AND c.user_id = auth.uid()
      ORDER BY c.created_at DESC, c.id DESC LIMIT 1), false);
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
    NEW.training_consent := OLD.training_consent;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.was_corrected := NEW.final_label IS NOT NULL AND NEW.final_label <> NEW.ai_label;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS layer_labels_guard ON public.layer_labels;
CREATE TRIGGER layer_labels_guard BEFORE INSERT OR UPDATE ON public.layer_labels
  FOR EACH ROW EXECUTE FUNCTION public.layer_labels_guard();

-- 3. Access -------------------------------------------------------------------
ALTER TABLE public.layer_label_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.layer_labels         ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.layer_label_consents, public.layer_labels FROM anon;

DROP POLICY IF EXISTS "Editors record their consent" ON public.layer_label_consents;
DROP POLICY IF EXISTS "Users read their consent; admins read all" ON public.layer_label_consents;
CREATE POLICY "Editors record their consent" ON public.layer_label_consents FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.user_can_edit_building(building_id));
CREATE POLICY "Users read their consent; admins read all" ON public.layer_label_consents FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.user_is_platform_admin());

DROP POLICY IF EXISTS "Editors add their venue's layer labels" ON public.layer_labels;
DROP POLICY IF EXISTS "Editors read their venue's layer labels" ON public.layer_labels;
DROP POLICY IF EXISTS "Editors review their venue's layer labels" ON public.layer_labels;
DROP POLICY IF EXISTS "Platform admins delete layer labels" ON public.layer_labels;
-- user_can_edit_building is true for platform admins on every venue, so these
-- also give admins the cross-venue read; editors see only their own venues.
CREATE POLICY "Editors add their venue's layer labels" ON public.layer_labels FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_building(building_id));
CREATE POLICY "Editors read their venue's layer labels" ON public.layer_labels FOR SELECT TO authenticated
  USING (public.user_can_edit_building(building_id));
CREATE POLICY "Editors review their venue's layer labels" ON public.layer_labels FOR UPDATE TO authenticated
  USING (public.user_can_edit_building(building_id))
  WITH CHECK (public.user_can_edit_building(building_id));
CREATE POLICY "Platform admins delete layer labels" ON public.layer_labels FOR DELETE TO authenticated
  USING (public.user_is_platform_admin());

-- 4. Training export ----------------------------------------------------------
-- The ONLY way training data leaves the table: confirmed by a person AND
-- consented. (Synthetic fixtures are refused again by the export script.)
CREATE OR REPLACE FUNCTION public.layer_label_training_rows()
RETURNS SETOF public.layer_labels LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF NOT (public.user_is_platform_admin() OR current_user = 'service_role') THEN
    RAISE EXCEPTION 'Only platform admins can export training data' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.layer_labels l
    WHERE l.human_verified AND l.training_consent AND l.final_label IS NOT NULL
    ORDER BY l.building_id, l.created_at, l.layer_name;
END $$;
REVOKE EXECUTE ON FUNCTION public.layer_label_training_rows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.layer_label_training_rows() TO authenticated, service_role;

-- 5. Original drawings: private bucket ---------------------------------------
-- Paths start with the venue id: <building id>/<import id>/<file>.dxf.
-- Editors reach only their venues' files; platform admins every venue's.
-- Files are kept as uploaded (no update policy); editors may remove theirs.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('cad-sources', 'cad-sources', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;

DROP POLICY IF EXISTS "Editors read CAD sources" ON storage.objects;
DROP POLICY IF EXISTS "Editors add CAD sources" ON storage.objects;
DROP POLICY IF EXISTS "Editors remove CAD sources" ON storage.objects;
CREATE POLICY "Editors read CAD sources" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cad-sources' AND public.user_can_edit_building(((storage.foldername(name))[1])::uuid));
CREATE POLICY "Editors add CAD sources" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cad-sources' AND public.user_can_edit_building(((storage.foldername(name))[1])::uuid));
CREATE POLICY "Editors remove CAD sources" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cad-sources' AND public.user_can_edit_building(((storage.foldername(name))[1])::uuid));
