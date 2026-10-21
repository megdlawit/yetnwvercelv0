-- Map layers drawn in the control center (institution_id IS NULL) show on
-- every visitor's outdoor map, so only the Yet New team may write them.
-- Before this, any signed-in account could change or delete them.
-- An institution's own layers stay with its editors.

ALTER TABLE public.custom_layers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Editors write custom_layers" ON public.custom_layers;
CREATE POLICY "Editors write custom_layers" ON public.custom_layers FOR ALL TO authenticated
  USING (
    CASE WHEN institution_id IS NULL THEN public.user_is_platform_admin()
         ELSE public.user_can_edit_institution(institution_id) END
  )
  WITH CHECK (
    CASE WHEN institution_id IS NULL THEN public.user_is_platform_admin()
         ELSE public.user_can_edit_institution(institution_id) END
  );

-- Visitors read layers in creation order.
CREATE INDEX IF NOT EXISTS idx_custom_layers_institution ON public.custom_layers (institution_id, created_at);
