-- Track where a row came from so a DXF re-import only replaces what it created.
ALTER TABLE public.walls ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS idx_walls_floor_source ON public.walls(floor_id, source);
CREATE INDEX IF NOT EXISTS idx_rooms_floor_source ON public.rooms(floor_id, source);
