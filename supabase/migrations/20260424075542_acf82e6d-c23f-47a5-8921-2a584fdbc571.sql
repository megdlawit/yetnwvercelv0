-- Add geo-anchor fields to buildings (origin lat/lng + rotation in degrees, meters per pixel)
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS origin_lat double precision,
  ADD COLUMN IF NOT EXISTS origin_lng double precision,
  ADD COLUMN IF NOT EXISTS rotation_deg double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meters_per_pixel double precision NOT NULL DEFAULT 1;

-- Add optional GPS coords + outdoor flag to POIs (lets POIs live in the outdoor map)
ALTER TABLE public.pois
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision,
  ADD COLUMN IF NOT EXISTS is_outdoor boolean NOT NULL DEFAULT false;

-- Allow node_id to be null for outdoor POIs that aren't pinned to an indoor graph node
ALTER TABLE public.pois
  ALTER COLUMN node_id DROP NOT NULL;
