/**
 * MapSearchBar — search bar + full-page search dropdown.
 *
 * Indoor building results are filtered from the same `buildings` data the
 * rest of the app already loads from Supabase (via useBuildingLoader in
 * Index.tsx) — passed in as the `buildings` prop. This is the actual
 * indoor-map database, with real UUID ids and floor/room graphs, so a
 * result selected here is guaranteed to exist and be navigable.
 *
 * Outdoor place results come live from OpenStreetMap (Nominatim search)
 * via the useOutdoorPlaceSearch hook, biased around `parkCenter` — we
 * don't store outdoor places of the world in our own database, so this
 * lets people find streets, landmarks, and venues around the park.
 */
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, QrCode, X, Clock, MapPin, Building2, Trees, Bath, Gift, Loader2, Map as MapIcon, Star } from 'lucide-react';
import type { Building } from '@/data/types';
import { useOutdoorPlaceSearch, type OutdoorPlaceResult } from '@/hooks/useOutdoorPlaceSearch';
import type { GeoCoord } from '@/lib/geo/GeoTypes';
import { type POI, getPOIIcon } from '@/data/poi';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { usePopularSearchPlaces, popularPlaceTypeLabel } from '@/hooks/usePopularSearchPlaces';
import type { SearchHistoryEntry } from '@/lib/searchHistory';

interface MapSearchBarProps {
  onQRScan?: () => void;
  onSearch?: (query: string) => void;
  onCategorySelect?: (categoryId: string) => void;
  /** Indoor buildings to search — pass the app's real building list (from useBuildingLoader). */
  buildings?: Building[];
  /** True while `buildings` is still loading. */
  buildingsLoading?: boolean;
  /** Called when the user picks a building from Indoor search results */
  onBuildingSelect?: (buildingId: string) => void;
  /** Called when the user picks an Outdoor place result (sourced from OpenStreetMap) */
  onOutdoorPlaceSelect?: (place: OutdoorPlaceResult) => void;
  /** Outdoor POIs already on our own map (from usePOILoader) — park attractions, gardens, etc. */
  outdoorPois?: POI[];
  /** All POIs for the active building — used to resolve recent / popular indoor selections. */
  allPois?: POI[];
  /** Called when the user picks one of our own outdoor map POIs from search results */
  onOutdoorPOISelect?: (poi: POI) => void;
  parkName?: string;
  /** Center point used to bias Outdoor/OpenStreetMap search results. Defaults to Unity Park. */
  parkCenter?: GeoCoord;
  /** Notified whenever the full search panel opens/closes — lets a parent
   *  hide other floating UI (e.g. the explore card strip) while searching. */
  onFocusChange?: (focused: boolean) => void;
  /** When true, the full search panel is scoped to the desktop sidebar's
   *  bounds (left-anchored, fixed width) instead of covering the whole
   *  viewport, and skips the full-viewport dimming backdrop. Used when this
   *  component is rendered inside DesktopSidebar. */
  desktopPanel?: boolean;
  /** Bump this (e.g. `n => n + 1`) to force the search panel open from a
   *  parent — there's no other way in since `focused` is local state. Used
   *  to wire a "Where to?" prompt (e.g. after a QR anchor) straight into
   *  the same search UI a manual tap would open. 0/undefined does nothing;
   *  any change to a new value opens it. */
  openSignal?: number;
  /** The rooms and spots inside this venue — searched first ("Café", "Restrooms", "Gallery 2"). */
  indoorPois?: POI[];
  /** Called when the person picks one of those places. */
  onIndoorPOISelect?: (poi: POI) => void;
  /** Shown at the pill's right end (the phone home puts the profile avatar here). */
  trailing?: React.ReactNode;
}

// Unity Park, Addis Ababa — default center for biasing outdoor (OSM) search.
const DEFAULT_PARK_CENTER: GeoCoord = { lat: 8.9806, lng: 38.7974 };

const CATEGORIES = [
  { id: 'palaces',   label: 'Palaces',   Icon: Building2 },
  { id: 'outdoors',  label: 'Outdoors',  Icon: Trees },
  { id: 'restrooms', label: 'Restrooms', Icon: Bath },
  { id: 'gifts',     label: 'Gifts',     Icon: Gift },
];

const MapSearchBar: React.FC<MapSearchBarProps> = ({
  onQRScan, onSearch, onCategorySelect, buildings = [], buildingsLoading = false,
  onBuildingSelect, onOutdoorPlaceSelect,
  outdoorPois = [], allPois,
  onOutdoorPOISelect,
  parkName = 'Unity Park', parkCenter = DEFAULT_PARK_CENTER,
  onFocusChange,
  desktopPanel = false,
  openSignal,
  indoorPois = [],
  onIndoorPOISelect,
  trailing,
}) => {
  const [focused, setFocused] = useState(false);
  const [query,   setQuery]   = useState('');
  const { entries: recentEntries, record: recordSearch } = useSearchHistory();
  const { places: popularPlaces, loading: popularLoading } = usePopularSearchPlaces();
  const resolvedPois = allPois ?? outdoorPois;
  const resolvePoi = (id: string) => indoorPois.find(p => p.id === id) ?? resolvedPois.find(p => p.id === id);

  const openSearch = () => { setFocused(true); onFocusChange?.(true); };
  const closeSearch = () => { setFocused(false); setQuery(''); onFocusChange?.(false); };

  // Opens the panel on demand from a parent. `openSignal` starts at
  // undefined/0 so this is a no-op on mount — it only fires the moment a
  // parent bumps it to a new truthy value.
  React.useEffect(() => {
    if (openSignal) openSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  const selectBuilding = (buildingId: string, name: string) => {
    recordSearch({ type: 'building', id: buildingId, name });
    onBuildingSelect?.(buildingId);
    closeSearch();
  };

  const selectOutdoorPOI = (poi: POI) => {
    recordSearch({
      type: 'poi',
      id: poi.id,
      name: poi.name,
      buildingId: poi.buildingId,
      isOutdoor: poi.isOutdoor,
    });
    onOutdoorPOISelect?.(poi);
    closeSearch();
  };

  const selectOutdoorPlace = (place: OutdoorPlaceResult) => {
    recordSearch({
      type: 'outdoor_place',
      id: place.id,
      name: place.name,
      displayName: place.displayName,
      lat: place.lat,
      lng: place.lng,
    });
    onOutdoorPlaceSelect?.(place);
    closeSearch();
  };

  const handleRecentSelect = (entry: SearchHistoryEntry) => {
    if (entry.type === 'building') {
      selectBuilding(entry.id, entry.name);
      return;
    }
    if (entry.type === 'poi') {
      const poi = resolvePoi(entry.id);
      if (poi) {
        if (!poi.isOutdoor && onIndoorPOISelect) selectIndoorPOI(poi); else selectOutdoorPOI(poi);
        return;
      }
      onBuildingSelect?.(entry.buildingId);
      closeSearch();
      return;
    }
    if (entry.type === 'outdoor_place') {
      selectOutdoorPlace({
        id: entry.id,
        name: entry.name,
        displayName: entry.displayName,
        type: 'place',
        lat: entry.lat,
        lng: entry.lng,
      });
    }
  };

  const handlePopularSelect = (place: typeof popularPlaces[number]) => {
    if (place.kind === 'building') {
      selectBuilding(place.id, place.name);
      return;
    }
    const poi = resolvedPois.find(p => p.id === place.id);
    if (poi) {
      selectOutdoorPOI(poi);
      return;
    }
    setQuery(place.name);
    onSearch?.(place.name);
  };

  const recentLabel = (entry: SearchHistoryEntry) => {
    if (entry.type === 'building') return entry.name;
    if (entry.type === 'poi') return entry.name;
    return entry.name;
  };

  const recentSublabel = (entry: SearchHistoryEntry) => {
    if (entry.type === 'building') return 'Indoor building';
    if (entry.type === 'poi') return entry.isOutdoor ? 'Outdoor spot' : 'Indoor POI';
    return entry.displayName;
  };

  // ── This venue's own places (rooms, spots) — what visitors look for most ──
  const placeResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const score = (p: POI) => (p.name.toLowerCase().startsWith(q) ? 0 : p.name.toLowerCase().includes(q) ? 1 : 2);
    return indoorPois
      .filter(p => p.name.toLowerCase().includes(q) || (p.subcategory ?? '').toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q))
      .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))
      .slice(0, 12);
  }, [query, indoorPois]);
  const selectIndoorPOI = (poi: POI) => {
    recordSearch({ type: 'poi', id: poi.id, name: poi.name, buildingId: poi.buildingId, isOutdoor: false } as Parameters<typeof recordSearch>[0]);
    onIndoorPOISelect?.(poi);
    closeSearch();
  };
  // A single venue: listing "buildings" adds nothing.
  const showBuildings = !(indoorPois.length > 0 && buildings.length <= 1);

  // ── Indoor: filter the app's real building data (from our Supabase database) ──
  const buildingResults = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return buildings.filter(
      b => b.name.toLowerCase().includes(q) || (b.address ?? '').toLowerCase().includes(q),
    );
  }, [query, buildings]);

  // ── Outdoor (ours): filter the app's own outdoor map POIs (from usePOILoader) ──
  const outdoorPoiResults = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return outdoorPois.filter(
      p => p.name.toLowerCase().includes(q)
        || (p.description ?? '').toLowerCase().includes(q)
        || (p.subcategory ?? '').toLowerCase().includes(q),
    );
  }, [query, outdoorPois]);

  // ── Outdoor (world): live place data from OpenStreetMap (Nominatim) ─────────
  const {
    results: outdoorResults,
    loading: outdoorLoading,
  } = useOutdoorPlaceSearch(query, parkCenter);

  return (
    <div className="relative">
      {/* Top search pill (map overlay) */}
      <div
        className="flex h-[52px] cursor-text items-center gap-1 rounded-full border border-white/80 bg-pcard/95 pl-4 pr-1.5 font-inter shadow-[0_8px_24px_rgba(15,61,38,.14)] backdrop-blur-md"
        onClick={openSearch}
      >
        <Search style={{ width: 19, height: 19 }} className="mr-1.5 flex-shrink-0 text-ink/70" strokeWidth={2.2} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-sub">Search {parkName}</span>
        <button
          onClick={e => { e.stopPropagation(); onQRScan?.(); }}
          className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full text-ink/75 transition-colors hover:bg-ink/[.06] active:bg-ink/[.08]"
          aria-label="Scan QR code"
        >
          <QrCode style={{ width: 19, height: 19 }} />
        </button>
        {trailing}
      </div>

      {/* Full search panel */}
      <AnimatePresence>
        {focused && (
          <>
            {!desktopPanel && (
              <div className="fixed inset-0 z-30 bg-background/95" onClick={closeSearch} />
            )}

            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
              className={desktopPanel
                ? 'fixed left-3 top-3 bottom-3 z-40 bg-card flex flex-col overflow-hidden w-[392px] rounded-[28px] border border-border/30 shadow-2xl'
                : 'fixed inset-0 z-40 bg-card flex flex-col overflow-hidden'
              }
              style={desktopPanel ? undefined : { height: '100dvh' }}
            >
              {/* Header */}
              <div className="px-4 pt-safe pb-0" style={{ paddingTop: desktopPanel ? 20 : 'max(env(safe-area-inset-top, 0px), 48px)' }}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-black text-primary">Search</h2>
                  <button onClick={closeSearch} className="w-9 h-9 rounded-full bg-muted/60 flex items-center justify-center">
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>

                {/* Input */}
                <div
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 mb-1"
                  style={{ background: 'hsl(152 40% 94%)' }}
                >
                  <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'hsl(152 70% 28%)' }} />
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={indoorPois.length ? `Search ${parkName} — rooms, cafés, exhibits…` : 'Find places, buildings, exhibits'}
                    className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
                  />
                  {query && (
                    <button onClick={() => setQuery('')}>
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable body */}
              <div
                className="flex-1 overflow-y-auto px-4 pt-5 scroll-touch"
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 24px)' }}
              >

                {/* ── This venue's places ── */}
                {query.trim() && indoorPois.length > 0 && (
                  <div className="mb-6">
                    <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">PLACES IN {parkName.toUpperCase()}</p>
                    {placeResults.length === 0 ? (
                      <p className="py-2 text-xs text-muted-foreground">No place here matches "{query}"</p>
                    ) : (
                      <div className="space-y-2">
                        {placeResults.map(poi => {
                          const Icon = getPOIIcon(poi);
                          return (
                            <button key={poi.id} type="button" onClick={() => selectIndoorPOI(poi)}
                              className="flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left tap-scale"
                              style={{ background: 'hsl(152 40% 97%)', borderColor: 'hsl(152 40% 88%)' }}>
                              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl" style={{ background: 'hsl(152 40% 90%)' }}>
                                {poi.imageUrl ? <img src={poi.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Icon className="h-5 w-5" style={{ color: 'hsl(var(--primary))' }} />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-bold text-foreground">{poi.name}</p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{poi.subcategory || poi.description}</p>
                              </div>
                              <span className="shrink-0 rounded-full px-2 py-1 text-[10px] font-bold" style={{ background: 'hsl(152 50% 90%)', color: 'hsl(var(--primary))' }}>Show</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Indoor: live building results from our Supabase database ── */}
                {query.trim() && showBuildings && (
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        INDOOR BUILDINGS
                      </p>
                      {buildingsLoading && (
                        <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
                      )}
                    </div>

                    {buildingsLoading ? (
                      /* Skeleton while loading */
                      <div className="space-y-2">
                        {[1, 2].map(i => (
                          <div key={i} className="flex items-center gap-3 px-3 py-3 rounded-2xl border border-border/20 bg-muted/20 animate-pulse">
                            <div className="w-11 h-11 rounded-xl bg-muted flex-shrink-0" />
                            <div className="flex-1 space-y-2">
                              <div className="h-3 bg-muted rounded w-2/3" />
                              <div className="h-2 bg-muted rounded w-1/3" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : buildingResults.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">No buildings match "{query}"</p>
                    ) : (
                      <div className="space-y-2">
                        {buildingResults.map(b => (
                          <button
                            key={b.id}
                            onClick={() => selectBuilding(b.id, b.name)}
                            className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl border tap-scale text-left"
                            style={{ background: 'hsl(152 40% 97%)', borderColor: 'hsl(152 40% 88%)' }}
                            type="button"
                          >
                            <div
                              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                              style={{ background: 'hsl(152 40% 90%)' }}
                            >
                              <Building2 className="w-5 h-5" style={{ color: 'hsl(var(--primary))' }} />
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-foreground">{b.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {[b.address || null, `${b.floors.length} floor${b.floors.length !== 1 ? 's' : ''}`]
                                  .filter(Boolean).join(' · ')}
                              </p>
                            </div>

                            <span
                              className="text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0"
                              style={{ background: 'hsl(152 50% 90%)', color: 'hsl(var(--primary))' }}
                            >
                              Indoor map
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Outdoor (ours): attractions, gardens, etc. already on our map ── */}
                {query.trim() && outdoorPoiResults.length > 0 && (
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        OUTDOOR SPOTS
                      </p>
                    </div>

                    <div className="space-y-2">
                      {outdoorPoiResults.map(poi => {
                        const Icon = getPOIIcon(poi);
                        return (
                          <button
                            key={poi.id}
                            onClick={() => selectOutdoorPOI(poi)}
                            className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl border tap-scale text-left"
                            style={{ background: 'hsl(152 40% 97%)', borderColor: 'hsl(152 40% 88%)' }}
                            type="button"
                          >
                            <div
                              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                              style={{ background: 'hsl(152 40% 90%)' }}
                            >
                              <Icon className="w-5 h-5" style={{ color: 'hsl(var(--primary))' }} />
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-foreground truncate">{poi.name}</p>
                              {poi.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">{poi.description}</p>
                              )}
                            </div>

                            <span
                              className="text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0"
                              style={{ background: 'hsl(152 50% 90%)', color: 'hsl(var(--primary))' }}
                            >
                              On this map
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Outdoor (world): live place results from OpenStreetMap ── */}
                {query.trim() && (
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        NEARBY (OPENSTREETMAP)
                      </p>
                      {outdoorLoading && (
                        <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
                      )}
                    </div>

                    {outdoorLoading ? (
                      /* Skeleton while loading */
                      <div className="space-y-2">
                        {[1, 2].map(i => (
                          <div key={i} className="flex items-center gap-3 px-3 py-3 rounded-2xl border border-border/20 bg-muted/20 animate-pulse">
                            <div className="w-11 h-11 rounded-xl bg-muted flex-shrink-0" />
                            <div className="flex-1 space-y-2">
                              <div className="h-3 bg-muted rounded w-2/3" />
                              <div className="h-2 bg-muted rounded w-1/3" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : outdoorResults.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">No outdoor places match "{query}"</p>
                    ) : (
                      <div className="space-y-2">
                        {outdoorResults.map(place => (
                          <button
                            key={place.id}
                            onClick={() => selectOutdoorPlace(place)}
                            className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl border tap-scale text-left"
                            style={{ background: 'hsl(205 60% 97%)', borderColor: 'hsl(205 50% 88%)' }}
                            type="button"
                          >
                            <div
                              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                              style={{ background: 'hsl(205 60% 90%)' }}
                            >
                              <MapPin className="w-5 h-5" style={{ color: 'hsl(205 80% 32%)' }} />
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-foreground truncate">{place.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">{place.displayName}</p>
                            </div>

                            <span
                              className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0"
                              style={{ background: 'hsl(205 60% 90%)', color: 'hsl(205 80% 28%)' }}
                            >
                              <MapIcon className="w-3 h-3" />
                              Nearby
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Categories */}
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">CATEGORIES</p>
                <div className="grid grid-cols-4 gap-3 mb-6">
                  {CATEGORIES.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      className="flex flex-col items-center gap-1.5 tap-scale"
                      onClick={() => { onCategorySelect?.(id); setQuery(label); closeSearch(); }}
                      type="button"
                    >
                      <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center border border-border/30"
                        style={{ background: 'hsl(var(--primary) / 0.08)' }}
                      >
                        <Icon className="w-6 h-6" style={{ color: 'hsl(var(--primary))' }} />
                      </div>
                      <span className="text-xs text-muted-foreground font-medium">{label}</span>
                    </button>
                  ))}
                </div>

                {!query && indoorPois.length > 0 && (
                  <div className="mb-6">
                    <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">PLACES HERE</p>
                    <div className="flex flex-wrap gap-2">
                      {indoorPois.slice(0, 14).map(poi => (
                        <button key={poi.id} type="button" onClick={() => selectIndoorPOI(poi)}
                          className="rounded-full border border-border/40 bg-background px-3 py-1.5 text-xs font-semibold text-foreground tap-scale hover:bg-muted">
                          {poi.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {!query && (
                  <>
                    {/* Recent — places the user previously searched / selected */}
                    {recentEntries.length > 0 && (
                      <>
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">RECENT</p>
                        <div className="space-y-2 mb-6">
                          {recentEntries.map(entry => (
                            <button
                              key={`${entry.type}-${entry.type === 'outdoor_place' ? entry.id : entry.id}-${entry.timestamp}`}
                              onClick={() => handleRecentSelect(entry)}
                              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-background border border-border/25 tap-scale text-left"
                              type="button"
                            >
                              <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <div className="min-w-0 flex-1">
                                <span className="text-sm text-foreground block truncate">{recentLabel(entry)}</span>
                                <span className="text-[11px] text-muted-foreground block truncate">{recentSublabel(entry)}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Popular — admin-curated via is_search_popular in admin console */}
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">POPULAR</p>
                      {popularLoading && <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />}
                    </div>
                    <div className="space-y-2 pb-10">
                      {popularPlaces.length === 0 && !popularLoading ? (
                        <p className="text-xs text-muted-foreground py-2">
                          No popular places yet. Mark POIs or buildings as &quot;Popular in search&quot; in the admin console.
                        </p>
                      ) : (
                        popularPlaces.map(place => (
                          <button
                            key={`${place.kind}-${place.id}`}
                            onClick={() => handlePopularSelect(place)}
                            className="w-full flex items-center gap-3 px-2 py-2.5 rounded-2xl bg-background border border-border/25 tap-scale text-left"
                            type="button"
                          >
                            <div className="w-16 h-12 rounded-xl bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
                              {place.kind === 'poi' && place.imageUrl ? (
                                <img src={place.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                              ) : place.kind === 'building' ? (
                                <Building2 className="w-5 h-5 text-muted-foreground" />
                              ) : (
                                <Star className="w-5 h-5 text-muted-foreground" />
                              )}
                            </div>
                            <div className="flex-1 text-left min-w-0">
                              <p className="text-sm font-bold text-foreground break-words">{place.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{popularPlaceTypeLabel(place)}</p>
                              {place.description && (
                                <div className="flex items-center gap-1 mt-1">
                                  <MapPin className="w-3 h-3 text-primary flex-shrink-0" />
                                  <span className="text-[10px] text-primary font-bold truncate">{parkName}</span>
                                </div>
                              )}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MapSearchBar;