-- YET NEW Business, the missing half of the way in. Until now a business could only claim a place
-- a venue had already put on its map; a café the venue hadn't added yet hit a dead end. Now:
--   * a business browses the published venues and the business places in each (no need to guess a
--     name), and
--   * when its place isn't there, it asks the venue to add it. The venue's team (or Yet New) puts the
--     place on the map and links the request to it — the venue knows its tenants, so linking also
--     makes the business the place's manager.
-- Builds on 20261103090000_business_reviews_verification.sql.

-- 1. Finding places ---------------------------------------------------------------------------------

-- Published venues, with how many business places each has (for "pick the venue you're in").
CREATE OR REPLACE FUNCTION public.business_venues(q text DEFAULT '')
RETURNS TABLE (building_id uuid, venue_name text, places bigint, unclaimed bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.name::text,
         count(p.id) FILTER (WHERE p.id IS NOT NULL),
         count(p.id) FILTER (WHERE p.id IS NOT NULL AND bp.business_id IS NULL)
  FROM public.buildings b
  LEFT JOIN public.pois p ON p.building_id = b.id AND public.is_business_place_type(p.place_type) AND COALESCE(p.is_visible, true)
  LEFT JOIN public.business_profiles bp ON bp.poi_id = p.id
  WHERE b.is_published AND (trim(COALESCE(q, '')) = '' OR b.name ILIKE '%' || trim(q) || '%')
  GROUP BY b.id, b.name
  ORDER BY count(p.id) DESC, b.name
  LIMIT 60;
$$;

-- Business places by name anywhere (2+ letters), or every business place in one venue.
CREATE OR REPLACE FUNCTION public.business_find_places(q text DEFAULT '', venue uuid DEFAULT NULL)
RETURNS TABLE (poi_id uuid, place_name text, place_type text, building_id uuid, venue_name text, claimed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name::text, p.place_type, b.id, b.name::text, COALESCE(bp.business_id IS NOT NULL, false)
  FROM public.pois p
  JOIN public.buildings b ON b.id = p.building_id AND b.is_published
  LEFT JOIN public.business_profiles bp ON bp.poi_id = p.id
  WHERE public.is_business_place_type(p.place_type) AND COALESCE(p.is_visible, true)
    AND CASE
      WHEN venue IS NOT NULL THEN b.id = venue AND (trim(COALESCE(q, '')) = '' OR p.name ILIKE '%' || trim(q) || '%')
      ELSE char_length(trim(COALESCE(q, ''))) >= 2 AND (p.name ILIKE '%' || trim(q) || '%' OR b.name ILIKE '%' || trim(q) || '%')
    END
  ORDER BY (p.name ILIKE trim(COALESCE(q, '')) || '%') DESC, p.name
  LIMIT 60;
$$;

-- 2. Asking a venue to add a place ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_place_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  building_id   uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  place_name    text NOT NULL CHECK (char_length(trim(place_name)) BETWEEN 2 AND 120),
  place_type    text NOT NULL CHECK (place_type IN ('cafe', 'restaurant', 'hotel', 'shop', 'custom')),
  -- Where it is inside the venue: "ground floor, next to the north gate"
  where_note    text NOT NULL CHECK (char_length(trim(where_note)) BETWEEN 3 AND 500),
  contact_phone text CHECK (char_length(contact_phone) <= 40),
  note          text CHECK (char_length(note) <= 1000),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'added', 'declined', 'withdrawn')),
  poi_id        uuid REFERENCES public.pois(id) ON DELETE SET NULL,
  requested_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  decision_note text CHECK (char_length(decision_note) <= 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS business_place_requests_one_pending
  ON public.business_place_requests(business_id, building_id, lower(trim(place_name))) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_business_place_requests_venue ON public.business_place_requests(building_id, status);

ALTER TABLE public.business_place_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "The business, the venue and Yet New read place requests" ON public.business_place_requests;
CREATE POLICY "The business, the venue and Yet New read place requests" ON public.business_place_requests FOR SELECT TO authenticated
  USING (public.user_is_platform_admin() OR public.user_can_view_institution(business_id) OR public.user_can_view_building(building_id));
REVOKE ALL ON public.business_place_requests FROM anon, authenticated;
GRANT SELECT ON public.business_place_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.request_business_place(business uuid, venue uuid, place_name text, place_type text, where_note text,
  phone text DEFAULT NULL, note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.buildings; id_ uuid;
BEGIN
  IF NOT public.user_can_edit_institution(business) THEN
    RAISE EXCEPTION 'Only the business''s owners and editors can ask for it.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT account_type FROM public.institutions WHERE id = business) IS DISTINCT FROM 'business' THEN
    RAISE EXCEPTION 'Only a business account can ask to be added.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.buildings WHERE id = venue;
  IF b.id IS NULL OR NOT COALESCE(b.is_published, false) THEN
    RAISE EXCEPTION 'That venue isn''t on Yet New.' USING ERRCODE = '22023';
  END IF;
  IF char_length(trim(COALESCE(place_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Add your place''s name.' USING ERRCODE = '22023';
  END IF;
  IF char_length(trim(COALESCE(where_note, ''))) < 3 THEN
    RAISE EXCEPTION 'Say where it is in the venue, so the team can find it.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.business_place_requests (business_id, building_id, place_name, place_type, where_note, contact_phone, note, requested_by)
  VALUES (business, venue, trim(place_name), COALESCE(place_type, 'custom'), trim(where_note), NULLIF(trim(phone), ''), NULLIF(trim(note), ''), auth.uid())
  RETURNING id INTO id_;
  PERFORM public.audit_write('business.place_requested', 'venue', venue::text, b.name, b.institution_id, b.id,
    jsonb_build_object('business', business, 'business_name', (SELECT name FROM public.institutions WHERE id = business), 'place', trim(place_name)));
  INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name)
  VALUES (b.id, auth.uid(), (SELECT name FROM public.institutions WHERE id = business), 'asked to be added to the map:', 'place', trim(place_name));
  RETURN id_;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'You''ve already asked this venue to add that place.' USING ERRCODE = '23505';
END $$;

CREATE OR REPLACE FUNCTION public.withdraw_business_place_request(req uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.business_place_requests;
BEGIN
  SELECT * INTO r FROM public.business_place_requests WHERE id = req;
  IF r.id IS NULL OR NOT public.user_can_edit_institution(r.business_id) THEN
    RAISE EXCEPTION 'Only the business can withdraw its request.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.business_place_requests SET status = 'withdrawn', decided_at = now(), decided_by = auth.uid()
  WHERE id = req AND status = 'pending';
END $$;

-- What businesses asked a venue for, with the business's name (the venue's team and Yet New).
CREATE OR REPLACE FUNCTION public.venue_place_requests(b uuid DEFAULT NULL)
RETURNS TABLE (id uuid, business_id uuid, business_name text, building_id uuid, venue_name text, place_name text, place_type text,
               where_note text, contact_phone text, note text, status text, poi_id uuid, requested_at timestamptz, decided_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.business_id, bi.name::text, r.building_id, bl.name::text, r.place_name, r.place_type, r.where_note, r.contact_phone, r.note,
         r.status, r.poi_id, r.requested_at, r.decided_at
  FROM public.business_place_requests r
  JOIN public.institutions bi ON bi.id = r.business_id
  JOIN public.buildings bl ON bl.id = r.building_id
  WHERE (venue_place_requests.b IS NULL AND public.user_is_platform_admin() AND r.status = 'pending')
     OR (venue_place_requests.b IS NOT NULL AND r.building_id = venue_place_requests.b
         AND (public.user_can_view_building(r.building_id) OR public.user_is_platform_admin())
         AND (r.status = 'pending' OR r.decided_at > now() - interval '30 days'))
  ORDER BY (r.status = 'pending') DESC, r.requested_at DESC
  LIMIT 200;
$$;

-- The venue's team (or Yet New) answers: link the place they added (it becomes the business's), or decline.
CREATE OR REPLACE FUNCTION public.answer_business_place_request(req uuid, poi uuid DEFAULT NULL, note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.business_place_requests; p public.pois; bl public.buildings; holder uuid;
BEGIN
  SELECT * INTO r FROM public.business_place_requests WHERE id = req FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'That request no longer exists.'; END IF;
  IF NOT (public.user_can_edit_building(r.building_id) OR public.user_is_platform_admin()) THEN
    RAISE EXCEPTION 'Only the venue''s team can answer this.' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request is no longer waiting.'; END IF;
  SELECT * INTO bl FROM public.buildings WHERE id = r.building_id;

  IF poi IS NULL THEN
    UPDATE public.business_place_requests SET status = 'declined', decided_by = auth.uid(), decided_at = now(),
      decision_note = NULLIF(trim(answer_business_place_request.note), '') WHERE id = req;
    PERFORM public.audit_write('business.place_request_declined', 'venue', bl.id::text, bl.name, bl.institution_id, bl.id,
      jsonb_build_object('business', r.business_id, 'place', r.place_name, 'note', NULLIF(trim(answer_business_place_request.note), '')));
  ELSE
    SELECT * INTO p FROM public.pois WHERE id = poi;
    IF p.id IS NULL OR p.building_id <> r.building_id THEN
      RAISE EXCEPTION 'Pick a place in this venue.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_business_place_type(p.place_type) THEN
      RAISE EXCEPTION 'Set the place''s type to café, restaurant, hotel, shop or custom first.' USING ERRCODE = '22023';
    END IF;
    SELECT business_id INTO holder FROM public.business_profiles WHERE poi_id = poi;
    IF holder IS NOT NULL AND holder <> r.business_id THEN
      RAISE EXCEPTION 'Another business already manages that place.' USING ERRCODE = '42710';
    END IF;
    PERFORM set_config('yetnew.claim', 'on', true);
    INSERT INTO public.business_profiles (poi_id, building_id, business_id, claimed_at, phone)
    VALUES (poi, r.building_id, r.business_id, now(), r.contact_phone)
    ON CONFLICT (poi_id) DO UPDATE SET business_id = EXCLUDED.business_id, claimed_at = EXCLUDED.claimed_at,
      phone = COALESCE(public.business_profiles.phone, EXCLUDED.phone);
    UPDATE public.business_place_requests SET status = 'added', poi_id = poi, decided_by = auth.uid(), decided_at = now(),
      decision_note = NULLIF(trim(answer_business_place_request.note), '') WHERE id = req;
    -- Anyone else still asking to manage this place is answered.
    UPDATE public.business_claims SET status = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_note = 'The venue confirmed another business as this place''s manager.'
    WHERE poi_id = poi AND status = 'pending' AND business_id <> r.business_id;
    UPDATE public.business_claims SET status = 'approved', decided_by = auth.uid(), decided_at = now()
    WHERE poi_id = poi AND status = 'pending' AND business_id = r.business_id;
    PERFORM public.audit_write('business.place_added', 'place', poi::text, p.name, bl.institution_id, bl.id,
      jsonb_build_object('business', r.business_id, 'business_name', (SELECT name FROM public.institutions WHERE id = r.business_id), 'request', req));
    INSERT INTO public.venue_activity (building_id, actor_id, actor_name, action, object_type, object_name)
    VALUES (bl.id, auth.uid(), public.current_actor_name(), 'linked a business to', 'place', p.name);
  END IF;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['business_venues(text)', 'business_find_places(text, uuid)',
    'request_business_place(uuid, uuid, text, text, text, text, text)', 'withdraw_business_place_request(uuid)',
    'venue_place_requests(uuid)', 'answer_business_place_request(uuid, uuid, text)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
