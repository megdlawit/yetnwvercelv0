// "Trust & verification" in Venue Settings: the venue's status, where its details
// come from and who answers for them, "still correct" confirmation, and asking
// Yet New to verify it (never paid). Archive / restore lives here too.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, Loader2, CheckCircle2, Archive, ArchiveRestore, Send, Undo2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { STATUS_INFO, isStale, sinceText, trustLevelOf, venueStatus } from '@/lib/venue/trust';

type Request = Tables<'verification_requests'>;
const missing = (msg: string) => /trust_level|verification_requests|archive_venue|schema cache|does not exist/i.test(msg);
const MIGRATION_HINT = 'Run the 20261028090000_place_trust migration first.';

export default function TrustPanel({ building, institutionStatus, canArchive, onSaved }: {
  building: Tables<'buildings'>; institutionStatus?: string | null; canArchive: boolean; onSaved: () => void | Promise<void>;
}) {
  const b = building;
  const status = venueStatus(b, institutionStatus);
  const level = trustLevelOf(b.trust_level);
  const [source, setSource] = useState(b.source ?? '');
  const [party, setParty] = useState(b.responsible_party ?? '');
  const [busy, setBusy] = useState<'save' | 'check' | 'ask' | 'archive' | 'withdraw' | null>(null);
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [askLevel, setAskLevel] = useState<'verified' | 'official'>(level === 'verified' ? 'official' : 'verified');
  const [askNote, setAskNote] = useState('');
  useEffect(() => { setSource(b.source ?? ''); setParty(b.responsible_party ?? ''); }, [b.source, b.responsible_party]);

  const loadRequests = useCallback(async () => {
    const { data, error } = await supabase.from('verification_requests').select('*').eq('building_id', b.id).is('poi_id', null)
      .order('requested_at', { ascending: false }).limit(5);
    setRequests(error ? [] : data ?? []);
  }, [b.id]);
  useEffect(() => { void loadRequests(); }, [loadRequests]);
  const pending = requests?.find(r => r.status === 'pending');
  const lastDecided = requests?.find(r => r.status === 'approved' || r.status === 'rejected');

  const fail = (msg: string) => toast.error(missing(msg) ? MIGRATION_HINT : msg);
  const dirty = (source.trim() || null) !== (b.source ?? null) || (party.trim() || null) !== (b.responsible_party ?? null);

  const save = async (patch: Partial<Tables<'buildings'>>, what: 'save' | 'check', ok: string) => {
    setBusy(what);
    const { error } = await supabase.from('buildings').update(patch).eq('id', b.id);
    setBusy(null);
    if (error) { fail(error.message); return; }
    toast.success(ok); await onSaved();
  };

  const ask = async () => {
    setBusy('ask');
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('verification_requests').insert({ building_id: b.id, level: askLevel, note: askNote.trim() || null, requested_by: u.user?.id ?? null });
    setBusy(null);
    if (error) { fail(/one_pending|duplicate/i.test(error.message) ? 'You already have a request waiting.' : error.message); return; }
    toast.success('Sent to Yet New — you’ll see the answer here.');
    setAsking(false); setAskNote(''); void loadRequests();
  };

  const withdraw = async (r: Request) => {
    setBusy('withdraw');
    const { error } = await supabase.from('verification_requests').update({ status: 'withdrawn' }).eq('id', r.id);
    setBusy(null);
    if (error) { fail(error.message); return; }
    void loadRequests();
  };

  const archive = async (on: boolean) => {
    setBusy('archive');
    const { error } = await supabase.rpc('archive_venue' as never, { b: b.id, archive: on } as never);
    setBusy(null);
    if (error) { fail(error.message); return; }
    toast.success(on ? `${b.name} archived — it's offline, nothing was deleted` : `${b.name} restored — publish it when you're ready`);
    await onSaved();
  };

  const info = STATUS_INFO[status];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', info.cls)}>{info.label}</span>
        {status === 'featured' && level !== 'listed' && <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_INFO[level].cls)}>{STATUS_INFO[level].label}</span>}
        <span className="text-xs text-muted-foreground">{info.hint}</span>
      </div>
      {b.suspended_at && b.suspend_note && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">Yet New: “{b.suspend_note}”</p>}
      {b.verified_at && level !== 'listed' && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {STATUS_INFO[level].label} by Yet New {sinceText(b.verified_at)}{b.trust_note ? ` — “${b.trust_note}”` : ''}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Where the details come from</Label>
          <Input value={source} onChange={e => setSource(e.target.value)} placeholder="e.g. Site survey, Sep 2026; architect's drawings" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Who answers for them</Label>
          <Input value={party} onChange={e => setParty(e.target.value)} placeholder="e.g. Unity Park Administration" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void save({ source: source.trim() || null, responsible_party: party.trim() || null }, 'save', 'Saved')} disabled={!dirty || !!busy}>
          {busy === 'save' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void save({ checked_at: new Date().toISOString() }, 'check', 'Thanks — visitors see the details were just checked')}>
          {busy === 'check' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />} Details are still correct
        </Button>
        <span className={cn('text-xs', isStale(b.checked_at) ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
          {b.checked_at ? `Last checked ${sinceText(b.checked_at)}` : 'Never checked'}{isStale(b.checked_at) ? ' — worth a look' : ''}
        </span>
      </div>

      <div className="rounded-2xl border p-3">
        <p className="text-sm font-semibold">Verification by Yet New</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Free. Yet New checks your details and marks the venue Verified — or Official when the responsible authority confirms it. Paying for promotion never changes this.</p>
        {requests === null ? <Loader2 className="mt-2 h-4 w-4 animate-spin text-muted-foreground" /> : pending ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-300">Waiting</span>
            Asked to be {pending.level} {sinceText(pending.requested_at)}.
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void withdraw(pending)}><Undo2 className="mr-1 h-3.5 w-3.5" /> Withdraw</Button>
          </div>
        ) : level === 'official' ? null : asking ? (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              {(['verified', 'official'] as const).filter(l => l !== level).map(l => (
                <button key={l} type="button" onClick={() => setAskLevel(l)} aria-pressed={askLevel === l}
                  className={cn('flex-1 rounded-xl border p-2 text-left', askLevel === l ? 'border-primary bg-primary/10' : 'hover:bg-muted')}>
                  <span className="block text-sm font-semibold">{STATUS_INFO[l].label}</span>
                  <span className="block text-[11px] text-muted-foreground">{STATUS_INFO[l].hint}</span>
                </button>
              ))}
            </div>
            <Textarea rows={2} maxLength={2000} value={askNote} onChange={e => setAskNote(e.target.value)}
              placeholder={askLevel === 'official' ? 'Which authority confirms it, and how Yet New can check (letter, contact, website)' : 'Anything that helps Yet New check (licence, website, a contact)'} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void ask()} disabled={!!busy || status === 'draft'}>{busy === 'ask' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />} Send request</Button>
              <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
            </div>
            {status === 'draft' && <p className="text-xs text-muted-foreground">Publish the venue first — Yet New verifies what visitors can see.</p>}
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {lastDecided?.status === 'rejected' && <p className="text-xs text-muted-foreground">Last request declined{lastDecided.decision_note ? `: “${lastDecided.decision_note}”` : '.'}</p>}
            <Button size="sm" variant="outline" onClick={() => setAsking(true)}><ShieldCheck className="mr-1.5 h-4 w-4" /> Ask Yet New to verify</Button>
          </div>
        )}
      </div>

      {canArchive && status !== 'suspended' && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <p className="min-w-[200px] flex-1 text-xs text-muted-foreground">{b.archived_at ? 'Archived: offline, everything kept.' : 'Closed for good or for a season? Archive takes it offline and keeps everything.'}</p>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void archive(!b.archived_at)}>
            {busy === 'archive' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : b.archived_at ? <ArchiveRestore className="mr-1.5 h-4 w-4" /> : <Archive className="mr-1.5 h-4 w-4" />}
            {b.archived_at ? 'Restore' : 'Archive venue'}
          </Button>
        </div>
      )}
    </div>
  );
}
