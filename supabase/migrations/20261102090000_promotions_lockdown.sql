-- Promotions were writable by anyone, signed in or not (20260423105948: "Anyone can insert / update /
-- delete promotions"): a visitor could add, change or delete any venue's promotions from the browser.
-- Now: everyone can still read them (the visitor map shows them); only people who can edit the venue
-- the promoted place belongs to (its team, or the Yet New team) can add, change or delete them.

DROP POLICY IF EXISTS "Anyone can insert promotions" ON public.promotions;
DROP POLICY IF EXISTS "Anyone can update promotions" ON public.promotions;
DROP POLICY IF EXISTS "Anyone can delete promotions" ON public.promotions;

-- The venue a promotion's place belongs to (NULL for a place without a venue → Yet New team only).
CREATE OR REPLACE FUNCTION public.user_can_edit_promotion(p uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND COALESCE(
    (SELECT CASE WHEN po.building_id IS NULL THEN public.user_is_platform_admin()
                 ELSE public.user_can_edit_building(po.building_id) END
       FROM public.pois po WHERE po.id = p),
    public.user_is_platform_admin())
$$;
REVOKE ALL ON FUNCTION public.user_can_edit_promotion(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.user_can_edit_promotion(uuid) TO authenticated;

DROP POLICY IF EXISTS "Venue editors can add promotions" ON public.promotions;
CREATE POLICY "Venue editors can add promotions" ON public.promotions
  FOR INSERT TO authenticated WITH CHECK (public.user_can_edit_promotion(poi_id));
DROP POLICY IF EXISTS "Venue editors can change promotions" ON public.promotions;
CREATE POLICY "Venue editors can change promotions" ON public.promotions
  FOR UPDATE TO authenticated USING (public.user_can_edit_promotion(poi_id)) WITH CHECK (public.user_can_edit_promotion(poi_id));
DROP POLICY IF EXISTS "Venue editors can delete promotions" ON public.promotions;
CREATE POLICY "Venue editors can delete promotions" ON public.promotions
  FOR DELETE TO authenticated USING (public.user_can_edit_promotion(poi_id));

REVOKE INSERT, UPDATE, DELETE ON public.promotions FROM anon;
