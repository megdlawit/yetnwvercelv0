-- Fix: "new row violates row-level security policy for venue_nodes"
--
-- The 20260617120000_venue_map_layer.sql migration already defines fully
-- permissive policies for venue_nodes/venue_paths, but inserts from the
-- Admin → Venue Paths screen are still being rejected by RLS. That means
-- the live database is out of sync with this migration (never applied,
-- applied only partially, or the policies were later dropped/renamed).
--
-- This migration is idempotent — safe to run even if some/all of the
-- policies already exist — and re-asserts:
--   1. RLS is enabled on both tables.
--   2. Fully open SELECT/INSERT/UPDATE/DELETE policies (matches every
--      other admin-authored table in this project — access control here
--      is enforced at the app layer via RequireAdminAuth, not via RLS).
--   3. Explicit table grants to anon/authenticated as a safety net, in
--      case the tables were created without inheriting the project's
--      default privileges.

ALTER TABLE public.venue_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_paths ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read venue_nodes"   ON public.venue_nodes;
DROP POLICY IF EXISTS "Anyone can insert venue_nodes" ON public.venue_nodes;
DROP POLICY IF EXISTS "Anyone can update venue_nodes" ON public.venue_nodes;
DROP POLICY IF EXISTS "Anyone can delete venue_nodes" ON public.venue_nodes;

CREATE POLICY "Anyone can read venue_nodes"   ON public.venue_nodes FOR SELECT USING (true);
CREATE POLICY "Anyone can insert venue_nodes" ON public.venue_nodes FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update venue_nodes" ON public.venue_nodes FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete venue_nodes" ON public.venue_nodes FOR DELETE USING (true);

DROP POLICY IF EXISTS "Anyone can read venue_paths"   ON public.venue_paths;
DROP POLICY IF EXISTS "Anyone can insert venue_paths" ON public.venue_paths;
DROP POLICY IF EXISTS "Anyone can update venue_paths" ON public.venue_paths;
DROP POLICY IF EXISTS "Anyone can delete venue_paths" ON public.venue_paths;

CREATE POLICY "Anyone can read venue_paths"   ON public.venue_paths FOR SELECT USING (true);
CREATE POLICY "Anyone can insert venue_paths" ON public.venue_paths FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update venue_paths" ON public.venue_paths FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete venue_paths" ON public.venue_paths FOR DELETE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_nodes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_paths TO anon, authenticated;
