-- Big DWG uploads on the website. Vercel caps a request (and its answer) at ~4.5 MB, so
-- a DWG bigger than that goes through storage instead: the editor uploads it here, the
-- converter (api/dwg-convert, with the uploader's own session) reads it, writes the DXF
-- back gzipped, and the editor downloads that and deletes both.
--
--   cad-uploads/<user id>/<upload id>.dwg        the drawing, while it's converted
--   cad-uploads/<user id>/<upload id>.dxf.gz     the converted drawing, until the editor reads it
--
-- Private; each signed-in user reaches only their own folder. Not the training data
-- (that's cad-sources, consented): nothing here is kept.
--
-- Idempotent: safe to re-run. Apply to the STAGING project first.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('cad-uploads', 'cad-uploads', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;

DROP POLICY IF EXISTS "Own CAD uploads: read" ON storage.objects;
DROP POLICY IF EXISTS "Own CAD uploads: add" ON storage.objects;
DROP POLICY IF EXISTS "Own CAD uploads: remove" ON storage.objects;

CREATE POLICY "Own CAD uploads: read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cad-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Own CAD uploads: add" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cad-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Own CAD uploads: remove" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cad-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);
