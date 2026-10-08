-- Scenery the map editor can place (Scenery tool): palms, shrubs, flower
-- beds, lawns, ponds, rocks, lamp posts, fountains and planters, alongside
-- the existing trees and benches. Only the allowed kinds change.

DO $$ BEGIN
  ALTER TABLE public.map_features DROP CONSTRAINT IF EXISTS map_features_kind_check;
  ALTER TABLE public.map_features ADD CONSTRAINT map_features_kind_check CHECK (kind IN
    ('door', 'arch', 'window', 'stairs', 'elevator', 'entrance', 'tree', 'bench', 'furniture', 'landmark', 'label',
     'palm', 'shrub', 'flowers', 'grass', 'water', 'rock', 'lamp', 'fountain', 'planter'));
END $$;
