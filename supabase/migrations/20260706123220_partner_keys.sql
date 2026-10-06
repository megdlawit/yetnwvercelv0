-- Partner API keys for @ethi/indoor-maps-sdk / indoor-maps-api Edge Function.
--
-- Deliberately NOT exposed to anon/authenticated roles — RLS is enabled with
-- zero policies for those roles, so only the service-role key (used inside
-- the indoor-maps-api Edge Function, never shipped to any client) can read
-- or write this table.

CREATE TABLE IF NOT EXISTS public.partner_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  -- NULL or empty = unrestricted (any building). Non-empty = allow-list.
  allowed_building_ids TEXT[] DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_keys_api_key ON public.partner_keys(api_key);

ALTER TABLE public.partner_keys ENABLE ROW LEVEL SECURITY;
-- No policies added on purpose: default-deny for anon/authenticated.
-- Only the service-role key (Edge Function) bypasses RLS entirely.

CREATE TRIGGER update_partner_keys_updated_at
  BEFORE UPDATE ON public.partner_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Example: issue yourself a first key for internal testing.
-- Swap in a real generated secret before using this for anything real.
-- INSERT INTO public.partner_keys (partner_name, api_key, allowed_building_ids)
-- VALUES ('internal-test', 'pk_live_replace_me_with_a_real_random_secret', NULL);
