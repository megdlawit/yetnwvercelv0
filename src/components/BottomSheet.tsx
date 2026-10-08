/**
 * BottomSheet — Mobile-first redesign.
 *
 * States:
 * 1. Home: one draggable sheet (HomeSheet) — name, Directions, categories, picks
 * 2. Explore FULL SCREEN: fixed overlay covering entire screen, scrollable cards
 * 3. Nav active: a "Show steps" pill (the turn card is at the top)
 */
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin, Navigation, Volume2, VolumeX,
  RotateCcw, Play, X, Footprints, Smartphone,
  ChevronLeft, History, CornerDownRight,
  type LucideIcon,
} from 'lucide-react';
import { useProfile } from '@/contexts/UserProfileContext';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { useVisitedPlaces } from '@/hooks/useVisitedPlaces';
import { useToast } from '@/hooks/use-toast';
import { Building, Floor, NavNode } from '@/data/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DirectionsPanel from './DirectionsPanel';
import { pxPerMeterOf } from '@/lib/navScale';
import { PDRNavState } from '@/hooks/usePDRNavigation';
import { NavigationState } from '@/hooks/useNavigationSimulation';
import { NavSnapshot } from '@/lib/NavigationController';
import { POI, getPOIIcon, hasActivePromotions } from '@/data/poi';
import { POIWithDistance } from '@/hooks/usePOIProximity';
import ExplorePanel from './ExplorePanel';
import SavedPanel from './SavedPanel';
import VisitedPanel from './VisitedPanel';
import ProfilePage from './ProfilePage';
import { BrowseBody, BrowseHeader, type BrowseStart, type BrowseTab } from './visitor/VenueBrowse';
import HomeSheet from './HomeSheet';
import { useBrowseTab, type VenueBrowseProps } from './visitor/VenueBrowsePanel';
import EmailGateDialog from './EmailGateDialog';
import BottomNavPill from './BottomNavPill';

interface BottomSheetProps {
  /** Open the step list by itself when a route starts (off on venue maps, where the turn card leads). */
  autoOpenRoute?: boolean;
  buildings: Building[];
  selectedBuildingId: string;
  selectedFloorId: string;
  startNodeId: string | null;
  endNodeId: string | null;
  currentFloor: Floor | null;
  path: NavNode[] | null;
  distance: number | null;
  navState: PDRNavState;
  navStateCompat: NavigationState;
  navSnapshot?: NavSnapshot;
  onBuildingChange: (id: string) => void;
  onFloorChange: (id: string) => void;
  onStartChange: (nodeId: string) => void;
  onEndChange: (nodeId: string) => void;
  onNavigate: () => void;
  onClear: () => void;
  onStartNav: () => void;
  onReset: () => void;
  onEnableSensors: () => void;
  hasPath: boolean;
  onOpenQRScanner?: () => void;
  onOpenManualLocation?: () => void;
  isAnchored?: boolean;
  anchorName?: string | null;
  voiceEnabled?: boolean;
  onToggleVoice?: () => void;
  building?: Building;
  pois?: POI[];
  nearbyPOIs?: POIWithDistance[];
  onPOISelect?: (poi: POI) => void;
  parkName?: string;
  activeTab?: 'explore' | 'saved' | 'profile';
  onTabChange?: (tab: 'explore' | 'saved' | 'profile') => void;
  /** True while some other floating UI is active (search focused, a modal or
   *  the layers panel is open, a POI card is showing) — the explore card
   *  strip hides while this is true, and reappears as a "swipe up to
   *  discover" pill rather than immediately auto-showing the cards again. */
  hideExploreStrip?: boolean;
  /** Discover / Explore for a venue (its events, tours, guides and stories). */
  browse?: VenueBrowseProps;
  /** Fold the home sheet to peek (the map is being panned). */
  collapseSheet?: boolean;
  /** The home sheet's Directions button (default: the route planner). */
  onDirections?: () => void;
  /** Directions to one recommended place (default: show it, as onPOISelect). */
  onPOINavigate?: (poi: POI) => void;
  /** The "my location" button on the home sheet's edge. */
  onMyLocation?: () => void;
}

const BottomSheet: React.FC<BottomSheetProps> = ({
  autoOpenRoute = true,
  buildings, selectedBuildingId, selectedFloorId,
  startNodeId, endNodeId, currentFloor, path, distance,
  navState, navStateCompat, navSnapshot,
  onBuildingChange, onFloorChange, onStartChange, onEndChange,
  onNavigate, onClear, onStartNav, onReset, onEnableSensors,
  hasPath, onOpenQRScanner, onOpenManualLocation,
  isAnchored, anchorName, voiceEnabled, onToggleVoice,
  building, pois = [], nearbyPOIs = [], onPOISelect,
  parkName = 'Unity Park',
  activeTab = 'explore', onTabChange, browse,
  hideExploreStrip = false, collapseSheet = false,
  onDirections, onPOINavigate, onMyLocation,
}) => {
  const [exploreOpen, setExploreOpen] = useState(() => !!browse?.start);
  const [browseTab, setBrowseTab] = useBrowseTab(browse?.start);
  // An event picked on the home sheet opens straight to it.
  const [eventStart, setEventStart] = useState<BrowseStart | null>(null);
  const openBrowse = (t: BrowseTab) => { setEventStart(null); setBrowseTab(t); setExploreOpen(true); };
  const [routeOpen, setRouteOpen] = useState(false);
  const [placesSubTab, setPlacesSubTab] = useState<'saved' | 'visited'>('saved');

  const handleTabChange = (tab: 'explore' | 'saved' | 'profile') => {
    if (tab === 'explore') {
      setExploreOpen(false);
      setRouteOpen(false);
    }
    onTabChange?.(tab);
  };

  const bld = buildings.find(b => b.id === selectedBuildingId);
  const isLive = navState.isNavigating || navState.isPaused || navState.isComplete;

  // Auto-surface the route sheet (which holds the live turn-by-turn
  // Directions/steps list -- see DirectionsPanel below) whenever a route is
  // computed or navigation goes live.
  //
  // FIX: routeOpen previously only ever got set back to `false` (drag-to-
  // close, Clear, Reset) -- nothing in this file or in Index.tsx ever called
  // setRouteOpen(true). POI cards call onNavigate -> handlePOINavigate in
  // Index.tsx, which jumps straight into brainStartNav() and never touches
  // this component's own route-planner UI, so routeOpen stayed `false`
  // forever and the steps list inside routeSheet/DirectionsPanel could
  // never actually be seen, even while a real navigation was in progress.
  // We watch for hasPath/isLive turning true (not just being true) so a
  // person who deliberately swipes the sheet away isn't yanked back into it
  // on every re-render.
  const prevHasPathRef = React.useRef(false);
  const prevIsLiveRef = React.useRef(false);
  React.useEffect(() => {
    if (autoOpenRoute && ((hasPath && !prevHasPathRef.current) || (isLive && !prevIsLiveRef.current))) {
      setRouteOpen(true);
    }
    prevHasPathRef.current = hasPath;
    prevIsLiveRef.current = isLive;
  }, [hasPath, isLive, autoOpenRoute]);
  const { profile, loading: profileLoading, signOut, updateProfile, updateEmail, hasEmail, error: profileError, stepsHistory } = useProfile();
  const { savedPlaces, savedPOIs, loading: savedLoading, isSaved, toggleSave, unsavePlace, error: savedError, refresh: refreshSaved } = useSavedPlaces(profile?.id, pois);
  const { visitedPlaces, visitedPOIs, loading: visitedLoading, removeVisit, refresh: refreshVisited } = useVisitedPlaces(profile?.id, pois);
  const { toast } = useToast();

  // Refresh both lists whenever the Saved/Visited or Profile overlay is opened,
  // since visits can be recorded elsewhere (e.g. navigation arrival in Index.tsx)
  // via a separate hook instance and won't otherwise be reflected here.
  React.useEffect(() => {
    if (activeTab === 'saved' || activeTab === 'profile') {
      void refreshSaved();
      void refreshVisited();
    }
  }, [activeTab, refreshSaved, refreshVisited]);

  // Email gate — shown once when a guest tries to save without having an email
  const [emailGateOpen, setEmailGateOpen]       = useState(false);
  const [pendingSavePoiId, setPendingSavePoiId] = useState<string | null>(null);

  const handleToggleSave = async (poiId: string) => {
    // If already saved, unsave directly — no gate needed
    if (isSaved(poiId)) {
      const ok = await toggleSave(poiId);
      if (!ok) {
        toast({
          title: 'Could not remove place',
          description: savedError || 'Something went wrong.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Removed from Saved', description: 'Place removed from your saved list.' });
      }
      return;
    }

    // Saved at once, guest or not; an email (Profile) keeps it on every device.
    const ok = await toggleSave(poiId);
    if (!ok) {
      toast({
        title: 'Could not save place',
        description: savedError || 'Something went wrong. Check your connection and try again.',
        variant: 'destructive',
      });
      return;
    }
    toast({ title: 'Saved!', description: hasEmail ? 'View it anytime in the Saved tab.' : 'Find it in Saved. Add your email in Profile to keep it on every device.' });
  };

  const handleEmailGateSubmit = async (email: string): Promise<boolean> => {
    if (!updateEmail) return false;
    const ok = await updateEmail(email);
    if (!ok) return false;

    setEmailGateOpen(false);

    if (pendingSavePoiId) {
      // Was triggered by a save action — complete it
      const poiId = pendingSavePoiId;
      setPendingSavePoiId(null);
      const saved = await toggleSave(poiId);
      if (saved) {
        toast({ title: 'Saved!', description: 'View it anytime in the Saved tab.' });
      }
    } else {
      // Was triggered by profile tab tap — open it now
      onTabChange?.('profile');
    }
    return true;
  };

  const startOptions = useMemo(() => {
    if (!currentFloor) return [];
    if (currentFloor.rooms.length > 0)
      return currentFloor.rooms.map(r => ({ id: r.nodeId, name: r.name }));
    return currentFloor.nodes.filter(n => !n.isHallway && n.name).map(n => ({ id: n.id, name: n.name }));
  }, [currentFloor]);

  const endOptions = useMemo(() => {
    if (!building) return startOptions.map(o => ({ ...o, floorName: '', isPOI: false, icon: undefined as LucideIcon | undefined, hasPromo: false }));
    const baseOptions = building.floors.flatMap(f => {
      if (f.rooms.length > 0) return f.rooms.map(r => ({ id: r.nodeId, name: r.name, floorName: f.name, isPOI: false, icon: undefined as LucideIcon | undefined, hasPromo: false }));
      return f.nodes.filter(n => !n.isHallway && n.name).map(n => ({ id: n.id, name: n.name, floorName: f.name, isPOI: false, icon: undefined as LucideIcon | undefined, hasPromo: false }));
    });
    const poiOptions = pois.filter(p => !!p.nodeId).map(p => {
      const floor = building.floors.find(f => f.nodes.some(n => n.id === p.nodeId));
      return { id: p.nodeId as string, name: p.name, floorName: floor?.name ?? '', isPOI: true, icon: getPOIIcon(p) as LucideIcon | undefined, hasPromo: hasActivePromotions(p) };
    });
    const poiNodeIds = new Set(poiOptions.map(o => o.id));
    return [...poiOptions, ...baseOptions.filter(o => !poiNodeIds.has(o.id))];
  }, [building, startOptions, pois]);

  // ── FULL-SCREEN EXPLORE OVERLAY ──────────────────────────────────────────
  const exploreOverlay = (
    <AnimatePresence>
      {exploreOpen && (
        <motion.div
          key="explore-fullscreen"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 32, stiffness: 300 }}
          className="fixed inset-0 z-50 bg-card flex flex-col"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          {/* ── Top bar: title only — swipe down to close ── */}
          <motion.div
            className="flex items-center gap-3 px-4 py-3 border-b border-border/20 bg-card flex-shrink-0 cursor-grab active:cursor-grabbing"
            style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)' }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 60) setExploreOpen(false);
            }}
          >
            {browse ? (
              <><div className="min-w-0 flex-1"><BrowseHeader name={browse.name} sub={browse.sub} accent={browse.accent} tab={browseTab} onTab={setBrowseTab} /></div>
              <button onClick={() => setExploreOpen(false)} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><X className="h-4 w-4" /></button></>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest leading-none" style={{ color: 'hsl(var(--primary))' }}>EXPLORE</p>
                  <h1 className="text-lg font-black text-foreground leading-tight truncate">{parkName}</h1>
                </div>
                <span className="text-xs text-muted-foreground font-medium">TODAY</span>
              </>
            )}
          </motion.div>

          {/* ── Scrollable content ── */}
          <div className="flex-1 overflow-y-auto scroll-touch overscroll-contain min-h-0">
            {browse ? (
              <BrowseBody tab={browseTab} places={browse.places} content={browse.content} start={eventStart ?? browse.start}
                onPlace={id => { setExploreOpen(false); browse.onPlace(id); }}
                onNavigate={id => { setExploreOpen(false); browse.onNavigate(id); }} />
            ) : (
            <ExplorePanel
              pois={pois}
              onPOISelect={(poi) => {
                setExploreOpen(false);
                onPOISelect?.(poi);
              }}
              nearbyPOIs={nearbyPOIs}
              hideHeader
              isSaved={isSaved}
              onToggleSave={handleToggleSave}
            />
            )}
          </div>

          {/* ── Bottom nav inside full-screen (so it's always visible) ── */}
          <div className="flex-shrink-0 bg-card border-t border-border/20">
            <BottomNavPill
              activeTab={activeTab}
              onTabChange={handleTabChange}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // ── ROUTE PLANNER SHEET (partial, from bottom) ────────────────────────────
  const routeSheet = (
    <AnimatePresence>
      {routeOpen && (
        <>
          {/* backdrop — only while planning; while walking the map stays visible and usable */}
          {!isLive && (
            <motion.div
              key="route-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setRouteOpen(false)}
            />
          )}
          <motion.div
            key="route-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-3xl border-t border-x border-border/30 flex flex-col"
            style={{
              boxShadow: '0 -4px 32px -4px hsl(152 40% 10% / 0.18)',
              paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)',
              // Walking: a shorter sheet, so the map (and where you are) stays in view.
              maxHeight: isLive ? '40dvh' : '85dvh',
            }}
          >
            {/* Drag handle */}
            <button onClick={() => setRouteOpen(false)} className="w-full flex justify-center pt-3 pb-2 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/25" />
            </button>

            <div className="overflow-y-auto scroll-touch flex-1 min-h-0">
              {/* Navigation setup */}
              {!isLive ? (
                <div className="px-4 pb-5 space-y-3">
                  <h3 className="text-base font-black text-foreground">Plan Route</h3>

                  {/* Building / Floor */}
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={selectedBuildingId} onValueChange={onBuildingChange}>
                      <SelectTrigger className="h-11 rounded-xl bg-muted/60 border-0 text-sm">
                        <SelectValue placeholder="Building" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-[60]">
                        {buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {bld && (
                      <Select value={selectedFloorId} onValueChange={onFloorChange}>
                        <SelectTrigger className="h-11 rounded-xl bg-muted/60 border-0 text-sm">
                          <SelectValue placeholder="Floor" />
                        </SelectTrigger>
                        <SelectContent className="bg-popover z-[60]">
                          {bld.floors.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* From / To */}
                  <div className="rounded-2xl border border-border/50 overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border/30">
                      <div className="w-2.5 h-2.5 rounded-full border-2 border-primary flex-shrink-0" />
                      <Select value={startNodeId ?? ''} onValueChange={onStartChange}>
                        <SelectTrigger className="flex-1 h-8 border-0 bg-transparent text-sm p-0 focus:ring-0 [&>svg]:hidden">
                          <SelectValue placeholder="Your location" />
                        </SelectTrigger>
                        <SelectContent className="bg-popover z-[60] max-h-48">
                          {startOptions.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <MapPin className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
                      <Select value={endNodeId ?? ''} onValueChange={onEndChange}>
                        <SelectTrigger className="flex-1 h-8 border-0 bg-transparent text-sm p-0 focus:ring-0 [&>svg]:hidden">
                          <SelectValue placeholder="Destination" />
                        </SelectTrigger>
                        <SelectContent className="bg-popover z-[60] max-h-48">
                          {endOptions.map(o => (
                            <SelectItem key={o.id} value={o.id}>
                              <span className="flex items-center gap-1.5">
                                {o.isPOI && o.icon && <o.icon className="w-3.5 h-3.5" />}
                                <span>{o.name}</span>
                                {o.hasPromo && <span className="text-[9px] font-bold px-1.5 rounded bg-orange-500 text-white">%</span>}
                                {o.floorName && <span className="text-muted-foreground text-xs">({o.floorName})</span>}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={onNavigate}
                      disabled={!startNodeId || !endNodeId || startNodeId === endNodeId}
                      className="flex-1 h-12 rounded-2xl font-bold text-sm text-white disabled:opacity-30 tap-scale flex items-center justify-center gap-2"
                      style={{ background: 'hsl(var(--primary))' }}
                    >
                      <Navigation className="w-4 h-4" /> Get Directions
                    </button>
                    <button
                      onClick={() => { onClear(); setRouteOpen(false); }}
                      className="h-12 w-12 rounded-2xl bg-muted/70 flex items-center justify-center border border-border/50 tap-scale"
                    >
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>

                  {hasPath && (
                    <div className="flex gap-2">
                      {!navState.isNavigating && !navState.isComplete && (
                        <button
                          onClick={onStartNav}
                          className="flex-1 h-11 rounded-2xl font-bold text-sm text-white tap-scale flex items-center justify-center gap-2"
                          style={{ background: 'hsl(var(--accent-green))' }}
                        >
                          <Play className="w-4 h-4" /> Start Walking
                        </button>
                      )}
                      {navState.sensorPermission === 'prompt' && (
                        <button
                          onClick={onEnableSensors}
                          className="flex-1 h-11 rounded-2xl font-semibold text-sm text-amber-700 bg-amber-50 border border-amber-200 tap-scale flex items-center justify-center gap-2"
                        >
                          <Smartphone className="w-4 h-4" /> Enable Sensors
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="px-4 pb-5">
                  {navState.isComplete ? (
                    <div className="flex items-center gap-3 bg-primary/8 rounded-2xl px-4 py-3 border border-primary/20">
                      <span className="text-xl">🎉</span>
                      <p className="text-sm font-bold text-primary">Destination Reached!</p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Footprints className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold">Navigating</p>
                        <p className="text-xs text-muted-foreground">{navState.stepCount} steps</p>
                      </div>
                      <div className="flex gap-1.5">
                        {onToggleVoice && (
                          <button onClick={onToggleVoice} className="w-9 h-9 rounded-xl bg-muted/70 flex items-center justify-center border border-border/50">
                            {voiceEnabled ? <Volume2 className="w-4 h-4 text-primary" /> : <VolumeX className="w-4 h-4 text-muted-foreground" />}
                          </button>
                        )}
                        <button onClick={() => { onReset(); setRouteOpen(false); }} className="w-9 h-9 rounded-xl bg-muted/70 flex items-center justify-center border border-border/50">
                          <RotateCcw className="w-4 h-4 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                  )}
                  {path && <DirectionsPanel path={path} navState={navStateCompat} pxPerMeter={pxPerMeterOf(building)} />}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // ── COLLAPSED STRIP (always on screen when explore is closed) ────────────
  return (
    <>
      {exploreOverlay}
      {routeSheet}

      {/* ── Saved places overlay — slides in from bottom ── */}
      <AnimatePresence>
        {activeTab === 'saved' && (
          <motion.div
            key="saved-fullscreen"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 300 }}
            className="visitor-surface fixed inset-0 z-50 bg-card text-foreground flex flex-col"
            style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
          >
            <div
              className="flex items-center gap-3 px-4 py-3 border-b border-border/20 bg-card flex-shrink-0"
              style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)' }}
            >
              <button
                onClick={() => handleTabChange('explore')}
                className="w-10 h-10 rounded-full bg-muted/70 flex items-center justify-center tap-scale flex-shrink-0"
                aria-label="Close saved places"
              >
                <ChevronLeft className="w-5 h-5 text-foreground" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground leading-none">
                  {placesSubTab === 'saved' ? 'SAVED' : 'HISTORY'}
                </p>
                <h1 className="text-lg font-black text-foreground leading-tight truncate">Your Places</h1>
              </div>
            </div>

            {/* Segmented control: Saved vs Visited */}
            <div className="px-4 pt-3 pb-1 flex-shrink-0 bg-card">
              <div className="grid grid-cols-2 rounded-2xl p-1 bg-muted/60">
                <button
                  onClick={() => setPlacesSubTab('saved')}
                  className="h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 tap-scale transition-colors"
                  style={placesSubTab === 'saved'
                    ? { background: 'hsl(var(--primary))', color: 'white' }
                    : { color: 'hsl(var(--muted-foreground))' }}
                >
                  Saved
                </button>
                <button
                  onClick={() => setPlacesSubTab('visited')}
                  className="h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 tap-scale transition-colors"
                  style={placesSubTab === 'visited'
                    ? { background: 'hsl(var(--primary))', color: 'white' }
                    : { color: 'hsl(var(--muted-foreground))' }}
                >
                  <History className="w-3.5 h-3.5" /> Visited
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scroll-touch overscroll-contain min-h-0">
              {placesSubTab === 'saved' ? (
                <SavedPanel
                  savedPlaces={savedPlaces}
                  savedPOIs={savedPOIs}
                  pois={pois}
                  loading={savedLoading}
                  onPOISelect={(poi) => {
                    handleTabChange('explore');
                    onPOISelect?.(poi);
                  }}
                  onUnsave={(poiId) => void unsavePlace(poiId)}
                />
              ) : (
                <VisitedPanel
                  visitedPlaces={visitedPlaces}
                  visitedPOIs={visitedPOIs}
                  pois={pois}
                  loading={visitedLoading}
                  onPOISelect={(poi) => {
                    handleTabChange('explore');
                    onPOISelect?.(poi);
                  }}
                  onRemove={(poiId) => void removeVisit(poiId)}
                />
              )}
            </div>

            <div className="flex-shrink-0 bg-card border-t border-border/20">
              <BottomNavPill
                activeTab={activeTab}
                onTabChange={handleTabChange}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Profile page overlay — slides in from right ── */}
      <ProfilePage
        open={activeTab === 'profile'}
        onClose={() => handleTabChange('explore')}
        onTabChange={handleTabChange}
        parkName={profile?.preferred_park ?? parkName}
        visitorName={profile?.full_name?.trim() || profile?.email || undefined}
        email={profile?.email ?? undefined}
        userId={profile?.id ?? undefined}
        placesVisited={visitedPlaces.length}
        stepsWalked={profile?.steps_walked}
        badgesEarned={profile?.badges_earned}
        savedCount={savedPlaces.length}
        visitedPlaces={visitedPlaces}
        visitedPOIs={visitedPOIs}
        visitedLoading={visitedLoading}
        onViewVisited={() => { setPlacesSubTab('visited'); handleTabChange('saved'); }}
        stepsHistory={stepsHistory}
        language={profile?.language ?? 'English'}
        location={profile?.location ?? undefined}
        preferredPark={profile?.preferred_park ?? undefined}
        loading={profileLoading || visitedLoading}
        onSignOut={signOut}
        onUpdateProfile={updateProfile}
        onOpenQRScanner={onOpenQRScanner}
        profileError={profileError}
      />

      {/* ── Email gate — shown once when saving without an email ── */}
      <EmailGateDialog
        open={emailGateOpen}
        onSubmit={handleEmailGateSubmit}
        reason="save this place"
        onCancel={() => { setEmailGateOpen(false); setPendingSavePoiId(null); }}
      />

      {/* Fixed bottom strip — hidden when a full-screen overlay provides its own nav */}
      {!(activeTab === 'profile' || activeTab === 'saved' || exploreOpen) && (
      <div className="flex flex-col">

        {/* Turn-by-turn info during navigation now lives entirely in the
            top FloatingTopCard (current turn, distance, ETA, voice toggle,
            cancel button) — this bottom strip used to duplicate all of
            that plus a full turn list, and its height crowded the map and
            debug drawer out of view during navigation. Removed. */}


        {/* The home sheet: name + Directions, categories, a few recommended
            places. It steps aside while other UI (search, a place card, a
            modal) is up, and folds to peek while the map is being panned. */}
        {!isLive && !hideExploreStrip && (
          <HomeSheet
            name={browse?.name ?? parkName}
            sub={browse?.sub ?? `${pois.length} places to explore`}
            pois={pois}
            nearbyPOIs={nearbyPOIs}
            content={browse?.content}
            collapse={collapseSheet}
            onDirections={onDirections ?? (() => setRouteOpen(true))}
            onSaved={() => handleTabChange('saved')}
            onSeeAll={() => openBrowse(browseTab)}
            onSelect={poi => onPOISelect?.(poi)}
            onNavigate={poi => (onPOINavigate ?? onPOISelect)?.(poi)}
            onEvent={id => { setEventStart({ contentId: id, nonce: Date.now() }); setExploreOpen(true); }}
            onMyLocation={onMyLocation}
          />
        )}

        {/* Reopen affordance — if a person drags the live route sheet away
            mid-navigation (e.g. to see the map), give them a way back into
            the full turn-by-turn Directions/steps list instead of stranding
            them with only FloatingTopCard's current+next turn. */}
        {isLive && !routeOpen && (
          <div className="flex items-center justify-center gap-2 px-4 pt-1" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}>
            <motion.button
              onClick={() => setRouteOpen(true)}
              whileTap={{ scale: 0.97 }}
              className="flex h-12 items-center gap-2 rounded-full bg-white px-5 font-inter text-sm font-semibold text-ink shadow-[0_6px_20px_rgba(20,50,30,.18)]"
            >
              <CornerDownRight className="h-4 w-4 text-moss" />
              Show steps
            </motion.button>
          </div>
        )}
      </div>
      )}
    </>
  );
};

export default BottomSheet;