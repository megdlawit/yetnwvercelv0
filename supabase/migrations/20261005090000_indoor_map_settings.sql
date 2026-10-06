-- Indoor 3D map settings: each institution chooses how its indoor map looks
-- to visitors — the opening view (3D / 2D), how tall walls stand, and which
-- details show by default (walls, rooms, 3D objects, labels, walkways, other
-- floors, scenery). Shape: see src/lib/venue/mapSettings.ts. Goes live with
-- "Publish", like everything else.
-- Idempotent: safe to re-run (run 20261004090000 first).

ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS map_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- The published snapshot carries the map settings too.
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
                      'tagline', tagline, 'cover_url', cover_url, 'hero_view', hero_view, 'map_settings', map_settings)
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
