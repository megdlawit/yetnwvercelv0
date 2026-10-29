-- The MVP's ecosystem and trust layer (business plan §18 YET NEW Business, §20 Identity, Trust and
-- Verification, §21 Reviews and Feedback):
--
--   1. Business places: restaurants, hotels and shops join cafés as place types.
--   2. Business profiles: contact, prices, amenities and an "about" for a business place. Kept in
--      their own table, read live (not from the published snapshot), so a business's own edits
--      reach visitors at once. Once a business has claimed a place, only that business (and
--      Yet New) changes its profile; the venue's team still owns the place on the map.
--   3. Claims: a business account asks to manage a listing; Yet New decides (plan §18.1).
--   4. Reviews: visitors with a confirmed email rate a place and write a few words; the venue's
--      team or the claiming business can answer; anyone can flag a review and only Yet New hides
--      one. Nobody reviews their own place. Reviews are visitor feedback, never official
--      information, and the app labels them so.
--   5. Verification gets a scope and an end date (plan §20: "verification date, verification
--      scope, expiry or review date"). Lapsed verification shows as "re-check due", and Yet New
--      sees what's due.
--
-- Also fixes 20261028090000's trust guard, which made every insert or update of a place (pois) fail
-- with "record new has no field is_published" (section 5).
--
-- Run on the STAGING project first.

-- 1. Business place types ------------------------------------------------------------------------
ALTER TABLE public.pois DROP CONSTRAINT IF EXISTS pois_place_type_check;
ALTER TABLE public.pois ADD CONSTRAINT pois_place_type_check CHECK (place_type IS NULL OR place_type IN (
  'attraction', 'garden', 'cafe', 'restaurant', 'hotel', 'shop', 'restroom', 'parking', 'entrance', 'info_desk',
  'play_area', 'viewpoint', 'cultural_site', 'custom'));

-- Places a business can claim.
CREATE OR REPLACE FUNCTION public.is_business_place_type(t text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT t IN ('cafe', 'restaurant', 'hotel', 'shop', 'custom') $$;

-- 2. Business profiles -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_profiles (
  poi_id       uuid PRIMARY KEY REFERENCES public.pois(id) ON DELETE CASCADE,
  building_id  uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  -- The business account that manages it, once a claim is approved.
  business_id  uuid REFERENCES public.institutions(id) ON DELETE SET NULL,
  claimed_at   timestamptz,
  about        text CHECK (char_length(about) <= 2000),
  phone        text CHECK (char_length(phone) <= 40),
  whatsapp     text CHECK (char_length(whatsapp) <= 40),
  email        text CHECK (char_length(email) <= 200),
  website      text CHECK (char_length(website) <= 300),
  price_range  text CHECK (price_range IS NULL OR price_range IN ('$', '$$', '$$$', '$$$$')),
  price_note   text CHECK (char_length(price_note) <= 300),
  amenities    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(amenities) <= 30),
  booking_note text CHECK (char_length(booking_note) <= 300),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_business_profiles_building ON public.business_profiles(building_id);
CREATE INDEX IF NOT EXISTS idx_business_profiles_business ON public.business_profiles(business_id);

-- Can this person change this business place's profile?
CREATE OR REPLACE FUNCTION public.user_can_edit_business_profile(p uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (public.user_is_platform_admin() OR COALESCE((
    SELECT CASE WHEN bp.business_id IS NOT NULL THEN public.user_can_edit_institution(bp.business_id)
                ELSE public.user_can_edit_building(bp.building_id) END
      FROM public.business_profiles bp WHERE bp.poi_id = p), false));
$$;
GRANT EXECUTE ON FUNCTION public.user_can_edit_business_profile(uuid) TO authenticated;

ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone reads profiles of published venues" ON public.business_profiles;
CREATE POLICY "Anyone reads profiles of published venues" ON public.business_profiles FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.buildings b WHERE b.id = building_id AND b.is_published)
    OR public.user_can_view_building(building_id)
    OR (business_id IS NOT NULL AND public.user_can_view_institution(business_id)));
DROP POLICY IF EXISTS "Venue teams start a profile" ON public.business_profiles;
CREATE POLICY "Venue teams start a profile" ON public.business_profiles FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_building(building_id));
DROP POLICY IF EXISTS "The managing side edits a profile" ON public.business_profiles;
CREATE POLICY "The managing side edits a profile" ON public.business_profiles FOR UPDATE TO authenticated
  USING (public.user_can_edit_business_profile(poi_id)) WITH CHECK (public.user_can_edit_business_profile(poi_id));
DROP POLICY IF EXISTS "Venue teams remove an unclaimed profile" ON public.business_profiles;
CREATE POLICY "Venue teams remove an unclaimed profile" ON public.business_profiles FOR DELETE TO authenticated
  USING ((business_id IS NULL AND public.user_can_edit_building(building_id)) OR public.user_is_platform_admin());
GRANT SELECT ON public.business_profiles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.business_profiles TO authenticated;

-- The place decides the venue; only a claim decision (or Yet New) sets who manages it.
CREATE OR REPLACE FUNCTION public.guard_business_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.building_id := (SELECT building_id FROM public.pois WHERE id = NEW.poi_id);
  IF NEW.building_id IS NULL THEN RAISE EXCEPTION 'That place has no venue.' USING ERRCODE = '22023'; END IF;
  -- COALESCE: an unset setting is NULL, and NOT (false OR NULL) is NULL, which would skip this guard.
  IF NOT (public.user_is_platform_admin() OR COALESCE(current_setting('yetnew.claim', true), '') = 'on') THEN
    IF TG_OP = 'INSERT' THEN NEW.business_id := NULL; NEW.claimed_at := NULL;
    ELSE NEW.poi_id := OLD.poi_id; NEW.business_id := OLD.business_id; NEW.claimed_at := OLD.claimed_at;
    END IF;
  END IF;
  NEW.updated_at := now(); NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_business_profile ON public.business_profiles;
CREATE TRIGGER guard_business_profile BEFORE INSERT OR UPDATE ON public.business_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_business_profile();

-- 3. Claims ------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_claims (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poi_id        uuid NOT NULL REFERENCES public.pois(id) ON DELETE CASCADE,
  building_id   uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  business_id   uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  -- Who they are and how Yet New can check: their role, a trade licence number, a website…
  evidence      text NOT NULL CHECK (char_length(evidence) BETWEEN 10 AND 2000),
  contact_phone text CHECK (char_length(contact_phone) <= 40),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  decision_note text CHECK (char_length(decision_note) <= 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS business_claims_one_pending ON public.business_claims(poi_id, business_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_business_claims_status ON public.business_claims(status, requested_at);

ALTER TABLE public.business_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "The business, the venue and Yet New read claims" ON public.business_claims;
CREATE POLICY "The business, the venue and Yet New read claims" ON public.business_claims FOR SELECT TO authenticated
  USING (public.user_is_platform_admin() OR public.user_can_view_institution(business_id) OR public.user_can_view_building(building_id));
REVOKE ALL ON public.business_claims FROM anon, authenticated;
GRANT SELECT ON public.business_claims TO authenticated;

-- Places a business could claim: business places in published venues, by name.
CREATE OR REPLACE FUNCTION public.business_claimable_places(q text)
RETURNS TABLE (poi_id uuid, place_name text, place_type text, building_id uuid, venue_name text, claimed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name::text, p.place_type, b.id, b.name::text, COALESCE(bp.business_id IS NOT NULL, false)
  FROM public.pois p
  JOIN public.buildings b ON b.id = p.building_id AND b.is_published
  LEFT JOIN public.business_profiles bp ON bp.poi_id = p.id
  WHERE public.is_business_place_type(p.place_type) AND COALESCE(p.is_visible, true)
    AND char_length(trim(q)) >= 2 AND (p.name ILIKE '%' || trim(q) || '%' OR b.name ILIKE '%' || trim(q) || '%')
  ORDER BY (p.name ILIKE trim(q) || '%') DESC, p.name
  LIMIT 30;
$$;
GRANT EXECUTE ON FUNCTION public.business_claimable_places(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_business_claim(poi uuid, business uuid, evidence text, phone text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.pois; b public.buildings; id_ uuid;
BEGIN
  IF NOT public.user_can_edit_institution(business) THEN
    RAISE EXCEPTION 'Only the business''s owners and editors can claim for it.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT account_type FROM public.institutions WHERE id = business) IS DISTINCT FROM 'business' THEN
    RAISE EXCEPTION 'Only a business account can claim a place.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.pois WHERE id = poi;
  SELECT * INTO b FROM public.buildings WHERE id = p.building_id;
  IF p.id IS NULL OR NOT COALESCE(b.is_published, false) OR NOT public.is_business_place_type(p.place_type) THEN
    RAISE EXCEPTION 'That place can''t be claimed.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.poi_id = poi AND bp.business_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Another business already manages this place. Contact Yet New if that''s wrong.' USING ERRCODE = '42710';
  END IF;
  IF char_length(trim(COALESCE(evidence, ''))) < 10 THEN
    RAISE EXCEPTION 'Tell us how we can check it''s your business (at least a sentence).' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.business_claims (poi_id, building_id, business_id, evidence, contact_phone, requested_by)
  VALUES (poi, p.building_id, business, trim(evidence), NULLIF(trim(phone), ''), auth.uid())
  RETURNING id INTO id_;
  PERFORM public.audit_write('business.claim_requested', 'place', poi::text, p.name, b.institution_id, b.id,
    jsonb_build_object('business', business, 'business_name', (SELECT name FROM public.institutions WHERE id = business)));
  RETURN id_;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'You''ve already asked to manage this place; Yet New will decide soon.' USING ERRCODE = '23505';
END $$;
GRANT EXECUTE ON FUNCTION public.request_business_claim(uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_business_claim(claim uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.business_claims SET status = 'withdrawn', decided_at = now(), decided_by = auth.uid()
  WHERE id = claim AND status = 'pending' AND public.user_can_edit_institution(business_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'This claim is no longer waiting.' USING ERRCODE = '22023'; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.withdraw_business_claim(uuid) TO authenticated;

-- A business's own places: profile, place, venue, and how visitors rate it.
CREATE OR REPLACE FUNCTION public.business_places(business uuid)
RETURNS TABLE (poi_id uuid, place_name text, place_type text, building_id uuid, venue_name text, images text[],
               profile jsonb, rating numeric, reviews bigint, unanswered bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.user_can_view_institution(business) THEN RAISE EXCEPTION 'Not your business.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT p.id, p.name::text, p.place_type, b.id, b.name::text, COALESCE(p.images, '{}'),
         to_jsonb(bp) - 'poi_id' - 'building_id' - 'business_id',
         (SELECT round(avg(r.rating)::numeric, 1) FROM public.place_reviews r WHERE r.poi_id = p.id AND r.status = 'visible'),
         (SELECT count(*) FROM public.place_reviews r WHERE r.poi_id = p.id AND r.status = 'visible'),
         (SELECT count(*) FROM public.place_reviews r WHERE r.poi_id = p.id AND r.status = 'visible' AND r.reply_body IS NULL)
  FROM public.business_profiles bp
  JOIN public.pois p ON p.id = bp.poi_id
  JOIN public.buildings b ON b.id = bp.building_id
  WHERE bp.business_id = business
  ORDER BY p.name;
END $$;
GRANT EXECUTE ON FUNCTION public.business_places(uuid) TO authenticated;

-- Yet New's queue and decision.
CREATE OR REPLACE FUNCTION public.admin_business_claims()
RETURNS TABLE (id uuid, poi_id uuid, place_name text, place_type text, building_id uuid, venue_name text, venue_institution text,
               business_id uuid, business_name text, evidence text, contact_phone text, requested_at timestamptz, requested_by_name text,
               other_claims bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  RETURN QUERY
  SELECT c.id, c.poi_id, p.name::text, p.place_type, c.building_id, b.name::text, vi.name::text, c.business_id, bi.name::text,
         c.evidence, c.contact_phone, c.requested_at, COALESCE(ua.display_name, ua.username)::text,
         (SELECT count(*) FROM public.business_claims o WHERE o.poi_id = c.poi_id AND o.status = 'pending' AND o.id <> c.id)
  FROM public.business_claims c
  JOIN public.pois p ON p.id = c.poi_id
  JOIN public.buildings b ON b.id = c.building_id
  LEFT JOIN public.institutions vi ON vi.id = b.institution_id
  JOIN public.institutions bi ON bi.id = c.business_id
  LEFT JOIN public.user_accounts ua ON ua.user_id = c.requested_by
  WHERE c.status = 'pending'
  ORDER BY c.requested_at;
END $$;

CREATE OR REPLACE FUNCTION public.admin_decide_business_claim(claim uuid, approve boolean, note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.business_claims; nm text; inst uuid;
BEGIN
  PERFORM public.admin_require();
  SELECT * INTO c FROM public.business_claims WHERE id = claim FOR UPDATE;
  IF NOT FOUND OR c.status <> 'pending' THEN RAISE EXCEPTION 'This claim is no longer waiting.'; END IF;
  SELECT p.name, b.institution_id INTO nm, inst FROM public.pois p JOIN public.buildings b ON b.id = p.building_id WHERE p.id = c.poi_id;
  UPDATE public.business_claims SET status = CASE WHEN approve THEN 'approved' ELSE 'rejected' END,
    decided_by = auth.uid(), decided_at = now(), decision_note = NULLIF(trim(admin_decide_business_claim.note), '') WHERE id = claim;
  IF approve THEN
    PERFORM set_config('yetnew.claim', 'on', true);
    INSERT INTO public.business_profiles (poi_id, building_id, business_id, claimed_at)
    VALUES (c.poi_id, c.building_id, c.business_id, now())
    ON CONFLICT (poi_id) DO UPDATE SET business_id = EXCLUDED.business_id, claimed_at = EXCLUDED.claimed_at;
    -- Other businesses asking for the same place are answered too.
    UPDATE public.business_claims SET status = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_note = 'Another business was confirmed as this place''s manager.'
    WHERE poi_id = c.poi_id AND status = 'pending';
  END IF;
  PERFORM public.audit_write(CASE WHEN approve THEN 'business.claim_approved' ELSE 'business.claim_rejected' END, 'place', c.poi_id::text, nm, inst, c.building_id,
    jsonb_build_object('business', c.business_id, 'business_name', (SELECT name FROM public.institutions WHERE id = c.business_id), 'note', NULLIF(trim(admin_decide_business_claim.note), '')));
  INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name)
  VALUES (c.building_id, auth.uid(), public.current_actor_name(),
    CASE WHEN approve THEN 'confirmed a business for' ELSE 'declined a business claim for' END, 'place', nm);
END $$;

-- Take a place back from a business (it closed, changed hands, or the claim was wrong).
CREATE OR REPLACE FUNCTION public.admin_release_business(poi uuid, note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bp public.business_profiles;
BEGIN
  PERFORM public.admin_require();
  SELECT * INTO bp FROM public.business_profiles WHERE poi_id = poi;
  IF bp.business_id IS NULL THEN RETURN; END IF;
  UPDATE public.business_profiles SET business_id = NULL, claimed_at = NULL WHERE poi_id = poi;
  PERFORM public.audit_write('business.released', 'place', poi::text, (SELECT name FROM public.pois WHERE id = poi),
    (SELECT institution_id FROM public.buildings WHERE id = bp.building_id), bp.building_id,
    jsonb_build_object('business', bp.business_id, 'note', NULLIF(trim(note), '')));
END $$;

-- 4. Reviews -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.place_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poi_id        uuid NOT NULL REFERENCES public.pois(id) ON DELETE CASCADE,
  building_id   uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The name shown with the review (a first name, say); never the email.
  author_name   text NOT NULL CHECK (char_length(trim(author_name)) BETWEEN 1 AND 60),
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body          text CHECK (char_length(body) <= 1500),
  status        text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  hidden_reason text CHECK (char_length(hidden_reason) <= 500),
  hidden_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  hidden_at     timestamptz,
  flags         integer NOT NULL DEFAULT 0,
  reply_body    text CHECK (char_length(reply_body) <= 1000),
  reply_name    text,
  reply_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reply_at      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poi_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_place_reviews_poi ON public.place_reviews(poi_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_place_reviews_building ON public.place_reviews(building_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_place_reviews_flagged ON public.place_reviews(flags) WHERE flags > 0;

-- One flag per review per person (signed-in id, or the device's guest id).
CREATE TABLE IF NOT EXISTS public.review_flags (
  review_id  uuid NOT NULL REFERENCES public.place_reviews(id) ON DELETE CASCADE,
  flagger    text NOT NULL CHECK (char_length(flagger) <= 100),
  reason     text CHECK (char_length(reason) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, flagger)
);
ALTER TABLE public.review_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.review_flags FROM anon, authenticated;

-- People who can see a place's insides: its venue's team, or the business that manages it.
CREATE OR REPLACE FUNCTION public.user_is_place_insider(p uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.pois x WHERE x.id = p AND public.user_can_view_building(x.building_id))
    OR EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.poi_id = p AND bp.business_id IS NOT NULL
               AND public.user_can_view_institution(bp.business_id)));
$$;
GRANT EXECUTE ON FUNCTION public.user_is_place_insider(uuid) TO authenticated;

ALTER TABLE public.place_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read visible reviews, your own, and your places'" ON public.place_reviews;
CREATE POLICY "Read visible reviews, your own, and your places'" ON public.place_reviews FOR SELECT
  USING ((status = 'visible' AND EXISTS (SELECT 1 FROM public.buildings b WHERE b.id = building_id AND b.is_published))
    OR user_id = auth.uid() OR public.user_is_place_insider(poi_id) OR public.user_is_platform_admin());
DROP POLICY IF EXISTS "Visitors write their own review" ON public.place_reviews;
CREATE POLICY "Visitors write their own review" ON public.place_reviews FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Visitors change their own review" ON public.place_reviews;
CREATE POLICY "Visitors change their own review" ON public.place_reviews FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Visitors delete their own review" ON public.place_reviews;
CREATE POLICY "Visitors delete their own review" ON public.place_reviews FOR DELETE TO authenticated
  USING (user_id = auth.uid());
GRANT SELECT ON public.place_reviews TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.place_reviews TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_place_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.pois;
BEGIN
  IF COALESCE(current_setting('yetnew.review_admin', true), '') = 'on' THEN NEW.updated_at := now(); RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO p FROM public.pois WHERE id = NEW.poi_id;
    IF p.id IS NULL OR NOT COALESCE(p.is_visible, true)
       OR NOT EXISTS (SELECT 1 FROM public.buildings b WHERE b.id = p.building_id AND b.is_published) THEN
      RAISE EXCEPTION 'This place can''t be reviewed.' USING ERRCODE = '22023';
    END IF;
    IF public.user_is_place_insider(NEW.poi_id) THEN
      RAISE EXCEPTION 'You can''t review a place you run.' USING ERRCODE = '42501';
    END IF;
    IF (SELECT count(*) FROM public.place_reviews r WHERE r.user_id = auth.uid() AND r.created_at > now() - interval '1 day') >= 10 THEN
      RAISE EXCEPTION 'That''s a lot of reviews for one day. Please try again tomorrow.' USING ERRCODE = '54000';
    END IF;
    NEW.building_id := p.building_id; NEW.user_id := auth.uid(); NEW.status := 'visible'; NEW.flags := 0;
    NEW.hidden_reason := NULL; NEW.hidden_by := NULL; NEW.hidden_at := NULL;
    NEW.reply_body := NULL; NEW.reply_name := NULL; NEW.reply_by := NULL; NEW.reply_at := NULL;
    NEW.created_at := now();
  ELSE
    -- The writer changes only the rating, the words and their name.
    NEW.poi_id := OLD.poi_id; NEW.building_id := OLD.building_id; NEW.user_id := OLD.user_id; NEW.status := OLD.status;
    NEW.hidden_reason := OLD.hidden_reason; NEW.hidden_by := OLD.hidden_by; NEW.hidden_at := OLD.hidden_at; NEW.flags := OLD.flags;
    NEW.reply_body := OLD.reply_body; NEW.reply_name := OLD.reply_name; NEW.reply_by := OLD.reply_by; NEW.reply_at := OLD.reply_at;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.author_name := trim(NEW.author_name);
  NEW.body := NULLIF(trim(NEW.body), '');
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_place_review ON public.place_reviews;
CREATE TRIGGER guard_place_review BEFORE INSERT OR UPDATE ON public.place_reviews FOR EACH ROW EXECUTE FUNCTION public.guard_place_review();

-- Ratings per place for a venue's map (visible reviews only).
CREATE OR REPLACE FUNCTION public.place_review_summary(b uuid)
RETURNS TABLE (poi_id uuid, rating numeric, reviews bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.poi_id, round(avg(r.rating)::numeric, 1), count(*)
  FROM public.place_reviews r
  JOIN public.buildings x ON x.id = r.building_id
  WHERE r.building_id = b AND r.status = 'visible' AND (x.is_published OR public.user_can_view_building(b))
  GROUP BY r.poi_id;
$$;
GRANT EXECUTE ON FUNCTION public.place_review_summary(uuid) TO anon, authenticated;

-- The venue's team or the managing business answers a review; an empty answer removes it.
CREATE OR REPLACE FUNCTION public.reply_to_review(review uuid, reply text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.place_reviews; biz uuid; who text;
BEGIN
  SELECT * INTO r FROM public.place_reviews WHERE id = review;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such review.' USING ERRCODE = '22023'; END IF;
  SELECT bp.business_id INTO biz FROM public.business_profiles bp WHERE bp.poi_id = r.poi_id;
  IF biz IS NOT NULL AND public.user_can_edit_institution(biz) THEN
    who := (SELECT name FROM public.institutions WHERE id = biz);
  ELSIF public.user_can_edit_building(r.building_id) THEN
    who := COALESCE((SELECT i.name FROM public.buildings b JOIN public.institutions i ON i.id = b.institution_id WHERE b.id = r.building_id),
                    (SELECT name FROM public.buildings WHERE id = r.building_id));
  ELSE
    RAISE EXCEPTION 'Only the place''s team or business can answer reviews.' USING ERRCODE = '42501';
  END IF;
  IF char_length(COALESCE(reply, '')) > 1000 THEN RAISE EXCEPTION 'Keep the answer under 1,000 characters.' USING ERRCODE = '22001'; END IF;
  PERFORM set_config('yetnew.review_admin', 'on', true);
  UPDATE public.place_reviews SET reply_body = NULLIF(trim(reply), ''),
    reply_name = CASE WHEN NULLIF(trim(reply), '') IS NULL THEN NULL ELSE who END,
    reply_by = CASE WHEN NULLIF(trim(reply), '') IS NULL THEN NULL ELSE auth.uid() END,
    reply_at = CASE WHEN NULLIF(trim(reply), '') IS NULL THEN NULL ELSE now() END
  WHERE id = review;
END $$;
GRANT EXECUTE ON FUNCTION public.reply_to_review(uuid, text) TO authenticated;

-- Anyone can flag a review once (by signed-in id, or the device's guest id); Yet New looks at flagged ones.
CREATE OR REPLACE FUNCTION public.flag_review(review uuid, flagger text, reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE who text := COALESCE(auth.uid()::text, NULLIF(trim(flagger), ''));
BEGIN
  IF who IS NULL THEN RAISE EXCEPTION 'Missing who is flagging.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.place_reviews r JOIN public.buildings b ON b.id = r.building_id
                 WHERE r.id = review AND r.status = 'visible' AND b.is_published) THEN
    RAISE EXCEPTION 'No such review.' USING ERRCODE = '22023';
  END IF;
  -- A flood guard: at most 100 flags an hour across the platform from people who aren't signed in.
  IF auth.uid() IS NULL AND (SELECT count(*) FROM public.review_flags WHERE created_at > now() - interval '1 hour') >= 100 THEN
    RAISE EXCEPTION 'Too many flags right now. Please try again later.' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.review_flags (review_id, flagger, reason) VALUES (review, left(who, 100), left(NULLIF(trim(reason), ''), 300))
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
    PERFORM set_config('yetnew.review_admin', 'on', true);
    UPDATE public.place_reviews SET flags = flags + 1 WHERE id = review;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.flag_review(uuid, text, text) TO anon, authenticated;

-- Only Yet New hides or shows a review: venues and businesses can't remove criticism.
CREATE OR REPLACE FUNCTION public.admin_moderate_review(review uuid, hide boolean, reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.place_reviews;
BEGIN
  PERFORM public.admin_require();
  PERFORM set_config('yetnew.review_admin', 'on', true);
  UPDATE public.place_reviews SET status = CASE WHEN hide THEN 'hidden' ELSE 'visible' END,
    hidden_reason = CASE WHEN hide THEN NULLIF(trim(reason), '') ELSE NULL END,
    hidden_by = CASE WHEN hide THEN auth.uid() ELSE NULL END, hidden_at = CASE WHEN hide THEN now() ELSE NULL END,
    -- Kept up: flags stay on the record; a review shown again starts its flag count over.
    flags = CASE WHEN hide THEN flags ELSE 0 END
  WHERE id = review RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such review.' USING ERRCODE = '22023'; END IF;
  IF NOT hide THEN DELETE FROM public.review_flags WHERE review_id = review; END IF;
  PERFORM public.audit_write(CASE WHEN hide THEN 'review.hidden' ELSE 'review.shown' END, 'review', review::text,
    (SELECT name FROM public.pois WHERE id = r.poi_id), (SELECT institution_id FROM public.buildings WHERE id = r.building_id), r.building_id,
    jsonb_build_object('rating', r.rating, 'reason', NULLIF(trim(reason), '')));
END $$;

CREATE OR REPLACE FUNCTION public.admin_flagged_reviews()
RETURNS TABLE (id uuid, poi_id uuid, place_name text, building_id uuid, venue_name text, author_name text, rating smallint, body text,
               status text, flags integer, reasons text[], created_at timestamptz, reply_body text, hidden_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  RETURN QUERY
  SELECT r.id, r.poi_id, p.name::text, r.building_id, b.name::text, r.author_name, r.rating, r.body, r.status, r.flags,
         ARRAY(SELECT f.reason FROM public.review_flags f WHERE f.review_id = r.id AND f.reason IS NOT NULL ORDER BY f.created_at LIMIT 5),
         r.created_at, r.reply_body, r.hidden_reason
  FROM public.place_reviews r
  JOIN public.pois p ON p.id = r.poi_id
  JOIN public.buildings b ON b.id = r.building_id
  WHERE r.flags > 0 AND r.status = 'visible'
  ORDER BY r.flags DESC, r.created_at DESC
  LIMIT 200;
END $$;

-- 5. Verification: scope and end date ---------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['buildings', 'pois'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS verified_until timestamptz', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS verification_scope text CHECK (char_length(verification_scope) <= 300)', t);
  END LOOP;
END $$;
ALTER TABLE public.verification_requests ADD COLUMN IF NOT EXISTS scope text CHECK (char_length(scope) <= 300);
-- Verified before end dates existed: good for a year from when it was verified.
UPDATE public.buildings SET verified_until = verified_at + interval '12 months' WHERE trust_level <> 'listed' AND verified_at IS NOT NULL AND verified_until IS NULL;
UPDATE public.pois SET verified_until = verified_at + interval '12 months' WHERE trust_level <> 'listed' AND verified_at IS NOT NULL AND verified_until IS NULL;

-- Teams still can't verify themselves: the new columns are guarded like the others (20261028090000 + two columns),
-- and the guard no longer breaks every place edit (see the end of the function).
CREATE OR REPLACE FUNCTION public.guard_trust_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.user_is_platform_admin() OR current_setting('yetnew.trust', true) = 'on' THEN
    NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.trust_level := 'listed'; NEW.verified_at := NULL; NEW.verified_by := NULL; NEW.trust_note := NULL;
    NEW.verified_until := NULL; NEW.verification_scope := NULL;
    IF TG_TABLE_NAME = 'buildings' THEN NEW.suspended_at := NULL; NEW.suspend_note := NULL; END IF;
  ELSE
    NEW.trust_level := OLD.trust_level; NEW.verified_at := OLD.verified_at; NEW.verified_by := OLD.verified_by; NEW.trust_note := OLD.trust_note;
    NEW.verified_until := OLD.verified_until; NEW.verification_scope := OLD.verification_scope;
    IF TG_TABLE_NAME = 'buildings' THEN NEW.suspended_at := OLD.suspended_at; NEW.suspend_note := OLD.suspend_note; END IF;
  END IF;
  -- Venues only. Two IFs on purpose: places (pois) have no is_published, and PL/pgSQL resolves every field an
  -- expression names before evaluating it, so one combined IF failed on EVERY place insert or update
  -- ("record new has no field is_published") — the bug in 20261028090000 this replaces.
  IF TG_TABLE_NAME = 'buildings' THEN
    IF NEW.is_published AND (NEW.suspended_at IS NOT NULL OR NEW.archived_at IS NOT NULL) THEN
      RAISE EXCEPTION '%', CASE WHEN NEW.suspended_at IS NOT NULL
        THEN 'This venue is suspended by Yet New. Contact Yet New to publish it again.'
        ELSE 'This venue is archived. Restore it first, then publish.' END USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Verify for a number of months (default 12) with what was checked; "listed" clears it all.
DROP FUNCTION IF EXISTS public.admin_set_trust(uuid, uuid, text, text);
CREATE OR REPLACE FUNCTION public.admin_set_trust(b uuid, poi uuid, level text, note text DEFAULT NULL, months integer DEFAULT 12, scope text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE until_ timestamptz := CASE WHEN level = 'listed' THEN NULL ELSE now() + make_interval(months => GREATEST(1, LEAST(COALESCE(months, 12), 36))) END;
BEGIN
  PERFORM public.admin_require();
  IF level NOT IN ('listed', 'verified', 'official') THEN RAISE EXCEPTION 'Unknown trust level %', level; END IF;
  PERFORM set_config('yetnew.trust', 'on', true);
  IF poi IS NULL THEN
    UPDATE public.buildings SET trust_level = level, trust_note = NULLIF(trim(note), ''),
      verified_at = CASE WHEN level = 'listed' THEN NULL ELSE now() END, verified_by = CASE WHEN level = 'listed' THEN NULL ELSE auth.uid() END,
      verified_until = until_, verification_scope = CASE WHEN level = 'listed' THEN NULL ELSE COALESCE(NULLIF(trim(scope), ''), verification_scope) END
    WHERE id = b;
  ELSE
    UPDATE public.pois SET trust_level = level, trust_note = NULLIF(trim(note), ''),
      verified_at = CASE WHEN level = 'listed' THEN NULL ELSE now() END, verified_by = CASE WHEN level = 'listed' THEN NULL ELSE auth.uid() END,
      verified_until = until_, verification_scope = CASE WHEN level = 'listed' THEN NULL ELSE COALESCE(NULLIF(trim(scope), ''), verification_scope) END
    WHERE id = poi AND building_id = b;
  END IF;
  INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name)
  VALUES (b, auth.uid(), public.current_actor_name(),
    CASE level WHEN 'listed' THEN 'removed verification' WHEN 'official' THEN 'marked official' ELSE 'verified' END,
    CASE WHEN poi IS NULL THEN 'venue' ELSE 'place' END,
    COALESCE((SELECT name FROM public.pois WHERE id = poi), (SELECT name FROM public.buildings WHERE id = b)));
END $$;

DROP FUNCTION IF EXISTS public.admin_decide_verification(uuid, boolean, text);
CREATE OR REPLACE FUNCTION public.admin_decide_verification(req uuid, approve boolean, note text DEFAULT NULL, months integer DEFAULT 12)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.verification_requests;
BEGIN
  PERFORM public.admin_require();
  SELECT * INTO r FROM public.verification_requests WHERE id = req FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' THEN RAISE EXCEPTION 'This request is no longer waiting.'; END IF;
  PERFORM set_config('yetnew.trust', 'on', true);
  UPDATE public.verification_requests SET status = CASE WHEN approve THEN 'approved' ELSE 'rejected' END,
    decided_by = auth.uid(), decided_at = now(), decision_note = NULLIF(trim(admin_decide_verification.note), '') WHERE id = req;
  IF approve THEN
    PERFORM public.admin_set_trust(r.building_id, r.poi_id, r.level, admin_decide_verification.note, admin_decide_verification.months, r.scope);
  ELSE
    INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name)
    VALUES (r.building_id, auth.uid(), public.current_actor_name(), 'declined verification', CASE WHEN r.poi_id IS NULL THEN 'venue' ELSE 'place' END,
      COALESCE((SELECT name FROM public.pois WHERE id = r.poi_id), (SELECT name FROM public.buildings WHERE id = r.building_id)));
  END IF;
END $$;

-- The request queue, now with what the team asked to have checked.
DROP FUNCTION IF EXISTS public.admin_verification_queue();
CREATE FUNCTION public.admin_verification_queue()
RETURNS TABLE (id uuid, building_id uuid, venue_name text, institution_name text, institution_status text, poi_id uuid, place_name text,
               level text, note text, requested_at timestamptz, requested_by_name text, current_level text, source text, responsible_party text,
               is_published boolean, open_reports bigint, scope text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  RETURN QUERY
  SELECT r.id, r.building_id, x.name::text, i.name::text, i.status, r.poi_id, p.name::text, r.level, r.note, r.requested_at,
         COALESCE(ua.display_name, ua.username)::text,
         COALESCE(p.trust_level, x.trust_level), COALESCE(p.source, x.source), COALESCE(p.responsible_party, x.responsible_party),
         x.is_published,
         (SELECT count(*) FROM public.place_reports pr WHERE pr.building_id = r.building_id AND pr.status = 'open'),
         r.scope
  FROM public.verification_requests r
  JOIN public.buildings x ON x.id = r.building_id
  LEFT JOIN public.institutions i ON i.id = x.institution_id
  LEFT JOIN public.pois p ON p.id = r.poi_id
  LEFT JOIN public.user_accounts ua ON ua.user_id = r.requested_by
  WHERE r.status = 'pending'
  ORDER BY r.requested_at;
END $$;

-- Verified venues and places whose verification has ended or ends within `days`.
CREATE OR REPLACE FUNCTION public.admin_verifications_due(days integer DEFAULT 30)
RETURNS TABLE (building_id uuid, poi_id uuid, name text, venue_name text, level text, verified_at timestamptz, verified_until timestamptz,
               scope text, responsible_party text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_require();
  RETURN QUERY
  SELECT b.id, NULL::uuid, b.name::text, b.name::text, b.trust_level, b.verified_at, b.verified_until, b.verification_scope, b.responsible_party
  FROM public.buildings b
  WHERE b.trust_level <> 'listed' AND b.verified_until IS NOT NULL AND b.verified_until < now() + make_interval(days => days)
  UNION ALL
  SELECT p.building_id, p.id, p.name::text, b.name::text, p.trust_level, p.verified_at, p.verified_until, p.verification_scope, p.responsible_party
  FROM public.pois p JOIN public.buildings b ON b.id = p.building_id
  WHERE p.trust_level <> 'listed' AND p.verified_until IS NOT NULL AND p.verified_until < now() + make_interval(days => days)
  ORDER BY 7;
END $$;

-- 6. The console's counts: what's waiting now includes claims, flagged reviews and verification due.
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
    'reports_open',          (SELECT count(*) FROM public.place_reports WHERE status = 'open'),
    'claims_pending',        (SELECT count(*) FROM public.business_claims WHERE status = 'pending'),
    'reviews_flagged',       (SELECT count(*) FROM public.place_reviews WHERE flags > 0 AND status = 'visible'),
    'verifications_due',     (SELECT count(*) FROM public.buildings WHERE trust_level <> 'listed' AND verified_until < now() + interval '30 days')
                           + (SELECT count(*) FROM public.pois WHERE trust_level <> 'listed' AND verified_until < now() + interval '30 days'),
    'businesses',            (SELECT count(*) FROM public.institutions WHERE account_type = 'business'),
    'businesses_claimed',    (SELECT count(*) FROM public.business_profiles WHERE business_id IS NOT NULL),
    'reviews',               (SELECT count(*) FROM public.place_reviews WHERE status = 'visible')
  );
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_set_trust(uuid, uuid, text, text, integer, text)', 'admin_decide_verification(uuid, boolean, text, integer)',
    'admin_verification_queue()', 'admin_verifications_due(integer)', 'admin_overview()', 'admin_business_claims()',
    'admin_decide_business_claim(uuid, boolean, text)', 'admin_release_business(uuid, text)', 'admin_moderate_review(uuid, boolean, text)',
    'admin_flagged_reviews()'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
