// Geometry analysis for drawings that don't say what they contain.
//
// Many real plans put everything on one layer, carry no room outlines and
// no door blocks, and declare the wrong units (or none). The drawing itself
// still tells us a lot:
//  - door swings are quarter circles about 0.6–1.2 m across, which reveals
//    both the doors and the drawing's real units;
//  - a sheet often holds several drawings (plan, elevations, details) set
//    apart from each other; the plan is the one with the door swings;
//  - rooms are the spaces the walls enclose (see detectRooms.ts).

import type { DxfEntity, DxfPoint } from '../dxf/parseDxf';
import type { CadDrawing } from './types';

export interface SwingArc { center: DxfPoint; radius: number; startDeg: number; endDeg: number; layer: string; source: DxfEntity }

const DOOR_MIN_M = 0.55, DOOR_MAX_M = 1.3;

/** If an open polyline traces a circular arc, its circle and angles (door swings drawn as segments). */
export function polylineAsArc(pts: DxfPoint[]): { center: DxfPoint; radius: number; startDeg: number; endDeg: number } | null {
  if (pts.length < 4) return null;
  const a = pts[0], b = pts[Math.floor(pts.length / 2)], c = pts[pts.length - 1];
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const ux = ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d;
  const uy = ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - ux, a.y - uy);
  if (!(r > 0) || pts.some(p => Math.abs(Math.hypot(p.x - ux, p.y - uy) - r) > r * 0.04)) return null;
  const ang = (p: DxfPoint) => (Math.atan2(p.y - uy, p.x - ux) * 180) / Math.PI;
  // walk the angles to get the signed sweep
  let sweep = 0;
  for (let i = 1; i < pts.length; i++) {
    let s = ang(pts[i]) - ang(pts[i - 1]);
    while (s > 180) s -= 360;
    while (s < -180) s += 360;
    sweep += s;
  }
  const s0 = ang(a), s1 = ang(c);
  return sweep > 0 ? { center: { x: ux, y: uy }, radius: r, startDeg: s0, endDeg: s1 } : { center: { x: ux, y: uy }, radius: r, startDeg: s1, endDeg: s0 };
}

const sweepOf = (a: { startDeg: number; endDeg: number }) => { let s = a.endDeg - a.startDeg; while (s <= 0) s += 360; while (s > 360) s -= 360; return s; };

/** Every quarter-circle arc in the drawing (real ARCs and arc-shaped polylines), in drawing units. */
export function quarterArcs(entities: DxfEntity[], skipLayers: Set<string> = new Set()): SwingArc[] {
  const out: SwingArc[] = [];
  for (const e of entities) {
    if (skipLayers.has(e.layer)) continue;
    let arc: { center: DxfPoint; radius: number; startDeg: number; endDeg: number } | null = null;
    if (e.kind === 'ARC') arc = e;
    else if (e.kind === 'POLYLINE' && !e.closed) arc = polylineAsArc(e.pts);
    if (!arc) continue;
    const sw = sweepOf(arc);
    if (sw >= 75 && sw <= 105) out.push({ ...arc, layer: e.layer, source: e });
  }
  return out;
}

/**
 * Swings that have a door leaf drawn from the hinge, about one radius long.
 * Curved fixtures (basins, seats, fillets) are quarter circles too, but
 * only doors have a leaf — so these measure door sizes whatever the units.
 */
export function leafedArcs(entities: DxfEntity[], arcs: SwingArc[]): SwingArc[] {
  const shapes: DxfPoint[][] = [];
  for (const e of entities) {
    if (e.kind === 'LINE') shapes.push([e.a, e.b]);
    else if (e.kind === 'POLYLINE' && e.pts.length <= 5) shapes.push(e.pts);
  }
  if (!arcs.length) return [];
  // A leaf starts at the hinge (within 8 % of the radius): the shapes' points sorted by x, so
  // each swing looks only at the points beside its centre (a big sheet has 20,000 arcs ×
  // 300,000 lines, and a few site arcs are a thousand times a door's size).
  const xs: number[] = [], ys: number[] = [], owner: DxfPoint[][] = [];
  const order: number[] = [];
  for (const pts of shapes) for (const p of pts) { order.push(xs.length); xs.push(p.x); ys.push(p.y); owner.push(pts); }
  order.sort((i, j) => xs[i] - xs[j]);
  const sortedX = order.map(i => xs[i]);
  const firstAtLeast = (x: number) => {
    let lo = 0, hi = sortedX.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedX[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  };
  return arcs.filter(a => {
    const tol = a.radius * 0.08;
    const seen = new Set<DxfPoint[]>();
    for (let k = firstAtLeast(a.center.x - tol); k < sortedX.length && sortedX[k] <= a.center.x + tol; k++) {
      const i = order[k];
      if (Math.abs(ys[i] - a.center.y) > tol || seen.has(owner[i])) continue;
      seen.add(owner[i]);
      if (isLeafOf(owner[i], a)) return true;
    }
    return false;
  });
}

/**
 * Is this short shape the leaf of that swing? It must start at the hinge and
 * reach the end of the swing — so a wall that merely starts at the hinge
 * (and happens to be about a door's length) doesn't count.
 */
export function isLeafOf(pts: DxfPoint[], a: { center: DxfPoint; radius: number; startDeg: number; endDeg: number }): boolean {
  const r = a.radius, d = (p: DxfPoint, q: DxfPoint) => Math.hypot(p.x - q.x, p.y - q.y);
  if (!pts.some(p => d(p, a.center) < r * 0.08)) return false;
  const far = pts.reduce((best, p) => (d(p, a.center) > d(best, a.center) ? p : best), pts[0]);
  if (Math.abs(d(far, a.center) - r) > r * 0.15) return false;
  const end = (deg: number) => ({ x: a.center.x + r * Math.cos((deg * Math.PI) / 180), y: a.center.y + r * Math.sin((deg * Math.PI) / 180) });
  return d(far, end(a.startDeg)) < r * 0.2 || d(far, end(a.endDeg)) < r * 0.2;
}

export interface UnitsGuess { perMeter: number; name: string; source: 'file' | 'inferred' | 'assumed'; reason: string }

const CANDIDATES = [
  { perMeter: 1000, name: 'millimetres' }, { perMeter: 100, name: 'centimetres' }, { perMeter: 1, name: 'metres' },
  { perMeter: 39.3701, name: 'inches' }, { perMeter: 3.28084, name: 'feet' },
];

/** Extent of the bulk of the geometry (5th–95th percentile), ignoring stray far-off bits. */
export function robustExtent(entities: DxfEntity[]): number {
  const xs: number[] = [], ys: number[] = [];
  for (const e of entities) {
    const p = e.kind === 'LINE' ? e.a : e.kind === 'POLYLINE' ? e.pts[0] : e.kind === 'TEXT' || e.kind === 'INSERT' ? e.pos : e.center;
    xs.push(p.x); ys.push(p.y);
  }
  if (xs.length < 2) return 0;
  const q = (v: number[], f: number) => v.sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * f))];
  return Math.max(q(xs, 0.95) - q(xs, 0.05), q(ys, 0.95) - q(ys, 0.05));
}

/**
 * Work out the drawing's real units. Door swings measure doors, so the
 * unit that makes the most swings door-sized wins; the plan's overall size
 * must also be believable for a venue. The file's own declaration is
 * trusted unless the drawing clearly contradicts it (a common export bug).
 */
export function inferUnits(d: CadDrawing, arcs = quarterArcs(d.entities)): UnitsGuess {
  const extent = robustExtent(d.entities);
  const declared = d.unitsPerMeter;
  const declaredName = CANDIDATES.find(c => declared !== null && Math.abs(declared - c.perMeter) / c.perMeter < 0.01)?.name;

  // Best evidence: doors with leaves. Typical door leaves are ~0.85 m.
  const leafed = leafedArcs(d.entities, arcs);
  if (leafed.length >= 2) {
    const radii = leafed.map(a => a.radius).sort((a, b) => a - b);
    const median = radii[Math.floor(radii.length / 2)];
    // Window and cupboard swings have leaves too, so not the median of all swings: the unit
    // that makes the most of them door-sized (0.6–1.2 m) wins; ties go to the declared unit,
    // then to doors nearest 0.85 m.
    const fits = CANDIDATES.map(c => {
      const doors = radii.filter(r => r / c.perMeter >= 0.6 && r / c.perMeter <= 1.2);
      return { ...c, count: doors.length, door: doors.length ? doors[Math.floor(doors.length / 2)] / c.perMeter : 0 };
    }).filter(c => c.count >= 2)
      .sort((a, b) => b.count - a.count || Number(b.name === declaredName) - Number(a.name === declaredName) || Math.abs(a.door - 0.85) - Math.abs(b.door - 0.85));
    const n = fits[0]?.count ?? leafed.length;
    if (fits.length) {
      const pick = fits[0];
      if (pick.name === declaredName) return { perMeter: pick.perMeter, name: pick.name, source: 'file', reason: `the file says ${pick.name}, and its ${n} doors measure ${pick.door.toFixed(2)} m` };
      return {
        perMeter: pick.perMeter, name: pick.name, source: 'inferred',
        reason: `${declaredName ? `the file says ${declaredName}, but ` : ''}its ${n} doors measure ${pick.door.toFixed(2)} m in ${pick.name}`,
      };
    }
    // No standard unit makes doors door-sized: a plotted / scaled drawing.
    const perMeter = median / 0.85;
    return {
      perMeter, name: `custom scale (1 m = ${perMeter.toPrecision(3)} units)`, source: 'inferred',
      reason: `a scaled drawing — its ${n} doors set the scale to 1 m = ${perMeter.toPrecision(3)} units (${(extent / perMeter).toFixed(0)} m across). Measure a known distance to confirm`,
    };
  }

  const scored = CANDIDATES.map(c => {
    const doors = arcs.filter(a => a.radius / c.perMeter >= DOOR_MIN_M && a.radius / c.perMeter <= DOOR_MAX_M).length;
    const m = extent / c.perMeter;
    const plausible = m >= 4 && m <= 1500;
    const typical = m >= 8 && m <= 400;
    const isDeclared = declared !== null && Math.abs(declared - c.perMeter) / c.perMeter < 0.01;
    return { ...c, doors, m, score: doors * 3 + (plausible ? 20 : -50) + (typical ? 5 : 0) + (isDeclared ? 15 : 0) };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const declaredC = scored.find(c => declared !== null && Math.abs(declared - c.perMeter) / c.perMeter < 0.01);
  if (declaredC && declaredC === best) {
    return { perMeter: best.perMeter, name: best.name, source: 'file', reason: `the file says ${best.name}` };
  }
  if (declaredC) {
    return {
      perMeter: best.perMeter, name: best.name, source: 'inferred',
      reason: `the file says ${declaredC.name}, but ${best.doors ? `its ${best.doors} door swings measure as doors` : 'its size only makes sense'} in ${best.name} (${best.m.toFixed(0)} m across)`,
    };
  }
  return {
    perMeter: best.perMeter, name: best.name, source: best.doors > 0 ? 'inferred' : 'assumed',
    reason: best.doors > 0 ? `${best.doors} door swings measure as doors in ${best.name}` : `the plan is ${best.m.toFixed(0)} m across in ${best.name} — check it`,
  };
}

export interface DrawingArea { minX: number; minY: number; maxX: number; maxY: number; entities: number; doors: number; label: string }

/**
 * Separate drawings on one sheet: geometry clustered on a coarse grid
 * (cells of ~1.5 m, touching cells joined). Returns the clusters worth
 * importing, best floor-plan candidate (most door swings) first.
 */
export function findDrawings(d: CadDrawing, perMeter: number, arcs = quarterArcs(d.entities)): DrawingArea[] {
  if (!d.bounds) return [];
  const cell = 1.5 * perMeter;
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const occ = new Map<string, number>();
  const mark = (p: DxfPoint) => { const k = key(p.x, p.y); occ.set(k, (occ.get(k) ?? 0) + 1); };
  const along = (a: DxfPoint, b: DxfPoint) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / cell));
    for (let i = 0; i <= n; i++) mark({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  };
  for (const e of d.entities) {
    if (e.kind === 'LINE') along(e.a, e.b);
    else if (e.kind === 'POLYLINE') for (let i = 1; i < e.pts.length; i++) along(e.pts[i - 1], e.pts[i]);
    else if (e.kind === 'CIRCLE' || e.kind === 'ARC') mark(e.center);
    else if (e.kind === 'TEXT') mark(e.pos);
  }
  // connected components of occupied cells (8-neighbours)
  const comp = new Map<string, number>();
  const boxes: { minX: number; minY: number; maxX: number; maxY: number; n: number }[] = [];
  for (const start of occ.keys()) {
    if (comp.has(start)) continue;
    const id = boxes.length;
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, n: 0 };
    const stack = [start];
    comp.set(start, id);
    while (stack.length) {
      const k = stack.pop()!;
      const [cx, cy] = k.split(',').map(Number);
      box.minX = Math.min(box.minX, cx * cell); box.maxX = Math.max(box.maxX, (cx + 1) * cell);
      box.minY = Math.min(box.minY, cy * cell); box.maxY = Math.max(box.maxY, (cy + 1) * cell);
      box.n += occ.get(k)!;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nk = `${cx + dx},${cy + dy}`;
        if (occ.has(nk) && !comp.has(nk)) { comp.set(nk, id); stack.push(nk); }
      }
    }
    boxes.push(box);
  }
  // A door belongs to the drawing its hinge is drawn in — not to any drawing
  // whose bounding box happens to contain it (a sheet border contains everything).
  const doorsIn = new Array(boxes.length).fill(0);
  for (const a of arcs) {
    if (a.radius / perMeter < DOOR_MIN_M || a.radius / perMeter > DOOR_MAX_M) continue;
    const id = comp.get(key(a.center.x, a.center.y));
    if (id !== undefined) doorsIn[id]++;
  }
  const areas = boxes
    .map((b, id) => ({ ...b, id }))
    .filter(b => b.n >= 6 && Math.max(b.maxX - b.minX, b.maxY - b.minY) / perMeter >= 3)
    .map(b => ({ minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, entities: b.n, doors: doorsIn[b.id], label: '' }))
    .sort((a, b) => b.doors - a.doors || b.entities - a.entities);
  areas.forEach((a, i) => {
    const w = (a.maxX - a.minX) / perMeter, h = (a.maxY - a.minY) / perMeter;
    a.label = `${i === 0 && a.doors > 0 ? 'Floor plan' : `Drawing ${i + 1}`} — ${w.toFixed(0)} × ${h.toFixed(0)} m, ${a.doors} door${a.doors === 1 ? '' : 's'}`;
  });
  return areas;
}

/**
 * The FLOOR PLANS on a sheet, one area per plan. Real sheets carry plans next
 * to elevations, sections, the site plan and legends, all tied together by
 * dimension and grid lines — so drawings are found by their walls (walls of
 * two plans never touch), and a floor plan is one with door swings in it
 * (elevations and sections show no swings). Pieces of one plan split by a wide
 * opening are joined when their boxes overlap.
 */
/**
 * Rectangles drawn round a plan on the sheet (a viewport or a frame), even on a wall layer:
 * big, and nothing else on those layers touches them — the plan sits inside with a margin.
 * A building's outer wall is never like that: its inside walls join it.
 */
function framesAmong(walls: DxfEntity[], perMeter: number): Set<DxfEntity> {
  const out = new Set<DxfEntity>();
  const tol = 0.3 * perMeter;
  const rects = walls.filter((e): e is Extract<DxfEntity, { kind: 'POLYLINE' }> => {
    if (e.kind !== 'POLYLINE') return false;
    const pts = e.pts.length === 5 && Math.hypot(e.pts[4].x - e.pts[0].x, e.pts[4].y - e.pts[0].y) <= tol ? e.pts.slice(0, 4) : e.pts;
    if (pts.length !== 4 || (!e.closed && pts === e.pts)) return false;
    const xs = new Set(pts.map(p => Math.round(p.x / tol))), ys = new Set(pts.map(p => Math.round(p.y / tol)));
    const w = Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)), h = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y));
    return xs.size <= 2 && ys.size <= 2 && Math.min(w, h) >= 8 * perMeter;   // axis-aligned, at least 8 m a side
  });
  if (!rects.length) return out;
  const ends: DxfPoint[] = [];
  for (const e of walls) {
    if (e.kind === 'LINE') ends.push(e.a, e.b);
    else if (e.kind === 'POLYLINE' && !rects.includes(e)) ends.push(...e.pts);
  }
  for (const r of rects) {
    const x0 = Math.min(...r.pts.map(p => p.x)), x1 = Math.max(...r.pts.map(p => p.x));
    const y0 = Math.min(...r.pts.map(p => p.y)), y1 = Math.max(...r.pts.map(p => p.y));
    let inside = 0, touching = 0;
    for (const p of ends) {
      if (p.x < x0 - tol || p.x > x1 + tol || p.y < y0 - tol || p.y > y1 + tol) continue;
      inside++;
      if (Math.min(p.x - x0, x1 - p.x, p.y - y0, y1 - p.y) <= tol) touching++;
    }
    if (inside >= 8 && touching === 0) out.add(r);
  }
  return out;
}

/**
 * Hatch outlines shaped like walls: thin (5–45 cm thick, as 2 × area ÷ perimeter, the width
 * of a long thin shape) and at least 40 cm long. Many offices draw walls as hatched areas with
 * no lines, often on a dimension or hatch layer; a floor, tile or grass hatch is room-wide and
 * never passes. `keep` filters by layer (the wall builder leaves out furniture and windows).
 */
export function wallHatchLoops(d: CadDrawing, perMeter: number, keep: (layer: string) => boolean = () => true): DxfPoint[][] {
  const out: DxfPoint[][] = [];
  for (const h of d.hatches ?? []) {
    if (!keep(h.layer)) continue;
    for (const loop of h.loops) {
      let area = 0, perimeter = 0;
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i], q = loop[(i + 1) % loop.length];
        area += p.x * q.y - q.x * p.y;
        perimeter += Math.hypot(q.x - p.x, q.y - p.y);
      }
      area = Math.abs(area) / 2;
      if (perimeter <= 0) continue;
      const thick = (2 * area) / perimeter / perMeter, long = perimeter / 2 / perMeter;
      if (thick >= 0.05 && thick <= 0.45 && long >= 0.4) out.push(loop);
    }
  }
  return out;
}

export function findFloorPlans(d: CadDrawing, isWallLayer: (layer: string) => boolean, perMeter: number,
                               arcs = quarterArcs(d.entities)): DrawingArea[] {
  // The wall segments once (lines, polylines, wall-shaped hatches; frames round plans left out).
  const segs: [DxfPoint, DxfPoint][] = [];
  const frames = framesAmong(d.entities.filter(e => isWallLayer(e.layer)), perMeter);
  for (const e of d.entities) {
    if (!isWallLayer(e.layer) || frames.has(e)) continue;
    if (e.kind === 'LINE') segs.push([e.a, e.b]);
    else if (e.kind === 'POLYLINE') for (let i = 1; i < e.pts.length; i++) segs.push([e.pts[i - 1], e.pts[i]]);
  }
  for (const loop of wallHatchLoops(d, perMeter)) for (let i = 0; i < loop.length; i++) segs.push([loop[i], loop[(i + 1) % loop.length]]);

  type Box = { minX: number; minY: number; maxX: number; maxY: number; len: number };
  /** Groups of walls closer than about a cell, as boxes; boxes that overlap are one plan in pieces. */
  const boxesAt = (cell: number, within?: Box): Box[] => {
    const occ = new Map<string, number>();   // cell → wall length in it (drawing units)
    const inside = (p: DxfPoint) => !within || (p.x >= within.minX && p.x <= within.maxX && p.y >= within.minY && p.y <= within.maxY);
    for (const [a, b] of segs) {
      if (!inside(a) || !inside(b)) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(len / cell));
      for (let i = 0; i <= n; i++) {
        const k = `${Math.floor((a.x + ((b.x - a.x) * i) / n) / cell)},${Math.floor((a.y + ((b.y - a.y) * i) / n) / cell)}`;
        occ.set(k, (occ.get(k) ?? 0) + len / (n + 1));
      }
    }
    const seen = new Set<string>();
    let boxes: Box[] = [];
    for (const start of occ.keys()) {
      if (seen.has(start)) continue;
      const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, len: 0 };
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const k = stack.pop()!;
        const [cx, cy] = k.split(',').map(Number);
        box.minX = Math.min(box.minX, cx * cell); box.maxX = Math.max(box.maxX, (cx + 1) * cell);
        box.minY = Math.min(box.minY, cy * cell); box.maxY = Math.max(box.maxY, (cy + 1) * cell);
        box.len += occ.get(k)!;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const nk = `${cx + dx},${cy + dy}`;
          if (occ.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
        }
      }
      boxes.push(box);
    }
    // One plan in pieces (a wide opening, a gap in the outer wall): join boxes that overlap.
    const overlap = (a: Box, b: Box) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
    for (let merged = true; merged;) {
      merged = false;
      outer: for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        if (!overlap(boxes[i], boxes[j])) continue;
        const a = boxes[i], b = boxes[j];
        boxes[i] = { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY), len: a.len + b.len };
        boxes = boxes.filter((_, k) => k !== j);
        merged = true;
        break outer;
      }
    }
    return boxes;
  };
  const doorsIn = (b: Box) => arcs.filter(a => a.radius / perMeter >= DOOR_MIN_M && a.radius / perMeter <= DOOR_MAX_M
    && a.center.x >= b.minX && a.center.x <= b.maxX && a.center.y >= b.minY && a.center.y <= b.maxY).length;
  const asCandidate = (b: Box) => ({ ...b, doors: doorsIn(b), w: b.maxX - b.minX, h: b.maxY - b.minY });
  const big = (b: ReturnType<typeof asCandidate>) => b.len / perMeter >= 20 && Math.min(b.w, b.h) / perMeter >= 4;

  // Plans drawn close together (about a metre apart) group as one: looked at more finely, such a
  // group falls apart into similar plans that each have doors — then it was several plans.
  const candidates = boxesAt(1.5 * perMeter).map(asCandidate).filter(big).flatMap(b => {
    const pieces = boxesAt(0.75 * perMeter, b).map(asCandidate).filter(big);
    const plans = pieces.filter(p => p.doors >= 1);
    const largest = Math.max(0, ...plans.map(p => p.w * p.h));
    return plans.length >= 2 && plans.every(p => p.w * p.h >= 0.4 * largest) ? pieces : [b];
  });
  const withDoors = candidates.filter(b => b.doors >= 1);
  // A floor without door swings (a basement car park) still counts when it has the footprint
  // of a floor that has them: floors of one building share it, elevations and sections don't.
  const sameFootprint = (a: typeof candidates[number], b: typeof candidates[number]) =>
    Math.abs(a.w - b.w) <= 0.15 * b.w && Math.abs(a.h - b.h) <= 0.15 * b.h && a.len >= 0.4 * b.len;
  // The sheet's own titles beat door counting: ArchiCAD exports draw shop shutters without
  // swings and open doors at 60–75°, and an elevation's window arcs can pass for doors.
  const titled = (b: typeof candidates[number]) => titleKind(d, b, perMeter);
  const plans = candidates
    .filter(b => { const t = titled(b); return t === 'floor' || (t !== 'other' && (b.doors >= 1 || withDoors.some(o => sameFootprint(b, o)))); })
    .sort((a, b) => a.minX - b.minX || a.minY - b.minY);
  return plans.map(b => {
    const w = (b.maxX - b.minX) / perMeter, h = (b.maxY - b.minY) / perMeter;
    return {
      minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, entities: Math.round(b.len / perMeter), doors: b.doors,
      label: `Floor plan — ${w.toFixed(0)} × ${h.toFixed(0)} m, ${b.doors} door${b.doors === 1 ? '' : 's'}`,
    };
  });
}

// "GROUND FLOOR PLAN", "1st -4th FLOOR PLAN"; not a bare "GROUND FLOOR", which is also how
// sections and elevations mark their levels.
const FLOOR_TITLE = /\b(?:floor|level)\s+plan\b/i;
// A title starts with what it is: labels inside plans say "95XE Elevation" (a door type).
const OTHER_TITLE = /^\s*(?:(?:front|rear|back|left|right|side|north|south|east|west)\s+){0,2}(?:elevations?|sections?)\b|^\s*(?:site|roof|foundation|footing|reflected\s+ceiling)\s+plan\b/i;

/**
 * What the title just below a drawing says it is: a floor plan, something else (an elevation,
 * section, site or roof plan), or null when there's no such title. The nearest title wins;
 * within the drawing's width, at most a third of its height (and at least 6 m) below it.
 */
export function titleKind(d: CadDrawing, a: { minX: number; minY: number; maxX: number; maxY: number }, perMeter: number): 'floor' | 'other' | null {
  const h = a.maxY - a.minY, w = a.maxX - a.minX, reach = Math.max(0.35 * h, 6 * perMeter);
  let best: { kind: 'floor' | 'other'; g: number } | null = null;
  for (const e of d.entities) {
    if (e.kind !== 'TEXT' || e.text.length > 80 || e.pos.x < a.minX - 0.1 * w || e.pos.x > a.maxX + 0.1 * w) continue;
    const kind = OTHER_TITLE.test(e.text) ? 'other' : FLOOR_TITLE.test(e.text) ? 'floor' : null;
    if (!kind) continue;
    const g = d.flipY ? a.minY - e.pos.y : e.pos.y - a.maxY;   // below on paper
    if (g < -0.25 * h || g > reach) continue;
    if (!best || Math.abs(g) < Math.abs(best.g)) best = { kind, g };
  }
  return best?.kind ?? null;
}

/** Entities inside a drawing area (by their first point) — the rest of the sheet is left out. */
export function withinArea(d: CadDrawing, area: DrawingArea | null): CadDrawing {
  if (!area) return d;
  const inside = (p: DxfPoint) => p.x >= area.minX && p.x <= area.maxX && p.y >= area.minY && p.y <= area.maxY;
  const entities = d.entities.filter(e => inside(e.kind === 'LINE' ? e.a : e.kind === 'POLYLINE' ? e.pts[0] : e.kind === 'TEXT' || e.kind === 'INSERT' ? e.pos : e.center));
  const hatches = d.hatches?.filter(h => inside(h.loops[0][0]));
  return { ...d, entities, hatches, layers: [...new Set(entities.map(e => e.layer))].sort(), bounds: { minX: area.minX, minY: area.minY, maxX: area.maxX, maxY: area.maxY } };
}

export const DOOR_RANGE_M = { min: DOOR_MIN_M, max: DOOR_MAX_M };
