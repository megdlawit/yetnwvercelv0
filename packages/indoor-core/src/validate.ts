// Checks a drawn venue before it goes live: rooms that aren't closed (or
// aren't walled in), doors and windows that aren't on a wall, path networks
// in pieces, stairs and lifts that lead nowhere or that no path climbs, and
// places nobody can be routed to. Each issue says where it is, so the editor
// can jump to it, and comes worded in English and Amharic.

import type { IndoorVenue, Lang, Vec2 } from './model';
import { centroid, dist, project, signedArea, segmentsCross } from './geometry';
import type { PlanRows } from './normalize';
import { t } from './nav/i18n';
import { obstacles } from './walls';

export type IssueKind =
  | 'room-unclosed' | 'room-open-walls' | 'door-off-wall' | 'graph-disconnected'
  | 'stairs-no-floor' | 'stairs-unlinked' | 'place-unroutable' | 'path-through-wall';

export interface Issue {
  kind: IssueKind;
  severity: 'error' | 'warning';
  floorId: string;
  /** Where to look (model metres). */
  at: Vec2;
  /** The rows involved (room, feature, node ids). */
  ids: string[];
  /** Extra words for the message (a name, a count). */
  detail?: Record<string, string | number>;
}

/** The message for an issue, in the editor's language. */
export function issueText(issue: Issue, lang: Lang): string {
  return t(lang, `issue.${issue.kind}`, issue.detail ?? {});
}

export function validate(venue: IndoorVenue, rows?: Pick<PlanRows, 'map_features'>, pxPerMeter = 40): Issue[] {
  const issues: Issue[] = [];

  // Rooms: a real outline, and walls along most of it (if the floor has walls at all).
  for (const r of venue.rooms) {
    const poly = r.polygon;
    const bad = poly.length < 3 || Math.abs(signedArea(poly)) < 0.25 || selfIntersects(poly);
    if (bad) { issues.push({ kind: 'room-unclosed', severity: 'error', floorId: r.floorId, at: poly[0] ?? { x: 0, z: 0 }, ids: [r.id], detail: { name: r.name.en || '—' } }); continue; }
    const walls = venue.walls.filter(w => w.floorId === r.floorId);
    if (!walls.length) continue;
    let covered = 0, total = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const n = Math.max(1, Math.round(dist(a, b) / 0.5));
      for (let k = 0; k <= n; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n };
        total++;
        // Walls or doorways count (a door is part of the enclosure).
        if (walls.some(w => project(p, w.a, w.b).d <= Math.max(0.35, w.thickness))) covered++;
      }
    }
    if (total && covered / total < 0.6) {
      issues.push({ kind: 'room-open-walls', severity: 'warning', floorId: r.floorId, at: centroid(poly), ids: [r.id], detail: { name: r.name.en || '—', percent: Math.round((covered / total) * 100) } });
    }
  }

  // Doors and windows must sit on a wall (else no opening is cut).
  for (const o of venue.openings) {
    if (!o.wallId) issues.push({ kind: 'door-off-wall', severity: 'error', floorId: o.floorId, at: o.at, ids: [o.id], detail: { kind: o.kind } });
  }

  // One path network: every point reachable from the largest piece.
  const adj = new Map<string, string[]>();
  for (const e of venue.edges) { (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to); (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push(e.from); }
  const seen = new Set<string>();
  const parts: string[][] = [];
  for (const n of venue.nodes) {
    if (seen.has(n.id)) continue;
    const part: string[] = [], stack = [n.id];
    seen.add(n.id);
    while (stack.length) { const u = stack.pop()!; part.push(u); for (const w of adj.get(u) ?? []) if (!seen.has(w)) { seen.add(w); stack.push(w); } }
    parts.push(part);
  }
  parts.sort((a, b) => b.length - a.length);
  const node = new Map(venue.nodes.map(n => [n.id, n]));
  for (const part of parts.slice(1)) {
    const first = node.get(part[0])!;
    const named = part.map(id => node.get(id)!).find(n => n.name && !n.hallway);
    issues.push({ kind: 'graph-disconnected', severity: part.length > 2 ? 'error' : 'warning', floorId: first.floorId, at: (named ?? first).at, ids: part, detail: { count: part.length, name: named?.name?.en ?? '' } });
  }

  // Paths that pass through a wall where there's no doorway (visitors would be told to walk through it).
  const linesOn = new Map<string, { a: Vec2; b: Vec2 }[]>();
  for (const e of venue.edges) {
    if (e.kind !== 'walk' && e.kind !== 'door') continue;
    const a = node.get(e.from), b = node.get(e.to);
    if (!a || !b || a.floorId !== b.floorId) continue;
    let lines = linesOn.get(a.floorId);
    if (!lines) { lines = obstacles(venue, a.floorId); linesOn.set(a.floorId, lines); }
    // Ends touching a wall don't count (a place set against a wall).
    const inner = (p: Vec2, q: Vec2, k: number) => ({ x: p.x + (q.x - p.x) * k, z: p.z + (q.z - p.z) * k });
    const p0 = inner(a.at, b.at, 0.04), p1 = inner(a.at, b.at, 0.96);
    if (lines.some(w => segmentsCross(p0, p1, w.a, w.b))) {
      issues.push({ kind: 'path-through-wall', severity: 'warning', floorId: a.floorId, at: inner(a.at, b.at, 0.5), ids: [a.id, b.id], detail: { name: (a.name ?? b.name)?.en ?? '' } });
    }
  }

  // Places nobody can reach.
  const main = new Set(parts[0] ?? []);
  for (const p of venue.pois) {
    if (!p.nodeId || !main.has(p.nodeId)) issues.push({ kind: 'place-unroutable', severity: 'warning', floorId: p.floorId, at: p.at, ids: [p.id], detail: { name: p.name.en } });
  }

  // Stairs and lifts: a floor to reach, and a path that climbs them.
  const drawnIds = new Set(venue.connectors.filter(c => c.drawn).map(c => c.id));
  for (const f of rows?.map_features ?? []) {
    if ((f.kind === 'stairs' || f.kind === 'elevator') && !drawnIds.has(f.id)) {
      const fl = venue.floors.find(x => x.id === f.floor_id);
      issues.push({ kind: 'stairs-no-floor', severity: 'error', floorId: f.floor_id, at: { x: f.x / pxPerMeter, z: f.y / pxPerMeter }, ids: [f.id], detail: { kind: f.kind, floor: fl?.name.en ?? '' } });
    }
  }
  for (const c of venue.connectors.filter(x => x.drawn)) {
    if (!venue.edges.some(e => e.connectorId === c.id)) issues.push({ kind: 'stairs-unlinked', severity: 'warning', floorId: c.fromFloorId, at: c.center, ids: [c.id], detail: { kind: c.kind } });
  }

  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

function selfIntersects(poly: Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours through the closing edge
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}
