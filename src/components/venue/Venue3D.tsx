// The 3D world of a venue, drawn by the shared indoor engine
// (@ethi/indoor-core: IndoorViewer3D) — the same renderer the SDK ships.
//
// Built entirely from the same walls / rooms / places / paths / objects the
// 2D editor edits — there is no separate 3D model to keep in sync. Every 2D
// edit re-renders here, and selecting something here selects it in 2D.
// Used by the editor, the dashboard, the home page and the visitor map.
//
// This component keeps the props the app has always passed (one floor in
// plan pixels, plus the other floors to stack) and turns them into the
// engine's metre-based model.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fromPlan, pathFromNodes, pathFromPoints, type IndoorVenue, type PlanRows } from '@ethi/indoor-core';
import { IndoorViewer3DView, type PlaceTag, type Pose, type Selection, type ViewMode } from '@ethi/indoor-core/react';
import type { IndoorViewer3D, ViewerTheme } from '@ethi/indoor-core';
import type { NavNode, NavEdge, Room, Wall } from '@/data/types';
import type { MapFeature } from '@/lib/venue/features';
import { cn } from '@/lib/utils';
import type { VenueTheme } from '@/lib/venue/themes';
import { DEFAULT_LAYERS, type IndoorLayerId } from '@/lib/venue/mapSettings';

export type CameraMode = 'overview' | 'walk' | 'floor' | 'place' | 'top' | 'navigate';

export interface FloorLayer { id: string; name: string; level: number; walls: Wall[]; rooms: Room[]; features: MapFeature[] }

export interface Venue3DProps {
  walls: Wall[];
  rooms: Room[];
  nodes: NavNode[];
  edges: NavEdge[];
  features?: MapFeature[];
  /** This floor's level, and the rest of the building to stack around it. */
  level?: number;
  otherFloors?: FloorLayer[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  pxPerMeter: number;
  /** Bump to re-frame the camera on the current selection ("Show in 3D"). */
  focusNonce?: number;
  /** A route on this floor (plan px), drawn and followable in Navigate mode. */
  route?: { x: number; y: number }[] | null;
  /** Draw the whole walkable path network (editor) or only the route (visitors). */
  showPaths?: boolean;
  initialMode?: CameraMode;
  /** Told when the camera mode changes — the editor pauses its own shortcuts while walking. */
  onModeChange?: (mode: CameraMode) => void;
  className?: string;
  /** Where the visitor is (plan px on this floor), e.g. the QR code they scanned. */
  here?: { x: number; y: number } | null;
  /** Where they're going (plan px on this floor). Defaults to the end of the route. */
  destination?: { x: number; y: number } | null;
  /** The venue's look (buildings.theme). */
  theme?: VenueTheme;
  /** Home-page hero: glide in slowly from afar, then turn gently until the visitor takes over. */
  cinematic?: boolean;
  /** 'minimal' hides the camera-mode bar and scenery switch (for the home page). */
  chrome?: 'full' | 'minimal';
  /** Pin colour per place (e.g. by visitor category), overriding the room-type colours. */
  pinColors?: Record<string, string>;
  /** A second line under a pin's name (e.g. "3 min walk"), by node id. */
  pinSubs?: Record<string, string>;
  /** How tall walls stand, in metres (the venue's Indoor 3D map setting). */
  wallHeight?: number;
  /** Which details to draw (Map Layers). Omitted: everything, with paths per `showPaths`. */
  layers?: Partial<Record<IndoorLayerId, boolean>>;
  /** Hands out zoom / recenter for map buttons outside the canvas. */
  registerControls?: (controls: { zoomIn: () => void; zoomOut: () => void; recenter: () => void }) => void;
  /** Switch the camera from outside (bump `nonce` to repeat the same mode). */
  cameraRequest?: { mode: CameraMode; nonce: number } | null;
  /**
   * The whole venue as one model (every floor, the stairs between them). With
   * it, `routeNodeIds` draws the route across floors — up the real stairs —
   * and the view follows the visitor from floor to floor.
   */
  model?: IndoorVenue | null;
  /** The route as path points (with `model`). */
  routeNodeIds?: string[] | null;
  /** The floor in view (with `model`). */
  floorId?: string | null;
  /** Told when the view moves to another floor by itself (climbing). */
  onFloorChange?: (floorId: string) => void;
  /** Play the glide-in (entering the building from the map); bump to repeat. */
  introNonce?: number;
}

const PIN_COLORS: Partial<Record<Room['type'], string>> = { stairs: '#e05a47', elevator: '#3b6fe0', entrance: '#2fa95a' };
const MODE_LABELS: Record<CameraMode, string> = { overview: 'Overview', walk: 'Walkthrough', floor: 'Floor', place: 'Place', top: 'Top', navigate: 'Navigate' };
const CURRENT = '__current';

const toViewMode = (m: CameraMode): ViewMode => (m === 'navigate' ? 'follow' : m === 'walk' ? 'walk' : m === 'top' ? 'top' : 'overview');

/** The venue theme in the engine's terms (route and markers stay in the Indoor colours). */
const viewerTheme = (t?: VenueTheme): Partial<ViewerTheme> | undefined =>
  t ? { sky: t.sky, ground: t.ground, slab: t.slab, wall: t.wall, path: t.path, treeA: t.treeA, treeB: t.treeB } : undefined;

function Venue3D(props: Venue3DProps) {
  const {
    walls, rooms, nodes, edges, features = [], level = 0, otherFloors = [], selectedNodeId, onSelectNode,
    pxPerMeter, focusNonce = 0, route, showPaths = true, initialMode = 'overview', onModeChange, className, theme, here, destination,
    cinematic = false, chrome = 'full', pinColors, pinSubs, wallHeight = 2.8, layers, registerControls, cameraRequest,
    model, routeNodeIds, floorId, onFloorChange, introNonce = 0,
  } = props;
  const viewer = useRef<IndoorViewer3D | null>(null);
  const [mode, setMode] = useState<CameraMode>(initialMode);
  const [scenery, setScenery] = useState(layers?.scenery ?? true);
  useEffect(() => { if (layers?.scenery !== undefined) setScenery(layers.scenery); }, [layers?.scenery]);
  const curId = (model && floorId) || nodes[0]?.floorId || rooms[0]?.floorId || CURRENT;

  // The props as database-shaped rows → the engine's metre model.
  const built = useMemo(() => {
    if (model) return null;
    const floorRows: PlanRows['floors'] = [{ id: curId, name: 'This floor', level }, ...otherFloors.filter(f => f.id !== curId).map(f => ({ id: f.id, name: f.name, level: f.level }))];
    const wallRows = (floorId: string, ws: Wall[]) => ws.map((w, i) => ({ id: (w as Wall & { id?: string }).id ?? `${floorId}:w${i}`, floor_id: floorId, ...w }));
    const roomRows = (floorId: string, rs: Room[]) => rs.map(r => ({ id: r.id, floor_id: floorId, name: r.name, x: r.x, y: r.y, width: r.width, height: r.height, type: r.type, node_id: r.nodeId || null, polygon: r.polygon?.map(p => [p.x, p.y]) }));
    const featureRows = (floorId: string, fs: MapFeature[]) => fs.map(f => ({ id: f.id, floor_id: floorId, kind: f.kind, x: f.x, y: f.y, rotation_deg: f.rotationDeg, width: f.width, depth: f.depth, label: f.label }));
    const rows: PlanRows = {
      building: { id: 'venue', name: '' },
      floors: floorRows,
      walls: [...wallRows(curId, walls), ...otherFloors.flatMap(f => wallRows(f.id, f.walls))],
      rooms: [...roomRows(curId, rooms), ...otherFloors.flatMap(f => roomRows(f.id, f.rooms))],
      map_features: [...featureRows(curId, features), ...otherFloors.flatMap(f => featureRows(f.id, f.features))],
      nodes: nodes.map(n => ({ id: n.id, floor_id: curId, name: n.name, x: n.x, y: n.y, is_hallway: n.isHallway })),
      edges: edges.map(e => ({ id: e.id, from_node: e.fromNodeId, to_node: e.toNodeId })),
    };
    return fromPlan(rows, { pxPerMeter, wallHeight });
  }, [model, walls, rooms, nodes, edges, features, otherFloors, level, pxPerMeter, wallHeight, curId]);
  const venue = model ?? built!;

  const elevation = venue.floors.find(f => f.id === curId)?.elevation ?? 0;
  const m = (p: { x: number; y: number }) => ({ x: p.x / pxPerMeter, z: p.y / pxPerMeter });

  const places = useMemo<PlaceTag[]>(() => {
    const roomByNode = new Map(rooms.map(r => [r.nodeId, r]));
    return nodes.filter(n => !n.isHallway).map(n => {
      const room = roomByNode.get(n.id);
      return { id: n.id, floorId: curId, at: m(n), name: room?.name || n.name || '', sub: pinSubs?.[n.id] ?? null,
        color: pinColors?.[n.id] ?? (room && PIN_COLORS[room.type]) ?? theme?.primary ?? null, priority: n.id === selectedNodeId ? 9 : 1 };
    }).filter(t => t.name);
  }, [nodes, rooms, pinColors, pinSubs, theme, curId, pxPerMeter]); // eslint-disable-line react-hooks/exhaustive-deps

  const routeKey = model && routeNodeIds && routeNodeIds.length > 1 ? routeNodeIds.join('>') : (route ?? []).map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(';');
  // Across floors through the model when we have the path points; else this floor's points.
  const path = useMemo(() => (model && routeNodeIds && routeNodeIds.length > 1 ? pathFromNodes(model, routeNodeIds)
    : route && route.length > 1 ? pathFromPoints(route.map(m), curId, elevation) : null), [routeKey, model, curId, elevation]); // eslint-disable-line react-hooks/exhaustive-deps
  const herePose = useMemo<Pose | null>(() => (here ? { floorId: curId, at: m(here) } : mode === 'navigate' && path ? { floorId: curId, at: { x: path.samples[0].p.x, z: path.samples[0].p.z } } : null),
    [here?.x, here?.y, curId, mode, path]); // eslint-disable-line react-hooks/exhaustive-deps
  const destPose = useMemo<Pose | null>(() => (destination ? { floorId: curId, at: m(destination) } : null), [destination?.x, destination?.y, curId]); // eslint-disable-line react-hooks/exhaustive-deps

  const show = { ...DEFAULT_LAYERS, paths: showPaths, ...layers, scenery, otherFloors: (layers?.otherFloors ?? true) && mode !== 'floor' };
  const layerKey = JSON.stringify(show);
  const viewLayers = useMemo(() => show, [layerKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const vTheme = useMemo(() => viewerTheme(theme), [theme]);

  // A new route switches to following it (once — not on every update).
  useEffect(() => { if (path) setMode('navigate'); }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Show in 3D" frames the place — except while walking, where picking a place walks you there.
  useEffect(() => { if (focusNonce > 0 && mode !== 'walk') setMode('place'); }, [focusNonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (cameraRequest) { setMode(cameraRequest.mode); viewer.current?.recenter(); } }, [cameraRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onModeChange?.(mode); }, [mode, onModeChange]);
  useEffect(() => { if (introNonce > 0) viewer.current?.intro(); }, [introNonce]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.setMode(toViewMode(mode));
    if (mode === 'place' && selectedNodeId) v.setSelected(selectedNodeId, { focus: true });
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRef = useCallback((v: IndoorViewer3D | null) => {
    viewer.current = v;
    if (v && registerControls) registerControls({ zoomIn: () => v.zoomIn(), zoomOut: () => v.zoomOut(), recenter: () => { setMode('overview'); v.recenter(); } });
  }, [registerControls]);
  useEffect(() => { if (viewer.current) setRef(viewer.current); }, [setRef]);

  const onSelect = useCallback((sel: Selection | null) => {
    if (mode === 'walk' || mode === 'navigate') return;
    onSelectNode(sel?.nodeId ?? sel?.id ?? null);
  }, [mode, onSelectNode]);

  const modes: CameraMode[] = ['overview', 'walk', 'floor', 'place', 'top', ...(path ? ['navigate' as const] : [])];

  return (
    <div className={cn('relative h-full w-full', className)}
      // The walk bar ("Where do you want to go?") sits below the editor's mode bar.
      style={chrome === 'full' ? ({ '--ivw-walkbar-top': '56px' } as React.CSSProperties) : undefined}>
      <IndoorViewer3DView ref={setRef} venue={venue} floorId={curId} mode={toViewMode(initialMode)} theme={vTheme} layers={viewLayers}
        places={places} roomLabels route={path} position={herePose} destination={destPose} selectedId={selectedNodeId}
        focusNonce={focusNonce} cinematic={cinematic} onSelect={onSelect} onFloorChange={onFloorChange} />

      {/* Camera modes */}
      {chrome === 'full' && (
        <div className="absolute left-3 top-3 flex max-w-[calc(100%-7rem)] flex-wrap items-center gap-0.5 rounded-full border border-white/80 bg-[rgba(255,253,248,.85)] p-1 font-inter shadow-[0_10px_26px_rgba(30,20,10,.14)] backdrop-blur-md">
          {modes.map(md => (
            <button key={md} onClick={() => setMode(md)} disabled={md === 'place' && !selectedNodeId}
              title={md === 'place' && !selectedNodeId ? 'Select a place first' : undefined}
              className={cn('rounded-full px-3 py-[5px] text-xs font-semibold transition-colors disabled:opacity-40',
                mode === md ? 'bg-ink text-white' : 'text-sub hover:bg-ink/[.06] hover:text-ink')}>
              {MODE_LABELS[md]}
            </button>
          ))}
        </div>
      )}
      {chrome === 'full' && (
        <label className="absolute right-3 top-3 flex cursor-pointer items-center gap-2 rounded-full border border-white/80 bg-[rgba(255,253,248,.85)] px-3 py-1.5 font-inter text-xs font-semibold text-ink shadow-[0_10px_26px_rgba(30,20,10,.14)] backdrop-blur-md">
          <input type="checkbox" checked={scenery} onChange={e => setScenery(e.target.checked)} className="accent-[#0f3d26]" />
          Scenery
        </label>
      )}
      {mode === 'walk' && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink/[.92] px-3.5 py-1.5 font-inter text-xs font-semibold text-white shadow">
          <span className="sm:hidden">Pick a place above, or tap a room · drag to look</span>
          <span className="hidden sm:inline">Pick a place above, or tap a room or a place's name · drag to look · <kbd className="font-mono">W A S D</kbd> to roam</span>
        </div>
      )}
      {mode === 'floor' && otherFloors.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink/[.92] px-3.5 py-1.5 font-inter text-xs font-semibold text-white shadow">
          Showing this floor only · Overview shows the whole building
        </div>
      )}
    </div>
  );
}

export default memo(Venue3D);
