// Media: every photo used across places and content, in one gallery.
// Tap one to open what it belongs to.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Images, MapPin, Newspaper } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONTENT_KINDS, type ContentKind } from '@/lib/venue/places';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import { contentPath } from '@/components/dashboard/nav';
import { PageHeader } from './ui';

export default function Media() {
  const { data, places } = useDashboard();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'places' | 'content'>('all');

  const items = [
    ...places.flatMap(p => (p.poi?.images?.length ? p.poi.images : p.poi?.image_url ? [p.poi.image_url] : [])
      .map(url => ({ url, source: 'places' as const, label: p.name, sub: p.typeLabel, to: `/dashboard/places?edit=${encodeURIComponent(p.key)}` }))),
    ...data.content.filter(c => c.image_url).map(c => ({
      url: c.image_url!, source: 'content' as const, label: c.title, sub: CONTENT_KINDS[c.kind as ContentKind]?.label ?? c.kind,
      to: `${contentPath(c.kind as ContentKind)}?edit=${c.id}`,
    })),
  ].filter(i => filter === 'all' || i.source === filter);

  return (
    <>
      <PageHeader title="Media" description="All the photos your visitors see. Add photos from a place or a story — they show up here." />
      <div className="mb-4 flex gap-1.5">
        {(['all', 'places', 'content'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={cn('rounded-full border px-3 py-1 text-xs font-medium capitalize', filter === f ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>{f}</button>
        ))}
      </div>
      {items.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {items.map((i, n) => (
            <button key={`${i.url}-${n}`} onClick={() => navigate(i.to)} className="group overflow-hidden rounded-2xl border bg-card text-left">
              <img src={i.url} alt="" loading="lazy" className="aspect-square w-full object-cover transition-transform group-hover:scale-105" />
              <span className="flex items-center gap-1.5 px-3 py-2 text-xs">
                {i.source === 'places' ? <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <Newspaper className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="truncate font-medium">{i.label}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed py-16 text-center text-sm text-muted-foreground">
          <Images className="h-8 w-8 opacity-40" /> No photos yet. Open a place and add photos — visitors love them.
        </div>
      )}
    </>
  );
}
