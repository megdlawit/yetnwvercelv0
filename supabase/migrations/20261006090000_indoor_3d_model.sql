-- Indoor 3D model: what the 3D renderer and turn-by-turn guidance need from a
-- floor plan, added to the tables the editor already writes (no duplicates).
--
--   floors        elevation, ceiling height, display order, Amharic name
--   walls         thickness, height, material
--   map_features  doors / arches / windows anchored to a wall (offset, width,
--                 height, sill); stairs / lifts joining two floors (step
--                 count, landing, step-free flag). A stair climbs along its
--                 own depth axis, turned by rotation_deg like every feature.
--   rooms         Amharic name, floor material, ceiling on/off
--   pois          the room they belong to, Amharic name and blurb
--   edges         'door' joins stairs / elevator / ramp / escalator as an
--                 edge kind (NULL = an ordinary walk)
--
-- NULL in a size column always means "use the default" (floor: level × 3.5 m
-- and the venue's wall height; wall: the floor's ceiling; opening: the kind's
-- size), so venues drawn before this migration render exactly as they did.
-- Plan coordinates stay in editor pixels (40 px = 1 m); sizes added here are
-- in metres. New columns inherit each table's existing RLS policies (anyone
-- reads, the venue's editors write — public.user_can_edit_building).
-- Idempotent: safe to re-run.

-- 1. Floors --------------------------------------------------------------------
ALTER TABLE public.floors ADD COLUMN IF NOT EXISTS elevation_m      double precision;
ALTER TABLE public.floors ADD COLUMN IF NOT EXISTS ceiling_height_m double precision;
ALTER TABLE public.floors ADD COLUMN IF NOT EXISTS sort_order       integer;
ALTER TABLE public.floors ADD COLUMN IF NOT EXISTS name_am          text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'floors_ceiling_height_check') THEN
    ALTER TABLE public.floors ADD CONSTRAINT floors_ceiling_height_check
      CHECK (ceiling_height_m IS NULL OR ceiling_height_m BETWEEN 2 AND 30);
  END IF;
END $$;

-- 2. Walls ---------------------------------------------------------------------
ALTER TABLE public.walls ADD COLUMN IF NOT EXISTS thickness_m double precision;
ALTER TABLE public.walls ADD COLUMN IF NOT EXISTS height_m    double precision;
ALTER TABLE public.walls ADD COLUMN IF NOT EXISTS material    text NOT NULL DEFAULT 'plaster';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'walls_thickness_check') THEN
    ALTER TABLE public.walls ADD CONSTRAINT walls_thickness_check CHECK (thickness_m IS NULL OR thickness_m BETWEEN 0.03 AND 2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'walls_height_check') THEN
    ALTER TABLE public.walls ADD CONSTRAINT walls_height_check CHECK (height_m IS NULL OR height_m BETWEEN 0.3 AND 30);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'walls_material_check') THEN
    ALTER TABLE public.walls ADD CONSTRAINT walls_material_check
      CHECK (material IN ('plaster', 'brick', 'concrete', 'glass', 'wood', 'stone'));
  END IF;
END $$;

-- 3. Rooms ---------------------------------------------------------------------
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS name_am        text;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS floor_material text NOT NULL DEFAULT 'tile';
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS has_ceiling    boolean NOT NULL DEFAULT true;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rooms_floor_material_check') THEN
    ALTER TABLE public.rooms ADD CONSTRAINT rooms_floor_material_check
      CHECK (floor_material IN ('tile', 'wood', 'carpet', 'concrete', 'stone', 'marble', 'grass'));
  END IF;
END $$;

-- 4. Openings and vertical connectors (map_features) ---------------------------
ALTER TABLE public.map_features ADD COLUMN IF NOT EXISTS wall_id       uuid REFERENCES public.walls(id) ON DELETE SET NULL;
ALTER TABLE public.map_features ADD COLUMN IF NOT EXISTS offset_m      double precision; -- opening centre, metres from the wall's (x1,y1) end
ALTER TABLE public.map_features ADD COLUMN IF NOT EXISTS height_m      double precision; -- opening height
ALTER TABLE public.map_features ADD COLUMN IF NOT EXISTS sill_m        double precision; -- windows: bottom edge above the floor
ALTER TABLE public.map_features ADD COLUMN IF NOT EXISTS from_floor_id uuid REFERENCES public.floors(id) ON DELETE SET NULL;
ALTER TABLE public.map_features ADD COLUMN IF NOT EXISTS to_floor_id   uuid REFERENCES public.floors(id) ON DELETE SET NULL;
ALTER TABLE public.map_features ADD COLUMN IF NOT EXISTS step_count    integer;
ALTER TABLE public.map_features ADD COLUMN IF NOT EXISTS landing       text;
ALTER TABLE public.map_features ADD COLUMN IF NOT EXISTS accessible    boolean;           -- NULL = the kind's default (lift yes, stairs no)
ALTER TABLE public.map_features ADD COLUMN IF NOT EXISTS label_am      text;
CREATE INDEX IF NOT EXISTS idx_map_features_wall ON public.map_features(wall_id);

DO $$ BEGIN
  -- 'arch': an opening with no door leaf.
  ALTER TABLE public.map_features DROP CONSTRAINT IF EXISTS map_features_kind_check;
  ALTER TABLE public.map_features ADD CONSTRAINT map_features_kind_check CHECK (kind IN
    ('door', 'arch', 'window', 'stairs', 'elevator', 'entrance', 'tree', 'bench', 'furniture', 'landmark', 'label'));
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_features_landing_check') THEN
    ALTER TABLE public.map_features ADD CONSTRAINT map_features_landing_check CHECK (landing IS NULL OR landing IN ('none', 'mid', 'top'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_features_step_count_check') THEN
    ALTER TABLE public.map_features ADD CONSTRAINT map_features_step_count_check CHECK (step_count IS NULL OR step_count BETWEEN 2 AND 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_features_opening_size_check') THEN
    ALTER TABLE public.map_features ADD CONSTRAINT map_features_opening_size_check CHECK (
      (height_m IS NULL OR height_m BETWEEN 0.2 AND 10) AND (sill_m IS NULL OR sill_m BETWEEN 0 AND 5) AND (offset_m IS NULL OR offset_m >= 0));
  END IF;
END $$;

-- Anchor the doors and windows drawn so far to the wall they sit on (within
-- 0.75 m), so the renderer can cut a real opening. The renderer snaps any it
-- still finds unanchored the same way (e.g. after a CAD re-import replaces
-- the walls), so this is a head start, not a requirement.
WITH scale AS (
  SELECT id, CASE WHEN meters_per_pixel > 0 AND meters_per_pixel < 0.5 THEN 1 / meters_per_pixel ELSE 40 END AS ppm
  FROM public.buildings
), cand AS (
  SELECT DISTINCT ON (f.id) f.id AS fid, w.id AS wid, t * len AS along_px, dist
  FROM public.map_features f
  JOIN public.walls w ON w.floor_id = f.floor_id
  CROSS JOIN LATERAL (SELECT w.x2 - w.x1 AS dx, w.y2 - w.y1 AS dy) d
  CROSS JOIN LATERAL (SELECT sqrt(d.dx * d.dx + d.dy * d.dy) AS len) l
  CROSS JOIN LATERAL (SELECT greatest(0, least(1, ((f.x - w.x1) * d.dx + (f.y - w.y1) * d.dy) / nullif(l.len * l.len, 0))) AS t) tt
  CROSS JOIN LATERAL (SELECT sqrt(power(f.x - (w.x1 + tt.t * d.dx), 2) + power(f.y - (w.y1 + tt.t * d.dy), 2)) AS dist) dd
  WHERE f.kind IN ('door', 'arch', 'window') AND f.wall_id IS NULL AND l.len > 0
  ORDER BY f.id, dd.dist
)
UPDATE public.map_features m
SET wall_id = c.wid, offset_m = c.along_px / s.ppm
FROM cand c, scale s
WHERE m.id = c.fid AND s.id = m.building_id AND c.dist <= 0.75 * s.ppm;

-- 5. Places ----------------------------------------------------------------------
ALTER TABLE public.pois ADD COLUMN IF NOT EXISTS room_id        uuid REFERENCES public.rooms(id) ON DELETE SET NULL;
ALTER TABLE public.pois ADD COLUMN IF NOT EXISTS name_am        text;
ALTER TABLE public.pois ADD COLUMN IF NOT EXISTS description_am text;
CREATE INDEX IF NOT EXISTS idx_pois_room ON public.pois(room_id);
-- A place on a room's path point belongs to that room.
UPDATE public.pois p SET room_id = r.id
FROM public.rooms r
WHERE p.room_id IS NULL AND r.node_id IS NOT NULL AND r.node_id = p.node_id;

-- 6. Path graph edge kinds ------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.edges DROP CONSTRAINT IF EXISTS edges_connection_check;
  ALTER TABLE public.edges ADD CONSTRAINT edges_connection_check
    CHECK (connection IS NULL OR connection IN ('door', 'stairs', 'elevator', 'ramp', 'escalator'));
END $$;
