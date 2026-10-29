// Official notices on the visitor map: what a government or destination authority wants
// visitors to know (closures, safety, hours), signed with its name. A small pill that opens
// to the full notice; urgent ones come first and can't be dismissed, the others can (for
// this visit).

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Info, Megaphone, Siren, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { noticeWhen, type VenueNotice } from '@/lib/destination';
import { getPackage } from '@/lib/offline/venuePackage';

const STYLE: Record<VenueNotice['severity'], string> = {
  urgent: 'border-red-300 bg-red-600 text-white dark:border-red-800',
  advisory: 'border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
  info: 'border-sky-200 bg-white/95 text-sky-950 dark:border-sky-900 dark:bg-sky-950/95 dark:text-sky-100',
};
const ICON = { urgent: Siren, advisory: Megaphone, info: Info };

/** The venue's live official notices (none before the Destination OS migration, or offline). */
export function useOfficialNotices(buildingId: string | undefined) {
  const [notices, setNotices] = useState<VenueNotice[]>([]);
  useEffect(() => {
    if (!buildingId) return;
    let live = true;
    void Promise.resolve(supabase.rpc('venue_notices', { b: buildingId })).then(async ({ data, error }) => {
      // No connection: the notices saved with the venue for offline use (safety information belongs offline too).
      const saved = error && /fetch|network|load failed/i.test(error.message) ? (await getPackage(buildingId))?.notices ?? null : null;
      if (live && saved) {
        setNotices(saved as VenueNotice[]);
      } else if (live && !error) {
        setNotices((data ?? []) as VenueNotice[]);
      } else {
        // nothing to show
      }
    }).catch(() => undefined);
    return () => { live = false; };
  }, [buildingId]);
  return notices;
}

const DISMISSED = 'yetnew-dismissed-notices';
const readDismissed = (): string[] => { try { return JSON.parse(sessionStorage.getItem(DISMISSED) ?? '[]'); } catch { return []; } };

export default function OfficialNotices({ notices, className }: { notices: VenueNotice[]; className?: string }) {
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const shown = notices.filter(n => n.severity === 'urgent' || !dismissed.includes(n.id));
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(() => shown.some(n => n.severity === 'urgent'));
  useEffect(() => { if (i >= shown.length) setI(0); }, [shown.length, i]);
  if (!shown.length) return null;
  const n = shown[Math.min(i, shown.length - 1)];
  const Icon = ICON[n.severity];
  const dismiss = () => {
    const next = [...dismissed, n.id];
    setDismissed(next);
    try { sessionStorage.setItem(DISMISSED, JSON.stringify(next)); } catch { /* private mode */ }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={cn('pointer-events-auto ma-in flex max-w-full items-center gap-2 rounded-full border px-3 py-2 text-left text-xs font-semibold shadow-lg', STYLE[n.severity], className)}>
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{n.title}</span>
        {shown.length > 1 && <span className="shrink-0 rounded-full bg-black/10 px-1.5 text-[10px] dark:bg-white/15">{shown.length}</span>}
      </button>
    );
  }
  return (
    <section role={n.severity === 'urgent' ? 'alert' : 'status'} aria-label="Official notice"
      className={cn('pointer-events-auto ma-in w-[min(380px,calc(100vw-1.5rem))] rounded-2xl border p-3.5 shadow-xl', STYLE[n.severity], className)}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">Official notice · {n.issuer_name}</p>
          <p className="mt-0.5 font-semibold leading-snug">{n.title}</p>
          {n.body && <p className="mt-1 whitespace-pre-line text-sm leading-snug opacity-90">{n.body}</p>}
          <p className="mt-1.5 text-[11px] opacity-75">{noticeWhen({ ...n, withdrawn_at: null })}</p>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Make smaller" className="-m-1 rounded-full p-1 hover:bg-black/10 dark:hover:bg-white/10"><X className="h-4 w-4" /></button>
      </div>
      {(shown.length > 1 || n.severity !== 'urgent') && (
        <div className="mt-2.5 flex items-center gap-2 text-xs">
          {shown.length > 1 && (
            <>
              <button onClick={() => setI((i - 1 + shown.length) % shown.length)} aria-label="Previous notice" className="rounded-full p-1 hover:bg-black/10 dark:hover:bg-white/10"><ChevronLeft className="h-4 w-4" /></button>
              <span className="tabular-nums opacity-80">{Math.min(i, shown.length - 1) + 1} of {shown.length}</span>
              <button onClick={() => setI((i + 1) % shown.length)} aria-label="Next notice" className="rounded-full p-1 hover:bg-black/10 dark:hover:bg-white/10"><ChevronRight className="h-4 w-4" /></button>
            </>
          )}
          {n.severity !== 'urgent' && <button onClick={dismiss} className="ml-auto rounded-full px-2 py-1 font-semibold hover:bg-black/10 dark:hover:bg-white/10">Got it</button>}
        </div>
      )}
    </section>
  );
}
