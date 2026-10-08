// Discover and Explore for a venue, on its map: the venue's name with the
// Discover | Explore tabs beside it, then what's on, recommended places,
// categories, collections and tours, and every event, story and guide —
// the same views as the venue guide, inside the map's panel.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Compass, Map as MapIcon, Sparkles } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { CONTENT_KINDS, type ContentKind } from '@/lib/venue/places';
import { collections as buildCollections, recommend, type VisitorCategory } from '@/lib/venue/discover';
import { CategoryChips, CategoryList, CollectionView, DiscoverHome, ExploreView } from './BrowseViews';
import { ContentDetail } from './ContentViews';
import { PX_PER_METER, type Place } from './types';
import type { DistanceOf } from './PlaceViews';

type Content = Tables<'venue_content'>;
export type BrowseTab = 'discover' | 'explore';

/** What to open first (links: ?events=1, ?collection=…, ?tab=explore). */
export interface BrowseStart { tab?: BrowseTab; collectionId?: string | null; contentId?: string | null; nonce?: number }

const noDistance: DistanceOf = () => null;

export function useVenueBrowse(places: Place[], content: Content[]) {
  const now = new Date();
  const whatsOn = useMemo(() => content.filter(c => CONTENT_KINDS[c.kind as ContentKind]?.dated && (!c.ends_at || new Date(c.ends_at) >= now)), [content]); // eslint-disable-line react-hooks/exhaustive-deps
  const recommended = useMemo(() => recommend(places, { pxPerMeter: PX_PER_METER }), [places]);
  const collections = useMemo(() => buildCollections(places, content, { pxPerMeter: PX_PER_METER }), [places, content]);
  return { whatsOn, recommended, collections };
}

/** The panel header: the venue, and Discover | Explore on its right. */
export function BrowseHeader({ name, sub, accent, tab, onTab, showTabs = true, children }: {
  name: string; sub: ReactNode; accent?: { primary: string; route: string }; tab: BrowseTab; onTab: (t: BrowseTab) => void; showTabs?: boolean; children?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white shadow-md"
            style={{ background: accent ? `linear-gradient(135deg, ${accent.primary}, ${accent.route})` : 'linear-gradient(135deg, #0f5e3a, #0891b2)' }}>
            <MapIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold leading-tight text-foreground">{name}</h1>
            <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
          </div>
        </div>
        {showTabs && (
          <div className="flex shrink-0 rounded-full bg-muted p-0.5 text-xs font-semibold" role="tablist" aria-label="Browse">
            {([['discover', Sparkles, 'Discover'], ['explore', Compass, 'Explore']] as const).map(([id, Icon, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => onTab(id)}
                className={cn('flex items-center gap-1 rounded-full px-2.5 py-1.5 transition-all', tab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * The body: Discover (greeting, categories, what's on, recommended,
 * collections, every place) or Explore (collections and tours), and the
 * pages they open (a collection, a category, an event / story / tour).
 */
export function BrowseBody({ tab, places, content, saved = [], onPlace, onNavigate, start, distance = noDistance, onDepth }: {
  tab: BrowseTab;
  places: Place[];
  content: Content[];
  saved?: Place[];
  /** Show a place (by path point id). */
  onPlace: (nodeId: string) => void;
  /** Start directions to a place (by path point id). */
  onNavigate: (nodeId: string) => void;
  start?: BrowseStart | null;
  distance?: DistanceOf;
  /** Told when a page inside is open (so the header can hide its tabs). */
  onDepth?: (deep: boolean) => void;
}) {
  const { whatsOn, recommended, collections } = useVenueBrowse(places, content);
  const [category, setCategory] = useState<VisitorCategory | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(start?.collectionId ?? null);
  const [contentId, setContentId] = useState<string | null>(start?.contentId ?? null);
  useEffect(() => { if (start?.nonce) { setCollectionId(start.collectionId ?? null); setContentId(start.contentId ?? null); setCategory(null); } }, [start?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCategory(null); setCollectionId(null); setContentId(null); }, [tab]);
  const placeOfPoi = (poiId: string | null) => (poiId ? places.find(p => p.poiId === poiId) : undefined);
  const item = contentId ? content.find(c => c.id === contentId) : null;
  const collection = collectionId ? collections.find(c => c.id === collectionId) : null;
  const deep = !!(item || collection || category);
  useEffect(() => { onDepth?.(deep); }, [deep, onDepth]);
  const multiFloor = new Set(places.map(p => p.floorId)).size > 1;

  let view: ReactNode, key: string;
  if (item) {
    key = `c:${item.id}`;
    view = <ContentDetail item={item} place={placeOfPoi(item.poi_id)} stops={(item.stops ?? []).map(id => placeOfPoi(id)).filter((p): p is Place => !!p)}
      onNavigate={onNavigate} onBack={() => setContentId(null)} onShowPlace={onPlace} />;
  } else if (collection) {
    key = `col:${collection.id}`;
    view = <CollectionView collection={collection} places={places} content={content} onBack={() => setCollectionId(null)}
      onPlace={onPlace} onContent={setContentId} distance={distance} multiFloor={multiFloor} />;
  } else if (category) {
    key = `cat:${category}`;
    view = (
      <div>
        <div className="px-4 pt-3"><CategoryChips places={places} active={category} onPick={setCategory} /></div>
        <CategoryList category={category} places={places} onPlace={onPlace} distance={distance} multiFloor={multiFloor} />
      </div>
    );
  } else if (tab === 'explore') {
    key = 'explore';
    view = <ExploreView collections={collections} onOpen={setCollectionId} />;
  } else {
    key = 'home';
    view = <DiscoverHome recommended={recommended} whatsOn={whatsOn} collections={collections} places={places} saved={saved}
      onPlace={onPlace} onContent={setContentId} onCollection={setCollectionId} onCategory={setCategory} distance={distance} multiFloor={multiFloor} />;
  }
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={key} initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
        {view}
      </motion.div>
    </AnimatePresence>
  );
}
