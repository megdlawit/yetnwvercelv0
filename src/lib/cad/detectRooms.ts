// Rooms from walls: the spaces the walls enclose.
//
// Walls (and the door openings, sealed shut along each door's closed leaf)
// are drawn onto a fine grid. Everything reachable from the edge of the grid
// is outside. What's left falls into separate enclosed spaces; the ones big
// and wide enough to stand in are rooms, traced back into outlines.
// Coordinates are editor px.

import type { Pt, Seg } from './geometry';

export interface DetectedRoom { polygon: Pt[]; areaM2: number }

export interface DetectOptions {
  pxPerMeter: number;
  minAreaM2?: number;      // smaller enclosed spaces are fixtures / wall cavities
  minWidthM?: number;      // narrowest a room can be (thinner = gap inside a wall)
  maxCells?: number;       // grid size cap for very large plans
}

export function detectRooms(walls: Seg[], seals: Seg[], o: DetectOptions): DetectedRoom[] {
  const minArea = o.minAreaM2 ?? 0.9, minWidth = o.minWidthM ?? 0.6;
  if (!walls.length) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2);
    minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  // 10 cm cells, coarser for big plans so the grid stays fast
  const cell = Math.max(0.1 * o.pxPerMeter, span / (o.maxCells ?? 1400));
  const pad = 3;
  const W = Math.ceil((maxX - minX) / cell) + pad * 2 + 1, H = Math.ceil((maxY - minY) / cell) + pad * 2 + 1;
  const ox = minX - pad * cell, oy = minY - pad * cell;
  const grid = new Uint8Array(W * H); // 1 = wall
  const at = (x: number, y: number) => y * W + x;

  // Walls are drawn 3 cells thick, which closes the small gaps real drawings
  // leave at corners (a few cm) without merging rooms across real openings.
  const draw = (s: Seg) => {
    const x0 = (s.x1 - ox) / cell, y0 = (s.y1 - oy) / cell, x1 = (s.x2 - ox) / cell, y1 = (s.y2 - oy) / cell;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let i = 0; i <= n; i++) {
      const cx = Math.round(x0 + ((x1 - x0) * i) / n), cy = Math.round(y0 + ((y1 - y0) * i) / n);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < W && y < H) grid[at(x, y)] = 1;
      }
    }
  };
  walls.forEach(draw);
  seals.forEach(draw);

  // Outside: flood from the border (4-neighbour, so diagonal wall cells hold).
  const region = new Int32Array(W * H).fill(-1); // -2 outside, ≥0 room candidate id
  const queue = new Int32Array(W * H);
  const flood = (seed: number, id: number) => {
    let head = 0, tail = 0;
    queue[tail++] = seed; region[seed] = id;
    let count = 0;
    while (head < tail) {
      const c = queue[head++]; count++;
      const x = c % W, y = (c - x) / W;
      const nb = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1];
      for (const n of nb) if (n >= 0 && !grid[n] && region[n] === -1) { region[n] = id; queue[tail++] = n; }
    }
    return count;
  };
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) if (!grid[at(x, y)] && region[at(x, y)] === -1) flood(at(x, y), -2);
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) if (!grid[at(x, y)] && region[at(x, y)] === -1) flood(at(x, y), -2);

  // Enclosed spaces.
  const sizes: number[] = [];
  for (let c = 0; c < W * H; c++) if (!grid[c] && region[c] === -1) sizes.push(flood(c, sizes.length));

  // How wide is each space? Distance (in cells) from each free cell to the
  // nearest wall, two-pass chamfer; a room must fit a circle of minWidth.
  const dist = new Float32Array(W * H);
  for (let c = 0; c < W * H; c++) dist[c] = region[c] >= 0 ? 1e9 : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(x, y); if (!dist[c]) continue;
    if (x > 0) dist[c] = Math.min(dist[c], dist[c - 1] + 1);
    if (y > 0) dist[c] = Math.min(dist[c], dist[c - W] + 1);
    if (x > 0 && y > 0) dist[c] = Math.min(dist[c], dist[c - W - 1] + 1.414);
    if (x < W - 1 && y > 0) dist[c] = Math.min(dist[c], dist[c - W + 1] + 1.414);
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const c = at(x, y); if (!dist[c]) continue;
    if (x < W - 1) dist[c] = Math.min(dist[c], dist[c + 1] + 1);
    if (y < H - 1) dist[c] = Math.min(dist[c], dist[c + W] + 1);
    if (x < W - 1 && y < H - 1) dist[c] = Math.min(dist[c], dist[c + W + 1] + 1.414);
    if (x > 0 && y < H - 1) dist[c] = Math.min(dist[c], dist[c + W - 1] + 1.414);
  }
  const widest = new Float32Array(sizes.length);
  for (let c = 0; c < W * H; c++) if (region[c] >= 0) widest[region[c]] = Math.max(widest[region[c]], dist[c]);

  // A space that spans (nearly) the whole drawing is the outside, closed in
  // by a sheet border or a site boundary — not a room.
  const boxes = sizes.map(() => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
  for (let c = 0; c < W * H; c++) {
    const id = region[c]; if (id < 0) continue;
    const x = c % W, y = (c - x) / W, b = boxes[id];
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
  }
  const wraps = (id: number) => (boxes[id].x1 - boxes[id].x0) > (W - 2 * pad) * 0.85 && (boxes[id].y1 - boxes[id].y0) > (H - 2 * pad) * 0.85;

  const cellM = cell / o.pxPerMeter;
  const rooms: DetectedRoom[] = [];
  for (let id = 0; id < sizes.length; id++) {
    if (wraps(id) && sizes.length > 1) continue;
    // widest counts cells to the wall's inner edge, so add back the drawn half-thickness
    if ((widest[id] + 1.5) * 2 * cellM < minWidth) continue;
    if (sizes[id] * cellM * cellM < minArea * 0.4) continue; // clearly too small; skip tracing
    const loop = traceOutline(region, W, H, id);
    if (!loop || loop.length < 3) continue;
    const simple = simplify(loop, 1.5);
    if (simple.length < 3) continue;
    // Out to the wall's centre line (the grid drew walls 1 cell either side).
    const grown = offsetOutward(simple, 1.5);
    // Area of the outline out to the walls' centre lines — the grid count
    // alone misses the drawn wall thickness, which is a lot for small rooms.
    const areaM2 = areaOf(grown) * cellM * cellM;
    if (areaM2 < minArea) continue;
    rooms.push({ polygon: grown.map(p => ({ x: ox + p.x * cell, y: oy + p.y * cell })), areaM2 });
  }
  return rooms;
}

/**
 * Outer boundary of one region as a loop of grid corners: collect the cell
 * edges between the region and everything else, oriented with the region on
 * the left, and chain them. The longest loop is the outline (others are holes).
 */
function traceOutline(region: Int32Array, W: number, H: number, id: number): Pt[] | null {
  const next = new Map<number, number[]>(); // corner key → next corner keys
  const K = (x: number, y: number) => y * (W + 1) + x;
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = K(ax, ay);
    (next.get(k) ?? next.set(k, []).get(k)!).push(K(bx, by));
  };
  const inR = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && region[y * W + x] === id;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inR(x, y)) continue;
    if (!inR(x, y - 1)) add(x, y, x + 1, y);         // top edge, heading +x
    if (!inR(x + 1, y)) add(x + 1, y, x + 1, y + 1); // right edge, heading +y
    if (!inR(x, y + 1)) add(x + 1, y + 1, x, y + 1); // bottom edge, heading −x
    if (!inR(x - 1, y)) add(x, y + 1, x, y);         // left edge, heading −y
  }
  let best: Pt[] | null = null;
  const used = new Set<string>();
  for (const [start, outs] of next) {
    for (const first of outs) {
      if (used.has(`${start}>${first}`)) continue;
      const loop: Pt[] = [];
      let a = start, b = first;
      for (let guard = 0; guard < 4 * W * H; guard++) {
        used.add(`${a}>${b}`);
        loop.push({ x: a % (W + 1), y: Math.floor(a / (W + 1)) });
        const cands = (next.get(b) ?? []).filter(c => !used.has(`${b}>${c}`));
        if (!cands.length) break;
        a = b; b = cands[0];
        if (a === start) break;
      }
      if (!best || loop.length > best.length) best = loop;
    }
  }
  return best;
}

/** Douglas–Peucker on a closed loop, tolerance in cells. */
function simplify(loop: Pt[], eps: number): Pt[] {
  const dp = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let far = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / len;
      if (d > far) { far = d; idx = i; }
    }
    if (far <= eps) return [a, b];
    return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))];
  };
  // split the loop at its two most distant points so DP has fixed ends
  let i0 = 0, i1 = 0, best = -1;
  for (let i = 0; i < loop.length; i += Math.max(1, Math.floor(loop.length / 64))) {
    for (let j = i + 1; j < loop.length; j += Math.max(1, Math.floor(loop.length / 64))) {
      const d = Math.hypot(loop[i].x - loop[j].x, loop[i].y - loop[j].y);
      if (d > best) { best = d; i0 = i; i1 = j; }
    }
  }
  const half1 = dp(loop.slice(i0, i1 + 1));
  const half2 = dp([...loop.slice(i1), ...loop.slice(0, i0 + 1)]);
  return [...half1.slice(0, -1), ...half2.slice(0, -1)];
}

/** Push each vertex outward along the corner's bisector by `d` cells. */
function offsetOutward(poly: Pt[], d: number): Pt[] {
  // Try both directions and keep the one that grows the outline — simpler
  // and sturdier than reasoning about the traced loop's winding.
  const a = offsetBy(poly, d, 1), b = offsetBy(poly, d, -1);
  return areaOf(a) >= areaOf(b) ? a : b;
}
const areaOf = (p: Pt[]) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j].x * p[i].y - p[i].x * p[j].y; return Math.abs(s / 2); };
function offsetBy(poly: Pt[], d: number, s: number): Pt[] {
  return poly.map((p, i) => {
    const prev = poly[(i - 1 + poly.length) % poly.length], next = poly[(i + 1) % poly.length];
    const n1 = normal(prev, p), n2 = normal(p, next);
    const nx = n1.x + n2.x, ny = n1.y + n2.y, len = Math.hypot(nx, ny) || 1;
    const dot = (n1.x * nx + n1.y * ny) / len || 1;
    const k = Math.min(d / dot, d * 2);
    return { x: p.x + (s * nx / len) * k, y: p.y + (s * ny / len) * k };
  });
}
const normal = (a: Pt, b: Pt) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.y - a.y) / l, y: -(b.x - a.x) / l }; };

/**
 * Doorways drawn as plain gaps (no door swing): two wall ends 0.6–1.3 m apart, in line with
 * both walls — the gap a door would fill. Sealed for finding rooms only (so a bedroom and the
 * lobby aren't one room); the walking paths still pass through. Wide openings stay open.
 */
export function doorwaySeals(walls: Seg[], pxPerMeter: number): Seg[] {
  const lo = 0.6 * pxPerMeter, hi = 1.3 * pxPerMeter;
  type End = { x: number; y: number; dx: number; dy: number; w: number };
  const ends: End[] = [];
  walls.forEach((w, i) => {
    const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    if (L < 0.2 * pxPerMeter) return;
    const ux = (w.x2 - w.x1) / L, uy = (w.y2 - w.y1) / L;
    ends.push({ x: w.x1, y: w.y1, dx: -ux, dy: -uy, w: i }, { x: w.x2, y: w.y2, dx: ux, dy: uy, w: i });   // pointing out of the wall
  });
  // Bucket the ends so the pair search stays fast on big plans.
  const cellSize = hi, grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  ends.forEach((e, i) => { const k = key(e.x, e.y); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  const out: Seg[] = [];
  const used = new Set<number>();
  ends.forEach((a, i) => {
    if (used.has(i)) return;
    const cx = Math.floor(a.x / cellSize), cy = Math.floor(a.y / cellSize);
    let best: { j: number; d: number } | null = null;
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) for (const j of grid.get(`${gx},${gy}`) ?? []) {
      if (j === i || used.has(j)) continue;
      const b = ends[j];
      if (b.w === a.w) continue;
      const vx = b.x - a.x, vy = b.y - a.y, d = Math.hypot(vx, vy);
      if (d < lo || d > hi) continue;
      // The gap continues both walls: a points towards b, b towards a, and they face each other.
      if ((a.dx * vx + a.dy * vy) / d < 0.97 || -(b.dx * vx + b.dy * vy) / d < 0.97) continue;
      if (!best || d < best.d) best = { j, d };
    }
    if (best) {
      const b = ends[best.j];
      used.add(i); used.add(best.j);
      out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  });

  // A wall that stops short of a crossing wall (an L-shaped doorway): carry its free end
  // straight on; meeting a wall 0.6–1.3 m ahead, roughly square on, is a doorway too.
  const near = 0.1 * pxPerMeter, cap = 0.4 * pxPerMeter;
  const segGrid = new Map<string, number[]>();
  walls.forEach((w, i) => {
    for (let gx = Math.floor(Math.min(w.x1, w.x2) / cellSize); gx <= Math.floor(Math.max(w.x1, w.x2) / cellSize); gx++)
      for (let gy = Math.floor(Math.min(w.y1, w.y2) / cellSize); gy <= Math.floor(Math.max(w.y1, w.y2) / cellSize); gy++)
        (segGrid.get(`${gx},${gy}`) ?? segGrid.set(`${gx},${gy}`, []).get(`${gx},${gy}`)!).push(i);
  });
  const around = (x: number, y: number) => {
    const cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize), found = new Set<number>();
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) for (const j of segGrid.get(`${gx},${gy}`) ?? []) found.add(j);
    return found;
  };
  ends.forEach((a, i) => {
    if (used.has(i)) return;
    const others = around(a.x, a.y);
    // Free end: no other real wall touches it (short jamb caps of a double-line wall don't count).
    for (const j of others) {
      if (j === a.w) continue;
      const w = walls[j];
      if (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= cap && distToSeg(a, w) <= near) return;
    }
    let hit: { d: number; x: number; y: number } | null = null;
    for (const j of others) {
      if (j === a.w) continue;
      const w = walls[j], ex = w.x2 - w.x1, ey = w.y2 - w.y1, L = Math.hypot(ex, ey);
      if (L < cap || Math.abs((a.dx * ex + a.dy * ey) / L) > 0.5) continue;
      // Ray a + t·dir against the segment.
      const den = a.dx * ey - a.dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((w.x1 - a.x) * ey - (w.y1 - a.y) * ex) / den, u = ((w.x1 - a.x) * a.dy - (w.y1 - a.y) * a.dx) / den;
      if (t <= 0 || u < 0 || u > 1) continue;
      if (!hit || t < hit.d) hit = { d: t, x: a.x + a.dx * t, y: a.y + a.dy * t };
    }
    if (hit && hit.d >= lo && hit.d <= hi) out.push({ x1: a.x, y1: a.y, x2: hit.x, y2: hit.y });
  });
  return out;
}

export function distToSeg(p: { x: number; y: number }, w: Seg): number {
  const ex = w.x2 - w.x1, ey = w.y2 - w.y1, L2 = ex * ex + ey * ey || 1;
  const t = Math.max(0, Math.min(1, ((p.x - w.x1) * ex + (p.y - w.y1) * ey) / L2));
  return Math.hypot(p.x - (w.x1 + ex * t), p.y - (w.y1 + ey * t));
}

/**
 * The first wall straight ahead of p along unit direction (dx, dy), within maxDist: a wall it
 * crosses, or the end of a wall lying in line with it (a wall centre line it would run along).
 */
export function rayToWall(p: Pt, dx: number, dy: number, walls: Seg[], maxDist: number, pxPerMeter: number): Pt | null {
  const side = 0.25 * pxPerMeter, skip = 0.05 * pxPerMeter;
  let best: { t: number; at: Pt } | null = null;
  const take = (t: number, at: Pt) => { if (t > skip && t <= maxDist && (!best || t < best.t)) best = { t, at }; };
  for (const w of walls) {
    const ex = w.x2 - w.x1, ey = w.y2 - w.y1, den = dx * ey - dy * ex;
    if (Math.abs(den) > 1e-9) {
      const t = ((w.x1 - p.x) * ey - (w.y1 - p.y) * ex) / den, u = ((w.x1 - p.x) * dy - (w.y1 - p.y) * dx) / den;
      if (u >= 0 && u <= 1) take(t, { x: p.x + dx * t, y: p.y + dy * t });
    }
    for (const q of [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]) {
      const along = (q.x - p.x) * dx + (q.y - p.y) * dy, across = Math.abs((q.x - p.x) * dy - (q.y - p.y) * dx);
      if (across <= side) take(along, q);
    }
  }
  return best ? (best as { t: number; at: Pt }).at : null;
}

/**
 * The sheet's frame, when the drawing has one: lines along all four sides of the drawing's
 * outer box (≥ 80 % of each side). Returns that box, or null. Rooms touching it are the
 * title block's cells, not rooms — a building never sits right against the paper's border.
 */
export function sheetFrame(walls: Seg[], pxPerMeter: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (walls.length < 4) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2);
    minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2);
  }
  const tol = 0.15 * pxPerMeter;
  const along = (horizontal: boolean, at: number) => {
    let len = 0;
    for (const w of walls) {
      const [a1, a2, b1, b2] = horizontal ? [w.y1, w.y2, w.x1, w.x2] : [w.x1, w.x2, w.y1, w.y2];
      if (Math.abs(a1 - at) <= tol && Math.abs(a2 - at) <= tol) len += Math.abs(b2 - b1);
    }
    return len;
  };
  const W = maxX - minX, H = maxY - minY;
  const framed = along(true, minY) >= 0.8 * W && along(true, maxY) >= 0.8 * W && along(false, minX) >= 0.8 * H && along(false, maxX) >= 0.8 * H;
  if (!framed) return null;
  // A building's outer walls look the same, but its inside walls join them. A sheet's frame
  // holds only the title block: the building floats inside it, joined to nothing.
  const parent = walls.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const size = Math.max(W, H) / 64 || 1, grid = new Map<string, number[]>();
  walls.forEach((w, i) => {
    for (let gx = Math.floor(Math.min(w.x1, w.x2) / size); gx <= Math.floor(Math.max(w.x1, w.x2) / size); gx++)
      for (let gy = Math.floor(Math.min(w.y1, w.y2) / size); gy <= Math.floor(Math.max(w.y1, w.y2) / size); gy++)
        (grid.get(`${gx},${gy}`) ?? grid.set(`${gx},${gy}`, []).get(`${gx},${gy}`)!).push(i);
  });
  walls.forEach((w, i) => {
    for (const q of [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]) {
      const gx = Math.floor(q.x / size), gy = Math.floor(q.y / size);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? [])
        if (j !== i && distToSeg(q, walls[j]) <= tol) parent[find(i)] = find(j);
    }
  });
  const onEdge = walls.findIndex(w => Math.abs(w.y1 - minY) <= tol && Math.abs(w.y2 - minY) <= tol);
  const frameSet = find(onEdge);
  // A big structure (≥ 40 % of the sheet across) joined to nothing on the frame:
  // the building. Furniture, fixtures and a free-standing stair are separate too, but smaller.
  const boxes = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  walls.forEach((w, i) => {
    const k = find(i); if (k === frameSet) return;
    const b = boxes.get(k) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    boxes.set(k, { x0: Math.min(b.x0, w.x1, w.x2), y0: Math.min(b.y0, w.y1, w.y2), x1: Math.max(b.x1, w.x1, w.x2), y1: Math.max(b.y1, w.y1, w.y2) });
  });
  // …and it keeps clear of the frame on at least three sides, the way a drawing sits on a sheet
  // (a hatch inside a building's room, like a car park, runs up against the walls).
  const margins = (b: { x0: number; y0: number; x1: number; y1: number }) =>
    [(b.x0 - minX) / W, (maxX - b.x1) / W, (b.y0 - minY) / H, (maxY - b.y1) / H].filter(m => m >= 0.04).length;
  const floating = [...boxes.values()].some(b => (b.x1 - b.x0 >= 0.4 * W || b.y1 - b.y0 >= 0.4 * H) && margins(b) >= 3);
  return floating ? { minX, minY, maxX, maxY } : null;
}
