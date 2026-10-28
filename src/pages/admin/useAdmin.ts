// The control center's data: everything comes from the admin_* database
// functions (migration 20261008110000), which only the Yet New team can call.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type InstitutionStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface AdminOverview {
  institutions: number; institutions_pending: number; institutions_suspended: number; venues: number; venues_published: number;
  venues_pending: number; team_members: number; platform_admins: number; places: number; new_institutions_30d: number; publishes_30d: number;
  /** Since migration 20261028090000 (absent before it). */
  verifications_pending?: number; venues_verified?: number; reports_open?: number;
}
export interface VisitorStats { visitors: number; with_email: number; saves: number; visits: number; steps: number }
export interface AdminInstitution {
  id: string; name: string; kind: string | null; status: InstitutionStatus; created_at: string; reviewed_at: string | null; review_note: string | null;
  logo_url: string | null; owner_id: string | null; owner_username: string | null; owner_name: string | null; members: number; venues: number;
  published: number; pending_reviews: number; last_activity: string | null;
}
export interface AdminVenue {
  id: string; name: string; institution_id: string | null; institution_name: string | null; institution_status: InstitutionStatus | null; layout: string;
  is_published: boolean; published_at: string | null; review_status: 'none' | 'pending' | 'rejected'; review_requested_at: string | null;
  review_note: string | null; home_rank: number; floors: number; places: number; placed: boolean; updated_at: string | null;
  /** Since migration 20261028090000. */
  trust_level?: string; verified_at?: string | null; archived_at?: string | null; suspended_at?: string | null; suspend_note?: string | null; open_reports?: number;
}
export interface AdminVerificationRequest {
  id: string; building_id: string; venue_name: string; institution_name: string | null; institution_status: InstitutionStatus | null;
  poi_id: string | null; place_name: string | null; level: 'verified' | 'official'; note: string | null; requested_at: string;
  requested_by_name: string | null; current_level: string; source: string | null; responsible_party: string | null; is_published: boolean; open_reports: number;
}
export interface AdminUser {
  user_id: string; username: string | null; display_name: string | null; email: string | null; created_at: string; last_sign_in_at: string | null;
  is_platform_admin: boolean; institutions: { id: string; name: string; role: string }[];
}
export interface AdminActivity {
  id: number; building_id: string; venue_name: string | null; institution_name: string | null; actor_name: string | null; action: string;
  object_type: string; object_name: string | null; count: number; created_at: string;
}

/** The database hasn't had the control-center migration yet. */
export const isMissingMigration = (msg: string | null | undefined) => !!msg && /admin_|schema cache|does not exist|Could not find the function/i.test(msg);

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

/** One read of the console, with reload. */
export function useAdminQuery<T>(name: string, args?: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(args ?? {});
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await rpc<T>(name, args)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [name, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, needsMigration: isMissingMigration(error) };
}

export const adminActions = {
  setInstitutionStatus: (inst: string, status: InstitutionStatus, note?: string) => rpc<void>('admin_set_institution_status', { inst, new_status: status, note: note ?? null }),
  reviewVenue: (b: string, approve: boolean, note?: string) => rpc<void>('admin_review_venue', { b, approve, note: note ?? null }),
  setVenueLive: (b: string, live: boolean) => rpc<void>('admin_set_venue_live', { b, live }),
  setHomeRank: (b: string, rank: number) => rpc<void>('admin_set_home_rank', { b, rank }),
  setPlatformAdmin: (u: string, make: boolean) => rpc<void>('admin_set_platform_admin', { u, make }),
  decideVerification: (req: string, approve: boolean, note?: string) => rpc<void>('admin_decide_verification', { req, approve, note: note ?? null }),
  setTrust: (b: string, level: 'listed' | 'verified' | 'official', note?: string, poi?: string) => rpc<void>('admin_set_trust', { b, poi: poi ?? null, level, note: note ?? null }),
  suspendVenue: (b: string, suspend: boolean, note?: string) => rpc<void>('admin_suspend_venue', { b, suspend, note: note ?? null }),
};

/** Open an institution's own dashboard (support view) in this tab. */
export function openInstitutionDashboard(institutionId: string, venueId?: string) {
  try {
    localStorage.setItem('yetnew-institution', institutionId);
    if (venueId) localStorage.setItem('yetnew-venue', venueId); else localStorage.removeItem('yetnew-venue');
  } catch { /* private mode */ }
}

export const STATUS_LOOK: Record<InstitutionStatus, { label: string; cls: string }> = {
  pending: { label: 'Waiting for approval', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  rejected: { label: 'Declined', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  suspended: { label: 'Suspended', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300' },
};
