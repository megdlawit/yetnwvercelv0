-- Insights: how visitors use a published venue — the KPI baseline the business plan's pilot
-- is measured against (visits, searches, directions, QR scans, questions, reports).
--
-- Privacy, by design:
--   * Anonymous. No account id, no IP, no location. A visit is a random id the visitor's
--     browser makes for that visit (sessionStorage) and forgets when the tab closes.
--   * The visitor's browser asking not to be tracked (Do Not Track / Global Privacy Control)
--     sends nothing (src/lib/analytics/visits.ts).
--   * Searches are kept as typed (lower case, 60 characters at most) so teams see what
--     people look for; anything that looks like an email or phone number is dropped.
--     What visitors say to "Ask" is NOT kept — only whether the guide understood.
--   * The venue's own team browsing its map is not counted.
--   * Events older than 400 days are removed (purge_visit_events).
--
-- Visitors never write the table directly: record_visit_events checks every event.
-- Teams and Yet New read only totals, through venue_insights / admin_insights.
--
-- Run on the STAGING project first.

CREATE TABLE IF NOT EXISTS public.visit_events (
  id          bigserial PRIMARY KEY,
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('visit', 'place', 'search', 'route', 'guide', 'qr', 'ask', 'share')),
  -- The map place (node id) and its name then, so totals read well after a rename.
  place_id    text CHECK (char_length(place_id) <= 100),
  place_name  text CHECK (char_length(place_name) <= 200),
  query       text CHECK (char_length(query) <= 60),
  -- search: anything found; ask: understood.
  ok          boolean,
  -- How this visit arrived: a QR code, a shared link, the venue's embed, Yet New's home, or straight.
  source      text CHECK (source IN ('direct', 'qr', 'link', 'embed', 'home')),
  visit       text NOT NULL CHECK (char_length(visit) BETWEEN 8 AND 40),
  device      text CHECK (device IN ('phone', 'tablet', 'desktop')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visit_events_building ON public.visit_events(building_id, created_at);
CREATE INDEX IF NOT EXISTS idx_visit_events_visit ON public.visit_events(visit, created_at);
CREATE INDEX IF NOT EXISTS idx_visit_events_created ON public.visit_events(created_at);

-- No policies: nobody reads or writes rows directly.
ALTER TABLE public.visit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.visit_events FROM anon, authenticated;

-- 1. Recording (visitors) ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_visit_events(b uuid, visit text, device text, source text, events jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF jsonb_typeof(events) <> 'array' OR jsonb_array_length(events) = 0 OR jsonb_array_length(events) > 40 THEN RETURN 0; END IF;
  IF visit IS NULL OR char_length(visit) NOT BETWEEN 8 AND 40 THEN RETURN 0; END IF;
  -- Only live venues, and not their own team looking at them.
  IF NOT EXISTS (SELECT 1 FROM public.buildings x WHERE x.id = b AND x.is_published) THEN RETURN 0; END IF;
  IF auth.uid() IS NOT NULL AND public.user_can_edit_building(b) THEN RETURN 0; END IF;
  -- A flood guard: a real visit doesn't make 300 events in ten minutes.
  IF (SELECT count(*) FROM public.visit_events v WHERE v.visit = record_visit_events.visit AND v.created_at > now() - interval '10 minutes') >= 300 THEN RETURN 0; END IF;

  INSERT INTO public.visit_events (building_id, kind, place_id, place_name, query, ok, source, visit, device)
  SELECT b, e->>'kind', left(e->>'place', 100), left(e->>'name', 200),
         CASE WHEN e->>'kind' = 'search' AND (e->>'query') !~ '@|[0-9][0-9 ().-]{6,}' THEN left(lower(btrim(e->>'query')), 60) END,
         CASE WHEN e->>'kind' IN ('search', 'ask') AND jsonb_typeof(e->'ok') = 'boolean' THEN (e->>'ok')::boolean END,
         CASE WHEN source IN ('direct', 'qr', 'link', 'embed', 'home') THEN source ELSE 'direct' END,
         visit,
         CASE WHEN device IN ('phone', 'tablet', 'desktop') THEN device END
  FROM jsonb_array_elements(events) e
  WHERE jsonb_typeof(e) = 'object' AND e->>'kind' IN ('visit', 'place', 'search', 'route', 'guide', 'qr', 'ask', 'share');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION public.record_visit_events(uuid, text, text, text, jsonb) TO anon, authenticated;

-- 2. A venue's insights (its team; Yet New) ------------------------------------------------------
-- Days are counted in Addis Ababa time. `since` / `until` bound the period; the period
-- before it, of the same length, is returned too, to compare.
CREATE OR REPLACE FUNCTION public.venue_insights(b uuid, since timestamptz, until timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz constant text := 'Africa/Addis_Ababa';
  span interval := until - since;
  result jsonb;
BEGIN
  IF NOT (public.user_can_edit_building(b) OR public.user_is_platform_admin()) THEN
    RAISE EXCEPTION 'You are not allowed to see this venue''s insights' USING ERRCODE = '42501';
  END IF;
  IF span <= interval '0' OR span > interval '400 days' THEN
    RAISE EXCEPTION 'Choose a period of up to 400 days' USING ERRCODE = '22023';
  END IF;

  WITH ev AS (SELECT * FROM public.visit_events WHERE building_id = b AND created_at >= since AND created_at < until),
       prev AS (SELECT * FROM public.visit_events WHERE building_id = b AND created_at >= since - span AND created_at < since)
  SELECT jsonb_build_object(
    'totals', (SELECT jsonb_build_object(
        'visits', count(DISTINCT visit),
        'places', count(*) FILTER (WHERE kind = 'place'),
        'searches', count(*) FILTER (WHERE kind = 'search'),
        'searches_missed', count(*) FILTER (WHERE kind = 'search' AND ok = false),
        'routes', count(*) FILTER (WHERE kind = 'route'),
        'guides', count(*) FILTER (WHERE kind = 'guide'),
        'qr', count(*) FILTER (WHERE kind = 'qr'),
        'asks', count(*) FILTER (WHERE kind = 'ask'),
        'asks_missed', count(*) FILTER (WHERE kind = 'ask' AND ok = false),
        'shares', count(*) FILTER (WHERE kind = 'share'),
        'visits_with_route', count(DISTINCT visit) FILTER (WHERE kind = 'route')) FROM ev),
    'previous', (SELECT jsonb_build_object(
        'visits', count(DISTINCT visit),
        'routes', count(*) FILTER (WHERE kind = 'route'),
        'searches', count(*) FILTER (WHERE kind = 'search'),
        'qr', count(*) FILTER (WHERE kind = 'qr')) FROM prev),
    'reports', (SELECT jsonb_build_object(
        'new', count(*),
        'fixed', count(*) FILTER (WHERE status = 'fixed'),
        'open', count(*) FILTER (WHERE status = 'open'),
        'median_hours_to_fix', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - created_at) / 3600)
                                       FILTER (WHERE status = 'fixed'))::numeric, 1))
        FROM public.place_reports WHERE building_id = b AND created_at >= since AND created_at < until),
    'days', (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d.day, 'visits', COALESCE(x.visits, 0), 'routes', COALESCE(x.routes, 0)) ORDER BY d.day), '[]')
        FROM generate_series((since AT TIME ZONE tz)::date, ((until - interval '1 second') AT TIME ZONE tz)::date, interval '1 day') AS d(day)
        LEFT JOIN (SELECT (created_at AT TIME ZONE tz)::date AS day, count(DISTINCT visit) AS visits, count(*) FILTER (WHERE kind = 'route') AS routes
                   FROM ev GROUP BY 1) x ON x.day = d.day::date),
    'hours', (SELECT COALESCE(jsonb_agg(jsonb_build_object('hour', h, 'visits', COALESCE(x.visits, 0)) ORDER BY h), '[]')
        FROM generate_series(0, 23) h
        LEFT JOIN (SELECT extract(hour FROM created_at AT TIME ZONE tz)::int AS hour, count(DISTINCT visit) AS visits FROM ev GROUP BY 1) x ON x.hour = h),
    'top_places', (SELECT COALESCE(jsonb_agg(t ORDER BY t.views + t.routes DESC), '[]') FROM (
        SELECT place_id AS id, max(place_name) AS name, count(*) FILTER (WHERE kind = 'place') AS views, count(*) FILTER (WHERE kind = 'route') AS routes
        FROM ev WHERE place_id IS NOT NULL AND kind IN ('place', 'route') GROUP BY place_id
        ORDER BY count(*) DESC LIMIT 10) t),
    'top_searches', (SELECT COALESCE(jsonb_agg(t ORDER BY t.count DESC), '[]') FROM (
        SELECT query, count(*) AS count, bool_or(ok) AS found FROM ev WHERE kind = 'search' AND query IS NOT NULL
        GROUP BY query ORDER BY count(*) DESC LIMIT 12) t),
    'missed_searches', (SELECT COALESCE(jsonb_agg(t ORDER BY t.count DESC), '[]') FROM (
        SELECT query, count(*) AS count FROM ev WHERE kind = 'search' AND ok = false AND query IS NOT NULL
        GROUP BY query ORDER BY count(*) DESC LIMIT 12) t),
    'qr_places', (SELECT COALESCE(jsonb_agg(t ORDER BY t.count DESC), '[]') FROM (
        SELECT place_id AS id, max(place_name) AS name, count(*) AS count FROM ev WHERE kind = 'qr' GROUP BY place_id ORDER BY count(*) DESC LIMIT 10) t),
    'sources', (SELECT COALESCE(jsonb_object_agg(source, n), '{}') FROM (
        SELECT COALESCE(source, 'direct') AS source, count(DISTINCT visit) AS n FROM ev GROUP BY 1) t),
    'devices', (SELECT COALESCE(jsonb_object_agg(device, n), '{}') FROM (
        SELECT COALESCE(device, 'unknown') AS device, count(DISTINCT visit) AS n FROM ev GROUP BY 1) t)
  ) INTO result;
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION public.venue_insights(uuid, timestamptz, timestamptz) TO authenticated;

-- 3. Every venue at once (Yet New; the pilot's KPI report) ----------------------------------------
CREATE OR REPLACE FUNCTION public.admin_insights(since timestamptz, until timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.user_is_platform_admin() THEN
    RAISE EXCEPTION 'Only the Yet New team can see every venue''s insights' USING ERRCODE = '42501';
  END IF;
  IF until - since <= interval '0' OR until - since > interval '400 days' THEN
    RAISE EXCEPTION 'Choose a period of up to 400 days' USING ERRCODE = '22023';
  END IF;
  WITH ev AS (SELECT * FROM public.visit_events WHERE created_at >= since AND created_at < until),
       per AS (
         SELECT building_id, count(DISTINCT visit) AS visits, count(*) FILTER (WHERE kind = 'place') AS places,
                count(*) FILTER (WHERE kind = 'search') AS searches, count(*) FILTER (WHERE kind = 'search' AND ok = false) AS searches_missed,
                count(*) FILTER (WHERE kind = 'route') AS routes, count(*) FILTER (WHERE kind = 'qr') AS qr,
                count(*) FILTER (WHERE kind = 'ask') AS asks, count(*) FILTER (WHERE kind = 'ask' AND ok = false) AS asks_missed
         FROM ev GROUP BY building_id),
       rep AS (
         SELECT building_id, count(*) AS reports, count(*) FILTER (WHERE status = 'fixed') AS reports_fixed,
                round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - created_at) / 3600) FILTER (WHERE status = 'fixed'))::numeric, 1) AS median_hours_to_fix
         FROM public.place_reports WHERE created_at >= since AND created_at < until GROUP BY building_id)
  SELECT jsonb_build_object(
    'totals', (SELECT jsonb_build_object('visits', count(DISTINCT visit), 'routes', count(*) FILTER (WHERE kind = 'route'),
                 'searches', count(*) FILTER (WHERE kind = 'search'), 'qr', count(*) FILTER (WHERE kind = 'qr'),
                 'asks', count(*) FILTER (WHERE kind = 'ask'), 'venues_with_visits', count(DISTINCT building_id)) FROM ev),
    'venues', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'published', x.is_published, 'trust_level', x.trust_level,
        'visits', COALESCE(per.visits, 0), 'places', COALESCE(per.places, 0), 'searches', COALESCE(per.searches, 0),
        'searches_missed', COALESCE(per.searches_missed, 0), 'routes', COALESCE(per.routes, 0), 'qr', COALESCE(per.qr, 0),
        'asks', COALESCE(per.asks, 0), 'asks_missed', COALESCE(per.asks_missed, 0),
        'reports', COALESCE(rep.reports, 0), 'reports_fixed', COALESCE(rep.reports_fixed, 0), 'median_hours_to_fix', rep.median_hours_to_fix)
        ORDER BY COALESCE(per.visits, 0) DESC, x.name), '[]')
      FROM public.buildings x LEFT JOIN per ON per.building_id = x.id LEFT JOIN rep ON rep.building_id = x.id
      WHERE x.is_published OR per.building_id IS NOT NULL)
  ) INTO result;
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_insights(timestamptz, timestamptz) TO authenticated;

-- 4. Keeping only what's useful -------------------------------------------------------------------
-- Removes events older than 400 days. Yet New runs it (or schedules it with pg_cron).
CREATE OR REPLACE FUNCTION public.purge_visit_events()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT public.user_is_platform_admin() AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Only the Yet New team can purge insights' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.visit_events WHERE created_at < now() - interval '400 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.purge_visit_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_visit_events() TO authenticated;
