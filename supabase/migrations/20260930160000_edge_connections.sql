-- Floor-to-floor connections on the path graph.
--
-- A path between places on two different floors is a stair, lift, ramp or
-- escalator. Routing needs to know which — a step-free route may use a lift
-- or ramp but not stairs or an escalator — so edges record it explicitly
-- instead of the app guessing from nearby rooms.
-- Idempotent: safe to re-run.

ALTER TABLE public.edges ADD COLUMN IF NOT EXISTS connection text;
ALTER TABLE public.edges ADD COLUMN IF NOT EXISTS accessible boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edges_connection_check') THEN
    ALTER TABLE public.edges ADD CONSTRAINT edges_connection_check
      CHECK (connection IS NULL OR connection IN ('stairs', 'elevator', 'ramp', 'escalator'));
  END IF;
END $$;

-- Stairs and escalators are never step-free, whatever was stored before.
UPDATE public.edges SET accessible = false WHERE connection IN ('stairs', 'escalator') AND accessible;
