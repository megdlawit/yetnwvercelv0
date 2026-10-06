-- Saved / bookmarked places.
-- Links a profile to a POI they've bookmarked, so it can be shown in the
-- "Saved" tab and shared as a link/text.

CREATE TABLE IF NOT EXISTS public.saved_places (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  poi_id UUID NOT NULL REFERENCES public.pois(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (profile_id, poi_id)
);

ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;

-- The app currently has no login flow (see useUserProfile), so reads/writes
-- happen as the anon role, scoped to a single profile row. If real auth is
-- added later, tighten these policies to check auth.uid() against profiles.user_id.

CREATE POLICY "Public read access for saved_places"
  ON public.saved_places FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public insert access for saved_places"
  ON public.saved_places FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Public delete access for saved_places"
  ON public.saved_places FOR DELETE
  TO anon, authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS saved_places_profile_id_idx ON public.saved_places(profile_id);
CREATE INDEX IF NOT EXISTS saved_places_poi_id_idx ON public.saved_places(poi_id);
