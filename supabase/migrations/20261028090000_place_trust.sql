-- Trust: how sure a visitor can be that what the map says is true (business plan:
-- "verified, official, structured information").
--
-- A place's status, as the plan names it, comes from columns that already work:
--   Draft      = not published (buildings.is_published = false)
--   Listed     = published (trust_level 'listed', the default)
--   Verified   = Yet New checked it (trust_level 'verified')
--   Official   = the responsible authority confirmed it (trust_level 'official')
--   Featured   = promoted on the home page (buildings.home_rank > 0, pois.is_featured),
--                always labelled as such; it never changes the trust level
--   Archived   = the team put it away (buildings.archived_at); offline, kept
--   Suspended  = Yet New took it down (buildings.suspended_at); offline until lifted
--
-- Plus where the information comes from (source), who answers for it
-- (responsible_party), when the team last confirmed it (checked_at) and when Yet New
-- verified it (verified_at / verified_by).
--
-- Only the Yet New team changes trust_level, verified_* and suspended_*. Verification
-- is never paid for: teams ask through verification_requests, Yet New decides.
-- Visitors report problems through place_reports; the venue's team works through them.
--
-- Run on the STAGING project first.

-- 1. Trust columns -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['buildings', 'pois'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS trust_level text NOT NULL DEFAULT ''listed''', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS source text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS responsible_party text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS checked_at timestamptz', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS verified_at timestamptz', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS trust_note text', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_trust_level_check') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (trust_level IN (''listed'', ''verified'', ''official''))', t, t || '_trust_level_check');
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS suspend_note text;

-- Teams must not verify or un-suspend themselves.
CREATE OR REPLACE FUNCTION public.guard_trust_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.user_is_platform_admin() OR current_setting('yetnew.trust', true) = 'on' THEN
    NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.trust_level := 'listed'; NEW.verified_at := NULL; NEW.verified_by := NULL; NEW.trust_note := NULL;
    IF TG_TABLE_NAME = 'buildings' THEN NEW.suspended_at := NULL; NEW.suspend_note := NULL; END IF;
  ELSE
    NEW.trust_level := OLD.trust_level; NEW.verified_at := OLD.verified_at; NEW.verified_by := OLD.verified_by; NEW.trust_note := OLD.trust_note;
    IF TG_TABLE_NAME = 'buildings' THEN NEW.suspended_at := OLD.suspended_at; NEW.suspend_note := OLD.suspend_note; END IF;
  END IF;
  -- Archived or suspended venues stay offline (publish_venue fails here, whoever calls it).
  IF TG_TABLE_NAME = 'buildings' AND NEW.is_published AND (NEW.suspended_at IS NOT NULL OR NEW.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION '%', CASE WHEN NEW.suspended_at IS NOT NULL
      THEN 'This venue is suspended by Yet New. Contact Yet New to publish it again.'
      ELSE 'This venue is archived. Restore it first, then publish.' END USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_trust_columns ON public.buildings;
CREATE TRIGGER guard_trust_columns BEFORE INSERT OR UPDATE ON public.buildings FOR EACH ROW EXECUTE FUNCTION public.guard_trust_columns();
DROP TRIGGER IF EXISTS guard_trust_columns ON public.pois;
CREATE TRIGGER guard_trust_columns BEFORE INSERT OR UPDATE ON public.pois FOR EACH ROW EXECUTE FUNCTION public.guard_trust_columns();

-- 2. Archive (the team) -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_venue(b uuid, archive boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.user_can_edit_building(b) THEN
    RAISE EXCEPTION 'You are not allowed to archive this venue' USING ERRCODE = '42501';
  END IF;
  -- Archiving also withdraws a waiting publish request (approving its institution would publish it).
  PERFORM set_config('yetnew.review', 'on', true);
  UPDATE public.buildings SET archived_at = CASE WHEN archive THEN now() ELSE NULL END,
    is_published = CASE WHEN archive THEN false ELSE is_published END,
    review_status = CASE WHEN archive AND review_status = 'pending' THEN 'none' ELSE review_status END,
    review_requested_at = CASE WHEN archive AND review_status = 'pending' THEN NULL ELSE review_requested_at END
  WHERE id = b;
  INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name)
  VALUES (b, auth.uid(), public.current_actor_name(), CASE WHEN archive THEN 'archived' ELSE 'restored' END, 'venue', (SELECT name FROM public.buildings WHERE id = b));
END $$;

-- 3. Verification requests -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.verification_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id   uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  -- A single place in the venue; NULL = the venue itself.
  poi_id        uuid REFERENCES public.pois(id) ON DELETE CASCADE,
  level         text NOT NULL DEFAULT 'verified' CHECK (level IN ('verified', 'official')),
  -- What the team offers as evidence: a licence number, an official letter, a website…
  note          text CHECK (char_length(note) <= 2000),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  decision_note text
);
CREATE INDEX IF NOT EXISTS idx_verification_requests_building ON public.verification_requests(building_id, requested_at DESC);
-- One open request per venue / place.
CREATE UNIQUE INDEX IF NOT EXISTS verification_requests_one_pending
  ON public.verification_requests(building_id, COALESCE(poi_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'pending';

ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Editors read their requests" ON public.verification_requests;
CREATE POLICY "Editors read their requests" ON public.verification_requests FOR SELECT TO authenticated
  USING (public.user_can_edit_building(building_id));
DROP POLICY IF EXISTS "Editors ask for verification" ON public.verification_requests;
CREATE POLICY "Editors ask for verification" ON public.verification_requests FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_building(building_id) AND requested_by = auth.uid() AND status = 'pending'
    AND (poi_id IS NULL OR EXISTS (SELECT 1 FROM public.pois p WHERE p.id = poi_id AND p.building_id = verification_requests.building_id)));
-- Teams may only withdraw their own open request; deciding goes through admin_decide_verification.
DROP POLICY IF EXISTS "Editors withdraw requests" ON public.verification_requests;
CREATE POLICY "Editors withdraw requests" ON public.verification_requests FOR UPDATE TO authenticated
  USING (public.user_can_edit_building(building_id) AND status = 'pending')
  WITH CHECK (public.user_can_edit_building(building_id) AND status = 'withdrawn');

CREATE OR REPLACE FUNCTION public.guard_verification_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('yetnew.trust', true) = 'on' THEN RETURN NEW; END IF;
  -- A team's change can only withdraw: nothing else moves.
  NEW.building_id := OLD.building_id; NEW.poi_id := OLD.poi_id; NEW.level := OLD.level; NEW.note := OLD.note;
  NEW.requested_by := OLD.requested_by; NEW.requested_at := OLD.requested_at;
  NEW.decided_by := OLD.decided_by; NEW.decided_at := OLD.decided_at; NEW.decision_note := OLD.decision_note;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_verification_request ON public.verification_requests;
CREATE TRIGGER guard_verification_request BEFORE UPDATE ON public.verification_requests FOR EACH ROW EXECUTE FUNCTION public.guard_verification_request();

CREATE OR REPLACE FUNCTION public.log_verification_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name)
  VALUES (NEW.building_id, auth.uid(), public.current_actor_name(), 'asked for verification',
    CASE WHEN NEW.poi_id IS NULL THEN 'venue' ELSE 'place' END,
    COALESCE((SELECT name FROM public.pois WHERE id = NEW.poi_id), (SELECT name FROM public.buildings WHERE id = NEW.building_id)));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS log_verification_request ON public.verification_requests;
CREATE TRIGGER log_verification_request AFTER INSERT ON public.verification_requests FOR EACH ROW EXECUTE FUNCTION public.log_verification_request();

-- 4. Problem reports from visitors -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.place_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id     uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  poi_id          uuid REFERENCES public.pois(id) ON DELETE SET NULL,
  -- The map spot (node) the visitor was looking at, and its name then, so a report
  -- still reads well when the place has no details row or is renamed later.
  node_id         text,
  place_name      text CHECK (char_length(place_name) <= 200),
  kind            text NOT NULL CHECK (kind IN ('wrong_info', 'closed', 'blocked', 'accessibility', 'safety', 'other')),
  message         text CHECK (char_length(message) <= 1000),
  -- Optional, only if the visitor wants an answer.
  contact         text CHECK (char_length(contact) <= 200),
  reporter_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'dismissed')),
  resolved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  resolution_note text CHECK (char_length(resolution_note) <= 1000),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_place_reports_building ON public.place_reports(building_id, status, created_at DESC);

ALTER TABLE public.place_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Visitors report problems" ON public.place_reports;
CREATE POLICY "Visitors report problems" ON public.place_reports FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.buildings x WHERE x.id = building_id AND x.is_published));
DROP POLICY IF EXISTS "Editors read reports" ON public.place_reports;
CREATE POLICY "Editors read reports" ON public.place_reports FOR SELECT TO authenticated
  USING (public.user_can_edit_building(building_id));
DROP POLICY IF EXISTS "Editors resolve reports" ON public.place_reports;
CREATE POLICY "Editors resolve reports" ON public.place_reports FOR UPDATE TO authenticated
  USING (public.user_can_edit_building(building_id)) WITH CHECK (public.user_can_edit_building(building_id));

CREATE OR REPLACE FUNCTION public.guard_place_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A visitor files it; nothing about how it's handled comes from them.
    NEW.status := 'open'; NEW.resolved_by := NULL; NEW.resolved_at := NULL; NEW.resolution_note := NULL;
    NEW.reporter_id := auth.uid(); NEW.created_at := now();
    IF NEW.poi_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pois p WHERE p.id = NEW.poi_id AND p.building_id = NEW.building_id) THEN
      NEW.poi_id := NULL;
    END IF;
    -- A flood guard: anyone can report, so cap a venue at 60 reports an hour.
    IF (SELECT count(*) FROM public.place_reports r WHERE r.building_id = NEW.building_id AND r.created_at > now() - interval '1 hour') >= 60 THEN
      RAISE EXCEPTION 'Too many reports for this venue right now. Please try again later.' USING ERRCODE = '54000';
    END IF;
  ELSE
    -- The team changes only how it's handled.
    NEW.building_id := OLD.building_id; NEW.poi_id := OLD.poi_id; NEW.node_id := OLD.node_id; NEW.place_name := OLD.place_name;
    NEW.kind := OLD.kind; NEW.message := OLD.message; NEW.contact := OLD.contact; NEW.reporter_id := OLD.reporter_id; NEW.created_at := OLD.created_at;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.resolved_at := CASE WHEN NEW.status = 'open' THEN NULL ELSE now() END;
      NEW.resolved_by := CASE WHEN NEW.status = 'open' THEN NULL ELSE auth.uid() END;
      INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name)
      VALUES (NEW.building_id, auth.uid(), public.current_actor_name(),
        CASE NEW.status WHEN 'fixed' THEN 'fixed a reported problem' WHEN 'dismissed' THEN 'dismissed a report' ELSE 'reopened a report' END,
        'report', COALESCE(NEW.place_name, (SELECT name FROM public.buildings WHERE id = NEW.building_id)));
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_place_report ON public.place_reports;
CREATE TRIGGER guard_place_report BEFORE INSERT OR UPDATE ON public.place_reports FOR EACH ROW EXECUTE FUNCTION public.guard_place_report();

-- 5. Yet New's decisions -------------------------------------------------------------------------
-- Set a venue's (poi NULL) or a place's trust level directly: verify, make official, or take it back.
CREATE OR REPLACE FUNCTION public.admin_set_trust(b uuid, poi uuid, level text, note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  IF level NOT IN ('listed', 'verified', 'official') THEN RAISE EXCEPTION 'Unknown trust level %', level; END IF;
  PERFORM set_config('yetnew.trust', 'on', true);
  IF poi IS NULL THEN
    UPDATE public.buildings SET trust_level = level, trust_note = NULLIF(trim(note), ''),
      verified_at = CASE WHEN level = 'listed' THEN NULL ELSE now() END, verified_by = CASE WHEN level = 'listed' THEN NULL ELSE auth.uid() END
    WHERE id = b;
  ELSE
    UPDATE public.pois SET trust_level = level, trust_note = NULLIF(trim(note), ''),
      verified_at = CASE WHEN level = 'listed' THEN NULL ELSE now() END, verified_by = CASE WHEN level = 'listed' THEN NULL ELSE auth.uid() END
    WHERE id = poi AND building_id = b;
  END IF;
  INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name)
  VALUES (b, auth.uid(), public.current_actor_name(),
    CASE level WHEN 'listed' THEN 'removed verification' WHEN 'official' THEN 'marked official' ELSE 'verified' END,
    CASE WHEN poi IS NULL THEN 'venue' ELSE 'place' END,
    COALESCE((SELECT name FROM public.pois WHERE id = poi), (SELECT name FROM public.buildings WHERE id = b)));
END $$;

CREATE OR REPLACE FUNCTION public.admin_decide_verification(req uuid, approve boolean, note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.verification_requests;
BEGIN
  PERFORM public.admin_require();
  SELECT * INTO r FROM public.verification_requests WHERE id = req FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' THEN RAISE EXCEPTION 'This request is no longer waiting.'; END IF;
  PERFORM set_config('yetnew.trust', 'on', true);
  -- "note" is also a column of verification_requests: the argument is named in full.
  UPDATE public.verification_requests SET status = CASE WHEN approve THEN 'approved' ELSE 'rejected' END,
    decided_by = auth.uid(), decided_at = now(), decision_note = NULLIF(trim(admin_decide_verification.note), '') WHERE id = req;
  IF approve THEN
    PERFORM public.admin_set_trust(r.building_id, r.poi_id, r.level, admin_decide_verification.note);
  ELSE
    INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name)
    VALUES (r.building_id, auth.uid(), public.current_actor_name(), 'declined verification', CASE WHEN r.poi_id IS NULL THEN 'venue' ELSE 'place' END,
      COALESCE((SELECT name FROM public.pois WHERE id = r.poi_id), (SELECT name FROM public.buildings WHERE id = r.building_id)));
  END IF;
END $$;

-- Suspend: offline at once, and the team can't publish until Yet New lifts it.
CREATE OR REPLACE FUNCTION public.admin_suspend_venue(b uuid, suspend boolean, note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  PERFORM set_config('yetnew.trust', 'on', true);
  UPDATE public.buildings SET suspended_at = CASE WHEN suspend THEN now() ELSE NULL END,
    suspend_note = CASE WHEN suspend THEN NULLIF(trim(note), '') ELSE NULL END,
    is_published = CASE WHEN suspend THEN false ELSE is_published END WHERE id = b;
  INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name)
  VALUES (b, auth.uid(), public.current_actor_name(), CASE WHEN suspend THEN 'suspended' ELSE 'lifted suspension' END, 'venue', (SELECT name FROM public.buildings WHERE id = b));
END $$;

-- The queue the console shows: open requests with what the decision needs to know.
CREATE OR REPLACE FUNCTION public.admin_verification_queue()
RETURNS TABLE (id uuid, building_id uuid, venue_name text, institution_name text, institution_status text, poi_id uuid, place_name text,
               level text, note text, requested_at timestamptz, requested_by_name text, current_level text, source text, responsible_party text,
               is_published boolean, open_reports bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  RETURN QUERY
  SELECT r.id, r.building_id, x.name::text, i.name::text, i.status, r.poi_id, p.name::text, r.level, r.note, r.requested_at,
         COALESCE(ua.display_name, ua.username)::text,
         COALESCE(p.trust_level, x.trust_level), COALESCE(p.source, x.source), COALESCE(p.responsible_party, x.responsible_party),
         x.is_published,
         (SELECT count(*) FROM public.place_reports pr WHERE pr.building_id = r.building_id AND pr.status = 'open')
  FROM public.verification_requests r
  JOIN public.buildings x ON x.id = r.building_id
  LEFT JOIN public.institutions i ON i.id = x.institution_id
  LEFT JOIN public.pois p ON p.id = r.poi_id
  LEFT JOIN public.user_accounts ua ON ua.user_id = r.requested_by
  WHERE r.status = 'pending'
  ORDER BY r.requested_at;
END $$;

-- The console's venue list, now with trust, archive and suspension (a new return type, so dropped first).
DROP FUNCTION IF EXISTS public.admin_venues();
CREATE FUNCTION public.admin_venues()
RETURNS TABLE (id uuid, name text, institution_id uuid, institution_name text, institution_status text, layout text, is_published boolean,
               published_at timestamptz, review_status text, review_requested_at timestamptz, review_note text, home_rank integer,
               floors bigint, places bigint, placed boolean, updated_at timestamptz,
               trust_level text, verified_at timestamptz, archived_at timestamptz, suspended_at timestamptz, suspend_note text, open_reports bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  RETURN QUERY
  SELECT x.id, x.name::text, x.institution_id, i.name::text, i.status, x.layout::text, x.is_published, x.published_at,
         x.review_status, x.review_requested_at, x.review_note, COALESCE(x.home_rank, 0)::integer,
         (SELECT count(*) FROM public.floors f WHERE f.building_id = x.id),
         (SELECT count(*) FROM public.nodes n WHERE n.building_id = x.id AND NOT COALESCE(n.is_hallway, false)),
         x.origin_lat IS NOT NULL, x.updated_at,
         x.trust_level, x.verified_at, x.archived_at, x.suspended_at, x.suspend_note,
         (SELECT count(*) FROM public.place_reports pr WHERE pr.building_id = x.id AND pr.status = 'open')
  FROM public.buildings x LEFT JOIN public.institutions i ON i.id = x.institution_id
  ORDER BY (x.review_status = 'pending') DESC, x.updated_at DESC NULLS LAST;
END $$;

-- The overview, with what's waiting on trust (same as 20261008110000 plus the last three).
CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  RETURN jsonb_build_object(
    'institutions',          (SELECT count(*) FROM public.institutions),
    'institutions_pending',  (SELECT count(*) FROM public.institutions WHERE status = 'pending'),
    'institutions_suspended',(SELECT count(*) FROM public.institutions WHERE status = 'suspended'),
    'venues',                (SELECT count(*) FROM public.buildings),
    'venues_published',      (SELECT count(*) FROM public.buildings WHERE is_published),
    'venues_pending',        (SELECT count(*) FROM public.buildings WHERE review_status = 'pending'),
    'team_members',          (SELECT count(*) FROM public.user_accounts),
    'platform_admins',       (SELECT count(*) FROM public.platform_admins),
    'places',                (SELECT count(*) FROM public.nodes WHERE NOT COALESCE(is_hallway, false)),
    'new_institutions_30d',  (SELECT count(*) FROM public.institutions WHERE created_at > now() - interval '30 days'),
    'publishes_30d',         (SELECT count(*) FROM public.venue_activity WHERE action = 'published' AND created_at > now() - interval '30 days'),
    'verifications_pending', (SELECT count(*) FROM public.verification_requests WHERE status = 'pending'),
    'venues_verified',       (SELECT count(*) FROM public.buildings WHERE is_published AND trust_level <> 'listed'),
    'reports_open',          (SELECT count(*) FROM public.place_reports WHERE status = 'open')
  );
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['archive_venue(uuid, boolean)', 'admin_set_trust(uuid, uuid, text, text)', 'admin_decide_verification(uuid, boolean, text)',
    'admin_suspend_venue(uuid, boolean, text)', 'admin_verification_queue()', 'admin_venues()', 'admin_overview()'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
