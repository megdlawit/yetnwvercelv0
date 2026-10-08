-- A visitor's saved places, visits and activity, for any place on any venue.
--
-- Venue places are path points (nodes), and most have no row in `pois`, so
-- the old foreign keys to pois(id) made saving and visiting them fail. The
-- keys go; each row keeps a small snapshot instead (name, photo, venue), so
-- the Saved list and the profile can show a place from any venue. The app
-- keeps everything on the device first (lib/visitor/visitorStore), so it
-- works before this runs — this lets it follow the visitor to other devices.
--
-- visitor_activities: the profile's activity feed (walks, visits, saves).
-- Same access model as saved_places / visited_places: the visitor app runs
-- as anon with a guest profile id (see useUserProfile).

ALTER TABLE public.saved_places DROP CONSTRAINT IF EXISTS saved_places_poi_id_fkey;
ALTER TABLE public.saved_places
  ADD COLUMN IF NOT EXISTS building_id uuid,
  ADD COLUMN IF NOT EXISTS node_id     text,
  ADD COLUMN IF NOT EXISTS name        text,
  ADD COLUMN IF NOT EXISTS detail      text,
  ADD COLUMN IF NOT EXISTS image_url   text,
  ADD COLUMN IF NOT EXISTS category    text,
  ADD COLUMN IF NOT EXISTS venue_name  text;

ALTER TABLE public.visited_places DROP CONSTRAINT IF EXISTS visited_places_poi_id_fkey;
ALTER TABLE public.visited_places
  ADD COLUMN IF NOT EXISTS building_id uuid,
  ADD COLUMN IF NOT EXISTS node_id     text,
  ADD COLUMN IF NOT EXISTS name        text,
  ADD COLUMN IF NOT EXISTS detail      text,
  ADD COLUMN IF NOT EXISTS image_url   text,
  ADD COLUMN IF NOT EXISTS category    text,
  ADD COLUMN IF NOT EXISTS venue_name  text;

CREATE TABLE IF NOT EXISTS public.visitor_activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('walk', 'visit', 'save')),
  title       text NOT NULL DEFAULT '',
  place_id    text,
  building_id uuid,
  venue_name  text,
  steps       integer,
  meters      real,
  seconds     integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visitor_activities_profile_idx ON public.visitor_activities(profile_id, created_at DESC);

ALTER TABLE public.visitor_activities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'visitor_activities' AND policyname = 'Public read access for visitor_activities') THEN
    CREATE POLICY "Public read access for visitor_activities" ON public.visitor_activities FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'visitor_activities' AND policyname = 'Public insert access for visitor_activities') THEN
    CREATE POLICY "Public insert access for visitor_activities" ON public.visitor_activities FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'visitor_activities' AND policyname = 'Public delete access for visitor_activities') THEN
    CREATE POLICY "Public delete access for visitor_activities" ON public.visitor_activities FOR DELETE TO anon, authenticated USING (true);
  END IF;
END $$;
