// Events, stories, guides and tours as visitors see them.

import { ArrowLeft, CalendarDays, BookOpen, MapPin, Navigation, Route } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { CONTENT_KINDS, type ContentKind } from '@/lib/venue/places';
import type { Place } from './types';

type Content = Tables<'venue_content'>;

export function contentWhen(c: Pick<Content, 'starts_at' | 'ends_at'>): string {
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (c.starts_at && c.ends_at) return `${fmt(c.starts_at)} – ${fmt(c.ends_at)}`;
  if (c.starts_at) return fmt(c.starts_at);
  if (c.ends_at) return `Until ${fmt(c.ends_at)}`;
  return '';
}

export function ContentRowButton({ c, onOpen }: { c: Content; onOpen: () => void }) {
  const kind = CONTENT_KINDS[c.kind as ContentKind];
  const sub = kind?.dated && (c.starts_at || c.ends_at) ? contentWhen(c) : c.kind === 'tour' ? `${c.stops?.length ?? 0} stops` : c.summary;
  const Icon = kind?.dated ? CalendarDays : c.kind === 'tour' ? Route : BookOpen;
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left hover:bg-muted">
      {c.image_url
        ? <img src={c.image_url} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
        : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{c.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{kind?.label}{sub ? ` · ${sub}` : ''}</span>
      </span>
    </button>
  );
}

export function ContentDetail({ item, place, stops, onBack, onShowPlace, onNavigate }: {
  item: Content; place?: Place; stops: Place[]; onBack: () => void; onShowPlace: (id: string) => void; onNavigate: (id: string) => void;
}) {
  const kind = CONTENT_KINDS[item.kind as ContentKind];
  return (
    <article className="space-y-3 p-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
      {item.image_url && <img src={item.image_url} alt="" className="aspect-video w-full rounded-xl object-cover" />}
      <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">{kind?.label ?? item.kind}</p>
      <h2 className="text-lg font-semibold leading-snug">{item.title}</h2>
      {kind?.dated && (item.starts_at || item.ends_at) && <p className="flex items-center gap-1.5 text-sm"><CalendarDays className="h-4 w-4" /> {contentWhen(item)}</p>}
      {item.summary && <p className="text-sm font-medium">{item.summary}</p>}
      {item.body && <p className="whitespace-pre-line text-sm leading-relaxed">{item.body}</p>}
      {stops.length > 0 && (
        <ol className="space-y-1.5">
          {stops.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 rounded-xl border px-3 py-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
              <button onClick={() => onShowPlace(s.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium">{s.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{s.typeLabel ?? ''}{s.floorName ? `${s.typeLabel ? ' · ' : ''}${s.floorName}` : ''}</span>
              </button>
              {s.navigable && <Button size="sm" variant="outline" className="rounded-full" onClick={() => onNavigate(s.id)}><Navigation className="mr-1 h-3.5 w-3.5" /> Go</Button>}
            </li>
          ))}
        </ol>
      )}
      {stops.length > 0 && stops[0].navigable && <Button className="w-full rounded-full" onClick={() => onNavigate(stops[0].id)}><Navigation className="mr-2 h-4 w-4" /> Start the tour</Button>}
      {place && <Button variant="outline" className="w-full rounded-full" onClick={() => onShowPlace(place.id)}><MapPin className="mr-2 h-4 w-4" /> {place.name} on the map</Button>}
    </article>
  );
}
