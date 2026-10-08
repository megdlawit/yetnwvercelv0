-- The Yet New control center (/admin): every institution, venue and person in
-- one place, and the approvals the platform team decides.
--
-- Approvals
--   • Institutions: a new institution starts 'pending'. It can build its venue
--     straight away, but nothing goes live until Yet New approves it.
--     Existing institutions are approved as they are. 'suspended' takes an
--     institution's venues offline and stops it publishing.
--   • Publishing: when a team that isn't approved yet presses Publish, the
--     venue is queued for review instead (buildings.review_status =
--     'pending'); approving it publishes it. Approved institutions publish
--     directly, as before.
--
-- Everything the console reads goes through admin_* functions that check
-- user_is_platform_admin() first (they can see e-mail addresses and counts
-- across all institutions, which ordinary RLS rightly hides).

-- 1. Status -----------------------------------------------------------------------------------
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';
ALTER TABLE public.institutions ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.institutions ADD COLUMN IF NOT EXISTS review_note text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'institutions_status_check') THEN
    ALTER TABLE public.institutions ADD CONSTRAINT institutions_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'suspended'));
  END IF;
END $$;

ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'none';
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS review_requested_at timestamptz;
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS review_note text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buildings_review_status_check') THEN
    ALTER TABLE public.buildings ADD CONSTRAINT buildings_review_status_check CHECK (review_status IN ('none', 'pending', 'rejected'));
  END IF;
END $$;

-- Teams must not approve themselves: only the platform can change these columns.
CREATE OR REPLACE FUNCTION public.guard_review_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.user_is_platform_admin() OR current_setting('yetnew.review', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'institutions' THEN
    IF TG_OP = 'INSERT' THEN NEW.status := 'pending'; NEW.reviewed_at := NULL; NEW.reviewed_by := NULL; NEW.review_note := NULL;
    ELSE NEW.status := OLD.status; NEW.reviewed_at := OLD.reviewed_at; NEW.reviewed_by := OLD.reviewed_by; NEW.review_note := OLD.review_note; END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN NEW.review_status := 'none'; NEW.review_requested_at := NULL; NEW.review_note := NULL;
    ELSE NEW.review_status := OLD.review_status; NEW.review_requested_at := OLD.review_requested_at; NEW.review_note := OLD.review_note; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_review_columns ON public.institutions;
CREATE TRIGGER guard_review_columns BEFORE INSERT OR UPDATE ON public.institutions FOR EACH ROW EXECUTE FUNCTION public.guard_review_columns();
DROP TRIGGER IF EXISTS guard_review_columns ON public.buildings;
CREATE TRIGGER guard_review_columns BEFORE INSERT OR UPDATE ON public.buildings FOR EACH ROW EXECUTE FUNCTION public.guard_review_columns();

-- The institution a venue belongs to may publish directly?
CREATE OR REPLACE FUNCTION public.venue_may_publish(b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.user_is_platform_admin() OR COALESCE((
    SELECT i.status = 'approved' FROM public.buildings x JOIN public.institutions i ON i.id = x.institution_id WHERE x.id = b
  ), true)
$$;

-- 2. Publishing (the snapshot is the same as 20261005090000) --------------------------------
-- Returns the publish time, or NULL when the venue was sent for review instead.
CREATE OR REPLACE FUNCTION public.publish_venue(b uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE snap jsonb; t timestamptz := now();
BEGIN
  IF NOT public.user_can_edit_building(b) THEN
    RAISE EXCEPTION 'You are not allowed to publish this venue' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.buildings x JOIN public.institutions i ON i.id = x.institution_id WHERE x.id = b AND i.status = 'suspended')
     AND NOT public.user_is_platform_admin() THEN
    RAISE EXCEPTION 'This institution is suspended. Contact Yet New to publish again.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.venue_may_publish(b) THEN
    PERFORM set_config('yetnew.review', 'on', true);
    UPDATE public.buildings SET review_status = 'pending', review_requested_at = t, review_note = NULL WHERE id = b;
    INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name, created_at)
    VALUES (b, auth.uid(), public.current_actor_name(), 'requested review', 'venue', (SELECT name FROM public.buildings WHERE id = b), t);
    RETURN NULL;
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
  PERFORM set_config('yetnew.review', 'on', true);
  UPDATE public.buildings SET is_published = true, published_at = t, published_by = auth.uid(), version = version + 1,
    review_status = 'none', review_requested_at = NULL WHERE id = b;
  INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name, created_at)
  VALUES (b, auth.uid(), public.current_actor_name(), 'published', 'venue', (SELECT name FROM public.buildings WHERE id = b), t);
  RETURN t;
END $$;
REVOKE EXECUTE ON FUNCTION public.publish_venue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_venue(uuid) TO authenticated;

-- 3. The console's reads --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_require()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.user_is_platform_admin() THEN RAISE EXCEPTION 'Yet New team only' USING ERRCODE = '42501'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.admin_require();
  r := jsonb_build_object(
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
    'publishes_30d',         (SELECT count(*) FROM public.venue_activity WHERE action = 'published' AND created_at > now() - interval '30 days')
  );
  RETURN r;
END $$;

-- Visitor numbers live in tables that may not exist everywhere; counted separately.
CREATE OR REPLACE FUNCTION public.admin_visitor_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE visitors bigint := 0; with_email bigint := 0; saves bigint := 0; visits bigint := 0; steps bigint := 0;
BEGIN
  PERFORM public.admin_require();
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE 'SELECT count(*), count(email), COALESCE(sum(steps_walked), 0) FROM public.profiles' INTO visitors, with_email, steps;
  END IF;
  IF to_regclass('public.saved_places') IS NOT NULL THEN EXECUTE 'SELECT count(*) FROM public.saved_places' INTO saves; END IF;
  IF to_regclass('public.visited_places') IS NOT NULL THEN EXECUTE 'SELECT COALESCE(sum(visit_count), 0) FROM public.visited_places' INTO visits; END IF;
  RETURN jsonb_build_object('visitors', visitors, 'with_email', with_email, 'saves', saves, 'visits', visits, 'steps', steps);
END $$;

CREATE OR REPLACE FUNCTION public.admin_institutions()
RETURNS TABLE (id uuid, name text, kind text, status text, created_at timestamptz, reviewed_at timestamptz, review_note text, logo_url text,
               owner_id uuid, owner_username text, owner_name text, members bigint, venues bigint, published bigint, pending_reviews bigint, last_activity timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  RETURN QUERY
  SELECT i.id, i.name::text, i.kind::text, i.status, i.created_at, i.reviewed_at, i.review_note, i.logo_url,
         i.owner_id, ua.username::text, ua.display_name::text,
         (SELECT count(*) FROM public.institution_members m WHERE m.institution_id = i.id),
         (SELECT count(*) FROM public.buildings x WHERE x.institution_id = i.id),
         (SELECT count(*) FROM public.buildings x WHERE x.institution_id = i.id AND x.is_published),
         (SELECT count(*) FROM public.buildings x WHERE x.institution_id = i.id AND x.review_status = 'pending'),
         (SELECT max(a.created_at) FROM public.venue_activity a JOIN public.buildings x ON x.id = a.building_id WHERE x.institution_id = i.id)
  FROM public.institutions i
  LEFT JOIN public.user_accounts ua ON ua.user_id = i.owner_id
  ORDER BY (i.status = 'pending') DESC, i.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.admin_venues()
RETURNS TABLE (id uuid, name text, institution_id uuid, institution_name text, institution_status text, layout text, is_published boolean,
               published_at timestamptz, review_status text, review_requested_at timestamptz, review_note text, home_rank integer,
               floors bigint, places bigint, placed boolean, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  RETURN QUERY
  SELECT x.id, x.name::text, x.institution_id, i.name::text, i.status, x.layout::text, x.is_published, x.published_at,
         x.review_status, x.review_requested_at, x.review_note, COALESCE(x.home_rank, 0)::integer,
         (SELECT count(*) FROM public.floors f WHERE f.building_id = x.id),
         (SELECT count(*) FROM public.nodes n WHERE n.building_id = x.id AND NOT COALESCE(n.is_hallway, false)),
         x.origin_lat IS NOT NULL, x.updated_at
  FROM public.buildings x LEFT JOIN public.institutions i ON i.id = x.institution_id
  ORDER BY (x.review_status = 'pending') DESC, x.updated_at DESC NULLS LAST;
END $$;

CREATE OR REPLACE FUNCTION public.admin_users()
RETURNS TABLE (user_id uuid, username text, display_name text, email text, created_at timestamptz, last_sign_in_at timestamptz,
               is_platform_admin boolean, institutions jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  PERFORM public.admin_require();
  RETURN QUERY
  SELECT u.id, ua.username::text, ua.display_name::text, u.email::text, u.created_at, u.last_sign_in_at,
         EXISTS (SELECT 1 FROM public.platform_admins p WHERE p.user_id = u.id),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'role', COALESCE(m.role, 'owner')))
                   FROM public.institutions i LEFT JOIN public.institution_members m ON m.institution_id = i.id AND m.user_id = u.id
                   WHERE m.user_id = u.id OR i.owner_id = u.id), '[]'::jsonb)
  FROM auth.users u LEFT JOIN public.user_accounts ua ON ua.user_id = u.id
  WHERE ua.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.platform_admins p WHERE p.user_id = u.id)
  ORDER BY u.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.admin_activity(lim integer DEFAULT 40)
RETURNS TABLE (id bigint, building_id uuid, venue_name text, institution_name text, actor_name text, action text, object_type text,
               object_name text, count integer, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  RETURN QUERY
  SELECT a.id::bigint, a.building_id, x.name::text, i.name::text, a.actor_name::text, a.action::text, a.object_type::text, a.object_name::text,
         COALESCE(a.count, 1)::integer, a.created_at
  FROM public.venue_activity a LEFT JOIN public.buildings x ON x.id = a.building_id LEFT JOIN public.institutions i ON i.id = x.institution_id
  ORDER BY a.created_at DESC LIMIT GREATEST(1, LEAST(lim, 200));
END $$;

-- 4. The console's decisions ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_institution_status(inst uuid, new_status text, note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record;
BEGIN
  PERFORM public.admin_require();
  IF new_status NOT IN ('pending', 'approved', 'rejected', 'suspended') THEN RAISE EXCEPTION 'Unknown status %', new_status; END IF;
  UPDATE public.institutions SET status = new_status, reviewed_at = now(), reviewed_by = auth.uid(), review_note = NULLIF(trim(note), '') WHERE id = inst;
  IF new_status IN ('suspended', 'rejected') THEN
    -- Off line, and nothing waiting.
    UPDATE public.buildings SET is_published = false, review_status = CASE WHEN review_status = 'pending' THEN 'rejected' ELSE review_status END,
      review_note = CASE WHEN review_status = 'pending' THEN NULLIF(trim(note), '') ELSE review_note END
    WHERE institution_id = inst;
  ELSIF new_status = 'approved' THEN
    -- Approving the institution publishes what it was waiting to publish.
    FOR v IN SELECT id FROM public.buildings WHERE institution_id = inst AND review_status = 'pending' LOOP
      PERFORM public.publish_venue(v.id);
    END LOOP;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_review_venue(b uuid, approve boolean, note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  IF approve THEN
    PERFORM public.publish_venue(b);
    UPDATE public.buildings SET review_note = NULLIF(trim(note), '') WHERE id = b;
  ELSE
    UPDATE public.buildings SET review_status = 'rejected', review_note = NULLIF(trim(note), '') WHERE id = b;
    INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name)
    VALUES (b, auth.uid(), public.current_actor_name(), 'review declined', 'venue', (SELECT name FROM public.buildings WHERE id = b));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_venue_live(b uuid, live boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  IF live THEN PERFORM public.publish_venue(b); ELSE PERFORM public.unpublish_venue(b); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_home_rank(b uuid, rank integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  UPDATE public.buildings SET home_rank = rank WHERE id = b;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_platform_admin(u uuid, make boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  IF NOT make AND u = auth.uid() THEN RAISE EXCEPTION 'You can''t remove your own admin access.'; END IF;
  IF make THEN INSERT INTO public.platform_admins (user_id) VALUES (u) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.platform_admins WHERE user_id = u; END IF;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_require()', 'admin_overview()', 'admin_visitor_stats()', 'admin_institutions()', 'admin_venues()', 'admin_users()',
    'admin_activity(integer)', 'admin_set_institution_status(uuid, text, text)', 'admin_review_venue(uuid, boolean, text)',
    'admin_set_venue_live(uuid, boolean)', 'admin_set_home_rank(uuid, integer)', 'admin_set_platform_admin(uuid, boolean)', 'venue_may_publish(uuid)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
