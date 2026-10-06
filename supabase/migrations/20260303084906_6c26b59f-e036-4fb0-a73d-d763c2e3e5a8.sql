
CREATE TABLE public.floors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  svg_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.floors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read floors" ON public.floors FOR SELECT USING (true);
CREATE POLICY "Anyone can insert floors" ON public.floors FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update floors" ON public.floors FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete floors" ON public.floors FOR DELETE USING (true);

CREATE TRIGGER update_floors_updated_at
  BEFORE UPDATE ON public.floors
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_floors_building_id ON public.floors(building_id);
