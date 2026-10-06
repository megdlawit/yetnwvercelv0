-- Institution accounts & workspace: username/password sign-up for
-- institutions (accounts are created by the `institution-accounts` edge
-- function), a platform-admin role, per-institution access everywhere,
-- real publishing (visitors see the last published snapshot), an activity
-- log, tours, and venue layout (building with floors / outdoor site with zones).
-- Idempotent: safe to re-run.

-- 1. Platform admins -------------------------------------------------------------
-- The Yet New team. Seeded once with the owners of the institutions that exist
-- before self sign-up opens (on the live project: the Unity Park admin account).
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_admins (user_id)
  SELECT DISTINCT owner_id FROM public.institutions
  WHERE owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.platform_admins)
ON CONFLICT DO NOTHING;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins see themselves" ON public.platform_admins;
CREATE POLICY "Admins see themselves" ON public.platform_admins FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.platform_admins TO authenticated;

CREATE OR REPLACE FUNCTION public.user_is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.user_is_platform_admin() TO anon, authenticated;

-- 2. Access: every venue belongs to an institution ---------------------------------
-- Before: a venue with no institution was editable by ANY signed-in user (and
-- visitors get sessions too). Now only platform admins can touch those, and
-- platform admins can help any institution.
CREATE OR REPLACE FUNCTION public.user_can_edit_institution(inst uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.institutions i WHERE i.id = inst AND i.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.institution_members m WHERE m.institution_id = inst AND m.user_id = auth.uid())
    OR public.user_is_platform_admin()
  );
$$;

CREATE OR REPLACE FUNCTION public.user_can_edit_building(b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.buildings bl
    WHERE bl.id = b
      AND (CASE WHEN bl.institution_id IS NULL THEN public.user_is_platform_admin()
                ELSE public.user_can_edit_institution(bl.institution_id) END)
  );
$$;

DROP POLICY IF EXISTS "Authenticated can insert buildings" ON public.buildings;
DROP POLICY IF EXISTS "Editors can update buildings" ON public.buildings;
-- Checks the row's own institution (not a lookup by id), so a venue just
-- inserted can be read back in the same request (insert … returning).
DROP POLICY IF EXISTS "Published or editable buildings are readable" ON public.buildings;
CREATE POLICY "Published or editable buildings are readable" ON public.buildings FOR SELECT
  USING (is_published OR (CASE WHEN institution_id IS NULL THEN public.user_is_platform_admin() ELSE public.user_can_edit_institution(institution_id) END));
CREATE POLICY "Authenticated can insert buildings" ON public.buildings FOR INSERT TO authenticated
  WITH CHECK (CASE WHEN institution_id IS NULL THEN public.user_is_platform_admin() ELSE public.user_can_edit_institution(institution_id) END);
CREATE POLICY "Editors can update buildings" ON public.buildings FOR UPDATE TO authenticated
  USING (public.user_can_edit_building(id))
  WITH CHECK (CASE WHEN institution_id IS NULL THEN public.user_is_platform_admin() ELSE public.user_can_edit_institution(institution_id) END);

-- Partner API keys are issued by the Yet New team, not by each institution.
DROP POLICY IF EXISTS "Institution editors manage partner_keys" ON public.partner_keys;
DROP POLICY IF EXISTS "Platform admins manage partner_keys" ON public.partner_keys;
CREATE POLICY "Platform admins manage partner_keys" ON public.partner_keys
  FOR ALL TO authenticated USING (public.user_is_platform_admin()) WITH CHECK (public.user_is_platform_admin());

-- 3. Accounts (username → person) ----------------------------------------------------
-- Sign-in uses Supabase Auth with an internal address <username>@accounts.yetnew.app;
-- this table holds the username and the name shown to teammates.
CREATE TABLE IF NOT EXISTS public.user_accounts (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username     text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
  display_name text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.users_share_institution(other uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM (
      SELECT institution_id FROM public.institution_members WHERE user_id = auth.uid()
      UNION SELECT id FROM public.institutions WHERE owner_id = auth.uid()
    ) mine
    JOIN (
      SELECT institution_id FROM public.institution_members WHERE user_id = other
      UNION SELECT id FROM public.institutions WHERE owner_id = other
    ) theirs USING (institution_id)
  );
$$;
GRANT EXECUTE ON FUNCTION public.users_share_institution(uuid) TO authenticated;

ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read own and teammates' accounts" ON public.user_accounts;
DROP POLICY IF EXISTS "Edit own display name" ON public.user_accounts;
CREATE POLICY "Read own and teammates' accounts" ON public.user_accounts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.users_share_institution(user_id) OR public.user_is_platform_admin());
CREATE POLICY "Edit own display name" ON public.user_accounts FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.user_accounts FROM anon, authenticated;
GRANT SELECT ON public.user_accounts TO authenticated;
GRANT UPDATE (display_name) ON public.user_accounts TO authenticated;

-- Institution profile.
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS description text;

-- 4. Venue layout & publishing ---------------------------------------------------------
-- 'building' has floors; 'site' (parks, campuses) has zones instead.
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS layout text NOT NULL DEFAULT 'building';
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buildings_layout_check') THEN
    ALTER TABLE public.buildings ADD CONSTRAINT buildings_layout_check CHECK (layout IN ('building', 'site'));
  END IF;
END $$;

-- What visitors see: a copy of the venue taken at "Publish". Edits after that
-- stay private (the team previews them) until the next publish.
CREATE TABLE IF NOT EXISTS public.venue_snapshots (
  building_id  uuid PRIMARY KEY REFERENCES public.buildings(id) ON DELETE CASCADE,
  data         jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.venue_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Published snapshots are public" ON public.venue_snapshots;
CREATE POLICY "Published snapshots are public" ON public.venue_snapshots FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.buildings b WHERE b.id = building_id AND b.is_published) OR public.user_can_edit_building(building_id));
GRANT SELECT ON public.venue_snapshots TO anon, authenticated;

-- 5. Tours ------------------------------------------------------------------------------
ALTER TABLE public.venue_content ADD COLUMN IF NOT EXISTS stops uuid[] NOT NULL DEFAULT '{}';  -- pois, in visiting order
ALTER TABLE public.venue_content DROP CONSTRAINT IF EXISTS venue_content_kind_check;
ALTER TABLE public.venue_content ADD CONSTRAINT venue_content_kind_check
  CHECK (kind IN ('story', 'guide', 'announcement', 'event', 'educational', 'tour'));

-- 6. Activity log -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venue_activity (
  id          bigserial PRIMARY KEY,
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name  text,
  action      text NOT NULL,         -- created | updated | deleted | map_edited | published | unpublished
  object_type text NOT NULL,         -- place | story | event | … | floor | map | venue
  object_name text,
  count       integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_venue_activity_building ON public.venue_activity(building_id, created_at DESC);
ALTER TABLE public.venue_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Editors read activity" ON public.venue_activity;
CREATE POLICY "Editors read activity" ON public.venue_activity FOR SELECT TO authenticated USING (public.user_can_edit_building(building_id));
GRANT SELECT ON public.venue_activity TO authenticated;

CREATE OR REPLACE FUNCTION public.current_actor_name()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(a.display_name, ''), a.username, NULLIF(u.raw_user_meta_data->>'display_name', ''), split_part(u.email, '@', 1))
  FROM auth.users u LEFT JOIN public.user_accounts a ON a.user_id = u.id
  WHERE u.id = auth.uid();
$$;

-- Records one change, folding repeats of the same change by the same person
-- within 10 minutes into one entry (so dragging a place around is one line).
CREATE OR REPLACE FUNCTION public.note_venue_activity(b uuid, act text, typ text, nm text, n integer DEFAULT 1)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE hit bigint;
BEGIN
  IF b IS NULL OR NOT EXISTS (SELECT 1 FROM public.buildings WHERE id = b) THEN RETURN; END IF;  -- venue being deleted
  SELECT id INTO hit FROM public.venue_activity
   WHERE building_id = b AND actor_id IS NOT DISTINCT FROM auth.uid() AND action = act AND object_type = typ
     AND object_name IS NOT DISTINCT FROM nm AND created_at > now() - interval '10 minutes'
     AND NOT EXISTS (SELECT 1 FROM public.buildings x WHERE x.id = b AND x.published_at > venue_activity.created_at)
   ORDER BY created_at DESC LIMIT 1;
  IF hit IS NOT NULL THEN
    UPDATE public.venue_activity SET count = count + n, created_at = now() WHERE id = hit;
  ELSE
    INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name, count)
    VALUES (b, auth.uid(), public.current_actor_name(), act, typ, nm, n);
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.note_venue_activity(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;

-- Places, content, floors and venue details: one entry per named thing.
CREATE OR REPLACE FUNCTION public.log_venue_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; skip text[] := ARRAY['is_published', 'published_at', 'published_by', 'version', 'updated_at'];
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME = 'buildings' THEN
    IF TG_OP <> 'UPDATE' OR (to_jsonb(NEW) - skip) = (to_jsonb(OLD) - skip) THEN RETURN NULL; END IF;
    PERFORM public.note_venue_activity(NEW.id, 'updated', 'venue', NEW.name);
  ELSE
    PERFORM public.note_venue_activity(
      (r->>'building_id')::uuid,
      CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END,
      CASE TG_TABLE_NAME WHEN 'pois' THEN 'place' WHEN 'floors' THEN 'floor' ELSE COALESCE(r->>'kind', 'content') END,
      COALESCE(NULLIF(r->>'name', ''), r->>'title'));
  END IF;
  RETURN NULL;
END $$;

-- Map geometry (walls, paths, areas, objects): one "map edited" entry per
-- statement, so a 5,000-wall CAD import is one line, not 5,000.
CREATE OR REPLACE FUNCTION public.log_venue_map()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b uuid; n integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR b, n IN SELECT building_id, count(*) FROM old_rows GROUP BY building_id LOOP
      PERFORM public.note_venue_activity(b, 'map_edited', 'map', NULL, n);
    END LOOP;
  ELSE
    FOR b, n IN SELECT building_id, count(*) FROM new_rows GROUP BY building_id LOOP
      PERFORM public.note_venue_activity(b, 'map_edited', 'map', NULL, n);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pois', 'venue_content', 'floors', 'buildings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS log_activity ON public.%I', t);
    EXECUTE format('CREATE TRIGGER log_activity AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_venue_row()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['walls', 'nodes', 'edges', 'rooms', 'map_features'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS log_activity_ins ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS log_activity_upd ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS log_activity_del ON public.%I', t);
    EXECUTE format('CREATE TRIGGER log_activity_ins AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.log_venue_map()', t);
    EXECUTE format('CREATE TRIGGER log_activity_upd AFTER UPDATE ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.log_venue_map()', t);
    EXECUTE format('CREATE TRIGGER log_activity_del AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.log_venue_map()', t);
  END LOOP;
END $$;

-- 7. Publish / unpublish ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_venue(b uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE snap jsonb; t timestamptz := now();
BEGIN
  IF NOT public.user_can_edit_building(b) THEN
    RAISE EXCEPTION 'You are not allowed to publish this venue' USING ERRCODE = '42501';
  END IF;
  snap := jsonb_build_object(
    'building',     (SELECT jsonb_build_object('id', id, 'name', name, 'description', description, 'theme', theme, 'layout', layout) FROM public.buildings WHERE id = b),
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

CREATE OR REPLACE FUNCTION public.unpublish_venue(b uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.user_can_edit_building(b) THEN
    RAISE EXCEPTION 'You are not allowed to unpublish this venue' USING ERRCODE = '42501';
  END IF;
  UPDATE public.buildings SET is_published = false WHERE id = b;
  INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name)
  VALUES (b, auth.uid(), public.current_actor_name(), 'unpublished', 'venue', (SELECT name FROM public.buildings WHERE id = b));
END $$;
REVOKE EXECUTE ON FUNCTION public.publish_venue(uuid), public.unpublish_venue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_venue(uuid), public.unpublish_venue(uuid) TO authenticated;

-- 8. Media uploads -----------------------------------------------------------------------
-- Before: anyone, even signed out, could upload, overwrite or delete any file.
-- Now files live under inst/<institution id>/… and only that institution's
-- team can change them; other paths are for platform admins. Reads stay public.
CREATE OR REPLACE FUNCTION public.storage_path_editable(path text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE parts text[] := string_to_array(path, '/');
BEGIN
  IF public.user_is_platform_admin() THEN RETURN true; END IF;
  IF parts[1] = 'inst' AND array_length(parts, 1) >= 3 THEN
    RETURN public.user_can_edit_institution(parts[2]::uuid);
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION public.storage_path_editable(text) TO anon, authenticated;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  DROP POLICY IF EXISTS "Public upload access for poi-media" ON storage.objects;
  DROP POLICY IF EXISTS "Public update access for poi-media" ON storage.objects;
  DROP POLICY IF EXISTS "Public delete access for poi-media" ON storage.objects;
  DROP POLICY IF EXISTS "Teams upload poi-media" ON storage.objects;
  DROP POLICY IF EXISTS "Teams update poi-media" ON storage.objects;
  DROP POLICY IF EXISTS "Teams delete poi-media" ON storage.objects;
  CREATE POLICY "Teams upload poi-media" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'poi-media' AND public.storage_path_editable(name));
  CREATE POLICY "Teams update poi-media" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'poi-media' AND public.storage_path_editable(name));
  CREATE POLICY "Teams delete poi-media" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'poi-media' AND public.storage_path_editable(name));
END $$;
