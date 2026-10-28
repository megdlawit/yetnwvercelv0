-- Roles and the audit log (business plan: "audit log and roles" for the pilot).
--
-- Roles, on two levels:
--   * In a team: owner (runs the team, publishes), editor (edits), and now viewer —
--     sees the venue's dashboard, insights and reports but changes nothing. A city or
--     ministry officer added to a venue's team as a viewer, say.
--   * Kinds of account: venue (the default), government, destination, business, provider.
--     Yet New sets it. A government or destination account can be given OVERSIGHT of
--     other institutions: its people see those venues read-only (dashboards, insights,
--     reports) — the basis of the destination view. Business and provider accounts work
--     like venues for now; their own tools come later.
--
-- To make "sees but doesn't change" true everywhere, access is split in two:
--   user_can_view_*  — any team member (any role), oversight, Yet New: used for reading
--   user_can_edit_*  — owners and editors, Yet New: used for changing (as before)
-- Every existing read policy that used the edit check is moved to the view check below,
-- so nothing a viewer could see before is hidden, and nothing they couldn't change opens up.
--
-- The audit log: an append-only record of who changed access, trust and visibility —
-- publishing, verification, suspension, archiving, reviews, team members and roles,
-- account kinds, oversight, Yet New staff. Written by triggers, so no screen can forget
-- it; nobody (not even Yet New) can edit or delete an entry. Teams read their own
-- institution's entries; Yet New reads all.
--
-- Run on the STAGING project first.

-- 1. Kinds of account and oversight ---------------------------------------------------------------
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'venue';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'institutions_account_type_check') THEN
    ALTER TABLE public.institutions ADD CONSTRAINT institutions_account_type_check
      CHECK (account_type IN ('venue', 'government', 'destination', 'business', 'provider'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'institution_members_role_check') THEN
    UPDATE public.institution_members SET role = 'editor' WHERE role NOT IN ('owner', 'editor', 'viewer');
    ALTER TABLE public.institution_members ADD CONSTRAINT institution_members_role_check CHECK (role IN ('owner', 'editor', 'viewer'));
  END IF;
END $$;

-- An institution (government / destination) that may see another's venues, read-only.
CREATE TABLE IF NOT EXISTS public.oversight_grants (
  overseer_id    uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  note           text CHECK (char_length(note) <= 500),
  granted_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (overseer_id, institution_id),
  CHECK (overseer_id <> institution_id)
);
CREATE INDEX IF NOT EXISTS idx_oversight_institution ON public.oversight_grants(institution_id);

-- 2. Who may see, who may change --------------------------------------------------------------------
-- The person's part in an institution: owner | editor | viewer | oversight | NULL.
CREATE OR REPLACE FUNCTION public.user_team_role(inst uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.institutions i WHERE i.id = inst AND i.owner_id = auth.uid()) THEN 'owner'
    ELSE COALESCE(
      (SELECT m.role FROM public.institution_members m WHERE m.institution_id = inst AND m.user_id = auth.uid()),
      CASE WHEN EXISTS (
        SELECT 1 FROM public.oversight_grants g JOIN public.institutions o ON o.id = g.overseer_id
        WHERE g.institution_id = inst AND o.account_type IN ('government', 'destination')
          AND (o.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.institution_members m WHERE m.institution_id = o.id AND m.user_id = auth.uid()))
      ) THEN 'oversight' END)
  END;
$$;
GRANT EXECUTE ON FUNCTION public.user_team_role(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_can_edit_institution(inst uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (public.user_team_role(inst) IN ('owner', 'editor') OR public.user_is_platform_admin());
$$;
CREATE OR REPLACE FUNCTION public.user_can_view_institution(inst uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (public.user_team_role(inst) IS NOT NULL OR public.user_is_platform_admin());
$$;
CREATE OR REPLACE FUNCTION public.user_can_view_building(b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.buildings bl WHERE bl.id = b
      AND (CASE WHEN bl.institution_id IS NULL THEN public.user_is_platform_admin() ELSE public.user_can_view_institution(bl.institution_id) END));
$$;
GRANT EXECUTE ON FUNCTION public.user_can_view_institution(uuid), public.user_can_view_building(uuid) TO anon, authenticated;
-- (user_can_edit_building is unchanged: it asks user_can_edit_institution, which now leaves viewers out.)

-- Reading moves to the view check: SELECT policies are rewritten; a policy FOR ALL keeps the
-- edit check for changes and gets a companion SELECT policy with the view check.
DO $$
DECLARE p record; q text; who text;
BEGIN
  FOR p IN SELECT * FROM pg_policies WHERE schemaname = 'public' AND cmd IN ('SELECT', 'ALL')
             AND qual ~ 'user_can_edit_(building|institution)' AND policyname NOT LIKE '% (view)' LOOP
    q := replace(replace(p.qual, 'user_can_edit_building', 'user_can_view_building'), 'user_can_edit_institution', 'user_can_view_institution');
    IF p.cmd = 'SELECT' THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', p.policyname, p.tablename, q);
    ELSE
      SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ') INTO who FROM unnest(p.roles) r;
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname || ' (view)', p.tablename);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO %s USING (%s)', p.policyname || ' (view)', p.tablename, who, q);
    END IF;
  END LOOP;
END $$;

-- Viewers and oversight read insights; nobody on the venue's side is counted as a visitor.
CREATE OR REPLACE FUNCTION public.venue_insights_allowed(b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.user_can_view_building(b) OR public.user_is_platform_admin();
$$;
DO $$
BEGIN
  IF to_regprocedure('public.venue_insights(uuid, timestamptz, timestamptz)') IS NOT NULL THEN
    EXECUTE replace(pg_get_functiondef('public.venue_insights(uuid, timestamptz, timestamptz)'::regprocedure),
      'public.user_can_edit_building(b) OR public.user_is_platform_admin()', 'public.venue_insights_allowed(b)');
  END IF;
  IF to_regprocedure('public.record_visit_events(uuid, text, text, text, jsonb)') IS NOT NULL THEN
    EXECUTE replace(pg_get_functiondef('public.record_visit_events(uuid, text, text, text, jsonb)'::regprocedure),
      'public.user_can_edit_building(b) THEN RETURN 0', 'public.user_can_view_building(b) THEN RETURN 0');
  END IF;
END $$;

-- 3. The audit log --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id             bigserial PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- No foreign keys: an entry outlives the person, venue or institution it names.
  actor_id       uuid,
  actor_name     text,
  -- yet_new | owner | editor | viewer | oversight | system
  actor_role     text NOT NULL,
  action         text NOT NULL,
  target_type    text NOT NULL,
  target_id      text,
  target_name    text,
  institution_id uuid,
  building_id    uuid,
  details        jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_institution ON public.audit_log(institution_id, created_at DESC);

-- Append-only, for everyone.
CREATE OR REPLACE FUNCTION public.audit_log_is_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The audit log can''t be changed or deleted' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS audit_log_append_only ON public.audit_log;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.audit_log_is_append_only();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON public.audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON public.audit_log FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_is_append_only();

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Yet New and the institution's owners and editors read" ON public.audit_log;
CREATE POLICY "Yet New and the institution's owners and editors read" ON public.audit_log FOR SELECT TO authenticated
  USING (public.user_is_platform_admin() OR (institution_id IS NOT NULL AND public.user_can_edit_institution(institution_id)));
REVOKE ALL ON public.audit_log FROM anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

-- One entry. The actor is the signed-in person, or the one a server function names
-- (yetnew.actor) when it acts with the service key on someone's behalf.
CREATE OR REPLACE FUNCTION public.audit_write(act text, typ text, tid text, tname text, inst uuid, b uuid, info jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE who uuid := COALESCE(auth.uid(), NULLIF(current_setting('yetnew.actor', true), '')::uuid);
        role_ text; name_ text;
BEGIN
  IF who IS NULL THEN role_ := 'system';
  ELSIF EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = who) THEN role_ := 'yet_new';
  ELSIF inst IS NOT NULL AND EXISTS (SELECT 1 FROM public.institutions i WHERE i.id = inst AND i.owner_id = who) THEN role_ := 'owner';
  ELSE role_ := COALESCE((SELECT m.role FROM public.institution_members m WHERE m.institution_id = inst AND m.user_id = who), 'system');
  END IF;
  SELECT COALESCE(NULLIF(a.display_name, ''), a.username) INTO name_ FROM public.user_accounts a WHERE a.user_id = who;
  INSERT INTO public.audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, target_name, institution_id, building_id, details)
  VALUES (who, name_, role_, act, typ, tid, tname, inst, b, COALESCE(info, '{}'));
END $$;
REVOKE EXECUTE ON FUNCTION public.audit_write(text, text, text, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- What changed in a row, for the given columns: {"col": {"from": …, "to": …}}.
CREATE OR REPLACE FUNCTION public.audit_changes(o jsonb, n jsonb, cols text[])
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_object_agg(c, jsonb_build_object('from', o->c, 'to', n->c)), '{}')
  FROM unnest(cols) c WHERE (o->c) IS DISTINCT FROM (n->c);
$$;

-- Venues: going live or offline, trust, suspension, archiving, review, featuring, moving.
CREATE OR REPLACE FUNCTION public.audit_buildings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o jsonb; n jsonb; ch jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.audit_write('venue.created', 'venue', NEW.id::text, NEW.name, NEW.institution_id, NEW.id); RETURN NULL;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.audit_write('venue.deleted', 'venue', OLD.id::text, OLD.name, OLD.institution_id, OLD.id); RETURN NULL;
  END IF;
  o := to_jsonb(OLD); n := to_jsonb(NEW);
  IF (o->'is_published') IS DISTINCT FROM (n->'is_published') THEN
    PERFORM public.audit_write(CASE WHEN NEW.is_published THEN 'venue.published' ELSE 'venue.unpublished' END, 'venue', NEW.id::text, NEW.name, NEW.institution_id, NEW.id);
  END IF;
  ch := public.audit_changes(o, n, ARRAY['trust_level', 'trust_note']);
  IF ch ? 'trust_level' THEN PERFORM public.audit_write('venue.trust', 'venue', NEW.id::text, NEW.name, NEW.institution_id, NEW.id, ch); END IF;
  IF (o->'suspended_at') IS DISTINCT FROM (n->'suspended_at') THEN
    PERFORM public.audit_write(CASE WHEN n->>'suspended_at' IS NULL THEN 'venue.unsuspended' ELSE 'venue.suspended' END, 'venue', NEW.id::text, NEW.name, NEW.institution_id, NEW.id,
      jsonb_build_object('note', n->'suspend_note'));
  END IF;
  IF (o->'archived_at') IS DISTINCT FROM (n->'archived_at') THEN
    PERFORM public.audit_write(CASE WHEN n->>'archived_at' IS NULL THEN 'venue.restored' ELSE 'venue.archived' END, 'venue', NEW.id::text, NEW.name, NEW.institution_id, NEW.id);
  END IF;
  ch := public.audit_changes(o, n, ARRAY['review_status', 'review_note']);
  IF ch ? 'review_status' THEN PERFORM public.audit_write('venue.review', 'venue', NEW.id::text, NEW.name, NEW.institution_id, NEW.id, ch); END IF;
  ch := public.audit_changes(o, n, ARRAY['home_rank']);
  IF ch <> '{}' THEN PERFORM public.audit_write('venue.featured', 'venue', NEW.id::text, NEW.name, NEW.institution_id, NEW.id, ch); END IF;
  ch := public.audit_changes(o, n, ARRAY['institution_id']);
  IF ch <> '{}' THEN PERFORM public.audit_write('venue.moved', 'venue', NEW.id::text, NEW.name, NEW.institution_id, NEW.id, ch); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_buildings ON public.buildings;
CREATE TRIGGER audit_buildings AFTER INSERT OR UPDATE OR DELETE ON public.buildings FOR EACH ROW EXECUTE FUNCTION public.audit_buildings();

-- A single place's trust level.
CREATE OR REPLACE FUNCTION public.audit_pois()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ch jsonb := public.audit_changes(to_jsonb(OLD), to_jsonb(NEW), ARRAY['trust_level', 'trust_note']);
BEGIN
  IF ch ? 'trust_level' THEN
    PERFORM public.audit_write('place.trust', 'place', NEW.id::text, NEW.name, (SELECT institution_id FROM public.buildings WHERE id = NEW.building_id), NEW.building_id, ch);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_pois ON public.pois;
CREATE TRIGGER audit_pois AFTER UPDATE ON public.pois FOR EACH ROW EXECUTE FUNCTION public.audit_pois();

-- Institutions: created, approved / rejected, kind of account, owner, deleted.
CREATE OR REPLACE FUNCTION public.audit_institutions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ch jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN PERFORM public.audit_write('institution.created', 'institution', NEW.id::text, NEW.name, NEW.id, NULL); RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN PERFORM public.audit_write('institution.deleted', 'institution', OLD.id::text, OLD.name, OLD.id, NULL); RETURN NULL; END IF;
  ch := public.audit_changes(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status']);
  IF ch <> '{}' THEN PERFORM public.audit_write('institution.status', 'institution', NEW.id::text, NEW.name, NEW.id, NULL, ch); END IF;
  ch := public.audit_changes(to_jsonb(OLD), to_jsonb(NEW), ARRAY['account_type']);
  IF ch <> '{}' THEN PERFORM public.audit_write('institution.type', 'institution', NEW.id::text, NEW.name, NEW.id, NULL, ch); END IF;
  ch := public.audit_changes(to_jsonb(OLD), to_jsonb(NEW), ARRAY['owner_id']);
  IF ch <> '{}' THEN PERFORM public.audit_write('institution.owner', 'institution', NEW.id::text, NEW.name, NEW.id, NULL, ch); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_institutions ON public.institutions;
CREATE TRIGGER audit_institutions AFTER INSERT OR UPDATE OR DELETE ON public.institutions FOR EACH ROW EXECUTE FUNCTION public.audit_institutions();

-- Team members and their roles.
CREATE OR REPLACE FUNCTION public.audit_members()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; nm text;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT COALESCE(NULLIF(display_name, ''), username) INTO nm FROM public.user_accounts WHERE user_id = r.user_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.audit_write('member.added', 'person', r.user_id::text, nm, r.institution_id, NULL, jsonb_build_object('role', NEW.role));
  ELSIF TG_OP = 'DELETE' THEN
    -- The institution itself going away removes its members too: that's one entry, not many.
    IF EXISTS (SELECT 1 FROM public.institutions WHERE id = OLD.institution_id) THEN
      PERFORM public.audit_write('member.removed', 'person', r.user_id::text, nm, r.institution_id, NULL, jsonb_build_object('role', OLD.role));
    END IF;
  ELSIF OLD.role IS DISTINCT FROM NEW.role THEN
    PERFORM public.audit_write('member.role', 'person', r.user_id::text, nm, r.institution_id, NULL, jsonb_build_object('role', jsonb_build_object('from', OLD.role, 'to', NEW.role)));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_members ON public.institution_members;
CREATE TRIGGER audit_members AFTER INSERT OR UPDATE OR DELETE ON public.institution_members FOR EACH ROW EXECUTE FUNCTION public.audit_members();

-- Yet New staff.
CREATE OR REPLACE FUNCTION public.audit_platform_admins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END; nm text;
BEGIN
  SELECT COALESCE(NULLIF(display_name, ''), username) INTO nm FROM public.user_accounts WHERE user_id = u;
  PERFORM public.audit_write(CASE WHEN TG_OP = 'DELETE' THEN 'staff.removed' ELSE 'staff.added' END, 'person', u::text, nm, NULL, NULL);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_platform_admins ON public.platform_admins;
CREATE TRIGGER audit_platform_admins AFTER INSERT OR DELETE ON public.platform_admins FOR EACH ROW EXECUTE FUNCTION public.audit_platform_admins();

-- Verification requests and their decisions; visitor reports being handled.
CREATE OR REPLACE FUNCTION public.audit_requests()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inst uuid; nm text;
BEGIN
  SELECT institution_id, name INTO inst, nm FROM public.buildings WHERE id = NEW.building_id;
  IF TG_TABLE_NAME = 'verification_requests' THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.audit_write('verification.requested', 'venue', NEW.building_id::text, nm, inst, NEW.building_id, jsonb_build_object('level', NEW.level, 'place', NEW.poi_id));
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      PERFORM public.audit_write('verification.' || NEW.status, 'venue', NEW.building_id::text, nm, inst, NEW.building_id,
        jsonb_build_object('level', NEW.level, 'place', NEW.poi_id, 'note', NEW.decision_note));
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.audit_write('report.' || NEW.status, 'report', NEW.id::text, COALESCE(NEW.place_name, nm), inst, NEW.building_id,
      jsonb_build_object('kind', NEW.kind, 'note', NEW.resolution_note));
  END IF;
  RETURN NULL;
END $$;
DO $$
BEGIN
  IF to_regclass('public.verification_requests') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS audit_requests ON public.verification_requests;
    CREATE TRIGGER audit_requests AFTER INSERT OR UPDATE ON public.verification_requests FOR EACH ROW EXECUTE FUNCTION public.audit_requests();
  END IF;
  IF to_regclass('public.place_reports') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS audit_requests ON public.place_reports;
    CREATE TRIGGER audit_requests AFTER UPDATE ON public.place_reports FOR EACH ROW EXECUTE FUNCTION public.audit_requests();
  END IF;
END $$;

-- Oversight given and taken away.
CREATE OR REPLACE FUNCTION public.audit_oversight()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; over text; nm text;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT name INTO over FROM public.institutions WHERE id = r.overseer_id;
  SELECT name INTO nm FROM public.institutions WHERE id = r.institution_id;
  PERFORM public.audit_write(CASE WHEN TG_OP = 'DELETE' THEN 'oversight.revoked' ELSE 'oversight.granted' END, 'institution', r.institution_id::text, nm, r.institution_id, NULL,
    jsonb_build_object('overseer', over, 'overseer_id', r.overseer_id));
  -- The overseer's side of the log shows it too.
  PERFORM public.audit_write(CASE WHEN TG_OP = 'DELETE' THEN 'oversight.revoked' ELSE 'oversight.granted' END, 'institution', r.institution_id::text, nm, r.overseer_id, NULL,
    jsonb_build_object('overseer', over, 'overseer_id', r.overseer_id));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_oversight ON public.oversight_grants;
CREATE TRIGGER audit_oversight AFTER INSERT OR DELETE ON public.oversight_grants FOR EACH ROW EXECUTE FUNCTION public.audit_oversight();

-- 4. Who sets what ----------------------------------------------------------------------------------
-- Only Yet New changes an institution's kind of account.
CREATE OR REPLACE FUNCTION public.guard_account_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.user_is_platform_admin() OR auth.uid() IS NULL AND current_setting('yetnew.actor', true) IS NULL THEN RETURN NEW; END IF;
  NEW.account_type := CASE WHEN TG_OP = 'INSERT' THEN 'venue' ELSE OLD.account_type END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_account_type ON public.institutions;
CREATE TRIGGER guard_account_type BEFORE INSERT OR UPDATE ON public.institutions FOR EACH ROW EXECUTE FUNCTION public.guard_account_type();

ALTER TABLE public.oversight_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Both sides and Yet New read oversight" ON public.oversight_grants;
CREATE POLICY "Both sides and Yet New read oversight" ON public.oversight_grants FOR SELECT TO authenticated
  USING (public.user_is_platform_admin() OR public.user_can_edit_institution(institution_id) OR public.user_team_role(overseer_id) IN ('owner', 'editor', 'viewer'));
REVOKE ALL ON public.oversight_grants FROM anon, authenticated;
GRANT SELECT ON public.oversight_grants TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_account_type(inst uuid, new_type text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  IF new_type NOT IN ('venue', 'government', 'destination', 'business', 'provider') THEN
    RAISE EXCEPTION 'Unknown kind of account: %', new_type USING ERRCODE = '22023';
  END IF;
  UPDATE public.institutions SET account_type = new_type WHERE id = inst;
  -- An account that no longer oversees loses what it oversaw.
  IF new_type NOT IN ('government', 'destination') THEN DELETE FROM public.oversight_grants WHERE overseer_id = inst; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_set_account_type(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_oversight(overseer uuid, inst uuid, give boolean, note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  IF give THEN
    IF NOT EXISTS (SELECT 1 FROM public.institutions WHERE id = overseer AND account_type IN ('government', 'destination')) THEN
      RAISE EXCEPTION 'Only a government or destination account can oversee others' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.oversight_grants (overseer_id, institution_id, note, granted_by)
    VALUES (overseer, inst, admin_set_oversight.note, auth.uid()) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.oversight_grants WHERE overseer_id = overseer AND institution_id = inst;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_set_oversight(uuid, uuid, boolean, text) TO authenticated;

-- Team changes made by the institution-accounts function (service key) on an owner's
-- behalf: the owner is named so the audit log says who did it. Service role only.
CREATE OR REPLACE FUNCTION public.team_set_member(actor uuid, inst uuid, member uuid, new_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('yetnew.actor', COALESCE(actor::text, ''), true);
  IF new_role IS NULL THEN
    DELETE FROM public.institution_members WHERE institution_id = inst AND user_id = member;
  ELSIF new_role IN ('owner', 'editor', 'viewer') THEN
    INSERT INTO public.institution_members (institution_id, user_id, role) VALUES (inst, member, new_role)
    ON CONFLICT (institution_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  ELSE
    RAISE EXCEPTION 'Unknown role: %', new_role USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('yetnew.actor', '', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.team_set_member(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.team_set_member(uuid, uuid, uuid, text) TO service_role;
  END IF;
END $$;

-- 5. Reading the log ------------------------------------------------------------------------------
-- Newest first, a page at a time; `inst` NULL = everything (Yet New only).
CREATE OR REPLACE FUNCTION public.audit_entries(inst uuid DEFAULT NULL, before_id bigint DEFAULT NULL, lim integer DEFAULT 50)
RETURNS SETOF public.audit_log LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF inst IS NULL THEN PERFORM public.admin_require();
  ELSIF NOT (public.user_is_platform_admin() OR public.user_can_edit_institution(inst)) THEN
    RAISE EXCEPTION 'Only this institution''s owners and editors can read its audit log' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.audit_log a
   WHERE (inst IS NULL OR a.institution_id = inst) AND (before_id IS NULL OR a.id < before_id)
   ORDER BY a.id DESC LIMIT LEAST(GREATEST(lim, 1), 200);
END $$;
GRANT EXECUTE ON FUNCTION public.audit_entries(uuid, bigint, integer) TO authenticated;
