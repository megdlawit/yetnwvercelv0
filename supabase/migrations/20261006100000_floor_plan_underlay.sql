-- Floor plan underlays: a scanned plan (image, or a PDF page rendered to an
-- image) shown under the editor's drawing, scaled and turned by two known
-- points. Editors only — visitors never see the underlay.
--
--   floors.plan_underlay = {
--     "path": "<building>/<floor>/<file>.png",   -- in the floor-plans bucket
--     "width": 3000, "height": 2100,             -- image pixels
--     "x": 0, "y": 0,                            -- editor px of the image's top-left corner
--     "scale": 0.5,                              -- editor px per image px (40 editor px = 1 m)
--     "rotationDeg": 0,                          -- about the top-left corner, clockwise
--     "opacity": 0.5, "visible": true, "locked": false
--   }
--
-- Idempotent: safe to re-run.

ALTER TABLE public.floors ADD COLUMN IF NOT EXISTS plan_underlay jsonb;

-- Private bucket: files live under <building id>/<floor id>/…, and only that
-- venue's editors can read or write them (signed URLs for the editor).
INSERT INTO storage.buckets (id, name, public)
VALUES ('floor-plans', 'floor-plans', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Editors read floor plans" ON storage.objects;
DROP POLICY IF EXISTS "Editors add floor plans" ON storage.objects;
DROP POLICY IF EXISTS "Editors change floor plans" ON storage.objects;
DROP POLICY IF EXISTS "Editors remove floor plans" ON storage.objects;

CREATE POLICY "Editors read floor plans" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'floor-plans' AND public.user_can_edit_building(((storage.foldername(name))[1])::uuid));
CREATE POLICY "Editors add floor plans" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'floor-plans' AND public.user_can_edit_building(((storage.foldername(name))[1])::uuid));
CREATE POLICY "Editors change floor plans" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'floor-plans' AND public.user_can_edit_building(((storage.foldername(name))[1])::uuid));
CREATE POLICY "Editors remove floor plans" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'floor-plans' AND public.user_can_edit_building(((storage.foldername(name))[1])::uuid));
