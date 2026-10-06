-- Reference wall geometry per floor (from DXF import). Idempotent.
CREATE TABLE IF NOT EXISTS public.walls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  floor_id    uuid NOT NULL REFERENCES public.floors(id) ON DELETE CASCADE,
  x1 double precision NOT NULL, y1 double precision NOT NULL,
  x2 double precision NOT NULL, y2 double precision NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_walls_floor    ON public.walls(floor_id);
CREATE INDEX IF NOT EXISTS idx_walls_building ON public.walls(building_id);

ALTER TABLE public.walls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read walls" ON public.walls;
DROP POLICY IF EXISTS "Editors can write walls" ON public.walls;
CREATE POLICY "Anyone can read walls" ON public.walls FOR SELECT USING (true);
CREATE POLICY "Editors can write walls" ON public.walls FOR ALL TO authenticated
  USING (public.user_can_edit_building(building_id))
  WITH CHECK (public.user_can_edit_building(building_id));
