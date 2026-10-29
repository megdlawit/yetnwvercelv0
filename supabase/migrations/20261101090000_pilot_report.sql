-- The pilot KPI report: one period's numbers across the venues a government or destination
-- account oversees (or, for Yet New, every venue) — coverage, trust, visitor use, how fast
-- reported problems are fixed, official notices, and what changed. The report page compares
-- it with the period before. Definitions are in the pilot package document.
--
-- Run on the STAGING project first.

CREATE OR REPLACE FUNCTION public.pilot_report(overseer uuid, since timestamptz, until timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF overseer IS NULL THEN
    PERFORM public.admin_require();
  ELSIF NOT (public.user_is_platform_admin() OR COALESCE(public.user_team_role(overseer) IN ('owner', 'editor', 'viewer'), false)) THEN
    RAISE EXCEPTION 'Only this account''s people can see its report' USING ERRCODE = '42501';
  END IF;
  IF until - since <= interval '0' OR until - since > interval '400 days' THEN
    RAISE EXCEPTION 'Choose a period of up to 400 days' USING ERRCODE = '22023';
  END IF;

  WITH v AS (
         SELECT x.* FROM public.buildings x
         WHERE (overseer IS NULL AND x.institution_id IS NOT NULL)
            OR x.institution_id IN (SELECT g.institution_id FROM public.oversight_grants g WHERE g.overseer_id = overseer)),
       live AS (SELECT * FROM v WHERE v.is_published AND v.suspended_at IS NULL AND v.archived_at IS NULL),
       ev AS (SELECT e.* FROM public.visit_events e WHERE e.building_id IN (SELECT id FROM v) AND e.created_at >= since AND e.created_at < until),
       rep AS (SELECT r.* FROM public.place_reports r WHERE r.building_id IN (SELECT id FROM v) AND r.created_at >= since AND r.created_at < until),
       aud AS (SELECT a.* FROM public.audit_log a WHERE a.building_id IN (SELECT id FROM v) AND a.created_at >= since AND a.created_at < until)
  SELECT jsonb_build_object(
    'coverage', (SELECT jsonb_build_object(
        'institutions', (SELECT count(DISTINCT institution_id) FROM v),
        'venues', (SELECT count(*) FROM v WHERE archived_at IS NULL),
        'live', (SELECT count(*) FROM live),
        'trusted', (SELECT count(*) FROM live WHERE trust_level IN ('verified', 'official')),
        'official', (SELECT count(*) FROM live WHERE trust_level = 'official'),
        'checked_recently', (SELECT count(*) FROM live WHERE checked_at > until - interval '180 days'))),
    'use', (SELECT jsonb_build_object(
        'visits', count(DISTINCT visit),
        'visits_with_route', count(DISTINCT visit) FILTER (WHERE kind = 'route'),
        'places', count(*) FILTER (WHERE kind = 'place'),
        'routes', count(*) FILTER (WHERE kind = 'route'),
        'guides', count(*) FILTER (WHERE kind = 'guide'),
        'qr', count(*) FILTER (WHERE kind = 'qr'),
        'searches', count(*) FILTER (WHERE kind = 'search'),
        'searches_missed', count(*) FILTER (WHERE kind = 'search' AND ok = false),
        'asks', count(*) FILTER (WHERE kind = 'ask'),
        'asks_missed', count(*) FILTER (WHERE kind = 'ask' AND ok = false),
        'shares', count(*) FILTER (WHERE kind = 'share'),
        'phone_visits', count(DISTINCT visit) FILTER (WHERE device = 'phone')) FROM ev),
    'weeks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('week', w.week, 'visits', COALESCE(x.visits, 0), 'routes', COALESCE(x.routes, 0), 'qr', COALESCE(x.qr, 0)) ORDER BY w.week), '[]')
        FROM generate_series(date_trunc('week', since AT TIME ZONE 'Africa/Addis_Ababa'), date_trunc('week', (until - interval '1 second') AT TIME ZONE 'Africa/Addis_Ababa'), interval '1 week') AS w(week)
        LEFT JOIN (SELECT date_trunc('week', created_at AT TIME ZONE 'Africa/Addis_Ababa') AS week, count(DISTINCT visit) AS visits,
                          count(*) FILTER (WHERE kind = 'route') AS routes, count(*) FILTER (WHERE kind = 'qr') AS qr
                   FROM ev GROUP BY 1) x ON x.week = w.week),
    'reports', (SELECT jsonb_build_object(
        'new', count(*),
        'fixed', count(*) FILTER (WHERE status = 'fixed'),
        'dismissed', count(*) FILTER (WHERE status = 'dismissed'),
        'safety', count(*) FILTER (WHERE kind IN ('safety', 'blocked', 'accessibility')),
        'fixed_within_7_days', count(*) FILTER (WHERE status = 'fixed' AND resolved_at - created_at <= interval '7 days'),
        'median_hours_to_fix', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - created_at) / 3600) FILTER (WHERE status = 'fixed'))::numeric, 1),
        'open_now', (SELECT count(*) FROM public.place_reports r WHERE r.building_id IN (SELECT id FROM v) AND r.status = 'open')) FROM rep),
    'notices', CASE WHEN overseer IS NULL THEN NULL ELSE (SELECT jsonb_build_object(
        'issued', count(*), 'urgent', count(*) FILTER (WHERE severity = 'urgent'))
        FROM public.official_notices n WHERE n.issuer_id = overseer AND n.created_at >= since AND n.created_at < until) END,
    'changes', (SELECT jsonb_build_object(
        'published', count(*) FILTER (WHERE action = 'venue.published'),
        'verified', count(*) FILTER (WHERE action = 'venue.trust' AND details->'trust_level'->>'to' IN ('verified', 'official')),
        'suspended', count(*) FILTER (WHERE action = 'venue.suspended'),
        'verification_requests', count(*) FILTER (WHERE action = 'verification.requested')) FROM aud),
    'venues', (SELECT COALESCE(jsonb_agg(t ORDER BY t.visits DESC, t.name), '[]') FROM (
        SELECT v.id, v.name, v.trust_level, v.is_published,
               (SELECT count(DISTINCT e.visit) FROM ev e WHERE e.building_id = v.id) AS visits,
               (SELECT count(*) FROM ev e WHERE e.building_id = v.id AND e.kind = 'route') AS routes,
               (SELECT count(*) FROM ev e WHERE e.building_id = v.id AND e.kind = 'qr') AS qr,
               (SELECT count(*) FROM rep r WHERE r.building_id = v.id) AS reports,
               (SELECT count(*) FROM rep r WHERE r.building_id = v.id AND r.status = 'fixed') AS reports_fixed
        FROM v WHERE v.archived_at IS NULL) t)
  ) INTO result;
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION public.pilot_report(uuid, timestamptz, timestamptz) TO authenticated;
