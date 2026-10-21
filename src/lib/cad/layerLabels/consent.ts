// Training consent for a venue's layer labels (table layer_training_consents,
// migration 20261010110000). One decision per venue, made by the venue's
// institution owner (or a platform admin for Yet New's own venues). Editors
// see it but can't change it. The latest decision counts; revoking is a new
// "not allowed" decision and takes the venue out of every FUTURE export.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

// ─────────────────────────────────────────────────────────────────────────────
// LEGAL REVIEW NEEDED — this wording has not been reviewed by a lawyer.
// Changing the meaning of the text means bumping TRAINING_NOTICE_VERSION, so
// every stored decision says which wording it answered.
// ─────────────────────────────────────────────────────────────────────────────
export const TRAINING_NOTICE_VERSION = 1;

export const TRAINING_NOTICE = {
  title: 'Help improve layer recognition',
  body: [
    'When you import a CAD drawing, Yet New suggests what each layer is. If you allow it, the layer descriptions from this venue\'s imports and the labels your team confirms may be used to train Yet New\'s layer-recognition model.',
    'What is used: layer names, counts of drawing elements, block names and the labels your team confirmed. Text written in the drawing is not used unless Yet New asks you separately. The original drawing file is kept privately for this venue and is not shared.',
    'You can withdraw this permission at any time. After that, this venue\'s data is left out of all future training. A model that was already trained cannot unlearn what it learned from earlier data.',
    'This choice does not affect importing or using your venue.',
  ],
} as const;

export interface ConsentState {
  /** The current decision; null when nobody has decided yet (= not allowed). */
  accepted: boolean | null;
  decidedAt: string | null;
  noticeVersion: number | null;
  /** The signed-in user may make the decision for this venue. */
  canDecide: boolean;
  /** The database doesn't have the consent table yet (migration not run). */
  unavailable?: boolean;
}

export async function loadConsent(supabase: SupabaseClient<Database>, buildingId: string): Promise<ConsentState> {
  const [latest, may] = await Promise.all([
    supabase.from('layer_training_consents').select('accepted, created_at, notice_version')
      .eq('building_id', buildingId).order('seq', { ascending: false }).limit(1).maybeSingle(),
    supabase.rpc('user_can_consent_for_building', { b: buildingId }),
  ]);
  if (latest.error || may.error) {
    return { accepted: null, decidedAt: null, noticeVersion: null, canDecide: false, unavailable: true };
  }
  return {
    accepted: latest.data?.accepted ?? null,
    decidedAt: latest.data?.created_at ?? null,
    noticeVersion: latest.data?.notice_version ?? null,
    canDecide: may.data === true,
  };
}

export async function recordConsent(supabase: SupabaseClient<Database>, buildingId: string, accepted: boolean): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Sign in first.');
  const { error } = await supabase.from('layer_training_consents').insert({
    building_id: buildingId, decided_by: data.user.id, notice_version: TRAINING_NOTICE_VERSION, accepted,
  });
  if (error) throw new Error(error.message);
}
