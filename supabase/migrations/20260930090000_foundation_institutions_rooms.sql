-- Foundation: multi-tenant institutions, persisted rooms, persisted admin layers,
-- and ownership-scoped write RLS. Idempotent — safe to re-run.
--
-- Backward compatible: buildings.institution_id is NULLABLE. Legacy buildings
-- (institution_id IS NULL) stay writable by any AUTHENTICATED user until they
-- are assigned to an institution (see the manual step at the bottom).
-- Reads stay fully open — the visitor app has no auth.

-- 1. Institutions ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.institutions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE,
  kind       text NOT NULL DEFAULT 'park',  -- park | heritage | museum | ... (matches the live column)
  owner_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.institution_members (
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role           text NOT NULL DEFAULT 'editor',  -- owner | editor
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, user_id)
);

-- Your database may already have these tables from an earlier version of this
-- migration with a different shape. CREATE TABLE IF NOT EXISTS skips them, so
-- add any missing columns explicitly.
ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS name       text,
  ADD COLUMN IF NOT EXISTS slug       text,
  ADD COLUMN IF NOT EXISTS kind       text NOT NULL DEFAULT 'park',
  ADD COLUMN IF NOT EXISTS owner_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.institution_members
  ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_id        uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS role           text NOT NULL DEFAULT 'editor',
  ADD COLUMN IF NOT EXISTS created_at     timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS institution_members_inst_user_uniq
  ON public.institution_members(institution_id, user_id);

-- If an older owner column exists under another name, copy it across once.
DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['owner_user_id','owner','created_by'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='institutions' AND column_name=c
                 AND data_type='uuid') THEN
      EXECUTE format('UPDATE public.institutions SET owner_id = %1$I WHERE owner_id IS NULL AND %1$I IN (SELECT id FROM auth.users)', c);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_buildings_institution ON public.buildings(institution_id);

DROP TRIGGER IF EXISTS update_institutions_updated_at ON public.institutions;
CREATE TRIGGER update_institutions_updated_at
  BEFORE UPDATE ON public.institutions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Ownership check ------------------------------------------------------
-- SECURITY DEFINER so it can read institutions/members regardless of their RLS.
-- An older version may exist with different parameter names, which CREATE OR
-- REPLACE cannot change, so it has to be dropped first. Only drop when the
-- name actually differs: CASCADE also drops every policy that uses the
-- function, including any created outside these migrations (e.g. in the
-- dashboard) that nothing here would recreate. When the names already match
-- (the live project as of 2026-10-01), CREATE OR REPLACE below is enough.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'user_can_edit_building'
               AND pg_get_function_identity_arguments(p.oid) <> 'b uuid') THEN
    DROP FUNCTION public.user_can_edit_building(uuid) CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'user_can_edit_institution'
               AND pg_get_function_identity_arguments(p.oid) <> 'inst uuid') THEN
    DROP FUNCTION public.user_can_edit_institution(uuid) CASCADE;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.user_can_edit_institution(inst uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.institutions i WHERE i.id = inst AND i.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.institution_members m WHERE m.institution_id = inst AND m.user_id = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.user_can_edit_building(b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.buildings bl
    WHERE bl.id = b
      AND (bl.institution_id IS NULL OR public.user_can_edit_institution(bl.institution_id))
  );
$$;
GRANT EXECUTE ON FUNCTION public.user_can_edit_institution(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_edit_building(uuid)    TO anon, authenticated;

ALTER TABLE public.institutions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read institutions" ON public.institutions;
DROP POLICY IF EXISTS "Authenticated can create institutions" ON public.institutions;
DROP POLICY IF EXISTS "Owners can update institutions" ON public.institutions;
DROP POLICY IF EXISTS "Owners can delete institutions" ON public.institutions;
CREATE POLICY "Anyone can read institutions" ON public.institutions FOR SELECT USING (true);
CREATE POLICY "Authenticated can create institutions" ON public.institutions FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners can update institutions" ON public.institutions FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners can delete institutions" ON public.institutions FOR DELETE TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Members can read membership" ON public.institution_members;
DROP POLICY IF EXISTS "Owners manage membership" ON public.institution_members;
CREATE POLICY "Members can read membership" ON public.institution_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.user_can_edit_institution(institution_id));
CREATE POLICY "Owners manage membership" ON public.institution_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.institutions i WHERE i.id = institution_id AND i.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.institutions i WHERE i.id = institution_id AND i.owner_id = auth.uid()));

-- 3. Rooms (previously only in FloorEditor's React state) -------------------
CREATE TABLE IF NOT EXISTS public.rooms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  floor_id    uuid NOT NULL REFERENCES public.floors(id) ON DELETE CASCADE,
  node_id     uuid REFERENCES public.nodes(id) ON DELETE SET NULL,
  name        text NOT NULL DEFAULT '',
  x           double precision NOT NULL DEFAULT 0,
  y           double precision NOT NULL DEFAULT 0,
  width       double precision NOT NULL DEFAULT 80,
  height      double precision NOT NULL DEFAULT 60,
  type        text NOT NULL DEFAULT 'office',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS node_id    uuid REFERENCES public.nodes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS type       text NOT NULL DEFAULT 'office',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_rooms_floor    ON public.rooms(floor_id);
CREATE INDEX IF NOT EXISTS idx_rooms_building ON public.rooms(building_id);
CREATE INDEX IF NOT EXISTS idx_rooms_node     ON public.rooms(node_id);
DROP TRIGGER IF EXISTS update_rooms_updated_at ON public.rooms;
CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Admin layers (replaces localStorage) -----------------------------------
CREATE TABLE IF NOT EXISTS public.custom_layers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  layer_key      text NOT NULL,
  data           jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- NULLS NOT DISTINCT so legacy (institution_id IS NULL) rows upsert correctly.
  CONSTRAINT custom_layers_inst_key_uniq UNIQUE NULLS NOT DISTINCT (institution_id, layer_key)
);
ALTER TABLE public.custom_layers
  ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_layers_inst_key_uniq') THEN
    ALTER TABLE public.custom_layers
      ADD CONSTRAINT custom_layers_inst_key_uniq UNIQUE NULLS NOT DISTINCT (institution_id, layer_key);
  END IF;
END $$;

DROP TRIGGER IF EXISTS update_custom_layers_updated_at ON public.custom_layers;
CREATE TRIGGER update_custom_layers_updated_at BEFORE UPDATE ON public.custom_layers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.custom_layers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read custom_layers" ON public.custom_layers;
DROP POLICY IF EXISTS "Editors write custom_layers" ON public.custom_layers;
CREATE POLICY "Anyone can read custom_layers" ON public.custom_layers FOR SELECT USING (true);
CREATE POLICY "Editors write custom_layers" ON public.custom_layers FOR ALL TO authenticated
  USING (institution_id IS NULL OR public.user_can_edit_institution(institution_id))
  WITH CHECK (institution_id IS NULL OR public.user_can_edit_institution(institution_id));

-- 5. Tighten write RLS --------------------------------------------------------
-- buildings: close the anon-write gap flagged "remove in production".
DROP POLICY IF EXISTS "Anon users can insert buildings" ON public.buildings;
DROP POLICY IF EXISTS "Anon users can update buildings" ON public.buildings;
DROP POLICY IF EXISTS "Anon users can delete buildings" ON public.buildings;
DROP POLICY IF EXISTS "Authenticated can insert buildings" ON public.buildings;
DROP POLICY IF EXISTS "Editors can update buildings" ON public.buildings;
DROP POLICY IF EXISTS "Editors can delete buildings" ON public.buildings;
DROP POLICY IF EXISTS "Authenticated users can insert buildings" ON public.buildings;
DROP POLICY IF EXISTS "Authenticated users can update buildings" ON public.buildings;
DROP POLICY IF EXISTS "Authenticated users can delete buildings" ON public.buildings;
CREATE POLICY "Authenticated can insert buildings" ON public.buildings FOR INSERT TO authenticated
  WITH CHECK (institution_id IS NULL OR public.user_can_edit_institution(institution_id));
CREATE POLICY "Editors can update buildings" ON public.buildings FOR UPDATE TO authenticated
  USING (public.user_can_edit_building(id))
  WITH CHECK (institution_id IS NULL OR public.user_can_edit_institution(institution_id));
CREATE POLICY "Editors can delete buildings" ON public.buildings FOR DELETE TO authenticated
  USING (public.user_can_edit_building(id));

-- Child tables: reads stay open ("Anyone can read ..." policies already exist);
-- writes now require ownership of the parent building.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['floors','nodes','edges','pois','venue_nodes','venue_paths','rooms'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Anyone can insert %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Anyone can update %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Anyone can delete %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Editors can write %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Editors can write %1$s" ON public.%1$I FOR ALL TO authenticated USING (public.user_can_edit_building(building_id)) WITH CHECK (public.user_can_edit_building(building_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Anyone can read %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Anyone can read %1$s" ON public.%1$I FOR SELECT USING (true)', t);
  END LOOP;
END $$;

-- MANUAL STEP (run once you have a real institution + user):
--   INSERT INTO public.institutions (name, slug, owner_id)
--     VALUES ('Unity Park', 'unity-park', '<your auth.users id>') RETURNING id;
--   UPDATE public.buildings SET institution_id = '<that id>' WHERE institution_id IS NULL;
--
-- Assign *every* building, not just Unity Park: a building with no
-- institution is editable by any signed-in user, and visitors can sign in
-- via email OTP. Afterwards this should return 0:
--   SELECT count(*) FROM public.buildings WHERE institution_id IS NULL;
