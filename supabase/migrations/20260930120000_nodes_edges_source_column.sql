ALTER TABLE public.nodes ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.edges ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS idx_nodes_floor_source ON public.nodes(floor_id, source);
