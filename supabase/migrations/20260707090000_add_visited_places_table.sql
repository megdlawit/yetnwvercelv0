-- Visited places history.
-- Records which POIs a profile has actually been to (as opposed to
-- saved_places, which is just a bookmark list), so it can power a
-- "Places you've been" history in the Saved/Profile UI.
--
-- A visit is recorded either automatically (arriving via turn-by-turn
-- navigation, or anchoring location with a QR scan at a POI) or manually
-- (user taps "Mark as visited" on a POI's detail card). Repeat visits to
-- the same POI update the existing row instead of creating duplicates.

CREATE TABLE IF NOT EXISTS public.visited_places (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  poi_id UUID NOT NULL REFERENCES public.pois(id) ON DELETE CASCADE,
  visit_count INTEGER NOT NULL DEFAULT 1,
  -- Source of the most recent visit: 'auto' (navigation arrival / QR anchor)
  -- or 'manual' (user tapped "Mark as visited").
  source TEXT NOT NULL DEFAULT 'auto',
  first_visited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_visited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (profile_id, poi_id)
);

ALTER TABLE public.visited_places ENABLE ROW LEVEL SECURITY;

-- The app currently has no login flow (see useUserProfile), so reads/writes
-- happen as the anon role, scoped to a single profile row. If real auth is
-- added later, tighten these policies to check auth.uid() against profiles.user_id.

CREATE POLICY "Public read access for visited_places"
  ON public.visited_places FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public insert access for visited_places"
  ON public.visited_places FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Public update access for visited_places"
  ON public.visited_places FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public delete access for visited_places"
  ON public.visited_places FOR DELETE
  TO anon, authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS visited_places_profile_id_idx ON public.visited_places(profile_id);
CREATE INDEX IF NOT EXISTS visited_places_poi_id_idx ON public.visited_places(poi_id);
CREATE INDEX IF NOT EXISTS visited_places_last_visited_at_idx ON public.visited_places(last_visited_at DESC);
