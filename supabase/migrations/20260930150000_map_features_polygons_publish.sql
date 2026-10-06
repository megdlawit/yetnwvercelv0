-- Map objects, polygon rooms, and publish enforced by the database.
-- Idempotent: safe to re-run.

-- 1. Polygon rooms -------------------------------------------------------------
-- Rooms were axis-aligned rectangles only. A polygon (editor px, [[x,y],...])
-- now overrides the rectangle when present; x/y/width/height are kept as its
-- bounding box so everything that only understands rectangles still works.
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS polygon jsonb;

-- 2. Map features --------------------------------------------------------------
-- Point objects on a floor that aren't walls, rooms or path nodes: doors,
-- stairs, lifts, entrances, trees, benches, furniture, landmarks, windows and
-- free-text labels. Imported ones carry source = 'dxf-import' (or the format
-- they came from) so a re-import can replace them without touching manual ones.
CREATE TABLE IF NOT EXISTS public.map_features (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id  uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  floor_id     uuid NOT NULL REFERENCES public.floors(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  x            double precision NOT NULL,
  y            double precision NOT NULL,
  rotation_deg double precision NOT NULL DEFAULT 0,
  width        double precision,   -- editor px; NULL = the kind's default size
  depth        double precision,
  label        text,
  source       text NOT NULL DEFAULT 'manual',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_features_kind_check') THEN
    ALTER TABLE public.map_features ADD CONSTRAINT map_features_kind_check CHECK (kind IN
      ('door','window','stairs','elevator','entrance','tree','bench','furniture','landmark','label'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_map_features_floor_source ON public.map_features(floor_id, source);

DROP TRIGGER IF EXISTS update_map_features_updated_at ON public.map_features;
CREATE TRIGGER update_map_features_updated_at
  BEFORE UPDATE ON public.map_features
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.map_features ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read map_features" ON public.map_features;
DROP POLICY IF EXISTS "Editors write map_features" ON public.map_features;
CREATE POLICY "Anyone can read map_features" ON public.map_features FOR SELECT USING (true);
CREATE POLICY "Editors write map_features" ON public.map_features FOR ALL TO authenticated
  USING (public.user_can_edit_building(building_id))
  WITH CHECK (public.user_can_edit_building(building_id));
GRANT SELECT ON public.map_features TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.map_features TO authenticated;

-- 3. Publish ------------------------------------------------------------------
-- buildings.is_published already exists and the visitor app filters on it,
-- but anyone could still read an unpublished venue straight from the API.
-- Visitors (anon, or signed in via OTP) now only see published venues; the
-- venue's own editors always see theirs. The partner API uses the service
-- role and checks is_published itself.
DROP POLICY IF EXISTS "Anon users can read buildings" ON public.buildings;
DROP POLICY IF EXISTS "Authenticated users can read buildings" ON public.buildings;
DROP POLICY IF EXISTS "Anyone can read buildings" ON public.buildings;
DROP POLICY IF EXISTS "Published or editable buildings are readable" ON public.buildings;
CREATE POLICY "Published or editable buildings are readable" ON public.buildings FOR SELECT
  USING (is_published OR public.user_can_edit_building(id));
