-- Storage bucket for POI media (images + audio clips), uploaded directly
-- from the Admin POIs page instead of pasting external URLs.
-- Public bucket + open policies, matching the no-auth pattern used
-- elsewhere in this app (see profiles/saved_places migrations).

INSERT INTO storage.buckets (id, name, public)
VALUES ('poi-media', 'poi-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read access for poi-media"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'poi-media');

CREATE POLICY "Public upload access for poi-media"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'poi-media');

CREATE POLICY "Public update access for poi-media"
  ON storage.objects FOR UPDATE
  TO anon, authenticated
  USING (bucket_id = 'poi-media');

CREATE POLICY "Public delete access for poi-media"
  ON storage.objects FOR DELETE
  TO anon, authenticated
  USING (bucket_id = 'poi-media');
