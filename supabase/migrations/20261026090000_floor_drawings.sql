-- The architect's drawing of each floor, for the visitor map: walls with their fills,
-- doors and swings, windows, stairs, lifts, furniture and fixtures, planting — by kind
-- (src/lib/cad/planDrawing.ts). Written by the CAD import; dimensions, grids, notes and
-- the title block are never kept.
--
--   drawing   = the latest import (what the team previews)
--   published = the copy visitors see, taken whenever the venue is published
--
-- Kept out of floors on purpose: publish_venue copies whole floor rows into the snapshot
-- that every venue list reads, and a drawing can be a megabyte or two.
--
-- Idempotent: safe to re-run. Apply to the STAGING project first.

CREATE TABLE IF NOT EXISTS public.floor_drawings (
  floor_id    uuid PRIMARY KEY REFERENCES public.floors(id) ON DELETE CASCADE,
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  drawing     jsonb NOT NULL,
  published   jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_floor_drawings_building ON public.floor_drawings(building_id);

ALTER TABLE public.floor_drawings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Published or own floor drawings" ON public.floor_drawings;
DROP POLICY IF EXISTS "Editors write floor drawings" ON public.floor_drawings;
CREATE POLICY "Published or own floor drawings" ON public.floor_drawings FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.buildings b WHERE b.id = building_id AND b.is_published) OR public.user_can_edit_building(building_id));
CREATE POLICY "Editors write floor drawings" ON public.floor_drawings FOR ALL TO authenticated
  USING (public.user_can_edit_building(building_id))
  WITH CHECK (public.user_can_edit_building(building_id));
GRANT SELECT ON public.floor_drawings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.floor_drawings TO authenticated;

-- Publishing writes the venue's snapshot; the drawings are published with it.
CREATE OR REPLACE FUNCTION public.publish_floor_drawings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.floor_drawings SET published = drawing WHERE building_id = NEW.building_id;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.publish_floor_drawings() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS publish_floor_drawings ON public.venue_snapshots;
CREATE TRIGGER publish_floor_drawings AFTER INSERT OR UPDATE OF data ON public.venue_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.publish_floor_drawings();
