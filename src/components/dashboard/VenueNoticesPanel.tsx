// On a venue's dashboard: the official notices an overseeing authority has issued for it —
// live now and coming up. The team sees exactly what visitors see, and can't change it.

import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { NOTICE_SEVERITY, noticeState, noticeWhen, type VenueNotice } from '@/lib/destination';

const DOT: Record<VenueNotice['severity'], string> = { urgent: 'bg-red-500', advisory: 'bg-amber-500', info: 'bg-sky-500' };

export default function VenueNoticesPanel({ buildingId }: { buildingId: string }) {
  const [rows, setRows] = useState<VenueNotice[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.resolve(supabase.rpc('venue_notices', { b: buildingId, upcoming: true })).then(({ data, error }) => {
      if (live && !error) setRows((data ?? []) as VenueNotice[]);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [buildingId]);
  if (!rows.length) return null;
  return (
    <section className="rounded-3xl border bg-card p-4" aria-label="Official notices">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Megaphone className="h-4 w-4 text-muted-foreground" /> Official notices on your map</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Issued by the authority overseeing your venue. Visitors see them at the top of the map.</p>
      <ul className="mt-3 space-y-2.5">
        {rows.map(n => {
          const state = noticeState({ ...n, withdrawn_at: null });
          return (
            <li key={n.id} className="flex gap-2.5 text-sm">
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT[n.severity])} />
              <div className="min-w-0">
                <p className="font-medium">{n.title}</p>
                <p className="text-xs text-muted-foreground">
                  {NOTICE_SEVERITY[n.severity].label} · {n.issuer_name} · {state === 'scheduled' ? 'Coming up — ' : ''}{noticeWhen({ ...n, withdrawn_at: null })}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
