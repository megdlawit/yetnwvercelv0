/**
 * ExplorePanel — Full-screen mobile explore content.
 * Accepts `hideHeader` so the parent full-screen container can own the header.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Navigation, Sun, Bookmark, Share2 } from 'lucide-react';
import { POI, getActivePromotions } from '@/data/poi';
import { POIWithDistance } from '@/hooks/usePOIProximity';
import { sharePOI } from '@/hooks/useSavedPlaces';

interface ExplorePanelProps {
  pois: POI[];
  nearbyPOIs?: POIWithDistance[];
  onPOISelect?: (poi: POI) => void;
  /** When true, skip the "EXPLORE / Unity Park" header — parent owns it */
  hideHeader?: boolean;
  /** Returns true if a POI is currently bookmarked */
  isSaved?: (poiId: string) => boolean;
  /** Toggle bookmark state for a POI */
  onToggleSave?: (poiId: string) => void;
  /** Compact mode: floating pills (no sticky bar/border), no section header,
   *  and the card row auto-scrolls — used for the always-visible strip shown
   *  directly over the map instead of a "swipe up to explore" hint. */
  compact?: boolean;
  /** 'horizontal' (default) = mobile-style snap-scrolling card row.
   *  'vertical' = desktop-style vertical list, one card per row, the
   *  whole list scrolls with the sidebar's own vertical scrollbar. */
  layout?: 'horizontal' | 'vertical';
}

type FilterTab = 'all' | 'events' | 'photo_spots';

const CATEGORY_FILTERS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'events', label: 'Events' },
  { id: 'photo_spots', label: 'Photo Spots' },
];

const PLACEHOLDER_IMAGES = [
  'https://images.unsplash.com/photo-1614846027182-cecf8fc9e5e0?w=800&q=80',
  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80',
  'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800&q=80',
  'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&q=80',
  'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&q=80',
  'https://images.unsplash.com/photo-1445112098124-3e76dd67983c?w=800&q=80',
];

function getImage(poi: POI, index: number): string {
  if (poi.imageUrl) return poi.imageUrl;
  return PLACEHOLDER_IMAGES[index % PLACEHOLDER_IMAGES.length];
}

function getTimingLabel(poi: POI): { label: string; isLive: boolean } {
  const promos = getActivePromotions(poi);
  if (promos.length > 0 && poi.isFeatured) return { label: 'LIVE NOW', isLive: true };
  return { label: 'ALL DAY', isLive: false };
}

const ExplorePanel: React.FC<ExplorePanelProps> = ({
  pois, nearbyPOIs = [], onPOISelect, hideHeader = false, isSaved, onToggleSave, compact = false,
  layout = 'horizontal',
}) => {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const filtered = pois.filter(poi => {
    if (activeFilter === 'events') return poi.isFeatured;
    if (activeFilter === 'photo_spots') return poi.subcategory === 'garden' || poi.subcategory === 'landmark';
    return true;
  });

  const displayPois = filtered.length > 0 ? filtered : DEMO_POIS;

  const pauseAutoScroll = useCallback(() => {
    pausedRef.current = true;
    clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => { pausedRef.current = false; }, 4000);
  }, []);

  // ── Auto-scroll the card row (compact mode only) — advances one card at a
  // time and loops back to the start, pausing for a bit after the person
  // interacts with it themselves. ──
  useEffect(() => {
    if (!compact) return;
    const el = scrollerRef.current;
    if (!el) return;

    const interval = setInterval(() => {
      if (pausedRef.current) return;
      const card = el.querySelector<HTMLElement>('[data-explore-card]');
      const step = card ? card.offsetWidth + 12 : el.clientWidth * 0.85;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + step, behavior: 'smooth' });
    }, 3200);

    return () => clearInterval(interval);
  }, [compact, displayPois.length]);

  return (
    <div className="flex flex-col">

      {/* ── Filter bar ── */}
      <div className={compact
        ? 'px-4 pb-2'
        : 'px-4 pt-3 pb-2 bg-card sticky top-0 z-10 border-b border-border/20'
      }>
        {/* Filter pills */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
          {CATEGORY_FILTERS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all tap-scale whitespace-nowrap flex-shrink-0 ${
                activeFilter === tab.id ? 'text-white' : compact ? 'bg-white text-foreground/85' : 'bg-muted/60 text-foreground/85'
              }`}
              style={
                activeFilter === tab.id
                  ? { background: 'hsl(133 60% 48%)' }
                  : compact ? { boxShadow: '0 2px 12px -2px hsl(152 40% 10% / 0.15)' } : {}
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Section header (full-screen mode only) ── */}
      {!compact && (
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Happening at the Park</h3>
          {layout === 'horizontal' && (
            <button className="text-xs font-bold" style={{ color: 'hsl(152 70% 22%)' }}>See all</button>
          )}
        </div>
      )}

      {layout === 'vertical' ? (
        /* ── Vertical list — one row per card, scrolls with the sidebar itself ── */
        <div className="flex flex-col gap-3 px-4 pb-8">
          {displayPois.map((poi, index) => {
            const { label, isLive } = getTimingLabel(poi);
            const image = getImage(poi, index);
            return (
              <motion.div
                key={poi.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03, duration: 0.22 }}
                className="cursor-pointer rounded-2xl overflow-hidden flex bg-muted/30 border border-border/15"
                style={{ height: 104 }}
                onClick={() => onPOISelect?.(poi)}
              >
                {/* Thumbnail */}
                <div className="relative w-28 flex-shrink-0">
                  <img src={image} alt={poi.name} className="w-full h-full object-cover" loading="lazy" />
                  <div
                    className={`absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold text-white ${
                      isLive ? 'bg-red-500' : 'bg-black/55'
                    }`}
                  >
                    {isLive ? <span className="w-1 h-1 rounded-full bg-white animate-pulse" /> : <Sun className="w-2.5 h-2.5" />}
                    {label}
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 px-3 py-2.5 flex flex-col justify-between">
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-foreground leading-tight truncate">{poi.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-tight truncate">
                      {poi.subcategory || poi.description?.slice(0, 40)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={e => { e.stopPropagation(); void sharePOI(poi); }}
                        className="w-7 h-7 rounded-full flex items-center justify-center tap-scale bg-muted/70"
                        aria-label={`Share ${poi.name}`}
                      >
                        <Share2 className="w-3.5 h-3.5 text-foreground/70" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); onToggleSave?.(poi.id); }}
                        className="w-7 h-7 rounded-full flex items-center justify-center tap-scale bg-muted/70"
                        aria-label={isSaved?.(poi.id) ? `Unsave ${poi.name}` : `Save ${poi.name}`}
                      >
                        <Bookmark
                          className={`w-3.5 h-3.5 ${isSaved?.(poi.id) ? 'fill-current' : ''}`}
                          style={{ color: isSaved?.(poi.id) ? 'hsl(152 70% 22%)' : undefined }}
                        />
                      </button>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); onPOISelect?.(poi); }}
                      className="w-8 h-8 rounded-full flex items-center justify-center tap-scale flex-shrink-0"
                      style={{ background: 'hsl(133 60% 42%)' }}
                      aria-label={`Navigate to ${poi.name}`}
                    >
                      <Navigation className="w-4 h-4 text-white" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
      /* ── Horizontally scrollable image cards (snap, peeking next card) ── */
      <div
        ref={scrollerRef}
        onPointerDown={compact ? pauseAutoScroll : undefined}
        onWheel={compact ? pauseAutoScroll : undefined}
        className={`flex gap-3 pl-4 pr-4 overflow-x-auto no-scrollbar snap-x snap-mandatory ${compact ? 'pb-1' : 'pb-8'}`}
        style={{ scrollPaddingLeft: 16 }}
      >
        {displayPois.map((poi, index) => {
          const { label, isLive } = getTimingLabel(poi);
          const image = getImage(poi, index);
          return (
            <motion.div
              key={poi.id}
              data-explore-card
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04, duration: 0.26 }}
              className="cursor-pointer rounded-2xl overflow-hidden flex-shrink-0 snap-start"
              // Phones: slimmer cards, so the map above stays in view.
              style={{ height: compact ? 112 : 220, width: compact ? '68%' : '82%', maxWidth: compact ? 260 : 320 }}
              onClick={() => onPOISelect?.(poi)}
            >
              <div className="relative w-full h-full">
                <img
                  src={image}
                  alt={poi.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />

                {/* Timing badge */}
                <div
                  className={`absolute top-3 left-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold text-white ${
                    isLive ? 'bg-red-500' : 'bg-black/55'
                  }`}
                >
                  {isLive ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  ) : (
                    <Sun className="w-3 h-3" />
                  )}
                  {label}
                </div>

                {/* Save + Share actions */}
                <div className="absolute top-3 right-3 flex items-center gap-2">
                  <button
                    onClick={e => { e.stopPropagation(); void sharePOI(poi); }}
                    className="w-8 h-8 rounded-full flex items-center justify-center tap-scale bg-black/45 backdrop-blur-sm"
                    aria-label={`Share ${poi.name}`}
                  >
                    <Share2 className="w-3.5 h-3.5 text-white" />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onToggleSave?.(poi.id); }}
                    className="w-8 h-8 rounded-full flex items-center justify-center tap-scale bg-black/45 backdrop-blur-sm"
                    aria-label={isSaved?.(poi.id) ? `Unsave ${poi.name}` : `Save ${poi.name}`}
                  >
                    <Bookmark
                      className={`w-3.5 h-3.5 ${isSaved?.(poi.id) ? 'text-white fill-white' : 'text-white'}`}
                    />
                  </button>
                </div>

                {/* Name + category */}
                <div className="absolute bottom-3 left-4 right-16">
                  <p className="text-white font-bold text-base leading-tight drop-shadow-sm">
                    {poi.name}
                  </p>
                  <p className="text-white/75 text-xs mt-0.5 leading-tight">
                    {poi.subcategory || poi.description?.slice(0, 32)}
                  </p>
                </div>

                {/* Navigate button */}
                <button
                  onClick={e => { e.stopPropagation(); onPOISelect?.(poi); }}
                  className="absolute bottom-3 right-3 w-11 h-11 rounded-full flex items-center justify-center tap-scale shadow-lg"
                  style={{ background: 'hsl(133 60% 42%)' }}
                  aria-label={`Navigate to ${poi.name}`}
                >
                  <Navigation className="w-5 h-5 text-white" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
      )}
    </div>
  );
};

const DEMO_POIS: POI[] = [
  {
    id: 'demo-1', nodeId: null, buildingId: 'unity-park',
    name: 'Lion Feeding Show', description: 'Watch the lions feed live', category: 'attraction',
    subcategory: 'Zoo Area', imageUrl: 'https://images.unsplash.com/photo-1614846027182-cecf8fc9e5e0?w=800&q=80',
    isFeatured: true, triggerRadius: 20, promotions: [], lat: null, lng: null, isOutdoor: true,
  },
  {
    id: 'demo-palace', nodeId: null, buildingId: 'unity-park',
    name: 'Menelik II Palace', description: 'Historic imperial palace', category: 'palace',
    subcategory: 'Palace · Historic Site', imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
    isFeatured: false, triggerRadius: 20, promotions: [], lat: null, lng: null, isOutdoor: false,
  },
  {
    id: 'demo-2', nodeId: null, buildingId: 'unity-park',
    name: 'Unity Garden Walk', description: 'Scenic garden path tour', category: 'attraction',
    subcategory: 'Unity Garden', imageUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80',
    isFeatured: false, triggerRadius: 20, promotions: [], lat: null, lng: null, isOutdoor: true,
  },
  {
    id: 'demo-3', nodeId: null, buildingId: 'unity-park',
    name: 'Coffee Ceremony', description: 'Traditional Ethiopian coffee', category: 'retail',
    subcategory: 'Traditional Coffee', imageUrl: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800&q=80',
    isFeatured: false, triggerRadius: 20, promotions: [], lat: null, lng: null, isOutdoor: false,
  },
  {
    id: 'demo-4', nodeId: null, buildingId: 'unity-park',
    name: 'Artisan Market', description: 'Handmade crafts and goods', category: 'retail',
    subcategory: 'Park Gift Shop', imageUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&q=80',
    isFeatured: false, triggerRadius: 20, promotions: [], lat: null, lng: null, isOutdoor: false,
  },
  {
    id: 'demo-5', nodeId: null, buildingId: 'unity-park',
    name: 'Palace Garden', description: 'Lush palace gardens', category: 'attraction',
    subcategory: 'Royal Garden', imageUrl: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&q=80',
    isFeatured: false, triggerRadius: 20, promotions: [], lat: null, lng: null, isOutdoor: true,
  },
  {
    id: 'demo-6', nodeId: null, buildingId: 'unity-park',
    name: 'Throne Room Exhibition', description: 'Imperial throne & artifacts', category: 'palace',
    subcategory: 'Historic Exhibition', imageUrl: 'https://images.unsplash.com/photo-1445112098124-3e76dd67983c?w=800&q=80',
    isFeatured: false, triggerRadius: 20, promotions: [], lat: null, lng: null, isOutdoor: false,
  },
];

export default ExplorePanel;
