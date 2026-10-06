/**
 * InstructionEngine — turns the active indoor or outdoor route into a
 * unified, dynamically-updated turn-by-turn instruction stream.
 *
 * Owned by NavigationBrain. Inputs:
 *   • Indoor: NavSnapshot (which already carries TurnInstruction[]).
 *   • Outdoor: an OutdoorNode[] polyline + the user's GeoCoord.
 *   • Environment: when it flips indoor↔outdoor we emit synthetic
 *     "Exit building" / "Enter building" instructions.
 *
 * Outputs:
 *   • UnifiedInstruction[] — the full route plan.
 *   • current / next — recomputed on every position update.
 *   • distanceRemainingM, estimatedTimeS — recomputed too.
 *   • diff() — used by the brain to decide what to announce via VoiceQueue.
 */

import type { TurnInstruction, NavSnapshot } from '@/lib/NavigationController';
import type { Environment, GeoCoord, OutdoorNode } from '@/lib/geo/GeoTypes';
import { haversineMeters } from '@/lib/geo/GeoMath';

export type UnifiedInstructionType =
  | 'START'
  | 'STRAIGHT'
  | 'LEFT'
  | 'RIGHT'
  | 'SLIGHT_LEFT'
  | 'SLIGHT_RIGHT'
  | 'STAIRS_UP'
  | 'STAIRS_DOWN'
  | 'ELEVATOR_UP'
  | 'ELEVATOR_DOWN'
  | 'EXIT_BUILDING'
  | 'ENTER_BUILDING'
  | 'ARRIVE';

export interface UnifiedInstruction {
  id: string;
  type: UnifiedInstructionType;
  /** Distance in meters from the previous instruction's anchor to this one. */
  distanceM: number;
  /** Spoken text ("Turn left in 12 m"). */
  text: string;
  /** Source: indoor pixel-graph or outdoor geo-graph. */
  source: 'indoor' | 'outdoor' | 'transition';
}

export interface InstructionHud {
  current: UnifiedInstruction | null;
  next: UnifiedInstruction | null;
  /** Distance to the *current* instruction's maneuver point, meters. */
  distanceToManeuverM: number;
  /** Total distance remaining along the route, meters. */
  distanceRemainingM: number;
  /** Estimated time remaining at walking speed, seconds. */
  estimatedTimeS: number;
  list: UnifiedInstruction[];
}

const WALKING_SPEED_MPS = 1.3;        // ~4.7 km/h
const PIXELS_PER_METER = 1;           // app's stated 1 unit = 1 m
const MIN_TURN_ANGLE_DEG = 25;        // ignore drift
const SHARP_TURN_ANGLE_DEG = 60;

export const EMPTY_HUD: InstructionHud = {
  current: null,
  next: null,
  distanceToManeuverM: 0,
  distanceRemainingM: 0,
  estimatedTimeS: 0,
  list: [],
};

interface IndoorInputs {
  kind: 'indoor';
  snapshot: NavSnapshot;
}
interface OutdoorInputs {
  kind: 'outdoor';
  path: OutdoorNode[];
  remainingM: number;
  here: GeoCoord | null;
}
interface NoneInputs { kind: 'none'; }

export type InstructionInputs = IndoorInputs | OutdoorInputs | NoneInputs;

export class InstructionEngine {
  private hud: InstructionHud = EMPTY_HUD;
  /** Last environment seen — used to detect transitions. */
  private lastEnv: Environment = 'unknown';

  /** Recompute HUD given the current routing inputs + environment.
   *  `speedMps` lets the caller pass a driving speed for outdoor car routes
   *  instead of the walking default — indoor legs always use walking speed
   *  regardless, since you're on foot inside a building either way. */
  update(inputs: InstructionInputs, env: Environment, speedMps: number = WALKING_SPEED_MPS): InstructionHud {
    const list = this.buildList(inputs, env);
    let current: UnifiedInstruction | null = null;
    let next: UnifiedInstruction | null = null;
    let distanceToManeuverM = 0;
    let distanceRemainingM = 0;

    if (inputs.kind === 'indoor') {
      const snap = inputs.snapshot;
      // Map the controller's current TurnInstruction → unified.
      if (snap.state === 'ARRIVED') {
        // Nothing left ahead — show the arrival, not the route's first line.
        current = [...list].reverse().find(i => i.type === 'ARRIVE') ?? null;
        next = null;
      } else if (snap.currentInstruction) {
        const idx = list.findIndex(i => i.id === idForIndoor(snap.currentInstruction!));
        current = idx >= 0 ? list[idx] : list[0] ?? null;
        next = idx >= 0 && idx + 1 < list.length ? list[idx + 1] : null;
      } else {
        current = list[0] ?? null;
        next = list[1] ?? null;
      }
      distanceToManeuverM = pxToM(snap.distanceToNextTurn);
      distanceRemainingM = pxToM(snap.distanceRemaining);
    } else if (inputs.kind === 'outdoor') {
      // Find the nearest segment to the user → "current" maneuver is the next
      // turn after that segment.
      const here = inputs.here;
      if (here && inputs.path.length >= 2) {
        const { segIdx, distAhead } = findOutdoorProgress(inputs.path, here);
        // The instruction list is built so that index N corresponds to the
        // turn at path[N+1]; current = first instruction whose index > segIdx.
        for (let i = 0; i < list.length; i++) {
          if (list[i].source === 'transition') continue;
          // Use a counter on outdoor instructions to map back to path index.
          const pathIdx = (list[i] as any).__pathIdx as number | undefined;
          if (pathIdx == null || pathIdx > segIdx) {
            current = list[i];
            next = list[i + 1] ?? null;
            // distance from here to that maneuver:
            distanceToManeuverM = distAhead;
            if (pathIdx != null) {
              for (let j = segIdx + 1; j < pathIdx; j++) {
                distanceToManeuverM += haversineMeters(inputs.path[j], inputs.path[j + 1]);
              }
            }
            break;
          }
        }
      } else {
        current = list[0] ?? null;
        next = list[1] ?? null;
      }
      distanceRemainingM = inputs.remainingM;
    }

    const estimatedTimeS = Math.round(distanceRemainingM / speedMps);
    this.lastEnv = env;
    this.hud = {
      current,
      next,
      distanceToManeuverM: Math.max(0, Math.round(distanceToManeuverM)),
      distanceRemainingM: Math.max(0, Math.round(distanceRemainingM)),
      estimatedTimeS,
      list,
    };
    return this.hud;
  }

  /** Compute what changed vs. a previous HUD — drives voice announcements. */
  diffForVoice(prev: InstructionHud, curr: InstructionHud): UnifiedInstruction | null {
    if (!curr.current) return null;
    if (prev.current?.id !== curr.current.id) {
      // New maneuver became current → announce.
      return curr.current;
    }
    // Same maneuver: announce when we get close (≤ 30 m) and haven't already.
    if (curr.distanceToManeuverM <= 30 && (prev.distanceToManeuverM > 30 || prev.current?.id !== curr.current.id)) {
      return curr.current;
    }
    return null;
  }

  reset(): void {
    this.hud = EMPTY_HUD;
    this.lastEnv = 'unknown';
  }

  getHud(): InstructionHud {
    return this.hud;
  }

  // ── private ─────────────────────────────────────────────────────

  private buildList(inputs: InstructionInputs, env: Environment): UnifiedInstruction[] {
    if (inputs.kind === 'indoor') return this.fromIndoor(inputs.snapshot);
    if (inputs.kind === 'outdoor') return this.fromOutdoor(inputs.path, env);
    return [];
  }

  private fromIndoor(snap: NavSnapshot): UnifiedInstruction[] {
    const out: UnifiedInstruction[] = [];
    out.push({
      id: 'indoor-start',
      type: 'START',
      distanceM: 0,
      text: 'Starting indoor navigation.',
      source: 'indoor',
    });
    for (const ti of snap.instructions) {
      out.push(toUnifiedIndoor(ti));
    }
    return out;
  }

  private fromOutdoor(path: OutdoorNode[], env: Environment): UnifiedInstruction[] {
    if (path.length < 2) return [];
    const out: UnifiedInstruction[] = [];
    const startText = env === 'transitioning'
      ? 'Exiting building. Continue outside.'
      : 'Starting outdoor navigation.';
    out.push({
      id: 'outdoor-start',
      type: env === 'transitioning' ? 'EXIT_BUILDING' : 'START',
      distanceM: 0,
      text: startText,
      source: env === 'transitioning' ? 'transition' : 'outdoor',
    });

    let accumDist = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const segDist = haversineMeters(path[i], path[i + 1]);
      accumDist += segDist;
      // Need three points for a turn angle.
      if (i < path.length - 2) {
        const angle = bearingDelta(path[i], path[i + 1], path[i + 2]);
        const absA = Math.abs(angle);
        if (absA >= MIN_TURN_ANGLE_DEG) {
          const type: UnifiedInstructionType = angle > 0
            ? (absA >= SHARP_TURN_ANGLE_DEG ? 'RIGHT' : 'SLIGHT_RIGHT')
            : (absA >= SHARP_TURN_ANGLE_DEG ? 'LEFT'  : 'SLIGHT_LEFT');
          const verb = type === 'RIGHT' ? 'Turn right'
            : type === 'LEFT' ? 'Turn left'
            : type === 'SLIGHT_RIGHT' ? 'Bear right'
            : 'Bear left';
          const inst: UnifiedInstruction = {
            id: `outdoor-turn-${i + 1}`,
            type,
            distanceM: Math.round(accumDist),
            text: `${verb} in ${Math.round(accumDist)} meters.`,
            source: 'outdoor',
          };
          (inst as any).__pathIdx = i + 1;
          out.push(inst);
          accumDist = 0;
        }
      }
    }
    // Final arrive.
    const arrive: UnifiedInstruction = {
      id: 'outdoor-arrive',
      type: 'ARRIVE',
      distanceM: Math.round(accumDist),
      text: 'You have arrived at your destination.',
      source: 'outdoor',
    };
    (arrive as any).__pathIdx = path.length - 1;
    out.push(arrive);
    return out;
  }
}

// ── helpers ───────────────────────────────────────────────────────

function pxToM(px: number): number {
  return px / PIXELS_PER_METER;
}

function idForIndoor(ti: TurnInstruction): string {
  return `indoor-${ti.nodeId}-${ti.type}`;
}

function toUnifiedIndoor(ti: TurnInstruction): UnifiedInstruction {
  const map: Record<string, UnifiedInstructionType> = {
    LEFT: 'LEFT', RIGHT: 'RIGHT', STRAIGHT: 'STRAIGHT', ARRIVE: 'ARRIVE',
    STAIRS_UP: 'STAIRS_UP', STAIRS_DOWN: 'STAIRS_DOWN',
    ELEVATOR_UP: 'ELEVATOR_UP', ELEVATOR_DOWN: 'ELEVATOR_DOWN',
  };
  return {
    id: idForIndoor(ti),
    type: map[ti.type] ?? 'STRAIGHT',
    distanceM: pxToM(ti.distance),
    text: ti.text,
    source: 'indoor',
  };
}

/** Initial bearing in degrees from a → b. */
function bearing(a: GeoCoord, b: GeoCoord): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Signed turn angle in degrees (right positive, left negative) at b. */
function bearingDelta(a: GeoCoord, b: GeoCoord, c: GeoCoord): number {
  const b1 = bearing(a, b);
  const b2 = bearing(b, c);
  let d = b2 - b1;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** Find which path segment the user is on + distance to its end. */
function findOutdoorProgress(path: OutdoorNode[], here: GeoCoord): { segIdx: number; distAhead: number } {
  let best = { segIdx: 0, distAhead: 0, score: Infinity };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dHere = haversineMeters(here, a) + haversineMeters(here, b);
    const segLen = haversineMeters(a, b);
    const detour = dHere - segLen; // ~0 when on-segment
    if (detour < best.score) {
      const distAhead = haversineMeters(here, b);
      best = { segIdx: i, distAhead, score: detour };
    }
  }
  return { segIdx: best.segIdx, distAhead: best.distAhead };
}
