// A review written before the visitor confirmed their email: kept on the device while the
// sign-in link travels, then posted as soon as they come back signed in — wherever the link
// lands them. Only one draft at a time; a draft older than a day is dropped.

import { supabase } from '@/integrations/supabase/client';

const KEY = 'yetnew-review-draft';
const MAX_AGE_MS = 24 * 3600_000;

export interface ReviewDraft { poiId: string; venueId: string; placeName: string; rating: number; body: string; authorName: string; savedAt: number }

export function saveReviewDraft(d: Omit<ReviewDraft, 'savedAt'>): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...d, savedAt: Date.now() })); } catch { /* private mode: they'll write it again */ }
}

export function loadReviewDraft(now = Date.now()): ReviewDraft | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null') as ReviewDraft | null;
    if (d && typeof d.poiId === 'string' && typeof d.rating === 'number' && now - d.savedAt < MAX_AGE_MS) {
      return d;
    } else {
      localStorage.removeItem(KEY);
      return null;
    }
  } catch {
    return null;
  }
}

export function clearReviewDraft(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** Post (or update) the signed-in visitor's review of a place. Returns an error message, or null. */
export async function postReview(d: Pick<ReviewDraft, 'poiId' | 'venueId' | 'rating' | 'body' | 'authorName'>): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user) {
    const row = { poi_id: d.poiId, building_id: d.venueId, user_id: auth.user.id, rating: d.rating, body: d.body.trim() || null, author_name: d.authorName.trim() };
    const { data: existing } = await supabase.from('place_reviews').select('id').eq('poi_id', d.poiId).eq('user_id', auth.user.id).maybeSingle();
    const { error } = existing
      ? await supabase.from('place_reviews').update({ rating: row.rating, body: row.body, author_name: row.author_name }).eq('id', existing.id)
      : await supabase.from('place_reviews').insert(row);
    return error ? error.message : null;
  } else {
    return 'Please confirm your email first.';
  }
}

/**
 * A quiet visitor session (Supabase anonymous sign-in), so a review posts straight away with no
 * email. Returns false when the project hasn't turned anonymous sign-ins on — then the visitor
 * confirms an email instead.
 */
export async function startVisitorSession(): Promise<boolean> {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    return false;
  } else {
    return true;
  }
}

/** Ask for a sign-in link that brings the visitor back to this place. */
export async function sendReviewLink(email: string, venueId: string, poiId: string): Promise<string | null> {
  const back = `${window.location.origin}/venue/${venueId}?review=${encodeURIComponent(poiId)}`;
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: back, shouldCreateUser: true } });
  return error ? error.message : null;
}
