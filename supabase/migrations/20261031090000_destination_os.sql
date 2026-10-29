-- Destination OS: the operations view for a government or destination account across the
-- venues it oversees (20261030090000_roles_audit.sql), and the OFFICIAL NOTICES it issues —
-- road closures, holiday hours, safety advice — shown on those venues' visitor maps, labelled
-- with the authority's name. Venue teams see them but can't change them.
--
-- Run on the STAGING project first.

-- 1. Official notices -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.official_notices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer_id     uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 120),
  body          text CHECK (char_length(body) <= 2000),
  severity      text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'advisory', 'urgent')),
  starts_at     timestamptz NOT NULL DEFAULT now(),
  ends_at       timestamptz,
  -- Every venue the issuer oversees, now and later — or just these venues.
  all_venues    boolean NOT NULL DEFAULT false,
  building_ids  uuid[] NOT NULL DEFAULT '{}',
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  withdrawn_at  timestamptz,
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (all_venues OR cardinality(building_ids) > 0)
);
CREATE INDEX IF NOT EXISTS idx_official_notices_issuer ON public.official_notices(issuer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_official_notices_buildings ON public.official_notices USING gin (building_ids);

-- Does this notice reach this venue? (The issuer must still oversee the venue's institution.)
CREATE OR REPLACE FUNCTION public.notice_reaches(n public.official_notices, b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.buildings x
    JOIN public.oversight_grants g ON g.institution_id = x.institution_id AND g.overseer_id = n.issuer_id
    WHERE x.id = b AND (n.all_venues OR b = ANY (n.building_ids)));
$$;

-- Issued by a government or destination account, only to venues it oversees; the issuer and
-- the dates are the database's, not the browser's.
CREATE OR REPLACE FUNCTION public.guard_official_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bad uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.institutions WHERE id = NEW.issuer_id AND account_type IN ('government', 'destination')) THEN
    RAISE EXCEPTION 'Only government and destination accounts issue official notices' USING ERRCODE = '42501';
  END IF;
  SELECT b INTO bad FROM unnest(NEW.building_ids) b
   WHERE NOT EXISTS (SELECT 1 FROM public.buildings x JOIN public.oversight_grants g ON g.institution_id = x.institution_id AND g.overseer_id = NEW.issuer_id WHERE x.id = b)
   LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'A notice can only go to venues you oversee' USING ERRCODE = '42501';
  END IF;
  NEW.building_ids := ARRAY(SELECT DISTINCT unnest(NEW.building_ids));
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid(); NEW.created_at := now(); NEW.withdrawn_at := NULL;
  ELSE
    NEW.issuer_id := OLD.issuer_id; NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at;
    -- Withdrawn stays withdrawn.
    IF OLD.withdrawn_at IS NOT NULL THEN NEW.withdrawn_at := OLD.withdrawn_at;
    ELSIF NEW.withdrawn_at IS NOT NULL THEN NEW.withdrawn_at := now(); END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_official_notice ON public.official_notices;
CREATE TRIGGER guard_official_notice BEFORE INSERT OR UPDATE ON public.official_notices FOR EACH ROW EXECUTE FUNCTION public.guard_official_notice();

-- In the audit log, on the issuer's side.
CREATE OR REPLACE FUNCTION public.audit_official_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE act text;
BEGIN
  act := CASE WHEN TG_OP = 'INSERT' THEN 'notice.issued'
              WHEN OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL THEN 'notice.withdrawn'
              ELSE 'notice.updated' END;
  PERFORM public.audit_write(act, 'notice', NEW.id::text, NEW.title, NEW.issuer_id, NULL,
    jsonb_build_object('severity', NEW.severity, 'all_venues', NEW.all_venues, 'venues', cardinality(NEW.building_ids),
                       'starts_at', NEW.starts_at, 'ends_at', NEW.ends_at));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_official_notice ON public.official_notices;
CREATE TRIGGER audit_official_notice AFTER INSERT OR UPDATE ON public.official_notices FOR EACH ROW EXECUTE FUNCTION public.audit_official_notice();

ALTER TABLE public.official_notices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "The issuer and Yet New read notices" ON public.official_notices;
CREATE POLICY "The issuer and Yet New read notices" ON public.official_notices FOR SELECT TO authenticated
  USING (public.user_can_view_institution(issuer_id));
DROP POLICY IF EXISTS "The issuer's owners and editors issue notices" ON public.official_notices;
CREATE POLICY "The issuer's owners and editors issue notices" ON public.official_notices FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_institution(issuer_id));
DROP POLICY IF EXISTS "The issuer's owners and editors change notices" ON public.official_notices;
CREATE POLICY "The issuer's owners and editors change notices" ON public.official_notices FOR UPDATE TO authenticated
  USING (public.user_can_edit_institution(issuer_id)) WITH CHECK (public.user_can_edit_institution(issuer_id));
-- Never deleted: withdrawn instead, so the record of what was said stays.
REVOKE ALL ON public.official_notices FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.official_notices TO authenticated;

-- 2. Notices on a venue (visitors; the venue's team) ------------------------------------------------
-- Live now: started, not ended, not withdrawn. The venue's team (and anyone who can view it)
-- also sees notices for an unpublished venue, and with `upcoming` the scheduled ones.
CREATE OR REPLACE FUNCTION public.venue_notices(b uuid, upcoming boolean DEFAULT false)
RETURNS TABLE (id uuid, title text, body text, severity text, starts_at timestamptz, ends_at timestamptz, issuer_name text, issuer_logo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, n.title, n.body, n.severity, n.starts_at, n.ends_at, i.name, i.logo_url
  FROM public.official_notices n JOIN public.institutions i ON i.id = n.issuer_id
  WHERE n.withdrawn_at IS NULL
    AND (n.ends_at IS NULL OR n.ends_at > now())
    AND (n.starts_at <= now() OR (upcoming AND public.user_can_view_building(b)))
    AND (EXISTS (SELECT 1 FROM public.buildings x WHERE x.id = b AND x.is_published) OR public.user_can_view_building(b))
    AND public.notice_reaches(n, b)
  ORDER BY CASE n.severity WHEN 'urgent' THEN 0 WHEN 'advisory' THEN 1 ELSE 2 END, n.starts_at DESC
  LIMIT 10;
$$;
GRANT EXECUTE ON FUNCTION public.venue_notices(uuid, boolean) TO anon, authenticated;

-- 3. The overview ------------------------------------------------------------------------------------
-- Every venue the account oversees, with what needs attention: offline, suspended, details not
-- checked in six months, open reports (and the oldest), waiting verification, visits, searches
-- that found nothing. For the account's people (any role) and Yet New.
CREATE OR REPLACE FUNCTION public.destination_overview(overseer uuid, since timestamptz, until timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT (public.user_is_platform_admin() OR COALESCE(public.user_team_role(overseer) IN ('owner', 'editor', 'viewer'), false)) THEN
    RAISE EXCEPTION 'Only this account''s people can see what it oversees' USING ERRCODE = '42501';
  END IF;
  IF until - since <= interval '0' OR until - since > interval '400 days' THEN
    RAISE EXCEPTION 'Choose a period of up to 400 days' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_build_object(
    'institutions', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'status', i.status, 'since', g.granted_at) ORDER BY i.name), '[]')
                     FROM public.oversight_grants g JOIN public.institutions i ON i.id = g.institution_id WHERE g.overseer_id = overseer),
    'venues', (SELECT COALESCE(jsonb_agg(v ORDER BY v->>'name'), '[]') FROM (
      SELECT jsonb_build_object(
        'id', x.id, 'name', x.name, 'institution_id', x.institution_id, 'institution_name', i.name, 'institution_status', i.status,
        'is_published', x.is_published, 'published_at', x.published_at, 'suspended_at', x.suspended_at, 'archived_at', x.archived_at,
        'trust_level', x.trust_level, 'verified_at', x.verified_at, 'checked_at', x.checked_at, 'responsible_party', x.responsible_party,
        'open_reports', (SELECT count(*) FROM public.place_reports r WHERE r.building_id = x.id AND r.status = 'open'),
        'oldest_open_report', (SELECT min(r.created_at) FROM public.place_reports r WHERE r.building_id = x.id AND r.status = 'open'),
        'safety_reports', (SELECT count(*) FROM public.place_reports r WHERE r.building_id = x.id AND r.status = 'open' AND r.kind IN ('safety', 'blocked', 'accessibility')),
        'verification_pending', EXISTS (SELECT 1 FROM public.verification_requests q WHERE q.building_id = x.id AND q.status = 'pending'),
        'visits', (SELECT count(DISTINCT e.visit) FROM public.visit_events e WHERE e.building_id = x.id AND e.created_at >= since AND e.created_at < until),
        'routes', (SELECT count(*) FROM public.visit_events e WHERE e.building_id = x.id AND e.kind = 'route' AND e.created_at >= since AND e.created_at < until),
        'searches_missed', (SELECT count(*) FROM public.visit_events e WHERE e.building_id = x.id AND e.kind = 'search' AND e.ok = false AND e.created_at >= since AND e.created_at < until),
        'notices', (SELECT count(*) FROM public.official_notices n WHERE n.issuer_id = overseer AND n.withdrawn_at IS NULL
                      AND n.starts_at <= now() AND (n.ends_at IS NULL OR n.ends_at > now()) AND (n.all_venues OR x.id = ANY (n.building_ids)))
      ) AS v
      FROM public.oversight_grants g
      JOIN public.institutions i ON i.id = g.institution_id
      JOIN public.buildings x ON x.institution_id = g.institution_id
      WHERE g.overseer_id = overseer) t)
  ) INTO result;
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION public.destination_overview(uuid, timestamptz, timestamptz) TO authenticated;
