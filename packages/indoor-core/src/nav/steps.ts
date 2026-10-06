// Turn-by-turn steps from a route: start, turns (slight / normal / sharp,
// left or right, through a door), stairs / lifts / escalators / ramps up or
// down to a named floor, and arrival. Each step knows where it happens
// along the 3D route line, so guidance can count down to it.
//
// Steps carry no text: i18n.ts words them in English or Amharic.

import type { IndoorVenue, Text2, Vec2 } from '../model';
import { dist } from '../geometry';
import type { Path3D } from '../path3d';
import type { Route } from './router';

export type TurnKind = 'slight-left' | 'left' | 'sharp-left' | 'slight-right' | 'right' | 'sharp-right' | 'u-turn';
export type ClimbKind = 'stairs-up' | 'stairs-down' | 'elevator-up' | 'elevator-down' | 'escalator-up' | 'escalator-down' | 'ramp-up' | 'ramp-down';
export type StepKind = 'start' | 'continue' | TurnKind | ClimbKind | 'arrive';

export interface Step {
  kind: StepKind;
  /** Where along the route line the step happens (m). */
  s: number;
  /** Metres from the previous step to this one. */
  distance: number;
  floorId: string;
  /** For floor changes: the floor you arrive on. */
  toFloorId?: string;
  at: Vec2;
  /** A named place at the step ("at the Café"), when there is one. */
  landmark?: Text2 | null;
  /** The turn is through a doorway. */
  door?: boolean;
  /** The destination's name (arrive / start). */
  place?: Text2 | null;
}

/** Turns gentler than this are "carry on" (plan drift), in degrees. */
const MIN_TURN = 28;

export function buildSteps(venue: IndoorVenue, route: Route, path: Path3D): Step[] {
  const node = new Map(venue.nodes.map(n => [n.id, n]));
  const sOf = new Map<number, number>();
  path.nodes.forEach((n, i) => sOf.set(i, n.s));
  const ids = route.nodeIds;
  const steps: Step[] = [];
  const first = node.get(ids[0]), last = node.get(ids[ids.length - 1]);
  if (!first || !last) return steps;
  steps.push({ kind: 'start', s: 0, distance: 0, floorId: first.floorId, at: first.at, place: first.name, landmark: first.name });

  for (let i = 1; i < ids.length - 1; i++) {
    const a = node.get(ids[i - 1])!, b = node.get(ids[i])!, c = node.get(ids[i + 1])!;
    const eIn = route.edges[i - 1], eOut = route.edges[i];
    // A floor change starts at b.
    if (eOut && eOut.kind !== 'walk' && eOut.kind !== 'door' && b.floorId !== c.floorId) {
      const up = (venue.floors.find(f => f.id === c.floorId)?.order ?? 0) > (venue.floors.find(f => f.id === b.floorId)?.order ?? 0);
      steps.push({ kind: `${eOut.kind}-${up ? 'up' : 'down'}` as ClimbKind, s: sOf.get(i) ?? 0, distance: 0, floorId: b.floorId, toFloorId: c.floorId, at: b.at, landmark: b.hallway ? null : b.name });
      continue;
    }
    if (b.floorId !== c.floorId) continue;
    // Just off the stairs: you're facing the way they climb (or descend), not from the point below.
    let d1 = { x: b.at.x - a.at.x, z: b.at.z - a.at.z };
    if (a.floorId !== b.floorId) {
      const conn = venue.connectors.find(k => k.id === eIn?.connectorId);
      if (!conn || conn.kind === 'elevator') continue;
      const up = conn.toFloorId === b.floorId;
      d1 = up ? conn.dir : { x: -conn.dir.x, z: -conn.dir.z };
    }
    const d2 = { x: c.at.x - b.at.x, z: c.at.z - b.at.z };
    if (Math.hypot(d1.x, d1.z) < 0.3 || Math.hypot(d2.x, d2.z) < 0.3) continue;
    const ang = (Math.atan2(d1.x * d2.z - d1.z * d2.x, d1.x * d2.x + d1.z * d2.z) * 180) / Math.PI; // + = right (plan z is down)
    const mag = Math.abs(ang);
    if (mag < MIN_TURN) continue;
    const side = ang > 0 ? 'right' : 'left';
    const kind: TurnKind = mag >= 160 ? 'u-turn' : mag < 50 ? `slight-${side}` : mag < 125 ? side : `sharp-${side}`;
    steps.push({ kind, s: sOf.get(i) ?? 0, distance: 0, floorId: b.floorId, at: b.at, landmark: b.hallway ? null : b.name, door: eOut?.kind === 'door' || eIn?.kind === 'door' });
  }
  steps.push({ kind: 'arrive', s: path.length, distance: 0, floorId: last.floorId, at: last.at, place: last.name });

  // Distances between consecutive steps; long straight stretches get a "continue".
  for (let i = 1; i < steps.length; i++) steps[i].distance = Math.max(0, steps[i].s - steps[i - 1].s);
  return steps;
}

/** The route's floors as the visitor will see them (for the floor indicator). */
export function floorsOnRoute(venue: IndoorVenue, route: Route) {
  return route.floors.map(id => venue.floors.find(f => f.id === id)!).filter(Boolean);
}

/** Straight-line distance between two steps' maneuver points (for tests and previews). */
export const stepGap = (a: Step, b: Step) => dist(a.at, b.at);
