/**
 * HybridNavigationBrain — Module 2: Smart Routing + Instruction Layer
 *
 * The single coordination layer ("navigation brain") that implements:
 *   1. Route progress tracking: closest point on polyline, distance remaining,
 *      deviation detection (>10m → reroute after 3s debounce)
 *   2. InstructionEngine integration: currentInstruction, nextInstruction,
 *      distanceToNextTurn, totalDistanceRemaining, ETA
 *   3. VoiceQueue activation: turn triggers at <30m, reroute, arrival,
 *      floor change, environment transition — deduplicated, priority-ordered
 *   4. Navigation HUD: brainState.hud is the single source of truth for UI
 *   5. Rerouting logic: debounced (3s), snapped origin, new instructions
 *   6. Environment-aware routing: indoor ↔ outdoor seamless handoff
 *
 * Wraps existing engines (no replacement):
 *   • HybridPositioningEngine  → "where am I?"
 *   • NavigationController     → indoor route state machine
 *   • OutdoorMapEngine         → outdoor Dijkstra (OSM)
 *   • InstructionEngine        → unified turn-by-turn HUD
 *   • VoiceQueue               → THE only TTS dispatcher
 *   • POITriggerEngine         → proximity triggers
 */

import type { POI } from '@/data/poi';
import type { Building, NavNode } from '@/data/types';
import { BuildingGraph } from '@/lib/BuildingGraph';
import {
  NavigationController,
  type NavSnapshot,
} from '@/lib/NavigationController';
import { HybridPositioningEngine, type HybridPosition } from '@/lib/geo/HybridPositioningEngine';
import { OutdoorMapEngine, MAX_ROUTE_SPAN_M } from '@/lib/geo/OutdoorMapEngine';
import { fetchStreetRoute } from '@/lib/geo/StreetRouting';
import { RoadSnapper } from '@/lib/geo/RoadSnapper';
import { POITriggerEngine, type POITriggerSnapshot } from '@/lib/POITriggerEngine';
import { pxPerMeterOf } from '@/lib/navScale';
import {
  InstructionEngine,
  EMPTY_HUD,
  type InstructionHud,
  type UnifiedInstruction,
} from '@/lib/InstructionEngine';
import { VoiceQueue, type VoicePriority } from '@/lib/VoiceQueue';
import type {
  Environment,
  GeoAnchor,
  GeoCoord,
  OutdoorGraph,
  OutdoorNode,
  TravelMode,
} from '@/lib/geo/GeoTypes';
import { haversineMeters, detourAroundObstacle } from '@/lib/geo/GeoMath';
import { Speaker, type IndoorFloor, type Lang } from '@ethi/indoor-core';
import { localizeAnnouncement, localizeInstruction, readLang, type LangContext } from '@/lib/guidanceLang';

// ─── Public types ──────────────────────────────────────────────────────────────

/** Minimal shape of useVenueGraph's VenueGraph, kept local so this lib module
 *  doesn't depend on a React hook file — just the data shape it needs. */
export interface VenueGraphLike {
  nodes: Array<{ id: string; lat: number; lng: number }>;
  paths: Array<{
    from: { id: string; lat: number; lng: number };
    to: { id: string; lat: number; lng: number };
    distanceM: number;
  }>;
}

export type BrainStatus = 'idle' | 'routing' | 'navigating' | 'arrived';
export type RoutingMode = 'none' | 'indoor' | 'outdoor';

export interface OutdoorRouteState {
  path: OutdoorNode[];
  distanceM: number;
  remainingM: number;
  destination: GeoCoord | null;
  /** True when this is a straight-line fallback (real path data unavailable) rather than a snapped walking route. */
  isDirect?: boolean;
}

export interface BrainDestination {
  nodeId?: string | null;
  geo?: GeoCoord | null;
  poi?: POI | null;
  name?: string;
}

/** An explicit outdoor route starting point, set in place of the device's
 *  live GPS position — see setCustomOrigin(). */
export interface CustomOrigin {
  geo: GeoCoord;
  /** Display label, e.g. a searched place name or reverse-geocoded address. */
  label: string;
}

export interface BrainState {
  status: BrainStatus;
  environment: Environment;
  routingMode: RoutingMode;
  position: HybridPosition;
  indoor: NavSnapshot;
  indoorPath: NavNode[];
  outdoor: OutdoorRouteState | null;
  /** True while actively trying to fetch a real (non-direct) outdoor route
   *  — either the local Overpass graph or a long-range OSRM lookup — and
   *  we don't have one yet. The UI should show a loading state instead of
   *  treating the direct-line fallback as final while this is true; see
   *  computeLongRangeRoute. */
  isFetchingOutdoorRoute: boolean;
  /** The loaded OSM graph — null while still fetching from Overpass. */
  outdoorGraph: OutdoorGraph | null;
  poi: POITriggerSnapshot;
  /** Unified HUD — THE source of truth for navigation UI */
  hud: InstructionHud;
  destination: BrainDestination | null;
  voiceEnabled: boolean;
  /** True during the reroute debounce window */
  rerouting: boolean;
  /** Seconds since deviation started (0 = on route) */
  deviationSec: number;
  /** Navigation vs explore mode */
  navigationMode: 'navigate' | 'explore';
  /** Outdoor travel mode — walking or driving. Indoor legs are always on
   *  foot regardless of this setting. */
  travelMode: TravelMode;
  /** Outdoor route starting point override, if the person picked one
   *  instead of routing from their live GPS position — see
   *  setCustomOrigin(). Null means "start from current location". */
  customOrigin: CustomOrigin | null;
}

export interface BrainCallbacks {
  onChange?: (s: BrainState) => void;
  onArrival?: () => void;
  onAnnounce?: (text: string) => void;
  onFloorChange?: (floorId: string) => void;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** How far off the route (m) before we start the reroute timer. */
const DEVIATION_THRESHOLD_M = 10;
/** How long the user must be off-route before we reroute (ms). */
const REROUTE_DEBOUNCE_MS = 3_000;
/** Announce a turn when this close to the maneuver (m). */
const TURN_ANNOUNCE_M = 28;
/** Arrival threshold for outdoor routes (m). */
const OUTDOOR_ARRIVAL_M = 12;
/** Minimum cooldown between outdoor reroutes (ms). */
const OUTDOOR_REROUTE_COOLDOWN_MS = 5_000;
/** Minimum gap between "graph loaded but doesn't reach the destination"
 *  retry fetches (see computeOutdoorRoute) — position updates can arrive
 *  every second or so, and without this it would hammer Overpass. */
const GRAPH_EXPAND_COOLDOWN_MS = 15_000;
/** Walking speed for ETA (m/s). */
const WALKING_SPEED_MPS = 1.3;
/** Assumed average driving speed for ETA (m/s) — ~30 km/h, a reasonable
 *  blended urban/arterial figure. The route itself is weighted per-road-type
 *  by OutdoorMapEngine; this is only the ETA readout's fallback average. */
const DRIVING_SPEED_MPS = 8.3;

const EMPTY_INDOOR_SNAPSHOT: NavSnapshot = {
  state: 'IDLE',
  position: { x: 0, y: 0 },
  progressIndex: 0,
  progressFraction: 0,
  distanceRemaining: 0,
  distanceToNextTurn: 0,
  currentInstruction: null,
  instructions: [],
  isOffRoute: false,
  completedPoints: '',
  remainingPoints: '',
  currentFloorId: null,
  floorTransitions: [],
  isMultiFloor: false,
  voiceEnabled: true,
  confidence: 1,
  confidenceLevel: 'HIGH',
  confidenceSnapshot: null,
};

// ─── Route progress tracker (outdoor) ─────────────────────────────────────────

interface OutdoorProgress {
  /** Index of the closest segment start. */
  segIdx: number;
  /** Distance from user to the end of that segment (m). */
  distAhead: number;
  /** Perpendicular distance off the route polyline (m). */
  distOffRoute: number;
  /** Total distance remaining from the closest point to destination (m). */
  remainingM: number;
}

function trackOutdoorProgress(path: OutdoorNode[], here: GeoCoord): OutdoorProgress {
  let bestSeg = 0;
  let bestDist = Infinity;
  let bestT = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    // Project here onto segment a→b using simple haversine approximation
    const abDist = haversineMeters(a, b);
    if (abDist < 0.1) continue;
    // t in [0,1]
    const da = haversineMeters(here, a);
    const db = haversineMeters(here, b);
    // Approximate t by ratio
    const t = Math.max(0, Math.min(1, (da * da - db * db + abDist * abDist) / (2 * abDist * abDist)));
    // Projected point distance
    const projLat = a.lat + (b.lat - a.lat) * t;
    const projLng = a.lng + (b.lng - a.lng) * t;
    const distToProj = haversineMeters(here, { lat: projLat, lng: projLng });
    if (distToProj < bestDist) {
      bestDist = distToProj;
      bestSeg = i;
      bestT = t;
    }
  }

  // Compute remaining distance from the projected point forward
  let remaining = 0;
  if (path.length > bestSeg + 1) {
    // Distance from projection to end of current segment
    const segEnd = path[bestSeg + 1];
    const segStart = path[bestSeg];
    const segLen = haversineMeters(segStart, segEnd);
    remaining += segLen * (1 - bestT);
    // Plus all subsequent segments
    for (let i = bestSeg + 1; i < path.length - 1; i++) {
      remaining += haversineMeters(path[i], path[i + 1]);
    }
  }

  const distAhead = path.length > bestSeg + 1
    ? haversineMeters(here, path[bestSeg + 1])
    : 0;

  return {
    segIdx: bestSeg,
    distAhead,
    distOffRoute: bestDist,
    remainingM: Math.max(0, remaining),
  };
}

// ─── HybridNavigationBrain ─────────────────────────────────────────────────────

export class HybridNavigationBrain {
  // ── Engines ──────────────────────────────────────────────────────────
  readonly hybrid: HybridPositioningEngine;
  readonly outdoor: OutdoorMapEngine;
  readonly roadSnapper: RoadSnapper;
  readonly poiEngine: POITriggerEngine;
  readonly voice: VoiceQueue;
  readonly instructions: InstructionEngine;

  private indoorCtrl: NavigationController | null = null;
  private buildingGraph: BuildingGraph | null = null;

  // ── State ─────────────────────────────────────────────────────────────
  private cb: BrainCallbacks;
  private state: BrainState;
  private destination: BrainDestination | null = null;
  /** Outdoor route starting point override — see setCustomOrigin(). */
  private customOrigin: CustomOrigin | null = null;
  private outdoorRoute: OutdoorRouteState | null = null;
  private lastOutdoorReroute = 0;
  /** Throttles the "graph loaded but doesn't reach the destination" retry
   *  fetch in computeOutdoorRoute — without this it would re-fire on every
   *  GPS tick while stuck on the direct-line fallback. */
  private lastGraphExpandAttempt = 0;
  /** True while a long-range (OSRM) street route fetch is in flight — see
   *  computeLongRangeRoute. Prevents kicking a duplicate fetch on every
   *  position tick while one is already running. */
  private longRangeLoading = false;
  /** Throttles retrying a *failed* long-range fetch, same reasoning as
   *  lastGraphExpandAttempt — position updates arrive often, and without
   *  this a flaky OSRM mirror would get hammered on every GPS tick. */
  private lastLongRangeAttempt = 0;
  /** The start|dest|mode key the current outdoorRoute (if non-direct and
   *  long-range) was fetched for — lets computeLongRangeRoute tell "still
   *  the same trip, keep the route we have" apart from "destination or
   *  travel mode changed, need a fresh fetch" without re-fetching on every
   *  GPS tick just because the person's position moved slightly. */
  private longRangeRouteKey: string | null = null;
  private buildings: Building[] = [];
  /** Building footprints (center + radius) used to keep the direct-line
   *  fallback route (see computeDirectFallbackRoute) from cutting straight
   *  through a building when real street data isn't available. */
  private buildingFootprints: Array<{ id: string; center: GeoCoord; radiusM: number }> = [];
  /** Curated outdoor walkable graph (venue_nodes + venue_paths), built by
   *  setVenueGraph(). Preferred over the live Overpass fetch when it can
   *  connect start → destination: no network round-trip, and it matches
   *  the venue's real paths (parks/campuses OSM often hasn't mapped). */
  private venueGraphVertices = new Map<string, GeoCoord>();
  private venueGraphAdjacency = new Map<string, Array<{ to: string; weight: number }>>();
  private pois: POI[] = [];
  private nodesById = new Map<string, NavNode>();
  private currentFloorId: string | null = null;
  /** Plan pixels per metre for the active building (1 = plan units). */
  private indoorPxPerMeter = 1;
  /** Arrival is announced once per trip (state updates and the callback both report it). */
  private arrivalHandled = false;
  private indoorSnapshot: NavSnapshot = EMPTY_INDOOR_SNAPSHOT;
  private detachers: Array<() => void> = [];
  private subscribers = new Set<(s: BrainState) => void>();
  private destroyed = false;

  // ── HUD / voice tracking ──────────────────────────────────────────────
  private hud: InstructionHud = EMPTY_HUD;
  /** Guidance language. English goes through VoiceQueue as before; Amharic is worded by the shared engine. */
  private lang: Lang = readLang();
  private amSpeaker: Speaker | null = null;
  private amSaid = new Set<string>();
  private prevHud: InstructionHud = EMPTY_HUD;
  private prevEnv: Environment = 'unknown';
  private outdoorAnnouncedArrival = false;
  private navigationMode: 'navigate' | 'explore' = 'navigate';
  private travelMode: TravelMode = 'walk';

  // ── Reroute debounce ──────────────────────────────────────────────────
  private deviationSince: number | null = null;
  private rerouteTimer: ReturnType<typeof setTimeout> | null = null;
  private isRerouting = false;

  // ── Pending-route retry (time-based, not GPS-event-based) ─────────────
  /** Retries computeOutdoorRoute a couple seconds later when a destination
   *  is set but we don't have a real route yet (no GPS fix, or a failed
   *  fetch). Position-update-driven retries alone leave the person stuck
   *  showing nothing if they're standing still and GPS isn't pushing new
   *  fixes — this covers that gap. */
  private pendingRouteRetryTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Turn-announce tracking ────────────────────────────────────────────
  /** ID of the last instruction we announced at the close-approach threshold. */
  private lastCloseTurnId: string | null = null;
  /** ID of the last instruction we announced on maneuver change. */
  private lastAnnouncedId: string | null = null;

  constructor(cb: BrainCallbacks = {}) {
    this.cb = cb;
    this.hybrid = new HybridPositioningEngine();
    this.outdoor = new OutdoorMapEngine();
    this.roadSnapper = new RoadSnapper();
    this.voice = new VoiceQueue();
    this.instructions = new InstructionEngine();
    this.poiEngine = new POITriggerEngine({
      onAnnounce: (poi) => {
        const promos = (poi.promotions ?? []).filter(p => p.isActive);
        const hasPromo = promos.length > 0;
        const text = hasPromo
          ? `Special offer available at ${poi.name}. ${promos[0].title}.`
          : `You are near ${poi.name}.`;
        this.speak({
          text,
          priority: 'poi',
          key: `poi:${poi.id}`,
        });
      },
      onChange: () => this.emit(),
    });
    this.state = this.buildState();

    this.detachers.push(
      this.hybrid.onChange((pos) => this.handlePositionChange(pos)),
    );
  }

  // ── Setup / teardown ──────────────────────────────────────────────────

  setBuildings(
    buildings: Building[],
    anchorMeta: Map<string, { anchor: GeoAnchor | null; radiusM: number }>,
  ): void {
    this.buildings = buildings;
    const fps = buildings.map((b) => {
      const meta = anchorMeta.get(b.id);
      return { id: b.id, anchor: meta?.anchor ?? null, radiusM: meta?.radiusM ?? 35 };
    });
    this.hybrid.setBuildings(fps);
    this.buildingFootprints = fps
      .filter((f) => f.anchor !== null)
      .map((f) => ({
        id: f.id,
        center: { lat: f.anchor!.originLat, lng: f.anchor!.originLng },
        radiusM: f.radiusM,
      }));
  }

  /** Load the curated venue walkable graph (see useVenueGraph) so outdoor
   *  routing can use real, admin-drawn paths instead of depending on a live
   *  Overpass/OpenStreetMap fetch — important for venues (parks, campuses)
   *  whose internal footpaths aren't mapped in OSM at all. Call with `null`
   *  to clear (e.g. when switching buildings/venues). */
  setVenueGraph(graph: VenueGraphLike | null): void {
    this.venueGraphVertices = new Map();
    this.venueGraphAdjacency = new Map();
    if (!graph) return;

    for (const n of graph.nodes) this.venueGraphVertices.set(n.id, { lat: n.lat, lng: n.lng });
    const addAdj = (a: string, b: string, weight: number) => {
      const arr = this.venueGraphAdjacency.get(a);
      if (arr) arr.push({ to: b, weight });
      else this.venueGraphAdjacency.set(a, [{ to: b, weight }]);
    };
    for (const p of graph.paths) {
      this.venueGraphVertices.set(p.from.id, { lat: p.from.lat, lng: p.from.lng });
      this.venueGraphVertices.set(p.to.id, { lat: p.to.lat, lng: p.to.lng });
      addAdj(p.from.id, p.to.id, p.distanceM);
      addAdj(p.to.id, p.from.id, p.distanceM);
    }

    // A destination may have been requested before the venue graph loaded
    // (or we're currently on a direct-line/Overpass fallback) — retry it now
    // so the real curated path appears without the person searching again.
    if (this.destination?.geo && (!this.outdoorRoute || this.outdoorRoute.isDirect)) {
      if (this.computeOutdoorRoute(this.destination.geo)) this.emit();
    }
  }

  /** Nearest venue-graph vertex to `point` within maxDistanceM, or null. */
  private nearestVenueVertex(point: GeoCoord, maxDistanceM: number): { id: string; geo: GeoCoord } | null {
    let best: { id: string; geo: GeoCoord; d: number } | null = null;
    for (const [id, geo] of this.venueGraphVertices) {
      const d = haversineMeters(point, geo);
      if (d > maxDistanceM) continue;
      if (!best || d < best.d) best = { id, geo, d };
    }
    return best ? { id: best.id, geo: best.geo } : null;
  }

  /** Dijkstra over the curated venue graph. Returns null if start/dest
   *  can't be connected to a nearby vertex or no path exists between them. */
  private findVenueRoute(start: GeoCoord, dest: GeoCoord): { path: OutdoorNode[]; distanceM: number } | null {
    if (this.venueGraphVertices.size === 0) return null;
    const startV = this.nearestVenueVertex(start, 400);
    const destV = this.nearestVenueVertex(dest, 400);
    if (!startV || !destV) return null;

    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const visited = new Set<string>();
    dist.set(startV.id, 0);
    prev.set(startV.id, null);

    while (true) {
      let u: string | null = null;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (!visited.has(id) && d < best) { best = d; u = id; }
      }
      if (u === null) break;
      if (u === destV.id) break;
      visited.add(u);
      for (const { to, weight } of this.venueGraphAdjacency.get(u) ?? []) {
        if (visited.has(to)) continue;
        const alt = best + weight;
        if (alt < (dist.get(to) ?? Infinity)) { dist.set(to, alt); prev.set(to, u); }
      }
    }
    if (!dist.has(destV.id)) return null;

    const ids: string[] = [];
    let cur: string | null = destV.id;
    while (cur) { ids.unshift(cur); cur = prev.get(cur) ?? null; }

    const path: OutdoorNode[] = ids.map((id) => {
      const geo = this.venueGraphVertices.get(id)!;
      return { id, lat: geo.lat, lng: geo.lng, kind: 'poi' };
    });
    // Include the last real-world hop from the snapped vertex to the exact
    // destination (and, symmetrically, from the exact start to the first
    // vertex) so the line doesn't stop short of where the person tapped.
    const fullPath: OutdoorNode[] = [
      { id: 'venue-start', lat: start.lat, lng: start.lng, kind: 'poi' },
      ...path,
      { id: 'venue-end', lat: dest.lat, lng: dest.lng, kind: 'poi' },
    ];
    let distanceM = dist.get(destV.id)!;
    distanceM += haversineMeters(start, startV.geo) + haversineMeters(destV.geo, dest);

    return { path: fullPath, distanceM };
  }

  setActiveBuilding(
    building: Building,
    floorId: string | null,
    onFloorChange?: (id: string) => void,
  ): void {
    this.buildingGraph = BuildingGraph.fromBuilding(building);
    this.currentFloorId = floorId;
    this.indoorPxPerMeter = pxPerMeterOf(building);

    const map = new Map<string, NavNode>();
    for (const f of building.floors) for (const n of f.nodes) map.set(n.id, n);
    this.nodesById = map;

    this.disposeIndoor();
    this.indoorCtrl = new NavigationController(this.buildingGraph, {
      onStateChange: (snap) => {
        this.indoorSnapshot = snap;
        if (snap.state === 'ARRIVED') this.handleArrived();
        this.emit();
      },
      onArrival: () => this.handleArrived(),
      onFloorChange: (fid, t) => {
        this.currentFloorId = fid;
        const floor = this.buildingGraph?.getFloor(fid);
        const verb = t.type === 'elevator' ? 'Take the elevator' : 'Take the stairs';
        const dir = t.direction === 'up' ? 'up' : 'down';
        this.speak({
          text: `${verb} ${dir} to ${floor?.name ?? fid}.`,
          priority: 'route',
          key: `floor:${fid}`,
          immediate: true,
        });
        onFloorChange?.(fid);
        this.emit();
      },
      onReroute: () => {
        this.speak({ text: 'Recalculating route.', priority: 'warning', key: 'reroute-indoor' });
        this.emit();
      },
    }, { pxPerMeter: this.indoorPxPerMeter });
    // Brain is the sole TTS owner — mute the controller's internal voice.
    this.indoorCtrl.voiceEngine.setEnabled(false);
    this.emit();
  }

  setPOIs(pois: POI[]): void {
    this.pois = pois;
    this.refreshPOIs();
  }

  setIndoorAnchor(anchored: boolean, buildingId: string | null): void {
    this.hybrid.setIndoorAnchor(anchored, buildingId);
  }

  /** English or Amharic: instructions, the HUD and voice switch at once. */
  setLanguage(lang: Lang): void {
    if (lang === this.lang) return;
    this.lang = lang;
    this.voice.stop();
    this.amSpeaker?.hush();
    this.emit();
  }

  getLanguage(): Lang { return this.lang; }

  /** Places' Amharic names by path point id. */
  setAmharicNames(names: Record<string, string>): void { this.amNames = names; if (this.lang !== 'en') this.emit(); }
  private amNames: Record<string, string> = {};

  setVoiceEnabled(enabled: boolean): void {
    this.voice.setEnabled(enabled);
    this.indoorCtrl?.voiceEngine.setEnabled(false);
    this.emit();
  }

  /** Switch outdoor travel mode (walk/car). Reloads the road graph for the
   *  new mode and recomputes the active route so it stops routing on
   *  footpaths a car can't use (or vice versa). */
  setTravelMode(mode: TravelMode): void {
    if (this.travelMode === mode) return;
    this.travelMode = mode;
    this.outdoor.setTravelMode(mode);
    if (this.destination?.geo && this.routingMode() !== 'indoor') {
      const start = this.hybrid.getPosition().geo;
      if (start) {
        this.outdoor.loadForRoute(start, this.destination.geo).then(() => {
          if (this.computeOutdoorRoute(this.destination!.geo)) this.emit();
        });
      }
    }
    this.emit();
  }

  getTravelMode(): TravelMode {
    return this.travelMode;
  }

  setNavigationMode(mode: 'navigate' | 'explore'): void {
    this.navigationMode = mode;
    if (mode === 'explore') {
      // Stop active routing when entering explore mode
      this.indoorCtrl?.stopNavigation();
      this.outdoorRoute = null;
      this.cancelRerouteTimer();
      this.deviationSince = null;
      this.speak({ text: 'Explore mode activated. Discover nearby points of interest.', priority: 'info', key: 'explore-start' });
    } else {
      this.speak({ text: 'Navigation mode activated.', priority: 'info', key: 'navigate-start' });
    }
    this.emit();
  }

  start(): void {
    this.hybrid.start();
  }

  stop(): void {
    this.hybrid.stop();
  }

  destroy(): void {
    this.destroyed = true;
    for (const d of this.detachers) d();
    this.detachers = [];
    this.disposeIndoor();
    this.hybrid.destroy();
    if (this.rerouteTimer) clearTimeout(this.rerouteTimer);
    if (this.pendingRouteRetryTimer) clearTimeout(this.pendingRouteRetryTimer);
  }

  // ── Navigation API ────────────────────────────────────────────────────

  startNavigation(opts: { startNodeId?: string | null; destination: BrainDestination }): boolean {
    this.arrivalHandled = false;
    this.destination = opts.destination;
    this.outdoorRoute = null;
    this.cancelRerouteTimer();
    this.cancelPendingRouteRetry();
    this.deviationSince = null;
    this.isRerouting = false;
    this.lastCloseTurnId = null;
    this.lastAnnouncedId = null;
    this.voice.reset();
    this.amSaid.clear();
    this.instructions.reset();

    // If both a start node and an end node are given, that alone is an
    // unambiguous request to route indoors between them (e.g. two rooms
    // picked on the floor plan, or navigating to an indoor POI). This must
    // not depend on the live GPS/geofence environment reading — someone
    // browsing or navigating a building isn't necessarily standing inside
    // its geofence, and gating on `env` here used to make every indoor
    // node-to-node route silently fail with "no route found" whenever the
    // engine's live position reading said 'outdoor'.
    const wantsIndoor = !!opts.startNodeId && !!opts.destination.nodeId;

    if (wantsIndoor && this.indoorCtrl) {
      const ok = this.indoorCtrl.startNavigation(opts.startNodeId!, opts.destination.nodeId!);
      if (!ok) {
        this.destination = null;
        this.emit();
        return false;
      }
      this.speak({
        text: `Starting indoor navigation to ${opts.destination.name ?? 'your destination'}.`,
        priority: 'route',
        key: 'nav-start',
        immediate: true,
      });
      this.emit();
      return true;
    }

    if (opts.destination.geo) {
      const ok = this.computeOutdoorRoute(opts.destination.geo);
      if (!ok) {
        // The only way this fails now is "no GPS fix yet" or "still waiting
        // on the very first graph load" — both self-resolve automatically:
        // handlePositionChange() retries the moment a fix/graph arrives, and
        // computeOutdoorRoute() falls back to a direct-line route once the
        // graph load fails (e.g. Overpass down/rate-limited), so the person
        // is never left with no guidance at all. Keep `destination` set.
        //
        // Position-driven retries alone aren't enough though — if the
        // person is standing still, GPS may not push another fix for a
        // while, and this could sit at "Getting your location…" forever.
        // Also schedule a time-based retry so it converges either way.
        this.scheduleRouteRetry(opts.destination.geo);
        this.emit();
        return false;
      }
      this.speak({
        text: `Starting outdoor navigation to ${opts.destination.name ?? 'your destination'}.`,
        priority: 'route',
        key: 'nav-start',
        immediate: true,
      });
      this.emit();
      return true;
    }

    this.destination = null;
    this.emit();
    return false;
  }

  stopNavigation(): void {
    this.arrivalHandled = false;
    this.indoorCtrl?.stopNavigation();
    this.outdoorRoute = null;
    this.destination = null;
    this.cancelRerouteTimer();
    this.cancelPendingRouteRetry();
    this.deviationSince = null;
    this.isRerouting = false;
    this.outdoorAnnouncedArrival = false;
    this.lastCloseTurnId = null;
    this.lastAnnouncedId = null;
    this.poiEngine.reset();
    this.indoorSnapshot = EMPTY_INDOOR_SNAPSHOT;
    this.hud = EMPTY_HUD;
    this.prevHud = EMPTY_HUD;
    this.voice.stop();
    this.instructions.reset();
    this.emit();
  }

  setDestination(dest: BrainDestination | null): void {
    this.destination = dest;
    this.emit();
  }

  /** Override the outdoor route's starting point with an arbitrary
   *  location instead of the device's live GPS position — e.g. planning
   *  "from the office to downtown" while sitting somewhere else entirely
   *  (the "From" field in Google Maps). Pass null to go back to routing
   *  from wherever the device actually is.
   *
   *  While set, the outdoor route is a static preview anchored to that
   *  point: live-GPS progress tracking, deviation detection, and
   *  auto-reroute are suspended, since there's nothing meaningful to
   *  "deviate" from when the route doesn't start where the person actually
   *  is standing. The blue dot keeps showing the device's real position on
   *  the map; only the route calculation and turn-by-turn HUD read from
   *  the custom origin. */
  setCustomOrigin(origin: CustomOrigin | null): void {
    this.customOrigin = origin;
    this.outdoorRoute = null;
    this.deviationSince = null;
    this.isRerouting = false;
    this.cancelRerouteTimer();
    if (this.destination?.geo) {
      this.computeOutdoorRoute(this.destination.geo);
    }
    this.emit();
  }

  getCustomOrigin(): CustomOrigin | null {
    return this.customOrigin;
  }

  pushIndoorPosition(buildingId: string, floorId: string | null, x: number, y: number): void {
    this.hybrid.pushIndoorPosition(buildingId, floorId, x, y);
    if (this.routingMode() === 'indoor' && this.indoorCtrl) {
      this.indoorCtrl.updatePosition(x, y);
    }
  }

  recordStep(timestamp: number): void {
    this.indoorCtrl?.recordStep(timestamp);
  }
  recordHeading(deg: number): void {
    this.indoorCtrl?.recordHeading(deg);
  }
  recordNoise(variance: number): void {
    this.indoorCtrl?.recordNoise(variance);
  }

  dismissPOI(poiId: string): void {
    this.poiEngine.dismiss(poiId);
  }

  getCurrentState(): BrainState {
    return this.state;
  }

  onChange(cb: (s: BrainState) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  speak(msg: {
    text: string;
    priority: VoicePriority;
    key?: string;
    immediate?: boolean;
  }): void {
    if (this.lang !== 'en') {
      const id = msg.key?.includes(':') ? msg.key.slice(msg.key.indexOf(':') + 1) : null;
      const instruction = id ? this.hud.list.find(i => i.id === id) ?? this.hud.current : this.hud.current;
      const text = localizeAnnouncement(msg.key, this.lang, { ...this.langContext(), instruction, distanceM: this.hud.distanceToManeuverM, english: msg.text });
      if (text) {
        if (msg.key && this.amSaid.has(msg.key)) return;
        if (msg.key) this.amSaid.add(msg.key);
        if (this.voice.isEnabled) {
          this.amSpeaker ??= new Speaker();
          this.amSpeaker.say(text, this.lang);
        }
        this.cb.onAnnounce?.(text);
        return;
      }
    }
    this.voice.enqueue(msg);
    this.cb.onAnnounce?.(msg.text);
  }

  /** What the shared engine's wording needs: names of path points and floors. */
  private langContext(): LangContext {
    const g = this.buildingGraph;
    const toFloor = (id: string): IndoorFloor | undefined => {
      const fl = g?.getFloor(id);
      return fl ? { id: fl.id, name: { en: fl.name }, level: fl.level, order: fl.level, elevation: 0, ceilingHeight: 3 } : undefined;
    };
    return {
      node: id => { const n = g?.getNode(id); return n ? { name: n.name ? { en: n.name, am: this.amNames[id] ?? null } : null, floorId: n.floorId } : null; },
      floor: toFloor,
      floors: [...new Set((g?.getAllNodes() ?? []).map(n => n.floorId))].map(toFloor).filter((x): x is IndoorFloor => !!x),
      destination: this.destination?.name ? { en: this.destination.name, am: (this.destination.nodeId && this.amNames[this.destination.nodeId]) || null } : null,
    };
  }

  /** The HUD in the visitor's language (the brain's own English otherwise). */
  private localizedHud(h: InstructionHud): InstructionHud {
    if (this.lang === 'en') return h;
    const ctx = this.langContext();
    const tr = (i: UnifiedInstruction | null) => (i ? { ...i, text: localizeInstruction(i, this.lang, ctx) } : null);
    return { ...h, current: tr(h.current), next: tr(h.next), list: h.list.map(i => tr(i)!) };
  }

  // ── Position → routing pipeline ───────────────────────────────────────

  private handlePositionChange(pos: HybridPosition): void {
    this.refreshPOIs(pos);

    // Pre-warm outdoor graph as soon as we have a GPS position —
    // prevents "route not found" on first navigate attempt. If a
    // destination is already set, fetch a bbox covering both points so
    // the destination's path data is included, not just the area
    // immediately around the person.
    if (pos.geo && !this.outdoor.getGraph() && !this.outdoor.isLoading()) {
      const preload = this.destination?.geo
        ? this.outdoor.loadForRoute(pos.geo, this.destination.geo)
        : this.outdoor.loadAround(pos.geo, 800);
      preload.then((graph) => {
        if (graph) {
          // A destination may have been requested before the graph was
          // ready (or we're currently on a direct-line fallback) — retry it
          // now so the real snapped path appears without the person having
          // to search again.
          if (this.destination?.geo && (!this.outdoorRoute || this.outdoorRoute.isDirect)) {
            this.computeOutdoorRoute(this.destination.geo);
          }
          this.emit(); // re-render the map the moment data arrives
        }
      });
    }

    // A destination may also have been requested before we had a GPS fix
    // at all — retry now that one exists, so navigation "just starts"
    // guiding the moment location becomes available.
    if (pos.geo && this.outdoor.getGraph() && this.destination?.geo && (!this.outdoorRoute || this.outdoorRoute.isDirect)) {
      this.computeOutdoorRoute(this.destination.geo);
    }

    const mode = this.routingMode();

    // ── Outdoor: progress tracking + reroute ──
    // Skipped while a custom origin is set — the route starts from a
    // chosen point, not wherever the device actually is, so tracking the
    // live GPS fix against it would just fire spurious "off route"
    // reroutes. It stays a static preview until the person clears the
    // custom origin and goes back to routing from their live location.
    if (mode === 'outdoor' && this.outdoorRoute && pos.geo && !this.customOrigin) {
      this.advanceOutdoorRoute(pos.geo);
    }

    // ── Environment handoff ──
    this.handleEnvironmentTransition(pos);

    this.emit();
  }

  private advanceOutdoorRoute(here: GeoCoord): void {
    if (!this.outdoorRoute) return;
    const dest = this.outdoorRoute.destination;

    // ── Arrival ──
    if (dest && haversineMeters(here, dest) <= OUTDOOR_ARRIVAL_M) {
      this.outdoorRoute = { ...this.outdoorRoute, remainingM: 0 };
      this.handleArrived();
      return;
    }

    // ── Progress tracking ──
    const progress = trackOutdoorProgress(this.outdoorRoute.path, here);
    this.outdoorRoute = { ...this.outdoorRoute, remainingM: progress.remainingM };

    // ── Deviation detection → reroute debounce ──
    if (progress.distOffRoute > DEVIATION_THRESHOLD_M) {
      if (this.deviationSince === null) {
        this.deviationSince = Date.now();
      }
      const elapsed = Date.now() - this.deviationSince;

      if (elapsed >= REROUTE_DEBOUNCE_MS && !this.isRerouting) {
        const cooldownOk = Date.now() - this.lastOutdoorReroute > OUTDOOR_REROUTE_COOLDOWN_MS;
        if (cooldownOk && dest) {
          this.triggerOutdoorReroute(dest, here);
        }
      }
    } else {
      // Back on route — cancel any pending reroute
      this.deviationSince = null;
      this.cancelRerouteTimer();
    }
  }

  private triggerOutdoorReroute(dest: GeoCoord, here: GeoCoord): void {
    this.isRerouting = true;
    this.speak({
      text: 'Off route. Recalculating.',
      priority: 'warning',
      key: 'reroute-outdoor',
      immediate: true,
    });
    const ok = this.computeOutdoorRoute(dest, here);
    if (ok) {
      this.lastCloseTurnId = null;
      this.lastAnnouncedId = null;
      this.instructions.reset();
    }
    this.deviationSince = null;
    this.isRerouting = false;
    this.emit();
  }

  private handleEnvironmentTransition(pos: HybridPosition): void {
    const env = pos.environment;
    if (env === this.prevEnv) return;
    const prevEnv = this.prevEnv;
    this.prevEnv = env;

    const mode = this.routingMode();
    if (mode === 'none') return;

    if (prevEnv === 'indoor' && env === 'outdoor') {
      this.speak({
        text: 'Now outside. Continuing outdoor navigation.',
        priority: 'route',
        key: 'env:outdoor',
      });
      // If we have an outdoor destination, kick off outdoor routing
      if (this.destination?.geo && !this.outdoorRoute) {
        this.computeOutdoorRoute(this.destination.geo);
      }
    } else if (prevEnv === 'outdoor' && env === 'indoor') {
      this.speak({
        text: "GPS can't follow us in here. Indoor guidance takes over.",
        priority: 'route',
        key: 'env:indoor',
      });
      // Pause outdoor routing while indoor
      if (this.destination?.nodeId && this.indoorCtrl) {
        // Let outdoor route sit until the user exits again
      }
    } else if (env === 'transitioning' && prevEnv !== 'transitioning') {
      this.speak({
        text: 'Approaching building entrance.',
        priority: 'info',
        key: 'env:transition',
      });
    }
  }

  private handleArrived(): void {
    if (this.arrivalHandled) return;
    this.arrivalHandled = true;
    if (!this.outdoorAnnouncedArrival && this.routingMode() === 'outdoor') {
      this.outdoorAnnouncedArrival = true;
    }
    this.speak({
      text: 'You have arrived at your destination.',
      priority: 'route',
      key: 'arrive',
      immediate: true,
    });
    this.cb.onArrival?.();
  }

  // ── HUD computation ───────────────────────────────────────────────────

  private buildHud(pos: HybridPosition): InstructionHud {
    const mode = this.routingMode();

    let hudInputs: Parameters<InstructionEngine['update']>[0];
    if (mode === 'indoor') {
      hudInputs = { kind: 'indoor', snapshot: this.indoorSnapshot };
    } else if (mode === 'outdoor' && this.outdoorRoute) {
      hudInputs = {
        kind: 'outdoor',
        path: this.outdoorRoute.path,
        remainingM: this.outdoorRoute.remainingM,
        // While a custom origin is set, the HUD reads from that fixed
        // point rather than the live GPS fix — see setCustomOrigin().
        here: this.customOrigin?.geo ?? pos.geo,
      };
    } else {
      hudInputs = { kind: 'none' };
    }

    const speedMps = mode === 'outdoor' && this.travelMode === 'car'
      ? DRIVING_SPEED_MPS
      : WALKING_SPEED_MPS;
    return this.instructions.update(hudInputs, pos.environment, speedMps);
  }

  // ── Voice: turn announcements ─────────────────────────────────────────

  private fireVoiceAnnouncements(newHud: InstructionHud, status: BrainStatus): void {
    if (status !== 'navigating') return;
    const cur = newHud.current;
    if (!cur) return;

    // 1. New maneuver became current
    if (cur.id !== this.lastAnnouncedId) {
      this.lastAnnouncedId = cur.id;
      const isFirst = cur.type === 'START';
      // Skip announcing START again if already done in startNavigation
      if (!isFirst) {
        const text = buildTurnText(cur, newHud.distanceToManeuverM);
        this.speak({ text, priority: 'route', key: `turn:${cur.id}` });
      }
      // Reset close-approach so we announce it fresh when we get near
      this.lastCloseTurnId = null;
      return;
    }

    // 2. Close-approach announcement (≤ TURN_ANNOUNCE_M) — one shot per maneuver
    if (
      newHud.distanceToManeuverM <= TURN_ANNOUNCE_M &&
      cur.id !== this.lastCloseTurnId &&
      cur.type !== 'START' &&
      cur.type !== 'ARRIVE'
    ) {
      this.lastCloseTurnId = cur.id;
      const text = buildTurnText(cur, newHud.distanceToManeuverM);
      this.speak({ text, priority: 'route', key: `turn-close:${cur.id}`, immediate: true });
      return;
    }

    // 3. Arrival
    if (cur.type === 'ARRIVE' && cur.id !== this.lastCloseTurnId) {
      this.lastCloseTurnId = cur.id;
      this.speak({
        text: 'You have arrived at your destination.',
        priority: 'route',
        key: 'arrive-hud',
        immediate: true,
      });
    }
  }

  // ── Route computation ─────────────────────────────────────────────────

  private computeOutdoorRoute(dest: GeoCoord, fromHere?: GeoCoord): boolean {
    const start = fromHere ?? this.customOrigin?.geo ?? this.hybrid.getPosition().geo;
    if (!start) return false;

    // 1. Prefer the curated venue graph (admin-drawn real paths) — no
    // network dependency, and it covers ground OSM often doesn't (park
    // footpaths, campus walkways). Only fall through to Overpass/direct
    // when it can't connect this start/destination pair.
    const venueResult = this.findVenueRoute(start, dest);
    if (venueResult) {
      this.outdoorRoute = {
        path: venueResult.path,
        distanceM: venueResult.distanceM,
        remainingM: venueResult.distanceM,
        destination: dest,
      };
      this.lastOutdoorReroute = Date.now();
      return true;
    }

    // 1b. Start and destination are farther apart than the local
    // Overpass+Dijkstra graph can practically cover in one query (see
    // MAX_ROUTE_SPAN_M) — e.g. navigating to Unity Park from elsewhere in
    // the city, not just finding a path once you're already near it.
    // loadForRoute would only fetch a small radius around `start` in this
    // case (the destination's real street data would never get fetched at
    // all), so hand this off to real street-network routing instead of
    // falling through to a graph that structurally can't reach `dest`.
    if (haversineMeters(start, dest) > MAX_ROUTE_SPAN_M) {
      return this.computeLongRangeRoute(start, dest);
    }

    // If the outdoor graph isn't loaded yet, kick off a load and retry once
    // it resolves — this is the main reason "route not found" appeared.
    if (!this.outdoor.getGraph()) {
      // Use the route-specific check (this exact start/dest bbox), not a
      // global "has anything failed recently" flag — an unrelated preload
      // fetch (e.g. around the person's position, kicked automatically
      // before they even picked a destination) failing shouldn't block us
      // from trying the actual route bbox they just requested. That global
      // check was the main reason a straight line showed up first: the
      // real fetch for this destination got skipped entirely while an
      // unrelated area's cooldown was still active.
      if (this.outdoor.hasFailedRecentlyFor(start, dest)) {
        // This specific bbox genuinely failed recently and is still
        // cooling down — don't leave the person stuck with no guidance at
        // all. Try OSRM's real street network (see computeLongRangeRoute)
        // before resorting to a straight line: a failed Overpass fetch here
        // usually means OSM has no ways tagged inside this narrow bbox for
        // this specific area (a common local-coverage gap), which OSRM's own
        // maintained street graph often still routes over just fine.
        // handlePositionChange will keep retrying the local graph in the
        // background too, and swap it in if it ever succeeds.
        return this.computeLongRangeRoute(start, dest);
      }
      if (!this.outdoor.isLoading()) {
        // Fetch a bbox covering both start AND destination — a plain
        // radius-around-start fetch would miss the destination's real
        // path data whenever it sits outside that radius.
        this.outdoor.loadForRoute(start, dest).then((graph) => {
          if (graph && this.destination?.geo && (!this.outdoorRoute || this.outdoorRoute.isDirect)) {
            const ok = this.computeOutdoorRoute(this.destination.geo);
            if (ok) this.emit();
          }
        });
      }
      // Return false for now; the retry above will call emit() once ready.
      return false;
    }

    // 200m was too tight for a park like this — OSM's mapped path network
    // often doesn't run right up to every internal point of interest, so a
    // destination sitting, say, 250m from the nearest *mapped* footpath was
    // permanently kicked to the direct-line fallback even with a perfectly
    // healthy graph. Widened to 400m; see the diagnostic log below if you're
    // still seeing frequent direct-route fallbacks — it tells you exactly
    // how far short the mapped network falls for the specific points hit.
    const SNAP_DISTANCE_M = 400;
    const startNode = this.outdoor.nearestNode(start, SNAP_DISTANCE_M);
    const destNode = this.outdoor.nearestNode(dest, SNAP_DISTANCE_M);
    if (!startNode || !destNode) {
      if (import.meta.env.DEV) {
        const startGap = startNode ? 0 : this.outdoor.nearestNodeDistance(start);
        const destGap = destNode ? 0 : this.outdoor.nearestNodeDistance(dest);
        console.warn(
          `[HybridNavigationBrain] outdoor graph loaded (${this.outdoor.getGraph()?.nodes.length ?? 0} nodes) ` +
          `but too far from mapped paths — nearest node is ${startGap == null ? 'unknown' : Math.round(startGap) + 'm'} ` +
          `from start, ${destGap == null ? 'unknown' : Math.round(destGap) + 'm'} from destination ` +
          `(snap threshold ${SNAP_DISTANCE_M}m). This means OSM's data for this area doesn't cover the ` +
          `actual walking paths here — Overpass working correctly won't fix this; the curated venue graph ` +
          `(admin-drawn paths) is the real fix for a specific venue like this.`
        );
      }
      // A graph is loaded, but it doesn't reach the destination (common
      // when it was only fetched around an earlier position) — fetch a
      // bbox covering both points in the background and retry once it
      // lands, instead of permanently settling for the direct line.
      // Throttled so this doesn't refire on every GPS tick while stuck.
      const now = Date.now();
      if (!this.outdoor.isLoading() && now - this.lastGraphExpandAttempt > GRAPH_EXPAND_COOLDOWN_MS) {
        this.lastGraphExpandAttempt = now;
        this.outdoor.loadForRoute(start, dest).then((graph) => {
          if (graph && this.destination?.geo && (!this.outdoorRoute || this.outdoorRoute.isDirect)) {
            const ok = this.computeOutdoorRoute(this.destination.geo);
            if (ok) this.emit();
          }
        });
      }
      // A full-coverage fetch is in flight (either just kicked above, or
      // already running from an earlier call) — wait for it instead of
      // immediately flashing a straight-line route that a moment later
      // gets replaced by the real snapped path. That flash-then-swap is
      // exactly the "straight line shows first, then the street shows up"
      // behavior we want to avoid. Only fall back once there's genuinely
      // nothing left to wait on (fetch cooling down after a failure) — and
      // even then, try OSRM's real street network first (see
      // computeLongRangeRoute) rather than going straight to a direct line.
      // The nearest-node gap logged above is frequently OSM simply having no
      // ways tagged inside this local bbox, not a network problem, so
      // retrying the same narrow Overpass query again won't help — OSRM's
      // maintained street graph is a genuinely different, often-successful
      // data source for exactly this case.
      if (this.outdoor.isLoading()) return false;
      return this.computeLongRangeRoute(start, dest);
    }
    const result = this.outdoor.findRoute(startNode.id, destNode.id);
    if (!result) {
      // Nodes snapped fine, but the graph is disconnected between them (e.g.
      // only part of the path network made it into the fetched/cached bbox).
      // Previously this fell back to the direct line with nothing queued to
      // retry, so it stayed stuck even once better data became available.
      // Kick a background refetch, same throttle as the snap-failure case.
      const now = Date.now();
      if (!this.outdoor.isLoading() && now - this.lastGraphExpandAttempt > GRAPH_EXPAND_COOLDOWN_MS) {
        this.lastGraphExpandAttempt = now;
        this.outdoor.loadForRoute(start, dest).then((graph) => {
          if (graph && this.destination?.geo && (!this.outdoorRoute || this.outdoorRoute.isDirect)) {
            const ok = this.computeOutdoorRoute(this.destination.geo);
            if (ok) this.emit();
          }
        });
      }
      // Same reasoning as the snap-failure branch above — don't flash a
      // direct line while a fresh fetch that might connect the two nodes
      // is still in flight, and once there's nothing left to wait on, try
      // OSRM's real street network before a straight line.
      if (this.outdoor.isLoading()) return false;
      return this.computeLongRangeRoute(start, dest);
    }
    this.outdoorRoute = {
      path: result.path,
      distanceM: result.distanceM,
      remainingM: result.distanceM,
      destination: dest,
    };
    this.lastOutdoorReroute = Date.now();
    return true;
  }

  /** Routes a start↔dest pair too far apart for the local Overpass graph
   *  (see MAX_ROUTE_SPAN_M) over the real street network via OSRM. Kicks an
   *  async fetch (deduped/throttled below) and, like the local-graph path,
   *  returns a direct-line fallback immediately so the person isn't left
   *  with nothing while it's in flight — the real route swaps in via
   *  emit() once it lands. */
  private computeLongRangeRoute(start: GeoCoord, dest: GeoCoord): boolean {
    const key = `${start.lat.toFixed(3)},${start.lng.toFixed(3)}|${dest.lat.toFixed(3)},${dest.lng.toFixed(3)}|${this.outdoor.getTravelMode()}`;

    // Already have a real (non-direct) route for this exact trip — nothing
    // to do, keep using it. Position ticks during a long walk/drive will
    // keep calling in here (via the same "no route or still direct" guards
    // used for the local-graph path), so this is what stops it from
    // re-fetching the whole city route on every GPS update.
    if (this.longRangeRouteKey === key && this.outdoorRoute && !this.outdoorRoute.isDirect) {
      return true;
    }

    const now = Date.now();
    const shouldFetch = !this.longRangeLoading
      && (this.longRangeRouteKey !== key || now - this.lastLongRangeAttempt > GRAPH_EXPAND_COOLDOWN_MS);
    if (shouldFetch) {
      this.longRangeLoading = true;
      this.lastLongRangeAttempt = now;
      const mode = this.outdoor.getTravelMode();
      fetchStreetRoute(start, dest, mode).then((result) => {
        this.longRangeLoading = false;
        if (!this.destination?.geo || haversineMeters(this.destination.geo, dest) > 5) return; // destination changed while fetching
        if (!result) {
          // Leave the direct-line fallback in place; the throttle above
          // lets a later GPS tick or reroute try again.
          return;
        }
        this.longRangeRouteKey = key;
        this.outdoorRoute = {
          path: result.path,
          distanceM: result.distanceM,
          remainingM: result.distanceM,
          destination: dest,
        };
        this.lastOutdoorReroute = Date.now();
        this.emit();
      });
    }

    // Only fall back to a direct line once there's genuinely nothing left
    // to wait on. While longRangeLoading is true — a fetch was just kicked
    // off above, or one from an earlier call is still running — returning
    // false here (same pattern as the "graph not loaded yet" branch above)
    // avoids flashing a straight line that a moment later gets swapped for
    // the real route; buildState's isFetchingOutdoorRoute tells the UI to
    // show a loading state instead. Once a fetch has actually failed and is
    // cooling down (longRangeLoading back to false), show the detoured
    // direct line rather than nothing.
    if (this.longRangeLoading) return false;
    return this.computeDirectFallbackRoute(start, dest);
  }

  /** As-the-crow-flies fallback when real path data can't be found/reached —
   *  still guides the person (bearing, distance, arrival) even without a
   *  snapped walking path. The line is bent around any known building
   *  footprints it would otherwise cut straight through (see
   *  buildDetouredWaypoints), rather than drawing one raw straight segment
   *  from origin to destination. */
  private computeDirectFallbackRoute(start: GeoCoord, dest: GeoCoord): boolean {
    const wasAlreadyDirect = this.outdoorRoute?.isDirect && this.outdoorRoute.destination
      && haversineMeters(this.outdoorRoute.destination, dest) < 5;

    const waypoints = this.buildDetouredWaypoints(start, dest);
    let distanceM = 0;
    for (let i = 1; i < waypoints.length; i++) distanceM += haversineMeters(waypoints[i - 1], waypoints[i]);

    const path: OutdoorNode[] = waypoints.map((p, i) => ({
      id: i === 0 ? 'direct-start' : i === waypoints.length - 1 ? 'direct-end' : `direct-detour-${i}`,
      lat: p.lat,
      lng: p.lng,
      kind: 'poi',
    }));
    this.outdoorRoute = {
      path,
      distanceM,
      remainingM: distanceM,
      destination: dest,
      isDirect: true,
    };
    this.lastOutdoorReroute = Date.now();

    if (!wasAlreadyDirect) {
      this.speak({
        text: 'Detailed walking paths aren\u2019t available right now, so showing a direct route instead.',
        priority: 'warning',
        key: 'outdoor-direct-fallback',
        immediate: false,
      });
    }
    return true;
  }

  /** Bends a start→dest straight line around any building footprints it
   *  would otherwise slice through, so the direct fallback still looks
   *  like a walkable route instead of a line drawn over rooftops. Bounded
   *  to a handful of detour points so it can't loop forever on dense data. */
  private buildDetouredWaypoints(start: GeoCoord, dest: GeoCoord): GeoCoord[] {
    let points: GeoCoord[] = [start, dest];
    if (this.buildingFootprints.length === 0) return points;

    const MAX_DETOURS = 6;
    for (let guard = 0; guard < MAX_DETOURS; guard++) {
      let inserted = false;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        // Pick the single worst (closest-to-center) obstruction on this
        // segment — resolving one at a time keeps detours minimal and
        // avoids two nearby buildings fighting over the same bend.
        let worst: { point: GeoCoord; clearance: number } | null = null;
        for (const fp of this.buildingFootprints) {
          const detour = detourAroundObstacle(a, b, fp.center, fp.radiusM);
          if (!detour) continue;
          const clearance = haversineMeters(detour, fp.center);
          if (!worst || clearance < worst.clearance) worst = { point: detour, clearance };
        }
        if (worst) {
          points = [...points.slice(0, i + 1), worst.point, ...points.slice(i + 1)];
          inserted = true;
          break; // re-scan from the top since segment indices shifted
        }
      }
      if (!inserted) break;
    }
    return points;
  }

  /** Pre-warm the outdoor graph around a known location (e.g. on GPS fix,
   *  or the moment a POI/place is selected so Navigate has a head start).
   *
   * FIX — this used to fire loadAround() and forget about it. The GPS-tick
   * path (handlePositionChange, below) always chains a `.then()` onto its
   * own preload to retry a pending destination once the graph resolves,
   * but this method didn't — so a route requested (via brainStartNav/
   * computeOutdoorRoute) before the preload finished got the direct-line
   * fallback and then stayed stuck on it forever: handlePositionChange's
   * own retry only fires while `!this.outdoor.isLoading()`, which is false
   * for the whole time this preload is in flight, so nothing ever rechecked
   * the destination once this particular load completed. That's why a
   * quick tap-to-navigate (existing pin, list item) showed a permanent
   * direct route while search worked — search took long enough (typing +
   * picking a result) for the preload to finish before Navigate was ever
   * pressed. Now this chains the same retry-on-ready logic itself. */
  preloadOutdoorGraph(center: GeoCoord): void {
    if (this.outdoor.getGraph() || this.outdoor.isLoading()) return;
    this.outdoor.loadAround(center, 800).then((graph) => {
      if (!graph) return;
      if (this.destination?.geo && (!this.outdoorRoute || this.outdoorRoute.isDirect)) {
        if (this.computeOutdoorRoute(this.destination.geo)) this.emit();
      }
    });
  }

  // ── Routing mode ──────────────────────────────────────────────────────

  private routingMode(): RoutingMode {
    if (this.indoorCtrl && this.indoorSnapshot.state !== 'IDLE') return 'indoor';
    if (this.outdoorRoute) return 'outdoor';
    return 'none';
  }

  // ── POIs ──────────────────────────────────────────────────────────────

  private refreshPOIs(pos?: HybridPosition): void {
    const p = pos ?? this.state.position;
    this.poiEngine.update({
      pois: this.pois,
      indoorPxPerMeter: this.indoorPxPerMeter,
      nodesById: this.nodesById,
      indoorPosition: p.indoor ? { x: p.indoor.x, y: p.indoor.y } : null,
      geoPosition: p.geo,
      currentFloorId: this.currentFloorId,
      isNavigating: this.routingMode() !== 'none',
      exploreMode: this.navigationMode === 'explore',
      distanceToManeuverM: this.hud.distanceToManeuverM,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private cancelRerouteTimer(): void {
    if (this.rerouteTimer) {
      clearTimeout(this.rerouteTimer);
      this.rerouteTimer = null;
    }
  }

  private cancelPendingRouteRetry(): void {
    if (this.pendingRouteRetryTimer) {
      clearTimeout(this.pendingRouteRetryTimer);
      this.pendingRouteRetryTimer = null;
    }
  }

  /** Schedule one more attempt at computing the outdoor route a couple
   *  seconds out. Safe to call repeatedly — it no-ops if a retry is already
   *  pending, and it self-cancels once a real (non-direct) route exists or
   *  the destination changes/clears. This is what keeps a stuck "Getting
   *  your location…" state from going nowhere when the person isn't
   *  physically moving and GPS isn't pushing fresh position events. */
  private scheduleRouteRetry(dest: GeoCoord): void {
    if (this.pendingRouteRetryTimer) return;
    this.pendingRouteRetryTimer = setTimeout(() => {
      this.pendingRouteRetryTimer = null;
      if (!this.destination?.geo || haversineMeters(this.destination.geo, dest) > 1) return; // destination changed/cleared meanwhile
      if (this.outdoorRoute && !this.outdoorRoute.isDirect) return; // already got a real route
      const ok = this.computeOutdoorRoute(dest);
      if (ok) {
        this.emit();
      } else {
        this.scheduleRouteRetry(dest); // still not ready — try again
      }
    }, 2500);
  }

  private disposeIndoor(): void {
    this.indoorCtrl?.stopNavigation();
    this.indoorCtrl = null;
    this.indoorSnapshot = EMPTY_INDOOR_SNAPSHOT;
  }

  // ── State emission ────────────────────────────────────────────────────

  private buildState(): BrainState {
    const pos = this.hybrid.getPosition();
    const mode = this.routingMode();

    let status: BrainStatus = 'idle';
    if (mode === 'indoor') {
      status =
        this.indoorSnapshot.state === 'ARRIVED'
          ? 'arrived'
          : this.indoorSnapshot.state === 'ROUTING'
          ? 'routing'
          : 'navigating';
    } else if (mode === 'outdoor') {
      status =
        this.outdoorRoute && this.outdoorRoute.remainingM <= 0
          ? 'arrived'
          : this.destination
          ? 'navigating'
          : 'idle';
    }

    // Build HUD from real data
    const newHud = this.buildHud(pos);

    // Fire voice announcements
    this.fireVoiceAnnouncements(newHud, status);

    // Outdoor arrival voice (one-shot)
    if (mode === 'outdoor' && status === 'arrived' && !this.outdoorAnnouncedArrival) {
      this.outdoorAnnouncedArrival = true;
      this.handleArrived();
    }
    if (mode !== 'outdoor' || status !== 'arrived') {
      this.outdoorAnnouncedArrival = false;
    }

    this.prevHud = newHud;
    this.hud = newHud;

    const deviationSec =
      this.deviationSince != null
        ? (Date.now() - this.deviationSince) / 1000
        : 0;

    return {
      status,
      environment: pos.environment,
      routingMode: mode,
      position: pos,
      indoor: this.indoorSnapshot,
      indoorPath: this.indoorCtrl?.currentPath ?? [],
      outdoor: this.outdoorRoute,
      isFetchingOutdoorRoute: this.longRangeLoading || this.outdoor.isLoading(),
      outdoorGraph: this.outdoor.getGraph(),
      poi: this.poiEngine.getSnapshot(),
      hud: this.localizedHud(newHud),
      destination: this.destination,
      voiceEnabled: this.voice.isEnabled,
      rerouting: this.isRerouting || (this.deviationSince != null && deviationSec > 1),
      deviationSec,
      navigationMode: this.navigationMode,
      travelMode: this.travelMode,
      customOrigin: this.customOrigin,
    };
  }

  private emit(): void {
    if (this.destroyed) return;
    this.state = this.buildState();
    this.cb.onChange?.(this.state);
    for (const sub of this.subscribers) sub(this.state);
  }
}

// ─── Voice text helpers ───────────────────────────────────────────────────────

function buildTurnText(inst: UnifiedInstruction, distM: number): string {
  const base = stripTrailingDistance(inst.text);
  if (inst.type === 'ARRIVE') return inst.text;
  if (inst.type === 'START') return inst.text;
  const dist = Math.round(distM);
  if (dist <= 5) return `${base} now.`;
  return `${base} in ${dist} meters.`;
}

function stripTrailingDistance(text: string): string {
  return text
    .replace(/\s+in\s+\d+\s*m(?:eters)?\.?$/i, '')
    .replace(/\.$/, '');
}

export const EMPTY_BRAIN_INDOOR_SNAPSHOT = EMPTY_INDOOR_SNAPSHOT;