import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { isValidEmail } from '@/lib/validation';

export interface UserProfile {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  language: string;
  location: string | null;
  preferred_park: string | null;
  places_visited: number;
  steps_walked: number;
  badges_earned: number;
  created_at: string;
  updated_at: string;
}

export type ProfileUpdate = Partial<
  Pick<UserProfile, 'full_name' | 'language' | 'location' | 'preferred_park' | 'email'>
>;

/** One day's worth of step history, as shown in the profile's step-detail
 *  chart. `date` is a local YYYY-MM-DD key (see `localDateKey`), not UTC —
 *  a day should roll over at local midnight for the person looking at it,
 *  not at UTC midnight. */
export interface DailyStepEntry {
  date: string;
  steps: number;
}

/** Local (device-timezone) YYYY-MM-DD key — deliberately not
 *  `toISOString().slice(0,10)`, which is UTC and would file a step logged
 *  just after 9pm in Addis Ababa (UTC+3) under the *next* UTC day. */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Last N local-day keys, oldest first, ending today. */
function lastNDateKeys(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push(localDateKey(d));
  }
  return out;
}

const GUEST_ID_KEY = 'ethi_guest_id';
// Set by CreateProfilePrompt right before it sends the magic-link email, and
// checked below so this hook's global SIGNED_IN listener only ever reacts to
// an actual magic-link return trip — never to an unrelated real sign-in
// (e.g. an admin logging into /admin/login) that happens to fire the same
// Supabase auth event on the shared client. Without this guard, ANY
// SIGNED_IN event anywhere in the app — including admin login — was being
// treated as "magic link came back" and immediately signed back out again,
// which is what caused the admin dashboard to flash and bounce to login.
const MAGIC_LINK_PENDING_KEY = 'ethi_guest_magic_link_pending';

function getOrCreateGuestId(): string {
  try {
    const existing = localStorage.getItem(GUEST_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(GUEST_ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function computeBadges(placesVisited: number, stepsWalked: number): number {
  let badges = 0;
  if (placesVisited >= 1) badges += 1;
  if (placesVisited >= 5) badges += 1;
  if (stepsWalked >= 1000) badges += 1;
  if (stepsWalked >= 5000) badges += 1;
  return badges;
}

export function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [stepsHistory, setStepsHistory] = useState<DailyStepEntry[]>([]);
  // Tracks *today's* accumulated steps so syncActivityStats can upsert an
  // absolute value into daily_steps without a read-modify-write round trip
  // on every call (it fires on every PDR step tick while navigating — see
  // Index.tsx — so an extra fetch per step would be wasteful). Seeded from
  // fetchStepsHistory once real data loads.
  const todayStepsRef = useRef(0);
  // Tracks how much of the *current session's* running step count (see
  // usePDRNavigation's stepCount, which resets to 0 at the start of every
  // navigation session) has already been folded into profile.steps_walked
  // and today's daily_steps row. Comparing the raw session count against
  // the lifetime total with Math.max only ever works for the very first
  // session ever recorded: every session after that starts from 0 again,
  // so it would need to out-walk the entire history in one sitting before
  // anything new got counted — which is why steps stopped accumulating
  // past the first day. A drop below what we last saw means a new session
  // started (the counter reset), so the whole incoming value is treated
  // as a fresh increment.
  const sessionStepsRef = useRef(0);

  const fetchStepsHistory = useCallback(async (profileId: string) => {
    const keys = lastNDateKeys(7);
    const { data, error: fetchErr } = await supabase
      .from('daily_steps')
      .select('log_date, steps')
      .eq('profile_id', profileId)
      .gte('log_date', keys[0]);
    if (fetchErr) return; // non-fatal — chart just shows zeros until the next successful fetch
    const byDate = new Map<string, number>();
    for (const row of data ?? []) byDate.set(row.log_date, row.steps);
    setStepsHistory(keys.map((date) => ({ date, steps: byDate.get(date) ?? 0 })));
    todayStepsRef.current = byDate.get(keys[keys.length - 1]) ?? 0;
  }, []);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);

    const guestId = getOrCreateGuestId();

    // Try to load existing row for this guest ID
    const { data: row, error: fetchErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', guestId)
      .maybeSingle<UserProfile>();

    if (fetchErr) {
      setError(fetchErr.message);
      setLoading(false);
      return;
    }

    if (row) {
      setProfile(row);
      setLoading(false);
      return;
    }

    // First visit — auto-create a guest profile row
    const { data: inserted, error: insertErr } = await supabase
      .from('profiles')
      .insert({
        user_id:        guestId,
        full_name:      null,
        language:       'English',
        location:       null,
        preferred_park: null,
        places_visited: 0,
        steps_walked:   0,
        badges_earned:  0,
      })
      .select()
      .maybeSingle<UserProfile>();

    if (insertErr) {
      setError(insertErr.message);
    } else if (inserted) {
      setProfile(inserted);
    }

    setLoading(false);
  }, []);

  useEffect(() => { void fetchProfile(); }, [fetchProfile]);

  useEffect(() => {
    if (profile?.id) void fetchStepsHistory(profile.id);
  }, [profile?.id, fetchStepsHistory]);

  // Keep a ref to the latest profile so the auth listener (set up once)
  // always writes to the right row, even if it fires before/after fetchProfile.
  const profileRef = useRef<UserProfile | null>(null);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  // Catches the redirect back from a magic-link email (see CreateProfilePrompt).
  // Clicking the link signs the user into Supabase Auth; we grab the verified
  // email off that session, attach it to the guest profile row, then drop the
  // auth session again since the rest of the app never uses it.
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' || !session?.user?.email) return;

      // Ignore any SIGNED_IN event that isn't the guest magic-link flow this
      // hook owns (e.g. an admin password sign-in on /admin/login firing on
      // the same shared Supabase client). Only proceed if we ourselves set
      // this flag right before sending the magic link.
      let pending: string | null = null;
      try { pending = sessionStorage.getItem(MAGIC_LINK_PENDING_KEY); } catch { /* ignore */ }
      if (!pending) return;
      try { sessionStorage.removeItem(MAGIC_LINK_PENDING_KEY); } catch { /* ignore */ }

      const verifiedEmail = session.user.email;

      const attach = async () => {
        // Drop the Supabase Auth session immediately — this app runs on the
        // anon key with a guest ID, and the longer a real auth session
        // lingers, the more other requests could accidentally be sent as
        // `authenticated` instead of `anon`.
        await supabase.auth.signOut();

        // The guest profile may still be loading when the redirect lands;
        // give fetchProfile a brief window to finish rather than dropping
        // the verified email on the floor.
        let current = profileRef.current;
        for (let i = 0; i < 20 && !current; i++) {
          await new Promise((r) => setTimeout(r, 150));
          current = profileRef.current;
        }
        if (!current || current.email === verifiedEmail) return;

        // Check whether this email already belongs to a profile — on a
        // different device/browser, that profile's guest ID won't match
        // this one. Treat that as "log in to the existing account" rather
        // than an error: adopt that profile's guest ID here instead of
        // trying (and failing) to claim the email for a second profile.
        const { data: existing, error: lookupErr } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', verifiedEmail)
          .maybeSingle<UserProfile>();

        if (lookupErr) {
          toast({
            title: 'Could not verify email',
            description: lookupErr.message,
            variant: 'destructive',
          });
          return;
        }

        if (existing && existing.id !== current.id) {
          try {
            localStorage.setItem(GUEST_ID_KEY, existing.user_id);
          } catch { /* ignore */ }
          setProfile(existing);
          toast({ title: 'Welcome back', description: `Signed in as ${verifiedEmail}.` });
          return;
        }

        const { data, error: updateErr } = await supabase
          .from('profiles')
          .update({ email: verifiedEmail })
          .eq('id', current.id)
          .select()
          .maybeSingle<UserProfile>();

        if (updateErr) {
          if (updateErr.code === '23505') {
            // Lost a race against another concurrent sign-in for the same
            // email — re-fetch, since it likely landed just above.
            const { data: nowExisting } = await supabase
              .from('profiles')
              .select('*')
              .eq('email', verifiedEmail)
              .maybeSingle<UserProfile>();
            if (nowExisting) {
              try { localStorage.setItem(GUEST_ID_KEY, nowExisting.user_id); } catch { /* ignore */ }
              setProfile(nowExisting);
              toast({ title: 'Welcome back', description: `Signed in as ${verifiedEmail}.` });
              return;
            }
          }
          toast({
            title: 'Could not verify email',
            description: updateErr.message,
            variant: 'destructive',
          });
          return;
        }

        if (data) {
          setProfile(data);
          toast({ title: 'Email verified', description: `${verifiedEmail} is now linked to your profile.` });
        }
      };

      void attach();
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  // createProfile kept for API compat — just re-fetches
  const createProfile = useCallback(async (_name: string): Promise<boolean> => {
    await fetchProfile();
    return true;
  }, [fetchProfile]);

  const updateProfile = useCallback(async (updates: ProfileUpdate): Promise<boolean> => {
    if (!profile) { setError('No profile loaded.'); return false; }
    setError(null);
    const { data, error: updateErr } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', profile.id)
      .select()
      .maybeSingle<UserProfile>();
    if (updateErr) { setError(updateErr.message); return false; }
    if (data) setProfile(data);
    return true;
  }, [profile]);

  const syncActivityStats = useCallback(async (steps: number, options?: { visit?: boolean }) => {
    if (!profile) return;
    const increment = steps < sessionStepsRef.current ? steps : steps - sessionStepsRef.current;
    sessionStepsRef.current = steps;
    const newSteps  = profile.steps_walked + Math.max(0, increment);
    const newPlaces = options?.visit ? profile.places_visited + 1 : profile.places_visited;
    const newBadges = computeBadges(newPlaces, newSteps);
    const stepsDelta = newSteps - profile.steps_walked;
    if (
      newSteps  === profile.steps_walked &&
      newPlaces === profile.places_visited &&
      newBadges === profile.badges_earned
    ) return;
    const { data, error: updateErr } = await supabase
      .from('profiles')
      .update({ steps_walked: newSteps, places_visited: newPlaces, badges_earned: newBadges })
      .eq('id', profile.id)
      .select()
      .maybeSingle<UserProfile>();
    if (!updateErr && data) setProfile(data);

    // Roll today's share of the increase into the daily log too, so the
    // step-detail chart stays current without a separate fetch. Best-effort:
    // a failed write here shouldn't roll back the lifetime total above, and
    // a missed day just means that day's bar under-reports slightly rather
    // than the whole feature breaking.
    if (stepsDelta > 0) {
      const today = localDateKey(new Date());
      todayStepsRef.current += stepsDelta;
      const { error: dailyErr } = await supabase
        .from('daily_steps')
        .upsert(
          { profile_id: profile.id, log_date: today, steps: todayStepsRef.current, updated_at: new Date().toISOString() },
          { onConflict: 'profile_id,log_date' },
        );
      if (!dailyErr) {
        setStepsHistory((prev) => {
          if (prev.length === 0 || prev[prev.length - 1].date !== today) return prev; // day rolled over — next mount refetches cleanly
          return [...prev.slice(0, -1), { date: today, steps: todayStepsRef.current }];
        });
      }
    }
  }, [profile]);

  const updateEmail = useCallback(async (email: string): Promise<boolean> => {
    if (!profile) { setError('No profile loaded.'); return false; }
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return false;
    }
    setError(null);
    const { data, error: updateErr } = await supabase
      .from('profiles')
      .update({ email })
      .eq('id', profile.id)
      .select()
      .maybeSingle<UserProfile>();
    if (updateErr) {
      // Unique violation means this email already belongs to a different
      // profile (e.g. it was used on another device/guest session before).
      // Rather than dead-ending with an error, treat this the same way the
      // magic-link flow does: adopt that existing profile as "logging in"
      // to the account the person already has.
      if (updateErr.code === '23505') {
        const { data: existing, error: lookupErr } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', email)
          .maybeSingle<UserProfile>();

        if (!lookupErr && existing) {
          try { localStorage.setItem(GUEST_ID_KEY, existing.user_id); } catch { /* ignore */ }
          setProfile(existing);
          toast({ title: 'Welcome back', description: `Signed in as ${email}.` });
          return true;
        }

        setError('That email is already linked to another account.');
        return false;
      }
      setError(updateErr.message);
      return false;
    }
    if (data) setProfile(data);
    return true;
  }, [profile]);

  // signOut just clears the local guest ID so a fresh profile is created next visit
  const signOut = useCallback(async (): Promise<boolean> => {
    try { localStorage.removeItem(GUEST_ID_KEY); } catch { /* ignore */ }
    setProfile(null);
    await fetchProfile(); // immediately create a new guest profile
    return true;
  }, [fetchProfile]);

  const displayName = useMemo(() => {
    if (profile?.full_name && profile.full_name.trim()) return profile.full_name.trim();
    if (profile?.email) return profile.email; // show full email as identifier
    return 'Guest';
  }, [profile]);
  const hasEmail = Boolean(profile?.email);

  return {
    profile,
    sessionUser: null,
    displayName,
    hasEmail,
    loading,
    error,
    refresh: fetchProfile,
    signOut,
    createProfile,
    updateProfile,
    updateEmail,
    syncActivityStats,
    stepsHistory,
  };
}