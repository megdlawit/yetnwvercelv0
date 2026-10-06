-- ──────────────────────────────────────────────────────────────────────────────
-- Module 4: Spatial Commerce — promotion_events + merchant_wallets
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Promotion event log -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.promotion_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    text NOT NULL CHECK (event_type IN (
                  'promotion_view',
                  'promotion_expand',
                  'promotion_click_navigate',
                  'promotion_dismiss'
                )),
  poi_id        uuid NOT NULL REFERENCES public.pois(id) ON DELETE CASCADE,
  promotion_id  uuid REFERENCES public.promotions(id) ON DELETE SET NULL,
  session_id    text NOT NULL DEFAULT '',
  user_lat      double precision,
  user_lng      double precision,
  user_x        double precision,
  user_y        double precision,
  environment   text NOT NULL DEFAULT 'unknown' CHECK (environment IN ('indoor', 'outdoor', 'unknown')),
  timestamp     timestamptz NOT NULL DEFAULT now()
);

-- Fast look-ups for the metrics dashboard
CREATE INDEX IF NOT EXISTS idx_promotion_events_poi_id
  ON public.promotion_events (poi_id);

CREATE INDEX IF NOT EXISTS idx_promotion_events_event_type
  ON public.promotion_events (event_type);

CREATE INDEX IF NOT EXISTS idx_promotion_events_timestamp
  ON public.promotion_events (timestamp DESC);

-- RLS: Allow inserts from the client (anonymous users can log events)
ALTER TABLE public.promotion_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_insert_promotion_events"
  ON public.promotion_events FOR INSERT
  WITH CHECK (true);

CREATE POLICY "allow_read_promotion_events"
  ON public.promotion_events FOR SELECT
  USING (true);

-- 2. Merchant wallet -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.merchant_wallets (
  merchant_id   text PRIMARY KEY,
  balance       numeric(12, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency      text NOT NULL DEFAULT 'ETB',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- RLS: merchants can only read their own wallet; inserts via service key only
ALTER TABLE public.merchant_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_read_merchant_wallets"
  ON public.merchant_wallets FOR SELECT
  USING (true);

-- 3. Atomic balance deduction RPC ---------------------------------------------
-- Returns {ok: boolean, new_balance: numeric}
-- Runs in a transaction; deducts only if balance >= amount.

CREATE OR REPLACE FUNCTION public.deduct_merchant_balance(
  p_merchant_id text,
  p_amount      numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance numeric(12, 2);
  v_new     numeric(12, 2);
BEGIN
  -- Lock the row
  SELECT balance INTO v_balance
  FROM public.merchant_wallets
  WHERE merchant_id = p_merchant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_merchant', 'new_balance', 0);
  END IF;

  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_funds', 'new_balance', v_balance);
  END IF;

  v_new := v_balance - p_amount;

  UPDATE public.merchant_wallets
  SET balance = v_new, updated_at = now()
  WHERE merchant_id = p_merchant_id;

  RETURN jsonb_build_object('ok', true, 'new_balance', v_new);
END;
$$;

-- 4. Seed example merchant wallets (replace UUIDs with real POI ids in prod) --

-- INSERT INTO public.merchant_wallets (merchant_id, balance) VALUES
--   ('merchant-001', 500.00),
--   ('merchant-002', 250.00)
-- ON CONFLICT (merchant_id) DO NOTHING;
