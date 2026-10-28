// Reports: problems visitors flagged on the map ("Report a problem"), for the
// team to fix or dismiss. Fixing one also marks the place's details as checked.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Flag, Check, X, RotateCcw, Loader2, Mail, Inbox } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import { REPORT_KINDS, isReportKind, sinceText } from '@/lib/venue/trust';
import { PageHeader, Panel } from './ui';

type Report = Tables<'place_reports'>;
type Filter = 'open' | 'fixed' | 'dismissed' | 'all';

export default function Reports() {
  const { data } = useDashboard();
  const b = data.building;
  const [rows, setRows] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data: r, error: e } = await supabase.from('place_reports').select('*').eq('building_id', b.id).order('created_at', { ascending: false }).limit(300);
    setError(e ? e.message : null);
    setRows(r ?? []);
  }, [b.id]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter(r => filter === 'all' || r.status === filter), [rows, filter]);
  const count = (f: Filter) => (rows ?? []).filter(r => f === 'all' || r.status === f).length;

  const decide = async (r: Report, status: 'fixed' | 'dismissed' | 'open') => {
    setBusy(r.id);
    const note = notes[r.id]?.trim() || null;
    const { error: e } = await supabase.from('place_reports').update({ status, resolution_note: status === 'open' ? null : note }).eq('id', r.id);
    // Fixed: the place's details were just looked at.
    if (!e && status === 'fixed' && r.poi_id) await supabase.from('pois').update({ checked_at: new Date().toISOString() }).eq('id', r.poi_id);
    setBusy(null);
    if (e) { toast.error(e.message); return; }
    toast.success(status === 'fixed' ? 'Marked fixed' : status === 'dismissed' ? 'Dismissed' : 'Reopened');
    void load();
  };

  return (
    <>
      <PageHeader title="Reports" description="Problems visitors flagged with “Report a problem” on your map — wrong details, closed places, blocked ways. Fix them in the map editor or Places, then mark them fixed." />
      {error && /place_reports|schema cache|does not exist/i.test(error) ? (
        <Panel bodyClassName="p-5"><p className="text-sm text-muted-foreground">Run the 20261028090000_place_trust migration to turn on visitor reports.</p></Panel>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {([['open', 'Open'], ['fixed', 'Fixed'], ['dismissed', 'Dismissed'], ['all', 'All']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)} className={cn('rounded-full border px-3 py-1.5 text-sm', filter === id ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:bg-muted')}>
                {label} {rows ? count(id) : ''}
              </button>
            ))}
          </div>
          <Panel bodyClassName="px-2 pb-2">
            {rows === null ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : !shown.length ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center">
                <Inbox className="h-8 w-8 text-muted-foreground/60" />
                <p className="font-semibold">{filter === 'open' ? 'Nothing to fix' : 'Nothing here'}</p>
                <p className="max-w-sm text-sm text-muted-foreground">Visitors can report a problem from any place's page on your map. Reports land here.</p>
              </div>
            ) : (
              <ul className="divide-y">
                {shown.map(r => (
                  <li key={r.id} className="space-y-2 px-3 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Flag className={cn('h-4 w-4', r.kind === 'safety' ? 'text-red-600' : 'text-amber-600')} />
                      <span className="font-semibold">{isReportKind(r.kind) ? REPORT_KINDS[r.kind].label : r.kind}</span>
                      <span className="text-sm text-muted-foreground">· {r.place_name ?? b.name} · {sinceText(r.created_at)}</span>
                      {r.status !== 'open' && <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold', r.status === 'fixed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-muted text-muted-foreground')}>{r.status === 'fixed' ? 'Fixed' : 'Dismissed'}{r.resolved_at ? ` ${sinceText(r.resolved_at)}` : ''}</span>}
                    </div>
                    {r.message && <p className="whitespace-pre-line text-sm">{r.message}</p>}
                    {r.contact && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="h-3.5 w-3.5" /> Wants an answer: {r.contact}</p>}
                    {r.resolution_note && <p className="text-xs text-muted-foreground">Note: {r.resolution_note}</p>}
                    {r.status === 'open' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input value={notes[r.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))} maxLength={1000} placeholder="What you did (optional)" className="h-8 min-w-[200px] flex-1" />
                        <Button size="sm" disabled={busy === r.id} onClick={() => void decide(r, 'fixed')}><Check className="mr-1.5 h-4 w-4" /> Fixed</Button>
                        <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void decide(r, 'dismissed')}><X className="mr-1.5 h-4 w-4" /> Dismiss</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void decide(r, 'open')}><RotateCcw className="mr-1.5 h-4 w-4" /> Reopen</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
