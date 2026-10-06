import { supabase } from '@/integrations/supabase/client';

// ── NOTE ──────────────────────────────────────────────────────────────────
// This file used to call createClient() a second time here, pointed at the
// same Supabase project as src/integrations/supabase/client.ts. Two
// GoTrueClient instances sharing one browser storage key fight over the
// same session: one client's background token refresh (or its initial
// getSession() call) can overwrite/invalidate the session the other client
// just set. That's exactly what caused the admin dashboard to flash in and
// then immediately bounce back to the login screen — the *second* client
// was silently signing the *first* one out.
//
// Fix: only ever create ONE Supabase client for the whole app
// (src/integrations/supabase/client.ts) and have every other file, like
// this one, just re-export/import it instead of instantiating its own.
export { supabase };

// ── Database row type for the `buildings` table ───────────────────────────────
// Adjust column names to match your actual Supabase schema if they differ.
export interface BuildingRow {
  id: number;
  name: string;
  /** Number of floors (used for display) */
  floors?: number | null;
  /** Total room count (used for display) */
  rooms?: number | null;
  /** Single emoji representing the building type */
  emoji?: string | null;
  /** Background colour for the thumbnail tile */
  bg?: string | null;
  /** Whether an indoor map is available for this building */
  available?: boolean | null;
  /** Freeform building type label, e.g. "Museum" */
  type?: string | null;
}