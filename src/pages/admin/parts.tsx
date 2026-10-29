// Small pieces shared by the control center pages.

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { timeAgo } from '@/lib/venue/activity';
import { trustLevelOf } from '@/lib/venue/trust';
import { Pill } from './ui';
import type { AdminActivity, AdminVenue, InstitutionStatus } from './useAdmin';

export { timeAgo };

const INSTITUTION_PILL: Record<InstitutionStatus, [string, 'blue' | 'green' | 'red' | 'orange']> = {
  pending: ['Waiting', 'blue'],
  approved: ['Approved', 'green'],
  rejected: ['Declined', 'red'],
  suspended: ['Suspended', 'orange'],
};

export function StatusChip({ status }: { status: InstitutionStatus }) {
  const [label, tone] = INSTITUTION_PILL[status] ?? INSTITUTION_PILL.pending;
  return <Pill tone={tone}>{label}</Pill>;
}

/** One status per venue, the most important first: suspended, archived, in review, declined, live, draft. */
export function VenueStatus({ v }: { v: AdminVenue }) {
  if (v.suspended_at) {
    return <Pill tone="red">Suspended</Pill>;
  } else if (v.archived_at) {
    return <Pill>Archived</Pill>;
  } else if (v.review_status === 'pending') {
    return <Pill tone="blue">In review</Pill>;
  } else if (v.review_status === 'rejected') {
    return <Pill tone="red">Declined</Pill>;
  } else if (v.is_published) {
    return <Pill tone="green">Live</Pill>;
  } else {
    return <Pill>Draft</Pill>;
  }
}

/** Verified / Official, or nothing for a plain listing. */
export function TrustPill({ level }: { level: string | null | undefined }) {
  const t = trustLevelOf(level);
  if (t === 'official') {
    return <Pill tone="purple">Official</Pill>;
  } else if (t === 'verified') {
    return <Pill tone="green">Verified</Pill>;
  } else {
    return null;
  }
}

/** A logo, or initials on a soft square. */
export function Mark({ name, logo, size = 36 }: { name: string; logo?: string | null; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';
  if (logo) {
    return <img src={logo} alt="" className="shrink-0 rounded-xl object-cover" style={{ width: size, height: size }} />;
  } else {
    return (
      <span className="grid shrink-0 place-items-center rounded-xl bg-primary/15 font-bold text-primary"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.33) }}>
        {initials}
      </span>
    );
  }
}

/** A round avatar for a person. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-primary font-bold text-primary-foreground"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>
      {initials}
    </span>
  );
}

/** Ask for an optional note before a decision (declining, suspending). */
export function useNoteDialog() {
  const [state, setState] = useState<{ title: string; text: string; confirm: string; danger: boolean; run: (note: string) => Promise<void> } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const ask = (o: { title: string; text: string; confirm: string; danger?: boolean; run: (note: string) => Promise<void> }) => { setNote(''); setState({ danger: false, ...o }); };
  const confirm = async () => {
    if (state) {
      setBusy(true);
      try { await state.run(note); setState(null); } finally { setBusy(false); }
    } else {
      setBusy(false);
    }
  };
  const dialog = (
    <Dialog open={!!state} onOpenChange={o => { if (!o && !busy) { setState(null); } else { /* keep open while saving */ } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          <DialogDescription>{state?.text}</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="A note for the team (optional) — they'll see it on their dashboard" />
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setState(null)} disabled={busy}>Cancel</Button>
          <Button variant={state?.danger ? 'destructive' : 'default'} disabled={busy} onClick={() => void confirm()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}{state?.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { ask, dialog };
}

export function describe(a: AdminActivity): string {
  const who = a.actor_name || 'Someone';
  const what = a.object_name ? `“${a.object_name}”` : a.object_type;
  if (a.object_type === 'venue') {
    return `${who} ${a.action} ${a.venue_name ?? what}`;
  } else {
    return `${who} ${a.action} ${a.count > 1 ? `${a.count} ${a.object_type}s` : `${a.object_type} ${what}`} in ${a.venue_name ?? 'a venue'}`;
  }
}

export function Empty({ icon: Icon, title, text }: { icon: typeof Loader2; title: string; text?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted"><Icon className="h-6 w-6 text-muted-foreground" /></span>
      <p className="text-sm font-semibold">{title}</p>
      {text ? <p className="max-w-sm text-xs text-muted-foreground">{text}</p> : null}
    </div>
  );
}

export function Loading() {
  return <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>;
}

export const matches = (q: string, ...fields: (string | null | undefined)[]) => {
  const t = q.trim().toLowerCase();
  return !t || fields.some(f => f?.toLowerCase().includes(t));
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
