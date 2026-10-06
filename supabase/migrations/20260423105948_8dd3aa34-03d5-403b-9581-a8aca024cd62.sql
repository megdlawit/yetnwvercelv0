-- POIs table
CREATE TABLE public.pois (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  node_id UUID NOT NULL,
  building_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'attraction',
  subcategory TEXT DEFAULT '',
  image_url TEXT,
  audio_url TEXT,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  trigger_radius INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_pois_building ON public.pois(building_id);
CREATE INDEX idx_pois_node ON public.pois(node_id);
CREATE INDEX idx_pois_category ON public.pois(category);

ALTER TABLE public.pois ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read pois" ON public.pois FOR SELECT USING (true);
CREATE POLICY "Anyone can insert pois" ON public.pois FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update pois" ON public.pois FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete pois" ON public.pois FOR DELETE USING (true);

CREATE TRIGGER update_pois_updated_at
BEFORE UPDATE ON public.pois
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Promotions table
CREATE TABLE public.promotions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  poi_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  discount_text TEXT DEFAULT '',
  badge_color TEXT DEFAULT 'primary',
  starts_at TIMESTAMP WITH TIME ZONE,
  ends_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_promotions_poi ON public.promotions(poi_id);
CREATE INDEX idx_promotions_active ON public.promotions(is_active);

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read promotions" ON public.promotions FOR SELECT USING (true);
CREATE POLICY "Anyone can insert promotions" ON public.promotions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update promotions" ON public.promotions FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete promotions" ON public.promotions FOR DELETE USING (true);

CREATE TRIGGER update_promotions_updated_at
BEFORE UPDATE ON public.promotions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed sample POIs for the existing Addis Ababa Office Complex sample
-- (uses the first 4 nodes of the building if it exists)
DO $$
DECLARE
  v_building_id UUID := '11111111-1111-1111-1111-111111111111';
  v_node RECORD;
  v_count INTEGER := 0;
  v_poi_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.buildings WHERE id = v_building_id) THEN
    FOR v_node IN
      SELECT id, name FROM public.nodes
      WHERE building_id = v_building_id AND is_hallway = false
      ORDER BY created_at LIMIT 4
    LOOP
      v_count := v_count + 1;
      v_poi_id := gen_random_uuid();

      IF v_count = 1 THEN
        INSERT INTO public.pois (id, node_id, building_id, name, description, category, subcategory, is_featured, trigger_radius)
        VALUES (v_poi_id, v_node.id, v_building_id, 'Welcome Desk', 'Reception and visitor services', 'service', 'info', true, 8);
      ELSIF v_count = 2 THEN
        INSERT INTO public.pois (id, node_id, building_id, name, description, category, subcategory, is_featured, trigger_radius)
        VALUES (v_poi_id, v_node.id, v_building_id, 'Habesha Coffee Shop', 'Authentic Ethiopian coffee and pastries', 'retail', 'cafe', true, 6);
        INSERT INTO public.promotions (poi_id, title, description, discount_text, badge_color, is_active)
        VALUES (v_poi_id, 'Morning Special', 'Buy 1 macchiato, get 1 free', '50% OFF', 'primary', true);
      ELSIF v_count = 3 THEN
        INSERT INTO public.pois (id, node_id, building_id, name, description, category, subcategory, is_featured, trigger_radius)
        VALUES (v_poi_id, v_node.id, v_building_id, 'Tech Hub', 'Innovation lab and meeting space', 'education', 'lab', false, 5);
      ELSE
        INSERT INTO public.pois (id, node_id, building_id, name, description, category, subcategory, is_featured, trigger_radius)
        VALUES (v_poi_id, v_node.id, v_building_id, 'ATM & Banking', 'CBE banking corner', 'service', 'atm', false, 5);
      END IF;
    END LOOP;
  END IF;
END $$;