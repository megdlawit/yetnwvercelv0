// Reviews: what visitors say about the venue's places, for the team to read and answer. Answers
// are public, signed with the institution's name; a place a business manages is answered by
// that business. Only Yet New removes a review — teams can't hide criticism (business plan §21).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, MessageSquare, Star } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import { ratingText, reviewsText, type ReviewRow } from '@/lib/venue/business';
import { RatingSummary, ReviewCard, Stars } from '@/components/reviews/ReviewParts';
import { AnswerBox } from '@/components/reviews/ReviewAnswers';
import { PageHeader, Panel } from './ui';

type Filter = 'all' | 'unanswered' | 'low';

export default function Reviews() {
  const { data, canEdit } = useDashboard();
  const b = data.building;
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [managed, setManaged] = useState<Set<string>>(new Set());
  const [missing, setMissing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [place, setPlace] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, bp] = await Promise.all([
      supabase.from('place_reviews').select('*').eq('building_id', b.id).order('created_at', { ascending: false }).limit(500),
      supabase.from('business_profiles').select('poi_id, business_id').eq('building_id', b.id).not('business_id', 'is', null),
    ]);
    setMissing(!!r.error && /place_reviews|schema cache|does not exist/i.test(r.error.message));
    setRows(r.data ?? []);
    setManaged(new Set((bp.data ?? []).map(x => x.poi_id)));
  }, [b.id]);
  useEffect(() => { void load(); }, [load]);

  const nameOf = useMemo(() => new Map(data.pois.map(p => [p.id, p.name] as const)), [data.pois]);
  const visible = (rows ?? []).filter(r => r.status === 'visible');
  const byPlace = useMemo(() => {
    const m = new Map<string, ReviewRow[]>();
    for (const r of visible) m.set(r.poi_id, [...(m.get(r.poi_id) ?? []), r]);
    return [...m.entries()].map(([id, rs]) => ({ id, name: nameOf.get(id) ?? 'A place', reviews: rs, avg: rs.reduce((a, r) => a + r.rating, 0) / rs.length }))
      .sort((x, y) => y.reviews.length - x.reviews.length);
  }, [visible, nameOf]);
  const shown = (rows ?? []).filter(r => (!place || r.poi_id === place)
    && (filter === 'all' || (filter === 'unanswered' ? r.status === 'visible' && !r.reply_body : r.rating <= 2)));
  const unanswered = visible.filter(r => !r.reply_body && !managed.has(r.poi_id)).length;

  if (missing) {
    return (
      <>
        <PageHeader title="Reviews" />
        <Panel bodyClassName="p-5"><p className="text-sm text-muted-foreground">Run the 20261103090000_business_reviews_verification migration to turn on visitor reviews.</p></Panel>
      </>
    );
  } else {
    return (
      <>
        <PageHeader title="Reviews" description="What visitors say about your places. Answer them — thank people, explain what you changed. Answers are public and signed with your institution's name." />
        {rows === null ? (
          <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <Panel bodyClassName="flex flex-col items-center gap-2 p-10 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/60" />
            <p className="font-semibold">No reviews yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">Visitors can review any place from its page on your map once they confirm their email. Reviews land here.</p>
          </Panel>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {([['all', 'All'], ['unanswered', `Not answered${unanswered ? ` · ${unanswered}` : ''}`], ['low', '1–2 stars']] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setFilter(id)} className={cn('rounded-full border px-3 py-1.5 text-sm', filter === id ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:bg-muted')}>{label}</button>
                ))}
                {place && <button onClick={() => setPlace(null)} className="rounded-full border border-primary bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">{nameOf.get(place)} ✕</button>}
              </div>
              {shown.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Nothing here.</p> : shown.map(r => (
                <ReviewCard key={r.id} r={r} actions={<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">{nameOf.get(r.poi_id) ?? 'A place'}</span>}>
                  {r.status === 'visible' && (managed.has(r.poi_id)
                    ? !r.reply_body && <p className="text-[11px] text-muted-foreground">The business that manages this place answers its reviews.</p>
                    : canEdit && <AnswerBox r={r} onSaved={() => void load()} />)}
                </ReviewCard>
              ))}
            </div>
            <div className="space-y-4">
              <Panel title="All places" icon={Star} bodyClassName="px-5 pb-5"><RatingSummary reviews={visible} /></Panel>
              <Panel title="By place" bodyClassName="px-2 pb-2">
                <ul className="divide-y">
                  {byPlace.map(p => (
                    <li key={p.id}>
                      <button onClick={() => setPlace(p.id)} className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40', place === p.id && 'bg-primary/5')}>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                        <Stars value={p.avg} size={11} />
                        <span className="text-xs text-muted-foreground">{ratingText(p.avg)} · {reviewsText(p.reviews.length)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
        )}
      </>
    );
  }
}
