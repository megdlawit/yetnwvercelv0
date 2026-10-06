/**
 * NavigationController — Centralized navigation orchestrator.
 * Manages the full navigation lifecycle: routing, position tracking,
 * route snapping, deviation detection, rerouting, turn instructions,
 * floor transitions, voice guidance, confidence scoring, and arrival.
 * Independent of UI / React.
 */

import { NavNode, NavEdge } from '@/data/types';
import { BuildingGraph, MultiFloorPath, FloorTransition } from '@/lib/BuildingGraph';
import { VoiceEngine } from '@/lib/VoiceEngine';
import { ConfidenceEngine, ConfidenceLevel, ConfidenceSnapshot } from '@/lib/ConfidenceEngine';
import { snapToPath } from '@/lib/PathSnapper';
import { splitRouteAtIndex, calcRouteDistance } from '@/lib/RouteRenderer';

// ─── Types ───────────────────────────────────────────────────────────

export type NavControllerState = 'IDLE' | 'ROUTING' | 'NAVIGATING' | 'OFF_ROUTE' | 'FLOOR_TRANSITION' | 'ARRIVED';

export type TurnType = 'LEFT' | 'RIGHT' | 'STRAIGHT' | 'ARRIVE' | 'STAIRS_UP' | 'STAIRS_DOWN' | 'ELEVATOR_UP' | 'ELEVATOR_DOWN';

export interface TurnInstruction {
  type: TurnType;
  distance: number;
  nodeId: string;
  text: string;
  floorId?: string;
}

export interface NavSnapshot {
  state: NavControllerState;
  position: { x: number; y: number };
  progressIndex: number;
  progressFraction: number;
  distanceRemaining: number;
  distanceToNextTurn: number;
  currentInstruction: TurnInstruction | null;
  instructions: TurnInstruction[];
  isOffRoute: boolean;
  completedPoints: string;
  remainingPoints: string;
  currentFloorId: string | null;
  floorTransitions: FloorTransition[];
  isMultiFloor: boolean;
  voiceEnabled: boolean;
  // Confidence fields
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  confidenceSnapshot: ConfidenceSnapshot | null;
}

export interface NavControllerCallbacks {
  onStateChange?: (snapshot: NavSnapshot) => void;
  onReroute?: (newPath: NavNode[]) => void;
  onArrival?: () => void;
  onFloorChange?: (floorId: string, transition: FloorTransition) => void;
}

export interface NavControllerOptions {
  /** Floor-plan pixels per real metre (see lib/navScale). 1 = the original unit-less behaviour. */
  pxPerMeter?: number;
}

// ─── Constants ───────────────────────────────────────────────────────

interface Thresholds { snap: number; softSnap: number; reroute: number; hardReroute: number; arrival: number; voice: number; reAnchor: number }

/** The original thresholds, in plan units, for buildings with no real scale. */
const LEGACY_THRESHOLDS: Thresholds = { snap: 15, softSnap: 25, reroute: 40, hardReroute: 60, arrival: 20, voice: 50, reAnchor: 25 };
/** The same stages in real metres, for plans with a known scale. */
const METRIC_THRESHOLDS_M: Thresholds = { snap: 1.5, softSnap: 2.5, reroute: 5, hardReroute: 8, arrival: 2, voice: 8, reAnchor: 3 };

function thresholdsFor(pxPerMeter: number): Thresholds {
  if (pxPerMeter === 1) return LEGACY_THRESHOLDS;
  const t = { ...METRIC_THRESHOLDS_M };
  for (const k of Object.keys(t) as (keyof Thresholds)[]) t[k] *= pxPerMeter;
  return t;
}

const TURN_ANGLE_THRESHOLD = 30;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// ─── Turn Instruction Engine ─────────────────────────────────────────

function angleBetweenSegments(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): { type: 'LEFT' | 'RIGHT' | 'STRAIGHT'; angleDeg: number } {
  const v1x = bx - ax, v1y = by - ay;
  const v2x = cx - bx, v2y = cy - by;
  const cross = v1x * v2y - v1y * v2x;
  const dot = v1x * v2x + v1y * v2y;
  const angleDeg = Math.abs(Math.atan2(cross, dot) * (180 / Math.PI));
  if (angleDeg < TURN_ANGLE_THRESHOLD) return { type: 'STRAIGHT', angleDeg };
  return { type: cross > 0 ? 'RIGHT' : 'LEFT', angleDeg };
}

function buildTurnInstructions(
  path: NavNode[],
  floorTransitions: FloorTransition[],
  buildingGraph?: BuildingGraph,
  pxPerMeter = 1,
): TurnInstruction[] {
  if (path.length < 2) return [];
  const m = (px: number) => Math.round(px / pxPerMeter);

  const instructions: TurnInstruction[] = [];
  let accDist = 0;
  const transitionIndices = new Set(floorTransitions.map(t => t.index));

  for (let i = 0; i < path.length - 1; i++) {
    const dx = path[i + 1].x - path[i].x;
    const dy = path[i + 1].y - path[i].y;
    const segDist = Math.sqrt(dx * dx + dy * dy);
    accDist += segDist;

    const transition = floorTransitions.find(t => t.index === i + 1);
    if (transition) {
      const verb = transition.type === 'elevator' ? 'Take the elevator' : 'Take the stairs';
      const dir = transition.direction === 'up' ? 'up' : 'down';
      const destFloor = buildingGraph?.getFloor(transition.toFloorId);
      const floorName = destFloor?.name ?? transition.toFloorId;
      const type: TurnType = transition.type === 'elevator'
        ? (transition.direction === 'up' ? 'ELEVATOR_UP' : 'ELEVATOR_DOWN')
        : (transition.direction === 'up' ? 'STAIRS_UP' : 'STAIRS_DOWN');

      instructions.push({ type, distance: m(accDist), nodeId: path[i + 1].id, text: `${verb} ${dir} to ${floorName}`, floorId: transition.toFloorId });
      accDist = 0;
      continue;
    }

    if (i < path.length - 2 && !transitionIndices.has(i + 1)) {
      const { type } = angleBetweenSegments(path[i].x, path[i].y, path[i + 1].x, path[i + 1].y, path[i + 2].x, path[i + 2].y);
      if (type !== 'STRAIGHT') {
        const label = type === 'LEFT' ? 'Turn left' : 'Turn right';
        instructions.push({ type, distance: m(accDist), nodeId: path[i + 1].id, text: `${label} in ${m(accDist)}m` });
        accDist = 0;
      }
    } else if (i === path.length - 2) {
      instructions.push({ type: 'ARRIVE', distance: m(accDist), nodeId: path[path.length - 1].id, text: `Arrive at destination in ${m(accDist)}m` });
    }
  }

  if (instructions.length === 0 || instructions[instructions.length - 1].type !== 'ARRIVE') {
    const totalDist = calcRouteDistance(path.map(n => ({ x: n.x, y: n.y })));
    instructions.push({ type: 'ARRIVE', distance: m(totalDist), nodeId: path[path.length - 1].id, text: `Go straight ${m(totalDist)}m to destination` });
  }

  return instructions;
}

// ─── Controller ──────────────────────────────────────────────────────

export class NavigationController {
  private buildingGraph: BuildingGraph;
  private path: NavNode[] = [];
  private fullPath: MultiFloorPath | null = null;
  private instructions: TurnInstruction[] = [];
  private _state: NavControllerState = 'IDLE';
  private position = { x: 0, y: 0 };
  private progressIndex = 0;
  private progressFraction = 0;
  private callbacks: NavControllerCallbacks;
  private destinationNodeId: string | null = null;
  private startNodeId: string | null = null;
  private currentFloorId: string | null = null;
  private voice: VoiceEngine;
  private confidence: ConfidenceEngine;
  private lastAnnouncedInstIdx = -1;
  private announcedFloorTransitions = new Set<number>();
  private deviationCount = 0;
  private lastRerouteTime = 0;
  private floorTransitionActive = false;
  private floorTransitionLockPos: { x: number; y: number } | null = null;
  private readonly pxPerMeter: number;
  private readonly t: Thresholds;

  constructor(
    buildingGraph: BuildingGraph,
    callbacks: NavControllerCallbacks = {},
    options: NavControllerOptions = {},
  ) {
    this.buildingGraph = buildingGraph;
    this.callbacks = callbacks;
    this.pxPerMeter = options.pxPerMeter && options.pxPerMeter > 0 ? options.pxPerMeter : 1;
    this.t = thresholdsFor(this.pxPerMeter);
    this.voice = new VoiceEngine();
    this.confidence = new ConfidenceEngine();
  }

  // ── Public API ─────────────────────────────────────────────────────

  get state() { return this._state; }
  get currentPath() { return this.path; }
  get voiceEngine() { return this.voice; }
  get confidenceEngine() { return this.confidence; }

  startNavigation(startNodeId: string, destinationNodeId: string): boolean {
    this._state = 'ROUTING';
    this.destinationNodeId = destinationNodeId;
    this.startNodeId = startNodeId;
    this.announcedFloorTransitions.clear();
    this.lastAnnouncedInstIdx = -1;
    this.deviationCount = 0;
    this.lastRerouteTime = 0;
    this.floorTransitionActive = false;
    this.floorTransitionLockPos = null;
    this.confidence.reset();
    this.emit();

    const result = this.buildingGraph.findPath(startNodeId, destinationNodeId);
    if (!result) {
      this._state = 'IDLE';
      this.emit();
      return false;
    }

    this.fullPath = result;
    this.path = result.nodeIds.map(id => this.buildingGraph.getNode(id)!).filter(Boolean);
    this.instructions = buildTurnInstructions(this.path, result.floorTransitions, this.buildingGraph, this.pxPerMeter);
    this.position = { x: this.path[0].x, y: this.path[0].y };
    this.progressIndex = 0;
    this.progressFraction = 0;
    this.currentFloorId = this.buildingGraph.getNodeFloorId(startNodeId) ?? null;
    this._state = 'NAVIGATING';

    if (this.instructions.length > 0) {
      this.voice.speak(this.instructions[0].text);
      this.lastAnnouncedInstIdx = 0;
    }

    this.emit();
    return true;
  }

  stopNavigation() {
    this._state = 'IDLE';
    this.path = [];
    this.fullPath = null;
    this.instructions = [];
    this.destinationNodeId = null;
    this.startNodeId = null;
    this.progressIndex = 0;
    this.progressFraction = 0;
    this.announcedFloorTransitions.clear();
    this.lastAnnouncedInstIdx = -1;
    this.deviationCount = 0;
    this.floorTransitionActive = false;
    this.floorTransitionLockPos = null;
    this.confidence.reset();
    this.voice.stop();
    this.emit();
  }

  /** Feed step event for confidence tracking */
  recordStep(timestamp: number) {
    this.confidence.recordStep(timestamp);
  }

  /** Feed heading for confidence tracking */
  recordHeading(deg: number) {
    this.confidence.recordHeading(deg);
  }

  /** Feed sensor noise for confidence tracking */
  recordNoise(variance: number) {
    this.confidence.recordNoise(variance);
  }

  /** Call on every PDR / joystick position update */
  updatePosition(x: number, y: number) {
    if (this._state !== 'NAVIGATING' && this._state !== 'OFF_ROUTE') return;
    if (this.path.length < 2) return;

    // ── Floor transition: lock horizontal position ──
    if (this.floorTransitionActive) {
      if (this.floorTransitionLockPos) {
        x = this.floorTransitionLockPos.x;
        y = this.floorTransitionLockPos.y;
      }
    }

    const floorPath = this.getCurrentFloorPath();
    if (floorPath.length < 2) {
      this.checkFloorTransition();
      return;
    }

    const snap = snapToPath(x, y, floorPath);

    // Feed route distance to confidence
    this.confidence.recordRouteDistance(snap.distanceToPath);
    this.confidence.recordDrift(x - snap.x, y - snap.y);

    // ── Arrival check ──
    const dest = this.path[this.path.length - 1];
    const isDestOnCurrentFloor = this.buildingGraph.getNodeFloorId(dest.id) === this.currentFloorId;
    if (isDestOnCurrentFloor) {
      const distToDest = Math.sqrt((x - dest.x) ** 2 + (y - dest.y) ** 2);
      if (distToDest < this.t.arrival) {
        this.position = { x: dest.x, y: dest.y };
        this.progressIndex = this.path.length - 1;
        this._state = 'ARRIVED';
        this.voice.speakImmediate('You have arrived at your destination.');
        this.emit();
        this.callbacks.onArrival?.();
        return;
      }
    }

    // ── Staged deviation handling ──
    const confLevel = this.confidence.level;
    const adaptiveSnapThreshold = confLevel === 'HIGH' ? this.t.snap
      : confLevel === 'MEDIUM' ? this.t.softSnap
      : this.t.softSnap * 1.5;

    if (snap.distanceToPath > this.t.hardReroute) {
      // Stage 3: Large deviation — full reroute
      this.deviationCount++;
      this._state = 'OFF_ROUTE';
      this.position = { x, y };
      this.voice.speak('Recalculating route.');
      this.emit();
      this.reroute(x, y);
      return;
    }

    if (snap.distanceToPath > this.t.reroute) {
      // Stage 2: Moderate deviation — recalc from nearest node
      this.deviationCount++;
      if (this.shouldReroute()) {
        this._state = 'OFF_ROUTE';
        this.position = { x, y };
        this.voice.speak('Adjusting your position.');
        this.emit();
        this.reroute(x, y);
        return;
      }
      // Not rerouting yet — soft snap toward route
      const blend = 0.6;
      this.position = { x: x * (1 - blend) + snap.x * blend, y: y * (1 - blend) + snap.y * blend };
    } else if (snap.distanceToPath > adaptiveSnapThreshold) {
      // Stage 1: Slight deviation — gradual soft snap (no teleport)
      const blend = confLevel === 'HIGH' ? 0.8 : confLevel === 'MEDIUM' ? 0.5 : 0.3;
      this.position = { x: x * (1 - blend) + snap.x * blend, y: y * (1 - blend) + snap.y * blend };
    } else {
      // On route — full snap
      this.position = { x: snap.x, y: snap.y };
      this.deviationCount = Math.max(0, this.deviationCount - 1);
    }

    // ── Smart re-anchor: if confidence very low and near a known node ──
    if (this.confidence.shouldReAnchor(snap.distanceToPath)) {
      const nearest = this.buildingGraph.findNearest(x, y, this.currentFloorId!);
      if (nearest) {
        const distToNode = Math.sqrt((x - nearest.x) ** 2 + (y - nearest.y) ** 2);
        if (distToNode < this.t.reAnchor) {
          this.position = { x: nearest.x, y: nearest.y };
          this.confidence.recordCorrection();
          this.voice.speak('Adjusting your position.');
        }
      }
    }

    // Map floorPath index back to full path index
    const fullIdx = this.floorPathStartIndex() + snap.nearestNodeIndex;
    this.progressIndex = fullIdx;

    // Compute fraction
    if (fullIdx < this.path.length - 1) {
      const from = this.path[fullIdx];
      const to = this.path[fullIdx + 1];
      const segLen = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
      if (segLen > 0) {
        const projDx = this.position.x - from.x;
        const projDy = this.position.y - from.y;
        const segDx = to.x - from.x;
        const segDy = to.y - from.y;
        this.progressFraction = Math.max(0, Math.min(1, (projDx * segDx + projDy * segDy) / (segLen * segLen)));
      }
    }

    if (this._state === 'OFF_ROUTE' && snap.distanceToPath <= adaptiveSnapThreshold) {
      this._state = 'NAVIGATING';
    }

    // ── Confidence-based voice warnings ──
    if (confLevel === 'LOW' && this._state === 'NAVIGATING') {
      this.voice.speak('Adjusting your position.');
    }

    this.announceUpcoming();
    this.checkFloorTransition();
    this.emit();
  }

  getSnapshot(): NavSnapshot {
    const pathCoords = this.getCurrentFloorPath().map(n => ({ x: n.x, y: n.y, id: n.id }));
    const floorStartIdx = this.floorPathStartIndex();
    const localIdx = Math.max(0, this.progressIndex - floorStartIdx);

    const split = pathCoords.length >= 2
      ? splitRouteAtIndex(pathCoords, Math.min(localIdx, pathCoords.length - 1))
      : { completed: { points: '', nodeCount: 0 }, remaining: { points: '', nodeCount: 0 } };

    // Measured from where the person actually is (not the last node they
    // passed), so the numbers count down smoothly with every step.
    const distanceRemaining = this.distanceAlongRoute(this.path.length - 1);

    let currentInstruction: TurnInstruction | null = null;
    let distanceToNextTurn = distanceRemaining;

    for (const inst of this.instructions) {
      const instNodeIdx = this.path.findIndex(n => n.id === inst.nodeId);
      if (instNodeIdx > this.progressIndex) {
        currentInstruction = inst;
        distanceToNextTurn = this.distanceAlongRoute(instNodeIdx);
        break;
      }
    }

    const confSnap = this.confidence.getSnapshot();

    return {
      state: this._state,
      position: { ...this.position },
      progressIndex: this.progressIndex,
      progressFraction: this.progressFraction,
      // In real metres (plan units for buildings without a scale).
      distanceRemaining: Math.round(distanceRemaining / this.pxPerMeter),
      distanceToNextTurn: Math.round(distanceToNextTurn / this.pxPerMeter),
      currentInstruction,
      instructions: this.instructions,
      isOffRoute: this._state === 'OFF_ROUTE',
      completedPoints: split.completed.points,
      remainingPoints: split.remaining.points,
      currentFloorId: this.currentFloorId,
      floorTransitions: this.fullPath?.floorTransitions ?? [],
      isMultiFloor: (this.fullPath?.floors.length ?? 0) > 1,
      voiceEnabled: this.voice.isEnabled,
      confidence: confSnap.score,
      confidenceLevel: confSnap.level,
      confidenceSnapshot: confSnap,
    };
  }

  // ── Private ────────────────────────────────────────────────────────

  /** Plan distance from the current position to path[toIdx], following the route. */
  private distanceAlongRoute(toIdx: number): number {
    if (this.path.length === 0) return 0;
    const next = this.progressIndex + 1;
    if (this._state === 'IDLE' || next > toIdx || next >= this.path.length) {
      return calcRouteDistance(this.path.slice(this.progressIndex, toIdx + 1).map(n => ({ x: n.x, y: n.y })));
    }
    return dist(this.position, this.path[next]) + calcRouteDistance(this.path.slice(next, toIdx + 1).map(n => ({ x: n.x, y: n.y })));
  }

  private getCurrentFloorPath(): NavNode[] {
    if (!this.currentFloorId) return this.path;
    return this.path.filter(n => this.buildingGraph.getNodeFloorId(n.id) === this.currentFloorId);
  }

  private floorPathStartIndex(): number {
    if (!this.currentFloorId) return 0;
    return this.path.findIndex(n => this.buildingGraph.getNodeFloorId(n.id) === this.currentFloorId);
  }

  private shouldReroute(): boolean {
    const now = Date.now();
    // Rate-limit reroutes to at most once per 3 seconds
    if (now - this.lastRerouteTime < 3000) return false;
    // If confidence is high, allow reroute sooner
    if (this.confidence.level === 'HIGH') return true;
    // If moderate deviation count, allow
    return this.deviationCount >= 3;
  }

  private checkFloorTransition() {
    if (!this.fullPath) return;

    for (const t of this.fullPath.floorTransitions) {
      if (this.announcedFloorTransitions.has(t.index)) continue;

      if (this.progressIndex >= t.index - 1) {
        const connectorNode = this.path[t.index - 1];
        if (!connectorNode) continue;

        const dist = Math.sqrt(
          (this.position.x - connectorNode.x) ** 2 +
          (this.position.y - connectorNode.y) ** 2
        );

        if (dist < this.t.arrival * 2) {
          this.announcedFloorTransitions.add(t.index);

          // Lock horizontal position during transition
          this.floorTransitionActive = true;
          this.floorTransitionLockPos = { x: connectorNode.x, y: connectorNode.y };
          this.confidence.setFloorTransition(true);

          this.currentFloorId = t.toFloorId;
          this._state = 'NAVIGATING';

          const floor = this.buildingGraph.getFloor(t.toFloorId);
          const floorName = floor?.name ?? t.toFloorId;
          const verb = t.type === 'elevator' ? 'Taking elevator' : 'Taking stairs';
          this.voice.speakImmediate(`${verb} ${t.direction} to ${floorName}.`);

          this.callbacks.onFloorChange?.(t.toFloorId, t);

          // Unlock after brief delay (simulated by next few position updates)
          setTimeout(() => {
            this.floorTransitionActive = false;
            this.floorTransitionLockPos = null;
            this.confidence.setFloorTransition(false);
          }, 2000);

          this.emit();
        }
      }
    }
  }

  private announceUpcoming() {
    for (let i = 0; i < this.instructions.length; i++) {
      if (i <= this.lastAnnouncedInstIdx) continue;
      const inst = this.instructions[i];
      const instNodeIdx = this.path.findIndex(n => n.id === inst.nodeId);
      if (instNodeIdx <= this.progressIndex) {
        this.lastAnnouncedInstIdx = i;
        continue;
      }

      const segToTurn = this.path.slice(this.progressIndex, instNodeIdx + 1);
      const dist = calcRouteDistance(segToTurn.map(n => ({ x: n.x, y: n.y })));

      if (dist < this.t.voice && i > this.lastAnnouncedInstIdx) {
        this.voice.speak(inst.text);
        this.lastAnnouncedInstIdx = i;
        break;
      }
      break;
    }
  }

  private reroute(x: number, y: number) {
    if (!this.destinationNodeId || !this.currentFloorId) return;
    this.lastRerouteTime = Date.now();

    const nearest = this.buildingGraph.findNearest(x, y, this.currentFloorId);
    if (!nearest) return;

    const result = this.buildingGraph.findPath(nearest.id, this.destinationNodeId);
    if (!result) return;

    this.fullPath = result;
    this.path = result.nodeIds.map(id => this.buildingGraph.getNode(id)!).filter(Boolean);
    this.instructions = buildTurnInstructions(this.path, result.floorTransitions, this.buildingGraph, this.pxPerMeter);
    this.progressIndex = 0;
    this.progressFraction = 0;
    this.lastAnnouncedInstIdx = -1;
    this.announcedFloorTransitions.clear();
    this._state = 'NAVIGATING';
    this.deviationCount = 0;
    this.confidence.recordCorrection();

    if (this.instructions.length > 0) {
      this.voice.speak(this.instructions[0].text);
      this.lastAnnouncedInstIdx = 0;
    }

    this.callbacks.onReroute?.(this.path);
    this.emit();
  }

  private emit() {
    this.callbacks.onStateChange?.(this.getSnapshot());
  }
}
