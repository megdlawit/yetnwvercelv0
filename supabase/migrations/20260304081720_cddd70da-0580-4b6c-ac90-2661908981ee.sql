
-- NODES table
CREATE TABLE public.nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  floor_id uuid NOT NULL REFERENCES public.floors(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  x integer NOT NULL DEFAULT 0,
  y integer NOT NULL DEFAULT 0,
  is_hallway boolean NOT NULL DEFAULT false,
  type text NOT NULL DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nodes_floor ON public.nodes(floor_id);
CREATE INDEX idx_nodes_building ON public.nodes(building_id);

ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read nodes" ON public.nodes FOR SELECT USING (true);
CREATE POLICY "Anyone can insert nodes" ON public.nodes FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update nodes" ON public.nodes FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete nodes" ON public.nodes FOR DELETE USING (true);

CREATE TRIGGER update_nodes_updated_at
  BEFORE UPDATE ON public.nodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- EDGES table
CREATE TABLE public.edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  from_node uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  to_node uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  weight integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_edges_building ON public.edges(building_id);

ALTER TABLE public.edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read edges" ON public.edges FOR SELECT USING (true);
CREATE POLICY "Anyone can insert edges" ON public.edges FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update edges" ON public.edges FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete edges" ON public.edges FOR DELETE USING (true);

CREATE TRIGGER update_edges_updated_at
  BEFORE UPDATE ON public.edges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
