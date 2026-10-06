
CREATE TABLE public.buildings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;

-- For now, allow all authenticated users full access (admin auth can be added later)
CREATE POLICY "Authenticated users can read buildings"
  ON public.buildings FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert buildings"
  ON public.buildings FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update buildings"
  ON public.buildings FOR UPDATE TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete buildings"
  ON public.buildings FOR DELETE TO authenticated
  USING (true);

-- Also allow anon access for development (remove in production)
CREATE POLICY "Anon users can read buildings"
  ON public.buildings FOR SELECT TO anon
  USING (true);

CREATE POLICY "Anon users can insert buildings"
  ON public.buildings FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Anon users can update buildings"
  ON public.buildings FOR UPDATE TO anon
  USING (true);

CREATE POLICY "Anon users can delete buildings"
  ON public.buildings FOR DELETE TO anon
  USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_buildings_updated_at
  BEFORE UPDATE ON public.buildings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
