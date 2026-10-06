-- Phase 2: full place details, venue content, and visual themes.
-- Idempotent: safe to re-run.

-- 1. Places (pois) ---------------------------------------------------------
-- The visitor-facing type of place. The existing `category` column (retail /
-- attraction / service / education) stays, kept in step by the app, so the
-- existing visitor app and partner API keep working.
ALTER TABLE public.pois ADD COLUMN IF NOT EXISTS place_type text;
ALTER TABLE public.pois ADD COLUMN IF NOT EXISTS custom_type text;          -- label when place_type = 'custom'
ALTER TABLE public.pois ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}';
-- {"mon":[["08:00","18:00"]], …, "note":"Closed on public holidays"}; NULL = not set
ALTER TABLE public.pois ADD COLUMN IF NOT EXISTS opening_hours jsonb;
-- {"wheelchair":true,"stepFree":true,"accessibleToilet":false,"notes":"…"}
ALTER TABLE public.pois ADD COLUMN IF NOT EXISTS accessibility jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.pois ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true;   -- shown to visitors
ALTER TABLE public.pois ADD COLUMN IF NOT EXISTS navigable boolean NOT NULL DEFAULT true;    -- "Navigate here" offered
ALTER TABLE public.pois ADD COLUMN IF NOT EXISTS floor_id uuid REFERENCES public.floors(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pois_place_type_check') THEN
    ALTER TABLE public.pois ADD CONSTRAINT pois_place_type_check CHECK (place_type IS NULL OR place_type IN (
      'attraction', 'garden', 'cafe', 'restroom', 'parking', 'entrance', 'info_desk',
      'play_area', 'viewpoint', 'cultural_site', 'custom'));
  END IF;
END $$;
-- A place may be outdoors with only lat/lng, so it needn't sit on a path node.
ALTER TABLE public.pois ALTER COLUMN node_id DROP NOT NULL;

-- 2. Venue content ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venue_content (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id  uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  title        text NOT NULL,
  summary      text,
  body         text,
  image_url    text,
  poi_id       uuid REFERENCES public.pois(id) ON DELETE SET NULL,  -- the place it's about, if any
  starts_at    timestamptz,                                          -- events / announcements
  ends_at      timestamptz,
  is_published boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venue_content_kind_check') THEN
    ALTER TABLE public.venue_content ADD CONSTRAINT venue_content_kind_check
      CHECK (kind IN ('story', 'guide', 'announcement', 'event', 'educational'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_venue_content_building ON public.venue_content(building_id, kind);

DROP TRIGGER IF EXISTS update_venue_content_updated_at ON public.venue_content;
CREATE TRIGGER update_venue_content_updated_at
  BEFORE UPDATE ON public.venue_content
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.venue_content ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Visitors read published content" ON public.venue_content;
DROP POLICY IF EXISTS "Editors manage content" ON public.venue_content;
-- Visitors see published items of published venues; editors see everything of theirs.
CREATE POLICY "Visitors read published content" ON public.venue_content FOR SELECT
  USING (
    (is_published AND EXISTS (SELECT 1 FROM public.buildings b WHERE b.id = building_id AND b.is_published))
    OR public.user_can_edit_building(building_id)
  );
CREATE POLICY "Editors manage content" ON public.venue_content FOR ALL TO authenticated
  USING (public.user_can_edit_building(building_id))
  WITH CHECK (public.user_can_edit_building(building_id));
GRANT SELECT ON public.venue_content TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_content TO authenticated;

-- 3. Theme --------------------------------------------------------------------
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'park';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buildings_theme_check') THEN
    ALTER TABLE public.buildings ADD CONSTRAINT buildings_theme_check CHECK (theme IN ('park', 'heritage', 'modern'));
  END IF;
END $$;
