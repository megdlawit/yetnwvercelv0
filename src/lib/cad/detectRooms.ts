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
