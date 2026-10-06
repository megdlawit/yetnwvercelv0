-- Venue Experience Map Layer — curated outdoor walkable paths.
--
-- Replaces the live OpenStreetMap Overpass fetch (OutdoorMapEngine) for
-- outdoor path rendering. That fetch was slow, rate-limited, and frequently
-- timed out, leaving the outdoor map stuck on a loading spinner. These
-- tables hold venue-curated paths instead — fast, reliable, and editable
-- from an admin UI — while POI data, GPS positioning, and routing math are
-- unchanged (this only replaces where path *geometry* comes from).
--
-- venue_nodes: junction/anchor points along a path (corners, intersections,
--              entrances) — independent of pois, which represent
--              attractions/destinations rather than path geometry.
-- venue_paths: edges connecting two venue_nodes (or a venue_node and a POI),
--              forming the walkable graph for a building/venue.

CREATE TABLE IF NOT EXISTS public.venue_nodes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  kind TEXT NOT NULL DEFAULT 'junction', -- junction | entrance | landmark
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_nodes_building ON public.venue_nodes(building_id);

ALTER TABLE public.venue_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read venue_nodes" ON public.venue_nodes FOR SELECT USING (true);
CREATE POLICY "Anyone can insert venue_nodes" ON public.venue_nodes FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update venue_nodes" ON public.venue_nodes FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete venue_nodes" ON public.venue_nodes FOR DELETE USING (true);

CREATE TRIGGER update_venue_nodes_updated_at
  BEFORE UPDATE ON public.venue_nodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- venue_paths: each endpoint is EITHER a venue_node OR a poi (exactly one
-- of from_node/from_poi must be set, same for to_node/to_poi), so paths can
-- connect junctions to attractions directly without a redundant node.
CREATE TABLE IF NOT EXISTS public.venue_paths (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  from_node UUID REFERENCES public.venue_nodes(id) ON DELETE CASCADE,
  from_poi UUID REFERENCES public.pois(id) ON DELETE CASCADE,
  to_node UUID REFERENCES public.venue_nodes(id) ON DELETE CASCADE,
  to_poi UUID REFERENCES public.pois(id) ON DELETE CASCADE,
  path_type TEXT NOT NULL DEFAULT 'main', -- main | secondary | steps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT venue_paths_from_check CHECK (
    (from_node IS NOT NULL AND from_poi IS NULL) OR (from_node IS NULL AND from_poi IS NOT NULL)
  ),
  CONSTRAINT venue_paths_to_check CHECK (
    (to_node IS NOT NULL AND to_poi IS NULL) OR (to_node IS NULL AND to_poi IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_venue_paths_building ON public.venue_paths(building_id);

ALTER TABLE public.venue_paths ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read venue_paths" ON public.venue_paths FOR SELECT USING (true);
CREATE POLICY "Anyone can insert venue_paths" ON public.venue_paths FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update venue_paths" ON public.venue_paths FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete venue_paths" ON public.venue_paths FOR DELETE USING (true);

CREATE TRIGGER update_venue_paths_updated_at
  BEFORE UPDATE ON public.venue_paths
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
