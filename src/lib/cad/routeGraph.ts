// Walkable paths from rooms and the openings between them.
//
// People move from room to room through doors and open doorways, so the
// graph is built that way: a place at the most open point of every room, a
// point in every passage between two rooms, and paths inside each room from
// its place to each of its passages (and straight between passages that can
// see each other). Passages are the drawn doors, plus anywhere two rooms
// meet without a wall between them (open doorways, arches, gaps).
//
// Halls and corridors that aren't drawn as rooms (often: a hall open to the
// entrance never closes into a room) are walkable too: open space INSIDE the
// building that no room owns becomes a hallway. Inside = not reachable from
// the edge of the drawing once gaps in the walls up to ~1.6 m (doorways,
// the entrance) are closed. Paths never go round the outside of the building.
//
// Everything is found on a fine grid that keeps a little clearance from
// walls; paths are then straightened, so they never cut through a wall.
// Coordinates are editor px. Output has the same shape as the older
// skeleton-based generator (generatePathGraph), the fallback for plans
// without rooms.

import type { Pt, Seg } from './geometry';
import { pointInPolygon } from './geometry';
import type { GraphEdge, GraphNode, PathGraphResult } from '../dxf/generatePathGraph';

export interface RouteGraphInput {
  walls: Seg[];
  rooms: { polygon: Pt[] }[];
  doors: Pt[];
  pxPerMeter: number;
}

export function buildRouteGraph({ walls, rooms, doors, pxPerMeter }: RouteGraphInput): PathGraphResult {
  const warnings: string[] = [];
  if (!rooms.length) return { nodes: [], edges: [], warnings: ['No rooms to connect.'] };

  // ── grid ───────────────────────────────────────────────────────────────────
  const pts = [...walls.flatMap(w => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]), ...rooms.flatMap(r => r.polygon), ...doors];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const cell = Math.max(0.1 * pxPerMeter, Math.max(maxX - minX, maxY - minY) / 1200);
  // The margin must be wider than the gap-closing for the outside (outsideOf) to reach round the building.
  const pad = Math.max(4, Math.round((0.8 * pxPerMeter) / cell) + 3);
  const W = Math.ceil((maxX - minX) / cell) + pad * 2 + 1, H = Math.ceil((maxY - minY) / cell) + pad * 2 + 1;
  const ox = minX - pad * cell, oy = minY - pad * cell;
  const N = W * H;
  const idx = (x: number, y: number) => y * W + x;
  const cellOf = (p: Pt) => idx(Math.min(W - 1, Math.max(0, Math.round((p.x - ox) / cell))), Math.min(H - 1, Math.max(0, Math.round((p.y - oy) / cell))));
  const toPt = (c: number) => ({ x: ox + (c % W) * cell, y: oy + Math.floor(c / W) * cell });

  // Walls as obstacles with ~10 cm clearance (paths shouldn't scrape walls,
  // but narrow doorways must stay open).
  const blocked = new Uint8Array(N);
  const grow = Math.max(0, Math.round((0.1 * pxPerMeter) / cell));
  for (const w of walls) {
    const a = cellOf({ x: w.x1, y: w.y1 }), b = cellOf({ x: w.x2, y: w.y2 });
    const ax = a % W, ay = (a - ax) / W, bx = b % W, by = (b - bx) / W;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    for (let i = 0; i <= n; i++) {
      const cx = Math.round(ax + ((bx - ax) * i) / n), cy = Math.round(ay + ((by - ay) * i) / n);
      for (let dx = -grow; dx <= grow; dx++) for (let dy = -grow; dy <= grow; dy++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < W && y < H) blocked[idx(x, y)] = 1;
      }
    }
  }
  const doorCells = doors.map(cellOf);
  // A door opens the whole wall, not one cell: walls are often drawn as two lines ~20 cm apart,
  // which with the clearance on both sides is ~0.5 m of blocked cells.
  const doorR = Math.max(1, Math.round((0.35 * pxPerMeter) / cell));
  for (const c of doorCells) for (const n of disk(c, doorR, W, H)) if (Math.hypot(n % W - c % W, Math.floor(n / W) - Math.floor(c / W)) <= doorR) blocked[n] = 0;
  // The bare walls, one cell thin: for the last-resort bridging, which only
  // asks whether a gap is physically passable at all.
  const thin = new Uint8Array(N);
  for (const w of walls) {
    const a = cellOf({ x: w.x1, y: w.y1 }), b = cellOf({ x: w.x2, y: w.y2 });
    const ax = a % W, ay = (a - ax) / W, bx = b % W, by = (b - bx) / W;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    for (let i = 0; i <= n; i++) thin[idx(Math.round(ax + ((bx - ax) * i) / n), Math.round(ay + ((by - ay) * i) / n))] = 1;
  }
  for (const c of doorCells) for (const n of disk(c, doorR, W, H)) if (Math.hypot(n % W - c % W, Math.floor(n / W) - Math.floor(c / W)) <= doorR) thin[n] = 0;

  // Distance to the nearest obstacle — a room's place goes where it is most open.
  const clear = chamfer(blocked, W, H);

  // ── which room owns each cell ──────────────────────────────────────────────
  // Inside the outlines first (smallest room wins overlaps), then each room
  // claims the free space around it, breadth-first, up to ~0.6 m. Where two
  // rooms' claims meet, there is no wall between them: a passage.
  const owner = new Int32Array(N).fill(-1);
  const order = rooms.map((r, i) => ({ i, a: Math.abs(area(r.polygon)) })).sort((p, q) => q.a - p.a);
  for (const { i } of order) {
    const poly = rooms[i].polygon;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) { const c = cellOf(p); x0 = Math.min(x0, c % W); x1 = Math.max(x1, c % W); y0 = Math.min(y0, Math.floor(c / W)); y1 = Math.max(y1, Math.floor(c / W)); }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = idx(x, y);
      if (!blocked[c] && pointInPolygon(toPt(c), poly)) owner[c] = i;
    }
  }
  // Outside the building: reachable from the drawing's edge with every gap up to ~1.6 m closed.
  // Rooms are inside by definition, so they bound it too: windows and glazing are not walls,
  // and a glazed front would otherwise let "outside" into the living room.
  const barrier = new Uint8Array(N);
  for (let c = 0; c < N; c++) barrier[c] = thin[c] || owner[c] >= 0 ? 1 : 0;
  const outside = outsideOf(barrier, W, H, Math.max(1, Math.round((0.8 * pxPerMeter) / cell)));
  for (let c = 0; c < N; c++) if (owner[c] >= 0) outside[c] = 0;

  // Open space inside the building that no room owns: hallways (pieces of at least ~1.5 m²).
  const minHall = Math.max(4, Math.round((1.5 * pxPerMeter * pxPerMeter) / (cell * cell)));
  const wide = Math.max(2, Math.round((0.3 * pxPerMeter) / cell));   // clearance from the walls' clearance band
  let halls = 0;
  for (let c0 = 0; c0 < N; c0++) {
    if (blocked[c0] || outside[c0] || owner[c0] !== -1) continue;
    const id = rooms.length + halls;
    const cells = [c0];
    owner[c0] = id;
    for (let q = 0; q < cells.length; q++) {
      const c = cells[q], x = c % W;
      for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (n >= 0 && n < N && !blocked[n] && !outside[n] && owner[n] === -1) { owner[n] = id; cells.push(n); }
      }
    }
    // Big enough, and somewhere at least ~0.6 m wide (a strip between a room outline and a wall isn't a corridor).
    if (cells.length >= minHall && cells.some(c => clear[c] >= wide)) halls++;
    else for (const c of cells) owner[c] = -2;
  }
  for (let c = 0; c < N; c++) if (owner[c] === -2) owner[c] = -1;
  const spaces = rooms.length + halls;

  const reach = Math.max(2, Math.round((0.6 * pxPerMeter) / cell));
  const step = new Int32Array(N).fill(-1);
  let frontier: number[] = [];
  for (let c = 0; c < N; c++) if (owner[c] >= 0) { step[c] = 0; frontier.push(c); }
  const contacts = new Map<string, number[]>(); // "a|b" → contact cells
  const touch = (a: number, b: number, c: number) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    (contacts.get(k) ?? contacts.set(k, []).get(k)!).push(c);
  };
  for (let s = 0; s <= reach && frontier.length; s++) {
    const next: number[] = [];
    for (const c of frontier) {
      const x = c % W;
      for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (n < 0 || n >= N || blocked[n]) continue;
        if (owner[n] === -1) { if (s < reach) { owner[n] = owner[c]; step[n] = s + 1; next.push(n); } }
        else if (owner[n] !== owner[c]) touch(owner[c], owner[n], c);
      }
    }
    frontier = next;
  }

  // Passages: each drawn door (with the rooms on either side of it), and
  // the middle of each place two rooms touch.
  interface Passage { cell: number; rooms: Set<number> }
  const passages: Passage[] = [];
  const near = (c: number, r: number) => {
    const out = new Set<number>(), x0 = c % W, y0 = Math.floor(c / W);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && owner[idx(x, y)] >= 0) out.add(owner[idx(x, y)]);
    }
    return out;
  };
  for (const c of doorCells) {
    const rs = near(c, Math.max(2, Math.round(reach / 2)));
    if (rs.size) passages.push({ cell: c, rooms: rs });
  }
  // Widest contacts first. A narrow contact still counts when two rooms have
  // no other way between them: in many drawings a door panel is drawn shut
  // with only a hairline gap, and that gap is the only sign of the door.
  for (const [k, cells] of [...contacts].sort((p, q) => q[1].length - p[1].length)) {
    const [a, b] = k.split('|').map(Number);
    if (passages.some(p => p.rooms.has(a) && p.rooms.has(b))) continue;
    const mid = cells.reduce((s, c) => ({ x: s.x + (c % W), y: s.y + Math.floor(c / W) }), { x: 0, y: 0 });
    const target = idx(Math.round(mid.x / cells.length), Math.round(mid.y / cells.length));
    // snap to the contact cell nearest the middle (the average may sit in a wall)
    const best = cells.reduce((bst, c) => (Math.hypot(c % W - target % W, Math.floor(c / W) - Math.floor(target / W)) < Math.hypot(bst % W - target % W, Math.floor(bst / W) - Math.floor(target / W)) ? c : bst), cells[0]);
    passages.push({ cell: best, rooms: new Set([a, b]) });
  }

  // ── graph ──────────────────────────────────────────────────────────────────
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const addNode = (p: Pt, isHallway: boolean, roomIndex: number | null) => { nodes.push({ x: p.x, y: p.y, isHallway, roomIndex }); return nodes.length - 1; };
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edgeKeys.has(k)) return;
    edgeKeys.add(k);
    edges.push({ from: a, to: b, weight: Math.round(Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y)) });
  };
  const passageNode = passages.map(p => addNode(toPt(p.cell), true, null));

  const allowed = new Uint8Array(N);
  // 64-bit: with 32-bit distances rounding made Dijkstra re-relax the same cells millions of times.
  const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  let isolated = 0;
  // Each space's cells, collected once (not a scan of the whole grid per space).
  const cellsOf: number[][] = Array.from({ length: spaces }, () => []);
  for (let c = 0; c < N; c++) if (owner[c] >= 0) cellsOf[owner[c]].push(c);
  for (let ri = 0; ri < spaces; ri++) {
    const hall = ri >= rooms.length;
    // this room's cells (its claim), plus a little room around its passages
    const mine = cellsOf[ri];
    if (!mine.length) continue;
    const myPassages = passages.map((p, i) => ({ p, i })).filter(({ p }) => p.rooms.has(ri));
    for (const c of mine) allowed[c] = 1;
    for (const { p } of myPassages) for (const n of disk(p.cell, 2, W, H)) if (!blocked[n]) allowed[n] = 1;
    // A room's outline can enclose pieces the walls cut apart. Put its place
    // in the piece that reaches the most of its passages (the most open spot
    // of that piece, preferring inside the outline).
    const piece = new Int32Array(mine.length).fill(-1);
    const pos = new Map(mine.map((c, i) => [c, i] as const));
    let anchor = -1, bestReach = -1;
    for (let i = 0; i < mine.length; i++) {
      if (piece[i] >= 0) continue;
      const cells: number[] = [mine[i]]; piece[i] = i;
      for (let q = 0; q < cells.length; q++) {
        const c = cells[q], x = c % W;
        for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
          const j = pos.get(n);
          if (j !== undefined && piece[j] < 0) { piece[j] = i; cells.push(n); }
        }
      }
      const set = new Set(cells);
      const reaches = myPassages.filter(({ p }) => disk(p.cell, 2, W, H).some(n => set.has(n))).length;
      const best = cells.reduce((b, c) => ((step[c] === 0 ? 1e6 : 0) + clear[c] > (step[b] === 0 ? 1e6 : 0) + clear[b] ? c : b), cells[0]);
      const score = reaches * 1e9 + cells.length;
      if (score > bestReach) { bestReach = score; anchor = best; }
    }

    const anchorNode = addNode(toPt(anchor), hall, hall ? null : ri);
    if (!myPassages.length) { if (!hall) isolated++; }
    else {
      dijkstra(anchor, allowed, W, N, dist, prev);
      const visible = (a: number, b: number) => lineOfSight(a, b, allowed, W);
      for (const { p, i } of myPassages) {
        if (!Number.isFinite(dist[p.cell])) continue;
        const raw: number[] = [];
        for (let k = p.cell; k >= 0; k = prev[k]) raw.push(k);
        raw.reverse(); // place → passage
        // straighten: keep only the turns the walls force
        const turns = straighten(raw, visible);
        let last = anchorNode;
        for (let t = 1; t < turns.length - 1; t++) { const bend = addNode(toPt(turns[t]), true, null); addEdge(last, bend); last = bend; }
        addEdge(last, passageNode[i]);
      }
      // passages that can see each other connect directly (shortcuts)
      for (let a = 0; a < myPassages.length; a++) for (let b = a + 1; b < myPassages.length; b++) {
        if (visible(myPassages[a].p.cell, myPassages[b].p.cell)) addEdge(passageNode[myPassages[a].i], passageNode[myPassages[b].i]);
      }
      for (const c of mine) { dist[c] = Infinity; prev[c] = -1; }
      for (const { p } of myPassages) for (const n of disk(p.cell, 2, W, H)) { dist[n] = Infinity; prev[n] = -1; }
    }
    for (const c of mine) allowed[c] = 0;
    for (const { p } of myPassages) for (const n of disk(p.cell, 2, W, H)) allowed[n] = 0;
  }

  // Bridges go through the building only: outside is as closed as a wall.
  const inside = new Uint8Array(N);
  for (let c = 0; c < N; c++) inside[c] = thin[c] || outside[c] ? 1 : 0;
  bridgeNetworks(nodes, edges, addNode, addEdge, inside, W, H, cellOf, toPt);

  // Drop passage points nothing reached.
  const used = new Set(edges.flatMap(e => [e.from, e.to]));
  const keep = nodes.map((n, i) => (!n.isHallway || used.has(i) ? i : -1)).filter(i => i >= 0);
  const remap = new Map(keep.map((old, i) => [old, i] as const));
  const outNodes = keep.map(i => nodes[i]);
  const outEdges = edges.filter(e => remap.has(e.from) && remap.has(e.to)).map(e => ({ ...e, from: remap.get(e.from)!, to: remap.get(e.to)! }));

  if (isolated) warnings.push(`${isolated} room(s) have no door or opening — connect them with the Path tool, or add a door.`);
  const parts = components(outNodes.length, outEdges);
  if (parts > 1) warnings.push(`The paths form ${parts} separate networks — a door or opening may be missing from the drawing.`);
  return { nodes: outNodes, edges: outEdges, warnings };
}

/**
 * Cells outside the building: flood from the grid's edge over cells that aren't wall,
 * with the walls thickened by `close` cells so doorways and gaps up to 2 × close are shut.
 */
function outsideOf(walls: Uint8Array, W: number, H: number, close: number): Uint8Array {
  const N = W * H;
  // Thickened walls from the distance to the nearest wall (one pass each way, not a disk per cell).
  const d = chamfer(walls, W, H);
  const out = new Uint8Array(N);
  const q: number[] = [];
  const seed = (c: number) => { if (d[c] > close && !out[c]) { out[c] = 1; q.push(c); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  for (let i = 0; i < q.length; i++) {
    const c = q[i], x = c % W;
    for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) if (n >= 0 && n < N && d[n] > close && !out[n]) { out[n] = 1; q.push(n); }
  }
  // The band along the outer walls' outside face is outside too: grow up to `close` steps, stopping at walls.
  let front = q;
  for (let step = 0; step < close && front.length; step++) {
    const next: number[] = [];
    for (const c of front) {
      const x = c % W;
      for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) if (n >= 0 && n < N && !walls[n] && !out[n]) { out[n] = 1; next.push(n); }
    }
    front = next;
  }
  return out;
}

/**
 * The turns of a grid path: from each turn, go as far along the path as stays in sight
 * (scanning forward — linear in practice, where searching back from the end was cubic
 * on long winding paths).
 */
function straighten(path: number[], visible: (a: number, b: number) => boolean): number[] {
  const turns = [path[0]];
  for (let i = 0; i < path.length - 1;) {
    let j = i + 1;
    while (j + 1 < path.length && visible(path[i], path[j + 1])) j++;
    turns.push(path[j]);
    i = j;
  }
  return turns;
}

function area(p: Pt[]) { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j].x * p[i].y - p[i].x * p[j].y; return s / 2; }

function disk(c: number, r: number, W: number, H: number): number[] {
  const out: number[] = [], x0 = c % W, y0 = Math.floor(c / W);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = x0 + dx, y = y0 + dy;
    if (x >= 0 && y >= 0 && x < W && y < H) out.push(y * W + x);
  }
  return out;
}

function chamfer(blocked: Uint8Array, W: number, H: number): Float32Array {
  const d = new Float32Array(W * H);
  for (let c = 0; c < W * H; c++) d[c] = blocked[c] ? 0 : 1e9;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x; if (!d[c]) continue;
    if (x > 0) d[c] = Math.min(d[c], d[c - 1] + 1);
    if (y > 0) d[c] = Math.min(d[c], d[c - W] + 1);
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const c = y * W + x; if (!d[c]) continue;
    if (x < W - 1) d[c] = Math.min(d[c], d[c + 1] + 1);
    if (y < H - 1) d[c] = Math.min(d[c], d[c + W] + 1);
  }
  return d;
}

/** Grid Dijkstra (8 neighbours) from `src`, limited to `allowed` cells. */
function dijkstra(src: number, allowed: Uint8Array, W: number, N: number, dist: Float64Array, prev: Int32Array) {
  const heap: [number, number][] = [[0, src]];
  dist[src] = 0;
  const steps = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [1, 1, 1.414]];
  while (heap.length) {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let m = 0; ;) {
        const l = 2 * m + 1, r = l + 1; let s = m;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === m) break;
        [heap[s], heap[m]] = [heap[m], heap[s]]; m = s;
      }
    }
    const [d, c] = top;
    if (d > dist[c]) continue;
    const x = c % W;
    for (const [dx, dy, w] of steps) {
      const nx = x + dx;
      if (nx < 0 || nx >= W) continue;
      const n = c + dx + dy * W;
      if (n < 0 || n >= N || !allowed[n]) continue;
      if (dx && dy && (!allowed[c + dx] || !allowed[c + dy * W])) continue; // no squeezing past corners
      const nd = d + w;
      if (nd < dist[n]) {
        dist[n] = nd; prev[n] = c;
        heap.push([nd, n]);
        for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
      }
    }
  }
}

function lineOfSight(a: number, b: number, allowed: Uint8Array, W: number): boolean {
  const ax = a % W, ay = Math.floor(a / W), bx = b % W, by = Math.floor(b / W);
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(ax + ((bx - ax) * i) / n), y = Math.round(ay + ((by - ay) * i) / n);
    if (!allowed[y * W + x]) return false;
  }
  return true;
}

function components(n: number, edges: GraphEdge[]): number {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const e of edges) parent[find(e.from)] = find(e.to);
  return new Set(Array.from({ length: n }, (_, i) => find(i))).size;
}

/**
 * Join any network cut off from the largest one by the shortest route
 * through open space (no wall crossed) — so a missed door or an unusual
 * drawing never leaves part of the venue unreachable when it is physically
 * reachable.
 */
function bridgeNetworks(
  nodes: GraphNode[], edges: GraphEdge[],
  addNode: (p: Pt, h: boolean, r: number | null) => number, addEdge: (a: number, b: number) => void,
  blocked: Uint8Array, W: number, H: number, cellOf: (p: Pt) => number, toPt: (c: number) => Pt,
) {
  const N = W * H;
  for (let round = 0; round < 50; round++) {
    const parent = nodes.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const e of edges) parent[find(e.from)] = find(e.to);
    const sizes = new Map<number, number>();
    nodes.forEach((_, i) => sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1));
    if (sizes.size <= 1) return;
    const main = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // breadth-first from every node of the main network through open cells
    const from = new Int32Array(N).fill(-1);
    const seen = new Uint8Array(N);
    let q: number[] = [];
    nodes.forEach((n, i) => { if (find(i) === main) { const c = cellOf(n); if (!seen[c]) { seen[c] = 1; from[c] = c; q.push(c); } } });
    const target = new Map<number, number>(); // cell → node index outside main
    nodes.forEach((n, i) => { if (find(i) !== main) target.set(cellOf(n), i); });
    let hit = -1;
    while (q.length && hit < 0) {
      const next: number[] = [];
      for (const c of q) {
        if (target.has(c)) { hit = c; break; }
        const x = c % W;
        for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
          if (n < 0 || n >= N || seen[n] || blocked[n]) continue;
          seen[n] = 1; from[n] = c; next.push(n);
        }
      }
      q = next;
    }
    if (hit < 0) return; // the rest is walled off for real
    const path: number[] = [];
    for (let c = hit; ; c = from[c]) { path.push(c); if (from[c] === c) break; }
    // path: outside node … main node; straighten it
    const free = (a: number, b: number) => {
      const ax = a % W, ay = Math.floor(a / W), bx = b % W, by = Math.floor(b / W);
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
      for (let i = 0; i <= n; i++) if (blocked[Math.round(ay + ((by - ay) * i) / n) * W + Math.round(ax + ((bx - ax) * i) / n)]) return false;
      return true;
    };
    const turns = straighten(path, free);
    const startNode = target.get(path[0])!;
    const endNode = nodes.findIndex((n, i) => find(i) === main && cellOf(n) === path[path.length - 1]);
    let last = startNode;
    for (let t = 1; t < turns.length - 1; t++) { const b = addNode(toPt(turns[t]), true, null); addEdge(last, b); last = b; }
    addEdge(last, endNode);
  }
}
