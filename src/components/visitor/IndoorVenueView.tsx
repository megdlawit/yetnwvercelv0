// The indoor map on a venue's map page: the same 3D world and 2D plan as the
// home page hero, built from what the institution drew (walls, rooms, 3D
// objects, places), shown the way the institution set it up (Indoor 3D map
// settings) and with the visitor's own layer choices. Also: the route, where
// the visitor is and which way they face, and a glass dock to switch
// Outdoor / 2D / 3D, floors and the 3D camera.

import { createElement, lazy, Suspense, useMemo } from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser';
import { AnimatePresence, motion } from 'framer-motion';
import { Box, Globe2, Loader2, Square, Orbit, ScanEye, PersonStanding, Navigation2, MapPin } from 'lucide-react';
import type { NavEdge, NavNode, Room, Wall } from '@/data/types';
import type { MapFeature } from '@/lib/venue/features';
import type { VenueTheme } from '@/lib/venue/themes';
import type { IndoorLayerId, IndoorView } from '@/lib/venue/mapSettings';
import type { CameraMode, FloorLayer } from '@/components/venue/Venue3D';
import type { IndoorVenue } from '@ethi/indoor-core';
import { cn } from '@/lib/utils';
import PlanView from './PlanView';
import { landmarkFor } from '@/lib/landmarks/kinds';
import { CATEGORY_COLORS, CATEGORY_ICONS, type Place } from './types';

/** A visitor category in the words the landmark chooser knows. */
const VISITOR_TO_POI_WORD: Record<string, string> = { food: 'food', gardens: 'garden', family: 'park' };

const Venue3D = lazy(() => import('@/components/venue/Venue3D'));

/** A category's icon as SVG markup, for the 3D place badges (white on the place's colour). */
const iconSvgs = new Map<string, string>();
function categoryIconSvg(category: Place['category']): string {
  let svg = iconSvgs.get(category);
  if (!svg) {
    const Icon = CATEGORY_ICONS[category] ?? MapPin;
    svg = renderToStaticMarkup(createElement(Icon, { color: '#ffffff', strokeWidth: 2.3, size: 22, 'aria-hidden': true }));
    iconSvgs.set(category, svg);
  }
  return svg;
}

export type Controls = { zoomIn: () => void; zoomOut: () => void; recenter: () => void };

export interface IndoorFloor { id: string; level: number; walls: Wall[]; rooms: Room[]; nodes: NavNode[]; edges: NavEdge[]; features: MapFeature[] }

export default function IndoorVenueView({
  view, floor, otherFloors, places, selectedNodeId, onSelect, route, here, headingPlanDeg, follow,
  layers, wallHeight, theme, pxPerMeter, registerControls, cameraRequest, focusNonce, onCameraModeChange, pinSubs,
  model, routeNodeIds, onFloorChange, introNonce, onZoomOutExit,
}: {
  view: IndoorView;
  floor: IndoorFloor;
  otherFloors: FloorLayer[];
  places: Place[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
  /** The route on this floor (plan px). */
  route: { x: number; y: number }[] | null;
  /** Where the visitor is on this floor, and which way they face (plan degrees). */
  here: { x: number; y: number } | null;
  headingPlanDeg: number | null;
  /** Keep the 2D plan centred on the visitor (while walking a route). */
  follow: boolean;
  layers: Record<IndoorLayerId, boolean>;
  wallHeight: number;
  theme: VenueTheme;
  pxPerMeter: number;
  registerControls: (c: Controls) => void;
  cameraRequest: { mode: CameraMode; nonce: number } | null;
  focusNonce: number;
  /** Told which 3D camera mode is active (for the dock). */
  onCameraModeChange?: (mode: CameraMode) => void;
  /** "N min walk" under each place's 3D label, by node id. */
  pinSubs?: Record<string, string>;
  /** The whole venue (all floors and their stairs), so the 3D route climbs real stairs. */
  model?: IndoorVenue | null;
  /** The route as path points across floors. */
  routeNodeIds?: string[] | null;
  /** The 3D view moved to another floor by itself (the visitor climbed). */
  onFloorChange?: (floorId: string) => void;
  /** Bump to play the glide-in (entering from the map). */
  introNonce?: number;
  /** The visitor zoomed out past the venue: show the outdoor map. */
  onZoomOutExit?: () => void;
}) {
  const placesHere = useMemo(() => places.filter(p => p.floorId === floor.id), [places, floor.id]);
  // Only places a visitor can open get a pin (no hallway junctions).
  const pinNodes = useMemo(() => {
    const ids = new Set(placesHere.map(p => p.id));
    return floor.nodes.filter(n => ids.has(n.id));
  }, [floor.nodes, placesHere]);
  const pinColors = useMemo(() => Object.fromEntries(placesHere.map(p => [p.id, CATEGORY_COLORS[p.category]])), [placesHere]);
  const pinNames = useMemo(() => Object.fromEntries(placesHere.map(p => [p.id, p.name])), [placesHere]);
  // Each place's badge: its photo, or its category's icon.
  const pinImages = useMemo(() => Object.fromEntries(placesHere.filter(p => p.images[0]).map(p => [p.id, p.images[0]])), [placesHere]);
  const pinIcons = useMemo(() => Object.fromEntries(placesHere.map(p => [p.id, categoryIconSvg(p.category)])), [placesHere]);
  // Each place's 3D landmark, chosen as the control center chooses it (Habesha Coffee → jebena, a gallery → throne…).
  // Exactly as the control center chooses (its category and kind); places without those use their type, then their category.
  const pinLandmarks = useMemo(() => Object.fromEntries(placesHere.map(p => {
    if (p.poiCategory || p.poiSubcategory) return [p.id, landmarkFor({ name: p.name, subcategory: p.poiSubcategory, category: p.poiCategory })];
    const own = landmarkFor({ name: p.name, subcategory: p.typeLabel ?? '', category: p.category === 'attractions' ? 'attraction' : p.category });
    return [p.id, own !== 'pin' ? own : landmarkFor({ subcategory: VISITOR_TO_POI_WORD[p.category] ?? '' })];
  })), [placesHere]);
  const selected = selectedNodeId ? placesHere.find(p => p.id === selectedNodeId) : null;
  const destination = route && route.length > 1 ? route[route.length - 1] : null;

  return (
    // Phones: the walk bar goes below the search bar, the view dock and the round map buttons.
    <div className="relative isolate h-full w-full [--ivw-walkbar-top:284px] lg:[--ivw-walkbar-top:16px]" style={{ background: `linear-gradient(180deg, ${theme.sky}, ${theme.ground})` }}>
      <AnimatePresence mode="wait" initial={false}>
        {view === '3d' ? (
          <motion.div key={`3d-${floor.id}`} className="absolute inset-0"
            initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.35, ease: 'easeOut' }}>
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Building the 3D world…</div>}>
              <Venue3D walls={floor.walls} rooms={floor.rooms} nodes={pinNodes} edges={floor.edges} features={floor.features}
                level={floor.level} otherFloors={otherFloors} selectedNodeId={selectedNodeId} onSelectNode={onSelect}
                pxPerMeter={pxPerMeter} focusNonce={focusNonce} route={route && route.length > 1 ? route : null} showPaths={false}
                theme={theme} here={here} destination={destination} chrome="minimal" pinColors={pinColors} pinSubs={pinSubs} pinImages={pinImages} pinIcons={pinIcons} pinLandmarks={pinLandmarks} pinNames={pinNames} onZoomOutExit={onZoomOutExit}
                model={model} routeNodeIds={routeNodeIds} floorId={floor.id} onFloorChange={onFloorChange} introNonce={introNonce}
                wallHeight={wallHeight} layers={layers} registerControls={registerControls} cameraRequest={cameraRequest} onModeChange={onCameraModeChange} />
            </Suspense>
          </motion.div>
        ) : (
          <motion.div key={`2d-${floor.id}`} className="absolute inset-0"
            initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
            <PlanView floorId={floor.id} data={floor} selected={selectedNodeId} start={null} route={route}
              onSelect={id => onSelect(id)} places={places} here={here} follow={follow} heading={headingPlanDeg}
              focus={selected ? { x: selected.x, y: selected.y, nonce: focusNonce } : null}
              layers={layers} registerControls={registerControls} theme={theme} onZoomOutExit={onZoomOutExit} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── The dock: Outdoor / 2D / 3D, floors, and the 3D camera ───────────────────

export type DockView = IndoorView | 'outdoor';

const CAMERA_MODES: { id: CameraMode; label: string; Icon: typeof Orbit; route?: boolean; desktop?: boolean }[] = [
  { id: 'overview', label: 'Orbit', Icon: Orbit },
  { id: 'top', label: 'Top', Icon: ScanEye },
  // Tap-to-walk works on phones too.
  { id: 'walk', label: 'Walk', Icon: PersonStanding },
  { id: 'navigate', label: 'Follow', Icon: Navigation2, route: true },
];

export function ViewDock({ view, onView, outdoorAvailable, floors, floorId, onFloor, cameraMode, onCamera, hasRoute, className, compact = false }: {
  view: DockView;
  onView: (v: DockView) => void;
  outdoorAvailable: boolean;
  floors: { id: string; name: string; level: number; onRoute: boolean }[];
  floorId: string | null;
  onFloor: (id: string) => void;
  cameraMode: CameraMode | null;
  onCamera: (m: CameraMode) => void;
  hasRoute: boolean;
  className?: string;
  /** Phones: one slim row, icons for the camera, so the map stays in view. */
  compact?: boolean;
}) {
  const views: [DockView, typeof Box, string][] = [
    ...(outdoorAvailable ? [['outdoor', Globe2, 'Outdoor'] as [DockView, typeof Box, string]] : []),
    ['2d', Square, '2D'], ['3d', Box, '3D'],
  ];
  const finePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;
  const cams = CAMERA_MODES.filter(m => (!m.route || hasRoute) && (!m.desktop || finePointer));
  // The Indoor design: frosted rounded-full docks, ink for the active pill.
  const glass = 'border border-white/80 bg-[rgba(255,253,248,.82)] font-inter shadow-[0_10px_26px_rgba(30,20,10,.14)] backdrop-blur-md';
  // Two docks can be on the page (phone + desktop layouts) — each needs its own sliding pill.
  const pillId = compact ? 'venue-view-pill-compact' : 'venue-view-pill';

  const camera = (
    <AnimatePresence>
      {view === '3d' && (
        <motion.div initial={{ opacity: 0, y: compact ? 0 : 8, x: compact ? -6 : 0 }} animate={{ opacity: 1, y: 0, x: 0 }} exit={{ opacity: 0 }}
          className={cn('pointer-events-auto flex gap-0.5 rounded-full p-1', glass)} role="group" aria-label="3D camera">
          {cams.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => onCamera(id)} aria-pressed={cameraMode === id} title={label} aria-label={label}
              className={cn('flex items-center gap-1 rounded-full text-[12px] font-semibold transition-colors',
                compact ? 'h-8 w-8 justify-center' : 'px-3 py-[7px]',
                cameraMode === id ? 'bg-ink text-white' : 'text-sub hover:bg-ink/[.06] hover:text-ink')}>
              <Icon className={compact ? 'h-4 w-4' : 'h-3.5 w-3.5'} /> {!compact && label}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );

  const viewSwitch = (
    <div className={cn('pointer-events-auto flex rounded-full p-1', glass)} role="group" aria-label="Map view">
      {views.map(([id, Icon, label]) => (
        <button key={id} onClick={() => onView(id)} aria-pressed={view === id} aria-label={label}
          className={cn('relative flex items-center gap-1.5 rounded-full font-semibold transition-colors', compact ? 'h-8 px-3 text-[12px]' : 'px-3.5 py-[7px] text-[13px]',
            view === id ? 'text-white' : 'text-sub hover:text-ink')}>
          {view === id && <motion.span layoutId={pillId} className="absolute inset-0 rounded-full bg-ink shadow-[0_4px_12px_rgba(15,61,38,.3)]" transition={{ type: 'spring', stiffness: 520, damping: 36 }} />}
          <span className="relative flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {compact && id === 'outdoor' ? null : label}</span>
        </button>
      ))}
    </div>
  );

  const floorSwitch = view !== 'outdoor' && floors.length > 1 && (
    <div className={cn('pointer-events-auto flex gap-0.5 overflow-x-auto rounded-full p-1', compact ? 'max-w-[40vw]' : 'max-w-[52vw]', glass)} role="group" aria-label="Floor">
      {[...floors].sort((a, b) => b.level - a.level).map(fl => (
        <button key={fl.id} onClick={() => onFloor(fl.id)} aria-pressed={fl.id === floorId} title={fl.name}
          className={cn('relative min-w-8 whitespace-nowrap rounded-full font-semibold transition-colors', compact ? 'h-8 px-2.5 text-[12px]' : 'px-3 py-[7px] text-[13px]',
            fl.id === floorId ? 'bg-ink text-white' : 'text-sub hover:bg-ink/[.06] hover:text-ink')}>
          {compact || floors.length > 4 ? fl.level : fl.name}
          {fl.onRoute && fl.id !== floorId && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-navblue ring-2 ring-white" />}
        </button>
      ))}
    </div>
  );

  if (compact) {
    return (
      <div className={cn('pointer-events-none flex flex-wrap items-center gap-1.5', className)}>
        {viewSwitch}{camera}{floorSwitch}
      </div>
    );
  }
  return (
    <div className={cn('pointer-events-none flex flex-col items-start gap-2', className)}>
      {camera}
      <div className="flex items-end gap-2">{viewSwitch}{floorSwitch}</div>
    </div>
  );
}
