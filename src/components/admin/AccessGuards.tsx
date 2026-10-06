// Who may open what, on top of being signed in (RequireAdminAuth):
//  - the platform console (/admin, venue lists, POIs, layers, merchants) is
//    for the Yet New team only — institutions are sent to their dashboard;
//  - a venue's map editor is for that venue's own team (or the Yet New team).
// The database enforces the same rules (RLS); these keep people out of
// screens they can't use, instead of showing them broken pages.

import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Loader2, ShieldOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAdminAuth } from '@/contexts/AdminAuthContext';

function Checking() {
  return <div className="flex min-h-[100dvh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Checking access…</div>;
}

export function NoAccess({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-muted"><ShieldOff className="h-6 w-6 text-muted-foreground" /></span>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      <Link to="/dashboard" className="mt-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Go to your dashboard</Link>
    </div>
  );
}

/** Platform console pages: Yet New team only. Everyone else goes to their own dashboard. */
export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const { user } = useAdminAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!user) return;
    let live = true;
    supabase.rpc('user_is_platform_admin').then(({ data, error }) => { if (live) setAllowed(!error && data === true); });
    return () => { live = false; };
  }, [user]);
  if (allowed === null) return <Checking />;
  return allowed ? <>{children}</> : <Navigate to="/dashboard" replace />;
}

/** A venue's map editor: only that venue's team (or the Yet New team). */
export function RequireVenueEditor({ children }: { children: ReactNode }) {
  const { buildingId, floorId } = useParams<{ buildingId: string; floorId: string }>();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!buildingId) return;
    let live = true;
    setAllowed(null);
    Promise.all([
      supabase.rpc('user_can_edit_building', { b: buildingId }),
      floorId ? supabase.from('floors').select('id').eq('id', floorId).eq('building_id', buildingId).maybeSingle() : Promise.resolve({ data: true }),
    ]).then(([can, floor]) => { if (live) setAllowed(can.data === true && !!floor.data); });
    return () => { live = false; };
  }, [buildingId, floorId]);
  if (allowed === null) return <Checking />;
  return allowed ? <>{children}</> : <NoAccess title="This venue isn't yours" text="You can only edit the maps of your own institution's venues." />;
}
