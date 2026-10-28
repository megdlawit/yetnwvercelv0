// Kinds of account and oversight, for the Yet New team: an institution is a venue, government,
// destination, business or experience provider account; a government or destination account
// can oversee other institutions — its people see their venues read-only (dashboards,
// insights, reports). Every change lands in the audit log.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Eye, Loader2, Plus, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export const ACCOUNT_TYPES = [
  ['venue', 'Venue', 'Runs its own venues'],
  ['government', 'Government', 'A ministry, city or regional office; can oversee others'],
  ['destination', 'Destination', 'A destination management organisation; can oversee others'],
  ['business', 'Business', 'A hotel, restaurant or shop'],
  ['provider', 'Experience provider', 'Tours, guides and activities'],
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number][0];
export const accountLabel = (t: string) => ACCOUNT_TYPES.find(a => a[0] === t)?.[1] ?? 'Venue';
export const canOversee = (t: string) => t === 'government' || t === 'destination';

interface Grant { overseer_id: string; institution_id: string; note: string | null; granted_at: string }

/** Every institution's kind of account and every oversight grant (null before the roles migration). */
export function useAccountTypes() {
  const [types, setTypes] = useState<Map<string, string> | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [missing, setMissing] = useState(false);
  const reload = useCallback(async () => {
    const [t, g] = await Promise.all([
      supabase.from('institutions').select('id, account_type'),
      supabase.from('oversight_grants' as never).select('overseer_id, institution_id, note, granted_at') as unknown as Promise<{ data: Grant[] | null; error: { message: string } | null }>,
    ]);
    setMissing(!!t.error || !!g.error);
    setTypes(new Map(((t.data ?? []) as unknown as { id: string; account_type?: string }[]).map(r => [r.id, r.account_type ?? 'venue'])));
    setGrants(g.data ?? []);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const setType = async (inst: string, t: AccountType) => {
    const { error } = await supabase.rpc('admin_set_account_type', { inst, new_type: t });
    if (error) throw new Error(error.message);
    await reload();
  };
  const setOversight = async (overseer: string, inst: string, give: boolean, note?: string) => {
    const { error } = await supabase.rpc('admin_set_oversight', { overseer, inst, give, note: note ?? null });
    if (error) throw new Error(error.message);
    await reload();
  };
  return { types, grants, missing, reload, setType, setOversight };
}

export function OversightDialog({ overseer, institutions, grants, onClose, setOversight }: {
  overseer: { id: string; name: string } | null;
  institutions: { id: string; name: string }[];
  grants: Grant[];
  onClose: () => void;
  setOversight: (overseer: string, inst: string, give: boolean, note?: string) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const mine = useMemo(() => new Set(grants.filter(g => g.overseer_id === overseer?.id).map(g => g.institution_id)), [grants, overseer]);
  const name = (id: string) => institutions.find(i => i.id === id)?.name ?? 'An institution';
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return institutions.filter(i => i.id !== overseer?.id && !mine.has(i.id) && (!q || i.name.toLowerCase().includes(q))).slice(0, 8);
  }, [institutions, overseer, mine, search]);

  const run = async (inst: string, give: boolean) => {
    if (!overseer) return;
    setBusy(inst);
    try { await setOversight(overseer.id, inst, give); toast.success(give ? `${overseer.name} now oversees ${name(inst)}` : `${overseer.name} no longer oversees ${name(inst)}`); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not change oversight'); }
    finally { setBusy(null); }
  };

  return (
    <Dialog open={!!overseer} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What {overseer?.name} oversees</DialogTitle>
          <DialogDescription>Their people see these institutions’ venues, insights and reports — read only. They can’t change anything there. Both sides see this in their audit log.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Overseeing {mine.size}</p>
            {!mine.size ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
              <ul className="divide-y rounded-2xl border">
                {[...mine].map(id => (
                  <li key={id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <Eye className="h-4 w-4 text-muted-foreground" /><span className="flex-1 truncate">{name(id)}</span>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={busy === id} onClick={() => run(id, false)}>
                      {busy === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}<span className="ml-1">Stop</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Add</p>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find an institution" className="mb-2" />
            <ul className="divide-y rounded-2xl border">
              {candidates.map(i => (
                <li key={i.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="flex-1 truncate">{i.name}</span>
                  <Button size="sm" variant="outline" disabled={busy === i.id} onClick={() => run(i.id, true)}>
                    {busy === i.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}<span className="ml-1">Oversee</span>
                  </Button>
                </li>
              ))}
              {!candidates.length && <li className="px-3 py-3 text-sm text-muted-foreground">No other institutions match.</li>}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
