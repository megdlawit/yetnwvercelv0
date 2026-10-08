// Small pieces shared by the control center pages.

import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/venue/activity';
import { STATUS_LOOK, type AdminActivity, type InstitutionStatus } from './useAdmin';

export { timeAgo };

export function StatusChip({ status }: { status: InstitutionStatus }) {
  const s = STATUS_LOOK[status] ?? STATUS_LOOK.pending;
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold', s.cls)}><span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />{s.label}</span>;
}

export function VenueChip({ live, review }: { live: boolean; review: string }) {
  const [label, cls] = review === 'pending' ? ['In review', 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300']
    : review === 'rejected' ? ['Declined', 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300']
    : live ? ['Live', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300']
    : ['Draft', 'bg-muted text-muted-foreground'];
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold', cls)}><span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />{label}</span>;
}

export function Mark({ name, logo, size = 36 }: { name: string; logo?: string | null; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';
  return logo
    ? <img src={logo} alt="" className="shrink-0 rounded-xl object-cover" style={{ width: size, height: size }} />
    : <span className="grid shrink-0 place-items-center rounded-xl bg-primary/15 text-xs font-bold text-primary" style={{ width: size, height: size }}>{initials}</span>;
}

export function Stat({ label, value, sub, icon: Icon, tone = 'default', onClick }: {
  label: string; value: ReactNode; sub?: ReactNode; icon: typeof Loader2; tone?: 'default' | 'attention' | 'good'; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} disabled={!onClick}
      className={cn('flex items-start gap-3 rounded-3xl border bg-card p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition enabled:hover:border-primary/40 enabled:hover:shadow-md',
        tone === 'attention' && 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20')}>
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-2xl', tone === 'attention' ? 'bg-amber-400/20 text-amber-700' : tone === 'good' ? 'bg-emerald-500/15 text-emerald-700' : 'bg-primary/10 text-primary')}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-black leading-none tabular-nums">{value}</span>
        <span className="mt-1 block text-xs font-medium text-muted-foreground">{label}</span>
        {sub && <span className="mt-0.5 block text-[11px] text-muted-foreground">{sub}</span>}
      </span>
    </button>
  );
}

/** Ask for an optional note before a decision (declining, suspending). */
export function useNoteDialog() {
  const [state, setState] = useState<{ title: string; text: string; confirm: string; danger: boolean; run: (note: string) => Promise<void> } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const ask = (o: { title: string; text: string; confirm: string; danger?: boolean; run: (note: string) => Promise<void> }) => { setNote(''); setState({ danger: false, ...o }); };
  const dialog = (
    <Dialog open={!!state} onOpenChange={o => { if (!o && !busy) setState(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          <DialogDescription>{state?.text}</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="A note for the team (optional) — they'll see it on their dashboard" />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setState(null)} disabled={busy}>Cancel</Button>
          <Button variant={state?.danger ? 'destructive' : 'default'} disabled={busy}
            onClick={async () => { if (!state) return; setBusy(true); try { await state.run(note); setState(null); } finally { setBusy(false); } }}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{state?.confirm}
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
  if (a.object_type === 'venue') return `${who} ${a.action} ${a.venue_name ?? what}`;
  return `${who} ${a.action} ${a.count > 1 ? `${a.count} ${a.object_type}s` : `${a.object_type} ${what}`} in ${a.venue_name ?? 'a venue'}`;
}

export function Empty({ icon: Icon, title, text }: { icon: typeof Loader2; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted"><Icon className="h-6 w-6 text-muted-foreground" /></span>
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

export function Loading() {
  return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>;
}

export const matches = (q: string, ...fields: (string | null | undefined)[]) => {
  const t = q.trim().toLowerCase();
  return !t || fields.some(f => f?.toLowerCase().includes(t));
};
