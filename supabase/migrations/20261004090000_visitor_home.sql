-- Visitor home page: each venue's hero (tagline, cover picture, opening view)
-- is set by its institution and goes live with "Publish", like everything
-- else. home_rank lets the Yet New team choose which venue leads the home page.
-- Idempotent: safe to re-run (re-run 20261003090000 first if you re-run older ones).

ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS tagline   text;
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS cover_url text;
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS hero_view text NOT NULL DEFAULT '3d';
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS home_rank integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buildings_hero_view_check') THEN
    ALTER TABLE public.buildings ADD CONSTRAINT buildings_hero_view_check CHECK (hero_view IN ('3d', '2d', 'outdoor'));
  END IF;
END $$;

-- Only the Yet New team ranks venues on the home page (institutions can't promote themselves).
CREATE OR REPLACE FUNCTION public.buildings_guard_home_rank()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.home_rank IS DISTINCT FROM COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.home_rank END, 0)
     AND auth.uid() IS NOT NULL AND NOT public.user_is_platform_admin() THEN
    NEW.home_rank := COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.home_rank END, 0);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS buildings_guard_home_rank ON public.buildings;
CREATE TRIGGER buildings_guard_home_rank BEFORE INSERT OR UPDATE ON public.buildings
  FOR EACH ROW EXECUTE FUNCTION public.buildings_guard_home_rank();

-- The published snapshot carries the hero too.
CREATE OR REPLACE FUNCTION public.publish_venue(b uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE snap jsonb; t timestamptz := now();
BEGIN
  IF NOT public.user_can_edit_building(b) THEN
    RAISE EXCEPTION 'You are not allowed to publish this venue' USING ERRCODE = '42501';
  END IF;
  snap := jsonb_build_object(
    'building',     (SELECT jsonb_build_object('id', id, 'name', name, 'description', description, 'theme', theme, 'layout', layout,
                      'origin_lat', origin_lat, 'origin_lng', origin_lng, 'rotation_deg', rotation_deg, 'meters_per_pixel', meters_per_pixel,
                      'tagline', tagline, 'cover_url', cover_url, 'hero_view', hero_view)
                    FROM public.buildings WHERE id = b),
    'floors',       COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.level) FROM public.floors x WHERE x.building_id = b), '[]'),
    'nodes',        COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.nodes x WHERE x.building_id = b), '[]'),
    'edges',        COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.edges x WHERE x.building_id = b), '[]'),
    'rooms',        COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.rooms x WHERE x.building_id = b), '[]'),
    'walls',        COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.walls x WHERE x.building_id = b), '[]'),
    'map_features', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.map_features x WHERE x.building_id = b), '[]'),
    'pois',         COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.pois x WHERE x.building_id = b AND x.is_visible), '[]'),
    'content',      COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sort_order, x.starts_at) FROM public.venue_content x WHERE x.building_id = b AND x.is_published), '[]')
  );
  INSERT INTO public.venue_snapshots (building_id, data, published_at, published_by) VALUES (b, snap, t, auth.uid())
  ON CONFLICT (building_id) DO UPDATE SET data = EXCLUDED.data, published_at = EXCLUDED.published_at, published_by = EXCLUDED.published_by;
  UPDATE public.buildings SET is_published = true, published_at = t, published_by = auth.uid(), version = version + 1 WHERE id = b;
  INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name, created_at)
  VALUES (b, auth.uid(), public.current_actor_name(), 'published', 'venue', (SELECT name FROM public.buildings WHERE id = b), t);
  RETURN t;
END $$;
