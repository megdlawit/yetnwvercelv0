// The signed-in person's workspace: who they are, which institutions they
// belong to, and which venue the dashboard is showing. Platform admins (the
// Yet New team) can switch into any institution to help.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { usernameFromEmail } from '@/lib/accounts';

export interface WorkspaceInstitution {
  id: string; name: string; kind: string; slug: string | null; logo_url: string | null; description: string | null; owner_id: string | null;
}
export interface WorkspaceVenue { id: string; name: string; is_published: boolean; layout: string; theme: string }
export type Role = 'owner' | 'editor' | 'admin';

interface WorkspaceValue {
  loading: boolean;
  account: { userId: string; username: string | null; displayName: string };
  isPlatformAdmin: boolean;
  institutions: (WorkspaceInstitution & { role: Role })[];
  institution: (WorkspaceInstitution & { role: Role }) | null;
  venues: WorkspaceVenue[];
  venueId: string | null;
  setInstitutionId: (id: string) => void;
  setVenueId: (id: string) => void;
  reload: () => Promise<void>;
  /** Run 20261002090000_institution_accounts.sql to get accounts, publishing and activity. */
  needsMigration: boolean;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);
const INST_KEY = 'yetnew-institution', VENUE_KEY = 'yetnew-venue';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAdminAuth();
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<WorkspaceValue['account']>({ userId: '', username: null, displayName: '' });
  const [isPlatformAdmin, setAdmin] = useState(false);
  const [institutions, setInstitutions] = useState<WorkspaceValue['institutions']>([]);
  const [institutionId, setInstitutionIdState] = useState<string | null>(() => read(INST_KEY));
  const [venues, setVenues] = useState<WorkspaceVenue[]>([]);
  const [venueId, setVenueIdState] = useState<string | null>(() => new URLSearchParams(location.search).get('venue') ?? read(VENUE_KEY));
  const [needsMigration, setNeedsMigration] = useState(false);

  const loadInstitutions = useCallback(async () => {
    if (!user) return;
    const [acc, admin, members, owned] = await Promise.all([
      supabase.from('user_accounts').select('username, display_name').eq('user_id', user.id).maybeSingle(),
      supabase.from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
      supabase.from('institution_members').select('institution_id, role').eq('user_id', user.id),
      supabase.from('institutions').select('*').eq('owner_id', user.id),
    ]);
    setNeedsMigration(!!acc.error);
    const meta = user.user_metadata ?? {};
    setAccount({
      userId: user.id,
      username: acc.data?.username ?? usernameFromEmail(user.email) ?? null,
      displayName: acc.data?.display_name || meta.display_name || meta.full_name || user.email?.split('@')[0] || 'You',
    });
    // Before the accounts migration, institution owners are the admins.
    const platformAdmin = !!admin.data || (!!admin.error && (owned.data?.length ?? 0) > 0);
    setAdmin(platformAdmin);

    const roleOf = new Map<string, Role>((members.data ?? []).map(m => [m.institution_id, (m.role === 'owner' ? 'owner' : 'editor') as Role]));
    for (const i of owned.data ?? []) roleOf.set(i.id, 'owner');
    let rows: WorkspaceInstitution[] = [];
    if (platformAdmin) {
      rows = ((await supabase.from('institutions').select('*').order('name')).data ?? []) as WorkspaceInstitution[];
    } else if (roleOf.size) {
      rows = ((await supabase.from('institutions').select('*').in('id', [...roleOf.keys()]).order('name')).data ?? []) as WorkspaceInstitution[];
    }
    const list = rows.map(r => ({
      id: r.id, name: r.name, kind: r.kind, slug: r.slug, logo_url: r.logo_url ?? null, description: r.description ?? null, owner_id: r.owner_id,
      role: roleOf.get(r.id) ?? 'admin' as Role,
    }))
      // your own institutions first
      .sort((a, b) => Number(a.role === 'admin') - Number(b.role === 'admin') || a.name.localeCompare(b.name));
    setInstitutions(list);
    return list;
  }, [user]);

  const loadVenues = useCallback(async (instId: string | null) => {
    if (!instId) { setVenues([]); return [] as WorkspaceVenue[]; }
    const { data } = await supabase.from('buildings').select('*').eq('institution_id', instId).order('created_at');
    const list = (data ?? []).map(b => ({ id: b.id, name: b.name, is_published: b.is_published, layout: b.layout ?? 'building', theme: b.theme ?? 'park' }));
    setVenues(list);
    return list;
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = (await loadInstitutions()) ?? [];
      // ?venue=<id> (e.g. from the Venues page) picks that venue's institution.
      const wantVenue = new URLSearchParams(location.search).get('venue');
      let inst = list.find(i => i.id === institutionId) ?? list[0] ?? null;
      if (wantVenue) {
        const { data: v } = await supabase.from('buildings').select('institution_id').eq('id', wantVenue).maybeSingle();
        inst = list.find(i => i.id === v?.institution_id) ?? inst;
      }
      setInstitutionIdState(inst?.id ?? null);
      if (inst) write(INST_KEY, inst.id);
      const vs = await loadVenues(inst?.id ?? null);
      const v = vs.find(x => x.id === (wantVenue ?? venueId)) ?? vs[0] ?? null;
      setVenueIdState(v?.id ?? null);
      if (v) write(VENUE_KEY, v.id);
    } finally {
      setLoading(false);
    }
  }, [loadInstitutions, loadVenues, institutionId, venueId]);

  useEffect(() => { reload(); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setInstitutionId = useCallback((id: string) => {
    setInstitutionIdState(id); write(INST_KEY, id);
    loadVenues(id).then(vs => { const v = vs[0]?.id ?? null; setVenueIdState(v); if (v) write(VENUE_KEY, v); });
  }, [loadVenues]);
  const setVenueId = useCallback((id: string) => { setVenueIdState(id); write(VENUE_KEY, id); }, []);

  const institution = useMemo(() => institutions.find(i => i.id === institutionId) ?? null, [institutions, institutionId]);

  return (
    <WorkspaceContext.Provider value={{
      loading, account, isPlatformAdmin, institutions, institution, venues, venueId, setInstitutionId, setVenueId, reload, needsMigration,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
