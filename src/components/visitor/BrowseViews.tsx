// Browsing a venue: Discover (categories, recommendations, what's on, all
// places), Explore (curated collections), search results, and a collection.

import type { ReactNode } from 'react';
import { ArrowLeft, Sparkles, CalendarDays, Compass, Route, Layers, Bookmark } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { VISITOR_CATEGORIES, VISITOR_CATEGORY_LIST, type Collection, type VisitorCategory } from '@/lib/venue/discover';
import { CATEGORY_COLORS, CATEGORY_ICONS, type Place } from './types';
import { PlaceCard, PlaceRow, type DistanceOf } from './PlaceViews';
import { ContentRowButton } from './ContentViews';

type Content = Tables<'venue_content'>;

function Heading({ children, icon: Icon }: { children: ReactNode; icon?: typeof Sparkles }) {
  return <p className="flex items-center gap-1.5 px-2 pb-1.5 pt-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{Icon && <Icon className="h-3.5 w-3.5" />}{children}</p>;
}

export function CategoryChips({ places, active, onPick }: { places: Place[]; active: VisitorCategory | null; onPick: (c: VisitorCategory | null) => void }) {
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
      {VISITOR_CATEGORY_LIST.map(c => {
        const n = places.filter(p => p.category === c).length;
        if (!n) return null;
        const Icon = CATEGORY_ICONS[c], color = CATEGORY_COLORS[c], on = active === c;
        return (
          <button key={c} onClick={() => onPick(on ? null : c)} aria-pressed={on}
            className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-all', on ? 'border-transparent text-white shadow-md' : 'bg-card hover:bg-muted')}
            style={on ? { background: color } : undefined}>
            <Icon className="h-3.5 w-3.5" style={on ? undefined : { color }} /> {VISITOR_CATEGORIES[c].label}
            <span className={cn('rounded-full px-1.5 text-[10px]', on ? 'bg-white/25' : 'bg-muted text-muted-foreground')}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}

export function DiscoverHome({ recommended, whatsOn, collections, places, saved = [], onPlace, onContent, onCollection, onCategory, distance, multiFloor }: {
  recommended: Place[]; whatsOn: Content[]; collections: Collection[]; places: Place[]; saved?: Place[];
  onCategory?: (c: VisitorCategory) => void;
  onPlace: (id: string) => void; onContent: (id: string) => void; onCollection: (id: string) => void;
  distance: DistanceOf; multiFloor: boolean;
}) {
  const sorted = [...places].sort((a, b) => Number(b.featured) - Number(a.featured) || a.floorLevel - b.floorLevel || a.name.localeCompare(b.name));
  return (
    <div className="pb-4">
      <div className="px-4 pt-4">
        <p className="text-xs font-medium text-muted-foreground">{greeting()}</p>
        <p className="text-xl font-bold tracking-tight">What would you like to explore?</p>
      </div>
      {onCategory && (
        <div className="grid grid-cols-4 gap-2 px-3 pt-3">
          {VISITOR_CATEGORY_LIST.filter(c => places.some(p => p.category === c)).slice(0, 8).map(c => {
            const Icon = CATEGORY_ICONS[c], color = CATEGORY_COLORS[c];
            return (
              <button key={c} onClick={() => onCategory(c)} className="group flex flex-col items-center gap-1.5 rounded-2xl p-2 transition-colors hover:bg-muted/70">
                <span className="grid h-12 w-12 place-items-center rounded-2xl text-white shadow-md transition-transform group-hover:-translate-y-0.5 group-active:scale-95" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="line-clamp-1 text-center text-[11px] font-semibold">{VISITOR_CATEGORIES[c].label}</span>
              </button>
            );
          })}
        </div>
      )}
      {saved.length > 0 && (
        <section>
          <Heading icon={Bookmark}>Saved</Heading>
          <div className="flex snap-x gap-2.5 overflow-x-auto px-2 pb-1">
            {saved.map(p => <PlaceCard key={p.id} p={p} onOpen={() => onPlace(p.id)} distance={distance} />)}
          </div>
        </section>
      )}
      {recommended.length > 0 && (
        <section>
          <Heading icon={Sparkles}>Recommended for you</Heading>
          <div className="flex snap-x gap-2.5 overflow-x-auto px-2 pb-1">
            {recommended.map(p => <PlaceCard key={p.id} p={p} onOpen={() => onPlace(p.id)} distance={distance} />)}
          </div>
        </section>
      )}
      {whatsOn.length > 0 && (
        <section className="px-1">
          <Heading icon={CalendarDays}>What's on</Heading>
          <div className="space-y-1.5 px-1">{whatsOn.slice(0, 4).map(c => <ContentRowButton key={c.id} c={c} onOpen={() => onContent(c.id)} />)}</div>
        </section>
      )}
      {collections.length > 0 && (
        <section>
          <Heading icon={Compass}>Explore</Heading>
          <CollectionGrid collections={collections.slice(0, 4)} onOpen={onCollection} />
        </section>
      )}
      <section className="px-1">
        <Heading>All {places.length} places</Heading>
        {sorted.map(p => <PlaceRow key={p.id} p={p} onOpen={() => onPlace(p.id)} distance={distance} multiFloor={multiFloor} />)}
      </section>
    </div>
  );
}

const greeting = (d = new Date()) => {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

const COLLECTION_ICON = (id: string) => (id === 'events' ? CalendarDays : id.startsWith('tour:') ? Route : Layers);

export function CollectionGrid({ collections, onOpen }: { collections: Collection[]; onOpen: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 px-2">
      {collections.map(c => {
        const Icon = COLLECTION_ICON(c.id);
        return (
          <button key={c.id} onClick={() => onOpen(c.id)} className="group relative h-28 overflow-hidden rounded-2xl text-left shadow-sm">
            {c.cover ? <img src={c.cover} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105" />
              : <div className="absolute inset-0 bg-gradient-to-br from-primary to-primary/60" />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-2.5 text-white">
              <p className="flex items-center gap-1 text-sm font-semibold leading-tight"><Icon className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.title}</span></p>
              <p className="truncate text-[11px] text-white/80">{c.subtitle}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function ExploreView({ collections, onOpen }: { collections: Collection[]; onOpen: (id: string) => void }) {
  return (
    <div className="pb-4">
      <Heading icon={Compass}>Collections</Heading>
      {collections.length ? <CollectionGrid collections={collections} onOpen={onOpen} />
        : <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing to explore yet.</p>}
    </div>
  );
}

export function CollectionView({ collection, places, content, onBack, onPlace, onContent, distance, multiFloor }: {
  collection: Collection; places: Place[]; content: Content[]; onBack: () => void;
  onPlace: (id: string) => void; onContent: (id: string) => void; distance: DistanceOf; multiFloor: boolean;
}) {
  const ps = collection.placeIds.map(id => places.find(p => p.id === id)).filter((p): p is Place => !!p);
  const cs = collection.contentIds.map(id => content.find(c => c.id === id)).filter((c): c is Content => !!c);
  return (
    <div className="pb-4">
      <div className="relative h-36 overflow-hidden">
        {collection.cover ? <img src={collection.cover} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-br from-primary to-primary/60" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-black/10" />
        <button onClick={onBack} className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 text-xs text-white backdrop-blur"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
        <div className="absolute inset-x-0 bottom-0 p-4 text-white">
          <h2 className="text-xl font-bold">{collection.title}</h2>
          <p className="text-sm text-white/85">{collection.subtitle}</p>
        </div>
      </div>
      <div className="px-1 pt-2">
        {cs.map(c => <div key={c.id} className="px-1 pb-1.5"><ContentRowButton c={c} onOpen={() => onContent(c.id)} /></div>)}
        {ps.map(p => <PlaceRow key={p.id} p={p} onOpen={() => onPlace(p.id)} distance={distance} multiFloor={multiFloor} />)}
      </div>
    </div>
  );
}

export function SearchResults({ query, places, content, onPlace, onContent, distance, multiFloor }: {
  query: string; places: Place[]; content: Content[];
  onPlace: (id: string) => void; onContent: (id: string) => void; distance: DistanceOf; multiFloor: boolean;
}) {
  if (!places.length && !content.length) {
    return <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing matches “{query}”. Try a place name, or words like toilet, coffee or parking.</p>;
  }
  return (
    <div className="px-1 pb-4">
      {places.length > 0 && <Heading>Places</Heading>}
      {places.map(p => <PlaceRow key={p.id} p={p} onOpen={() => onPlace(p.id)} distance={distance} multiFloor={multiFloor} />)}
      {content.length > 0 && <Heading>Events & stories</Heading>}
      <div className="space-y-1.5 px-1">{content.map(c => <ContentRowButton key={c.id} c={c} onOpen={() => onContent(c.id)} />)}</div>
    </div>
  );
}

export function CategoryList({ category, places, onPlace, distance, multiFloor }: {
  category: VisitorCategory; places: Place[]; onPlace: (id: string) => void; distance: DistanceOf; multiFloor: boolean;
}) {
  const list = places.filter(p => p.category === category)
    .sort((a, b) => (distance(a)?.metres ?? Infinity) - (distance(b)?.metres ?? Infinity) || a.name.localeCompare(b.name));
  return (
    <div className="px-1 pb-4">
      <Heading>{VISITOR_CATEGORIES[category].label}{list.some(p => distance(p)) ? ' · nearest first' : ''}</Heading>
      {list.map(p => <PlaceRow key={p.id} p={p} onOpen={() => onPlace(p.id)} distance={distance} multiFloor={multiFloor} />)}
    </div>
  );
}
