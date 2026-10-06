-- Admin-curated places shown under "Popular" in the map search panel.
ALTER TABLE public.pois
  ADD COLUMN IF NOT EXISTS is_search_popular boolean NOT NULL DEFAULT false;

ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS is_search_popular boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS pois_search_popular_idx
  ON public.pois (is_search_popular)
  WHERE is_search_popular = true;

CREATE INDEX IF NOT EXISTS buildings_search_popular_idx
  ON public.buildings (is_search_popular)
  WHERE is_search_popular = true;
