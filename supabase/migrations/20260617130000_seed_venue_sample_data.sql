-- Seed sample venue_nodes + venue_paths for the first building found, so
-- the new Venue Experience Map has something to render out of the box.
-- Safe to run multiple times (guarded by a marker name) and safe if no
-- buildings exist yet (does nothing).

DO $$
DECLARE
  target_building_id UUID;
  n_entrance UUID;
  n_plaza UUID;
  n_junction1 UUID;
  n_junction2 UUID;
BEGIN
  SELECT id INTO target_building_id FROM public.buildings ORDER BY created_at LIMIT 1;
  IF target_building_id IS NULL THEN
    RETURN;
  END IF;

  -- Don't double-seed if this building already has venue nodes.
  IF EXISTS (SELECT 1 FROM public.venue_nodes WHERE building_id = target_building_id) THEN
    RETURN;
  END IF;

  -- A small diamond-shaped path layout: entrance -> plaza -> two junctions
  -- forming a loop, offset a few dozen meters from each other. Replace or
  -- extend via /admin once a real surveyed layout is available.
  INSERT INTO public.venue_nodes (id, building_id, name, lat, lng, kind)
  VALUES (gen_random_uuid(), target_building_id, 'Main Entrance', 8.98060, 38.79740, 'entrance')
  RETURNING id INTO n_entrance;

  INSERT INTO public.venue_nodes (id, building_id, name, lat, lng, kind)
  VALUES (gen_random_uuid(), target_building_id, 'Central Plaza', 8.98090, 38.79760, 'landmark')
  RETURNING id INTO n_plaza;

  INSERT INTO public.venue_nodes (id, building_id, name, lat, lng, kind)
  VALUES (gen_random_uuid(), target_building_id, '', 8.98110, 38.79740, 'junction')
  RETURNING id INTO n_junction1;

  INSERT INTO public.venue_nodes (id, building_id, name, lat, lng, kind)
  VALUES (gen_random_uuid(), target_building_id, '', 8.98080, 38.79720, 'junction')
  RETURNING id INTO n_junction2;

  INSERT INTO public.venue_paths (building_id, from_node, to_node, path_type) VALUES
    (target_building_id, n_entrance, n_plaza, 'main'),
    (target_building_id, n_plaza, n_junction1, 'main'),
    (target_building_id, n_junction1, n_junction2, 'secondary'),
    (target_building_id, n_junction2, n_entrance, 'main');
END $$;
