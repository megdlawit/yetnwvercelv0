-- Access tests for the layer-labeling migrations:
--   20261010090000_layer_labels.sql
--   20261010110000_layer_labels_consent.sql
--
-- Runs in ONE transaction and always ends in ROLLBACK: nothing it creates
-- (test users, institutions, venues, rows, files) is kept. Run it as the
-- database owner (postgres), after both migrations:
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/layer_labels_rls.sql
--
-- The first failed check stops the run with "FAIL: …"; success ends with
-- the row 'layer_labels access: all checks passed'.
--
-- Cast:
--   owner A   owns institution A (venue A) — may decide training consent
--   editor A  member of institution A with role 'editor' — edits venue A, may not decide consent
--   owner B   owns institution B (venue B)
--   admin     platform admin
--   anon      signed out

BEGIN;

-- users:  ownerA …0a, editorA …0d, ownerB …0b, admin …0c
-- venues: A …a1, B …b1    institutions: A …a0, B …b0
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000b'),
  ('00000000-0000-4000-8000-00000000000c'),
  ('00000000-0000-4000-8000-00000000000d');
INSERT INTO public.institutions (id, name, owner_id) VALUES
  ('00000000-0000-4000-8000-0000000000a0', 'RLS test institution A', '00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-0000000000b0', 'RLS test institution B', '00000000-0000-4000-8000-00000000000b');
INSERT INTO public.institution_members (institution_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-00000000000d', 'editor');
INSERT INTO public.buildings (id, name, institution_id) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'RLS test venue A', '00000000-0000-4000-8000-0000000000a0'),
  ('00000000-0000-4000-8000-0000000000b1', 'RLS test venue B', '00000000-0000-4000-8000-0000000000b0');
INSERT INTO public.platform_admins (user_id) VALUES ('00000000-0000-4000-8000-00000000000c');

-- ── Owner B: venue B data. B never consents. ────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

INSERT INTO public.layer_labels (building_id, import_id, file_name, layer_name, layer_summary, summarizer_version, ai_label, final_label, human_verified, confirmed_via)
VALUES ('00000000-0000-4000-8000-0000000000b1', gen_random_uuid(), 'b.dxf', 'B-WALL', '{"name":"B-WALL","texts":["x"]}', 1, 'wall', 'wall', true, 'individual');
INSERT INTO storage.objects (bucket_id, name) VALUES ('cad-sources', '00000000-0000-4000-8000-0000000000b1/imp/b.dxf');

-- ── Editor A (not an owner) ─────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);

-- An editor cannot decide consent for the venue.
DO $$ BEGIN
  INSERT INTO public.layer_training_consents (building_id, notice_version, accepted)
  VALUES ('00000000-0000-4000-8000-0000000000a1', 1, true);
  RAISE EXCEPTION 'FAIL: an editor (not an owner) recorded training consent';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

-- The editor labels venue A: two layers one by one, one by group, one by bulk, one not confirmed.
INSERT INTO public.layer_labels (building_id, import_id, file_name, layer_name, layer_summary, summarizer_version, ai_label, ai_confidence, final_label, human_verified, confirmed_via, created_by)
VALUES
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1', 'a.dxf', 'A-WALL', '{"name":"A-WALL","texts":["Lobby"]}', 1, 'wall', 0.99, 'wall', true, 'individual',
   '00000000-0000-4000-8000-00000000000b'),  -- forged author: the trigger must set the editor
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1', 'a.dxf', 'A-FLOR-STRS', '{"name":"A-FLOR-STRS","texts":["UP"]}', 1, 'wall', 0.39, 'stairs', true, 'individual', NULL),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1', 'a.dxf', 'I-FURN', '{"name":"I-FURN","texts":[]}', 1, 'furniture', 0.99, 'furniture', true, 'group', NULL),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1', 'a.dxf', 'A-GLAZ', '{"name":"A-GLAZ","texts":[]}', 1, 'window', 0.99, 'window', true, 'bulk', NULL),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1', 'a.dxf', 'Layer3', '{"name":"Layer3"}', 1, 'ignore', 0.99, NULL, false, NULL, NULL);
INSERT INTO storage.objects (bucket_id, name) VALUES ('cad-sources', '00000000-0000-4000-8000-0000000000a1/imp/a.dxf');

DO $$
DECLARE r public.layer_labels;
BEGIN
  IF (SELECT count(*) FROM public.layer_labels) <> 5 THEN
    RAISE EXCEPTION 'FAIL: editor A should read exactly venue A''s 5 rows, read %', (SELECT count(*) FROM public.layer_labels);
  END IF;
  IF EXISTS (SELECT 1 FROM public.layer_labels WHERE building_id = '00000000-0000-4000-8000-0000000000b1') THEN
    RAISE EXCEPTION 'FAIL: editor A can read venue B''s layer labels';
  END IF;
  SELECT * INTO r FROM public.layer_labels WHERE layer_name = 'A-WALL';
  IF r.created_by <> '00000000-0000-4000-8000-00000000000d' THEN RAISE EXCEPTION 'FAIL: created_by was forged'; END IF;
  IF r.was_corrected THEN RAISE EXCEPTION 'FAIL: unchanged label marked as corrected'; END IF;
  IF NOT (SELECT was_corrected FROM public.layer_labels WHERE layer_name = 'A-FLOR-STRS') THEN
    RAISE EXCEPTION 'FAIL: wall → stairs not marked as corrected';
  END IF;
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'cad-sources') <> 1 THEN
    RAISE EXCEPTION 'FAIL: editor A should see only venue A''s CAD file';
  END IF;
  IF public.layer_training_consent_current('00000000-0000-4000-8000-0000000000a1') THEN
    RAISE EXCEPTION 'FAIL: venue A has consent before anyone gave it';
  END IF;
END $$;

-- Confirmed needs a confirmation method, and a method needs a confirmation.
DO $$ BEGIN
  INSERT INTO public.layer_labels (building_id, import_id, file_name, layer_name, layer_summary, summarizer_version, ai_label, final_label, human_verified)
  VALUES ('00000000-0000-4000-8000-0000000000a1', gen_random_uuid(), 'a.dxf', 'Z', '{}', 1, 'wall', 'wall', true);
  RAISE EXCEPTION 'FAIL: a row was confirmed without confirmed_via';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO public.layer_labels (building_id, import_id, file_name, layer_name, layer_summary, summarizer_version, ai_label, final_label, human_verified, confirmed_via)
  VALUES ('00000000-0000-4000-8000-0000000000a1', gen_random_uuid(), 'a.dxf', 'Z', '{}', 1, 'wall', 'wall', true, 'everyone');
  RAISE EXCEPTION 'FAIL: confirmed_via accepted a value outside individual/group/bulk';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- A cannot write into venue B: rows or files.
DO $$ BEGIN
  INSERT INTO public.layer_labels (building_id, import_id, file_name, layer_name, layer_summary, summarizer_version, ai_label)
  VALUES ('00000000-0000-4000-8000-0000000000b1', gen_random_uuid(), 'x.dxf', 'X', '{}', 1, 'wall');
  RAISE EXCEPTION 'FAIL: editor A inserted a layer label into venue B';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DO $$ BEGIN
  INSERT INTO storage.objects (bucket_id, name) VALUES ('cad-sources', '00000000-0000-4000-8000-0000000000b1/imp/x.dxf');
  RAISE EXCEPTION 'FAIL: editor A uploaded a CAD file into venue B''s folder';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

-- A cannot change venue B's rows (they are invisible, so nothing is updated).
UPDATE public.layer_labels SET final_label = 'door' WHERE building_id = '00000000-0000-4000-8000-0000000000b1';

-- Reviewing: only review fields change; moving a row to venue B is ignored.
UPDATE public.layer_labels
SET final_label = 'unknown', building_id = '00000000-0000-4000-8000-0000000000b1', ai_label = 'stairs'
WHERE layer_name = 'Layer3';
DO $$
DECLARE r public.layer_labels;
BEGIN
  SELECT * INTO r FROM public.layer_labels WHERE layer_name = 'Layer3';
  IF r.building_id <> '00000000-0000-4000-8000-0000000000a1' OR r.ai_label <> 'ignore' THEN
    RAISE EXCEPTION 'FAIL: an update changed fields other than the review fields';
  END IF;
  IF NOT r.was_corrected THEN RAISE EXCEPTION 'FAIL: ignore → unknown not marked as corrected'; END IF;
END $$;

-- Confirming "unknown" is not allowed: it must be changed to a real label first.
DO $$ BEGIN
  UPDATE public.layer_labels SET human_verified = true, confirmed_via = 'individual' WHERE layer_name = 'Layer3';
  RAISE EXCEPTION 'FAIL: a layer was confirmed as "unknown"';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- Labels outside the fixed list are rejected.
DO $$ BEGIN
  INSERT INTO public.layer_labels (building_id, import_id, file_name, layer_name, layer_summary, summarizer_version, ai_label)
  VALUES ('00000000-0000-4000-8000-0000000000a1', gen_random_uuid(), 'a.dxf', 'Y', '{}', 1, 'walls');
  RAISE EXCEPTION 'FAIL: a label outside the list was stored';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- Editors cannot export training data, or delete rows.
DO $$ BEGIN
  PERFORM * FROM public.layer_label_training_rows();
  RAISE EXCEPTION 'FAIL: an editor exported training data';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DELETE FROM public.layer_labels WHERE layer_name = 'A-WALL';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.layer_labels WHERE layer_name = 'A-WALL') THEN
    RAISE EXCEPTION 'FAIL: an editor deleted a layer label';
  END IF;
END $$;

-- ── Owner A decides consent for venue A, not for venue B ────────────────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

INSERT INTO public.layer_training_consents (building_id, notice_version, accepted)
VALUES ('00000000-0000-4000-8000-0000000000a1', 1, true);
DO $$ BEGIN
  INSERT INTO public.layer_training_consents (building_id, notice_version, accepted)
  VALUES ('00000000-0000-4000-8000-0000000000b1', 1, true);
  RAISE EXCEPTION 'FAIL: owner A recorded consent for venue B';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO public.layer_training_consents (building_id, decided_by, notice_version, accepted)
  VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000d', 1, true);
  RAISE EXCEPTION 'FAIL: consent was recorded in someone else''s name';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  IF NOT public.layer_training_consent_current('00000000-0000-4000-8000-0000000000a1') THEN
    RAISE EXCEPTION 'FAIL: owner A''s consent is not the current decision';
  END IF;
END $$;
-- The decision history is append-only.
DO $$ BEGIN
  DELETE FROM public.layer_training_consents;
  RAISE EXCEPTION 'FAIL: consent history can be deleted';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

-- ── Signed out (anon) ───────────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$ BEGIN
  PERFORM 1 FROM public.layer_labels;
  RAISE EXCEPTION 'FAIL: anon can query layer_labels';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM 1 FROM public.layer_training_consents;
  RAISE EXCEPTION 'FAIL: anon can query training consents';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'cad-sources') THEN
    RAISE EXCEPTION 'FAIL: anon can see CAD files';
  END IF;
END $$;

-- ── Platform admin ──────────────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

DO $$ BEGIN
  IF (SELECT count(*) FROM public.layer_labels
      WHERE building_id IN ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1')) <> 6 THEN
    RAISE EXCEPTION 'FAIL: the platform admin should read all 6 test rows across both venues';
  END IF;
  IF (SELECT final_label FROM public.layer_labels WHERE layer_name = 'B-WALL') <> 'wall' THEN
    RAISE EXCEPTION 'FAIL: editor A changed a row of venue B';
  END IF;
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'cad-sources'
      AND name LIKE '00000000-0000-4000-8000-0000000000_1/%') <> 2 THEN
    RAISE EXCEPTION 'FAIL: the platform admin should see both venues'' CAD files';
  END IF;
END $$;

-- Export: confirmed individually or by group, on venues with consent NOW.
--   A-WALL, A-FLOR-STRS (individual), I-FURN (group) → in
--   A-GLAZ (bulk) → out;  Layer3 (not confirmed) → out;  B-WALL (no consent) → out
DO $$
DECLARE names text; texts jsonb;
BEGIN
  SELECT string_agg(layer_name, ',' ORDER BY layer_name) INTO names
  FROM public.layer_label_training_rows()
  WHERE building_id IN ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1');
  IF names IS DISTINCT FROM 'A-FLOR-STRS,A-WALL,I-FURN' THEN
    RAISE EXCEPTION 'FAIL: export returned [%], expected [A-FLOR-STRS,A-WALL,I-FURN]', names;
  END IF;
  -- Text samples are left out unless asked for.
  SELECT layer_summary -> 'texts' INTO texts FROM public.layer_label_training_rows() WHERE layer_name = 'A-WALL';
  IF texts IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'FAIL: export included text samples by default: %', texts; END IF;
  SELECT layer_summary -> 'texts' INTO texts FROM public.layer_label_training_rows(true) WHERE layer_name = 'A-WALL';
  IF texts IS DISTINCT FROM '["Lobby"]'::jsonb THEN RAISE EXCEPTION 'FAIL: include_texts did not return the text samples'; END IF;
  -- The stored row keeps its texts (only the export drops them).
  IF (SELECT layer_summary -> 'texts' FROM public.layer_labels WHERE layer_name = 'A-WALL') <> '["Lobby"]'::jsonb THEN
    RAISE EXCEPTION 'FAIL: export changed the stored layer summary';
  END IF;
END $$;

-- Platform admins cannot decide for an institution's venue.
DO $$ BEGIN
  INSERT INTO public.layer_training_consents (building_id, notice_version, accepted)
  VALUES ('00000000-0000-4000-8000-0000000000b1', 1, true);
  RAISE EXCEPTION 'FAIL: a platform admin decided consent for an institution''s venue';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

-- ── Owner A revokes: venue A leaves every FUTURE export ─────────────────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
INSERT INTO public.layer_training_consents (building_id, notice_version, accepted)
VALUES ('00000000-0000-4000-8000-0000000000a1', 1, false);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.layer_label_training_rows()
             WHERE building_id = '00000000-0000-4000-8000-0000000000a1') THEN
    RAISE EXCEPTION 'FAIL: rows of a venue whose consent was revoked are still exported';
  END IF;
  IF (SELECT count(*) FROM public.layer_labels WHERE building_id = '00000000-0000-4000-8000-0000000000a1') <> 5 THEN
    RAISE EXCEPTION 'FAIL: revoking consent should keep the venue''s rows (only exports change)';
  END IF;
END $$;

DELETE FROM public.layer_labels WHERE layer_name = 'Layer3';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.layer_labels WHERE layer_name = 'Layer3') THEN
    RAISE EXCEPTION 'FAIL: the platform admin could not delete a layer label';
  END IF;
END $$;

RESET ROLE;
SELECT 'layer_labels access: all checks passed' AS result;
ROLLBACK;
