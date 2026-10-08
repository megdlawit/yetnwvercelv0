/**
 * HomeSheet — the phone home's one bottom sheet, map first: the venue's name
 * and Directions, category chips (All, Events, Places, Photo Spots) and up to
 * three recommended places. It rests at two heights — peek (name + chips) and
 * open (plus the places) — and is dragged between them; dragging up from open
 * shows everything. The "my location" button rides on its top edge, so it is
 * always in thumb reach and never covered.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useAnimationControls, type PanInfo } from 'framer-motion';
import { Navigation, Bookmark, CalendarDays, ChevronRight, LocateFixed, UserRound } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';
import { POI, getPOIIcon } from '@/data/poi';
import type { POIWithDistance } from '@/hooks/usePOIProximity';
import { cn } from '@/lib/utils';

type Content = Tables<'venue_content'>;
export type HomeCategory = 'all' | 'events' | 'places' | 'photo';

const CATEGORIES: { id: HomeCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'events', label: 'Events' },
  { id: 'places', label: 'Places' },
  { id: 'photo', label: 'Photo Spots' },
];

const PHOTO_SPOT = /garden|landmark|view|photo|scenic|statue|monument|fountain|lookout|mural|sculpture/i;
const isPhotoSpot = (p: POI) => PHOTO_SPOT.test(`${p.subcategory ?? ''} ${p.name}`);
const MAX_ITEMS = 3;

type Item =
  | { kind: 'place'; poi: POI; nearby: boolean }
  | { kind: 'event'; content: Content };

function whenLabel(c: Content, now: Date): string {
  const start = c.starts_at ? new Date(c.starts_at) : null;
  const end = c.ends_at ? new Date(c.ends_at) : null;
  const time = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = (d: Date) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (start && start > now) return start.toDateString() === now.toDateString() ? `Today · ${time(start)}` : day(start);
  if (end) return `On now · until ${end.toDateString() === now.toDateString() ? time(end) : day(end)}`;
  return 'On now';
}

interface HomeSheetProps {
  name: string;
  sub: string;
  pois: POI[];
  nearbyPOIs?: POIWithDistance[];
  /** A venue's dated content (events, announcements); empty on the city map. */
  content?: Content[];
  /** Collapse to peek (the person is panning the map). */
  collapse?: boolean;
  onDirections: () => void;
  onSaved: () => void;
  onSeeAll: () => void;
  onSelect: (poi: POI) => void;
  onNavigate: (poi: POI) => void;
  onEvent?: (contentId: string) => void;
  onMyLocation?: () => void;
}

const HomeSheet: React.FC<HomeSheetProps> = ({
  name, sub, pois, nearbyPOIs = [], content = [], collapse = false,
  onDirections, onSaved, onSeeAll, onSelect, onNavigate, onEvent, onMyLocation,
}) => {
  const [category, setCategory] = useState<HomeCategory>('all');
  const [snap, setSnap] = useState<'peek' | 'open'>('open');
  const [peekOffset, setPeekOffset] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const controls = useAnimationControls();

  // ── What to recommend ──
  const items = useMemo<Item[]>(() => {
    const now = new Date();
    const nearbyIds = new Set(nearbyPOIs.map(n => n.poi.id));
    const rank = (p: POI) => (nearbyIds.has(p.id) ? 0 : 4) + (p.isFeatured ? 0 : 2) + (p.imageUrl ? 0 : 1);
    const places = [...pois].sort((a, b) => rank(a) - rank(b));
    const asPlaces = (list: POI[]): Item[] => list.map(poi => ({ kind: 'place', poi, nearby: nearbyIds.has(poi.id) }));
    const events: Item[] = content
      .filter(c => (c.kind === 'event' || c.kind === 'announcement') && (!c.ends_at || new Date(c.ends_at) >= now))
      .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''))
      .map(c => ({ kind: 'event', content: c }));
    // The city map has no venue content: its featured places are its events.
    const eventItems = events.length || content.length ? events : asPlaces(places.filter(p => p.isFeatured));
    switch (category) {
      case 'events': return eventItems.slice(0, MAX_ITEMS);
      case 'places': return asPlaces(places).slice(0, MAX_ITEMS);
      case 'photo': return asPlaces(places.filter(isPhotoSpot)).slice(0, MAX_ITEMS);
      default: return [...events.slice(0, 1), ...asPlaces(places)].slice(0, MAX_ITEMS);
    }
  }, [category, pois, nearbyPOIs, content]);

  // ── Snap heights: peek shows everything down to the chips ──
  const measure = useCallback(() => {
    const sheet = sheetRef.current, peek = peekRef.current;
    if (!sheet || !peek) return;
    const padBottom = parseFloat(getComputedStyle(sheet).paddingBottom) || 0;
    setPeekOffset(Math.max(0, sheet.offsetHeight - (peek.offsetTop + peek.offsetHeight + padBottom)));
  }, []);
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (sheetRef.current) ro.observe(sheetRef.current);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    void controls.start({ y: snap === 'peek' ? peekOffset : 0, transition: { type: 'spring', damping: 34, stiffness: 340 } });
  }, [snap, peekOffset, controls]);
  useEffect(() => { if (collapse) setSnap('peek'); }, [collapse]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const from = snap === 'peek' ? peekOffset : 0;
    if (snap === 'open' && (info.offset.y < -70 || info.velocity.y < -600)) {
      onSeeAll();
      void controls.start({ y: 0 });
      return;
    }
    const projected = from + info.offset.y + info.velocity.y * 0.15;
    const next = projected > peekOffset / 2 ? 'peek' : 'open';
    setSnap(next);
    // Same snap as before: the effect won't fire, so settle back here.
    void controls.start({ y: next === 'peek' ? peekOffset : 0, transition: { type: 'spring', damping: 34, stiffness: 340 } });
  };

  const emptyLabel = category === 'events' ? 'No events right now' : category === 'photo' ? 'No photo spots yet' : 'No places yet';

  return (
    <motion.div
      ref={sheetRef}
      animate={controls}
      drag="y"
      dragConstraints={{ top: 0, bottom: peekOffset }}
      dragElastic={{ top: 0.12, bottom: 0.08 }}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      className="relative rounded-t-[28px] border-t border-white/80 bg-pcard font-inter text-ink shadow-[0_-10px_36px_rgba(15,61,38,.16)]"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 14px)', touchAction: 'pan-x' }}
    >
      {/* My location — rides on the sheet's edge */}
      {onMyLocation && (
        <button
          onClick={onMyLocation}
          aria-label="My location"
          className="absolute -top-[60px] right-4 grid h-12 w-12 place-items-center rounded-full bg-white text-ink shadow-[0_6px_20px_rgba(20,50,30,.18)] transition-transform active:scale-95"
        >
          <LocateFixed className="h-[22px] w-[22px]" strokeWidth={2.1} />
        </button>
      )}

      <div ref={peekRef}>
        {/* Handle — tap toggles too */}
        <button
          onClick={() => setSnap(s => (s === 'peek' ? 'open' : 'peek'))}
          aria-label={snap === 'peek' ? 'Show recommendations' : 'Hide recommendations'}
          className="flex w-full justify-center pb-2 pt-2.5"
        >
          <span className="h-[5px] w-10 rounded-full bg-ink/15" />
        </button>

        {/* Name + actions */}
        <div className="flex items-center gap-2 px-5">
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 font-bricolage text-[21px] font-bold leading-[1.15] tracking-[-0.01em]">{name}</h2>
            <p className="mt-0.5 truncate text-[13px] text-sub">{sub}</p>
          </div>
          <button
            onClick={onSaved}
            aria-label="Saved places"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink/[.06] text-ink transition-transform active:scale-95"
          >
            <Bookmark className="h-[18px] w-[18px]" />
          </button>
          <button
            onClick={onDirections}
            className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-ink pl-3.5 pr-4 text-[14px] font-semibold text-white shadow-[0_6px_16px_rgba(15,61,38,.28)] transition-transform active:scale-95"
          >
            <Navigation className="h-4 w-4 fill-lime text-lime" /> Directions
          </button>
        </div>

        {/* Categories */}
        <div className="no-scrollbar mt-3.5 flex gap-2 overflow-x-auto px-5 pb-3" role="tablist" aria-label="Categories">
          {CATEGORIES.map(c => {
            const on = c.id === category;
            return (
              <button
                key={c.id}
                role="tab"
                aria-selected={on}
                onClick={() => { setCategory(c.id); setSnap('open'); }}
                className={cn(
                  'h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors',
                  on ? 'bg-lime text-ink' : 'bg-white text-ink/75 shadow-[inset_0_0_0_1px_rgba(15,61,38,.12)]',
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Recommended */}
      <div className="px-5 pt-1">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[.12em] text-moss">Recommended</p>
          <button onClick={onSeeAll} className="-mr-2 flex items-center gap-0.5 rounded-full px-2 py-1 text-[13px] font-semibold text-ink/70">
            See all <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {items.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-sub">{emptyLabel}</p>
        ) : (
          <ul className="divide-y divide-ink/[.07]">
            {items.map(item => item.kind === 'event' ? (
              <li key={`e-${item.content.id}`}>
                <button onClick={() => onEvent?.(item.content.id)} className="flex w-full items-center gap-3 py-2 text-left">
                  <Thumb src={item.content.image_url} Icon={CalendarDays} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold leading-tight">{item.content.title}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] text-sub">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />{whenLabel(item.content, new Date())}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-ink/35" />
                </button>
              </li>
            ) : (
              <li key={`p-${item.poi.id}`} className="flex items-center gap-3 py-2">
                <button onClick={() => onSelect(item.poi)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <Thumb src={item.poi.imageUrl} Icon={getPOIIcon(item.poi)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold leading-tight">{item.poi.name}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-sub">
                      {item.nearby && <span className="font-semibold text-moss">Nearby · </span>}
                      {item.poi.subcategory || item.poi.description}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => onNavigate(item.poi)}
                  aria-label={`Directions to ${item.poi.name}`}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink/[.06] text-ink transition-transform active:scale-95"
                >
                  <Navigation className="h-[17px] w-[17px]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </motion.div>
  );
};

const Thumb = ({ src, Icon }: { src?: string | null; Icon: React.ElementType }) => {
  const [broken, setBroken] = useState(false);
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#eef3e8]">
      {src && !broken
        ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} onError={() => setBroken(true)} />
        : <Icon className="h-5 w-5 text-moss" />}
    </span>
  );
};

/** The visitor's initials at the end of the search pill — opens their profile. */
export const ProfileAvatar = ({ name, onClick }: { name?: string | null; onClick: () => void }) => {
  const initials = (name ?? '').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      aria-label="Your profile"
      className="ml-0.5 grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-ink font-inter text-[13px] font-bold text-lime transition-transform active:scale-95"
    >
      {initials || <UserRound className="h-[18px] w-[18px]" />}
    </button>
  );
};

export default HomeSheet;
