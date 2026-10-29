// src/lib/dxf/generatePathGraph.ts
//
// Turns wall segments + room rectangles into an actual routable graph
// (nodes + edges), the same shape FloorEditor's manual Add Node / Add Edge
// tools produce. This is what makes a DXF import walkable without a human
// tracing the path by hand afterwards.
//
// Approach (rasterize → flood-fill → skeletonize → trace), the same family
// of technique used elsewhere in this project for turning a flat image into
// a walkable network, just fed by exact vector walls instead of image pixels:
//
//   1. Rasterize every wall segment onto a grid as a thick obstacle line.
//   2. Flood-fill free space starting from each room's center. This finds
//      "everywhere reachable without crossing a wall" WITHOUT needing the
//      walls to form an explicit closed polygon — a real building's outer
//      wall is one continuous line anyway, and this only cares about
//      connectivity, not polygon closure. Small gaps at doorways are exactly
//      where you WANT the flood fill to pass through.
//   3. Skeletonize that free-space mask (Zhang–Suen thinning) down to
//      1-cell-wide centerlines — this becomes the corridor spine.
//   4. Trace the skeleton into a node/edge graph: junctions and dead ends
//      become nodes, the pixel chains between them become edges.
//   5. Snap each room's center onto the nearest skeleton point with a short
//      connector edge, so every room is reachable from the corridor graph.
//
// Failure mode this can't fully solve: if the outer wall has a large
// undrawn gap, the flood fill leaks past the intended boundary. That's
// detected (the free region touches the raster's outer margin) and
// surfaced as a warning rather than silently producing a wrong graph —
// but the graph is still returned, since a leak usually just adds a few
// harmless extra corridor branches around the true footprint rather than
// making it unusable.

import type { ImportedWall, ImportedRoom } from './dxfToVenue';

export interface GraphNode { x: number; y: number; isHallway: boolean; roomIndex: number | null }
export interface GraphEdge { from: number; to: number; weight: number }
export interface PathGraphResult { nodes: GraphNode[]; edges: GraphEdge[]; warnings: string[] }

export interface PathGraphOptions {
  cellSizePx?: number;     // raster resolution; default picks one that caps the grid at ~480px on the long side
  wallThicknessPx?: number; // how thick to draw walls as obstacles; default 4
  spurPrunePx?: number;    // drop dead-end skeleton branches shorter than this; default 14
  simplifyEpsPx?: number;  // polyline simplification tolerance; default 3
  maxRoomSnapPx?: number;  // warn (not drop) if a room center is farther than this from any corridor; default 300
}

// ── grid helpers ────────────────────────────────────────────────────────────

class Grid {
  w: number; h: number; ox: number; oy: number; cell: number;
  data: Uint8Array; // 1 = free/walkable, 0 = wall or unknown
  constructor(minX: number, minY: number, maxX: number, maxY: number, cell: number) {
    this.cell = cell; this.ox = minX; this.oy = minY;
    this.w = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
    this.h = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
    this.data = new Uint8Array(this.w * this.h);
  }
  ix(x: number, y: number) { return [Math.round((x - this.ox) / this.cell), Math.round((y - this.oy) / this.cell)] as const; }
  px(cx: number, cy: number) { return [this.ox + cx * this.cell, this.oy + cy * this.cell] as const; }
  idx(cx: number, cy: number) { return cy * this.w + cx; }
  inBounds(cx: number, cy: number) { return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h; }
  get(cx: number, cy: number) { return this.inBounds(cx, cy) ? this.data[this.idx(cx, cy)] : 0; }
  set(cx: number, cy: number, v: number) { if (this.inBounds(cx, cy)) this.data[this.idx(cx, cy)] = v; }
}

function fillRect(g: Grid, x: number, y: number, w: number, h: number, value: number) {
  const [cx1, cy1] = g.ix(x, y), [cx2, cy2] = g.ix(x + w, y + h);
  const x0 = Math.min(cx1, cx2), x1 = Math.max(cx1, cx2), y0 = Math.min(cy1, cy2), y1 = Math.max(cy1, cy2);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) g.set(cx, cy, value);
}

function drawThickLine(g: Grid, x1: number, y1: number, x2: number, y2: number, thicknessPx: number, value: number) {
  const [cx1, cy1] = g.ix(x1, y1), [cx2, cy2] = g.ix(x2, y2);
  const steps = Math.max(Math.abs(cx2 - cx1), Math.abs(cy2 - cy1), 1);
  const rCells = Math.max(1, Math.round(thicknessPx / g.cell / 2));
  for (let s = 0; s <= steps; s++) {
    const cx = Math.round(cx1 + ((cx2 - cx1) * s) / steps);
    const cy = Math.round(cy1 + ((cy2 - cy1) * s) / steps);
    for (let dx = -rCells; dx <= rCells; dx++) for (let dy = -rCells; dy <= rCells; dy++) {
      if (dx * dx + dy * dy <= rCells * rCells + 1) g.set(cx + dx, cy + dy, value);
    }
  }
}

function floodFillFreeSpace(g: Grid, seeds: Array<readonly [number, number]>): { touchesBorder: boolean } {
  // g.data currently has 1 = obstacle (walls just drawn). We flip: BFS from
  // each seed over NON-obstacle cells, marking them 2 (temporary "reached"),
  // then convert 2 -> 1 (free) and leave untouched cells as 0 (unreachable /
  // outside). This also naturally handles unreachable pockets (closets with
  // no drawn door — they end up excluded from the graph, matching reality:
  // you can't route through a wall that's actually there).
  const obstacle = g.data;
  const reached = new Uint8Array(g.w * g.h);
  const qx: number[] = []; const qy: number[] = [];
  let touchesBorder = false;
  for (const [sx, sy] of seeds) {
    const [cx, cy] = g.ix(sx, sy);
    if (!g.inBounds(cx, cy) || obstacle[g.idx(cx, cy)] === 1) continue;
    if (reached[g.idx(cx, cy)]) continue;
    reached[g.idx(cx, cy)] = 1; qx.push(cx); qy.push(cy);
  }
  let head = 0;
  while (head < qx.length) {
    const cx = qx[head], cy = qy[head]; head++;
    if (cx <= 1 || cy <= 1 || cx >= g.w - 2 || cy >= g.h - 2) touchesBorder = true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (!g.inBounds(nx, ny)) continue;
      const idx = g.idx(nx, ny);
      if (obstacle[idx] === 1 || reached[idx]) continue;
      reached[idx] = 1; qx.push(nx); qy.push(ny);
    }
  }
  g.data = reached; // 1 = free & reachable from a room, 0 = wall or unreachable
  return { touchesBorder };
}

// ── Zhang–Suen thinning ──────────────────────────────────────────────────────

function thin(g: Grid): void {
  const w = g.w, h = g.h;
  const img = g.data;
  const at = (arr: Uint8Array, x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? arr[y * w + x] : 0);
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 400) {
    changed = false;
    for (const step of [0, 1]) {
      const toRemove: number[] = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        if (!img[idx]) continue;
        const p2 = at(img, x, y - 1), p3 = at(img, x + 1, y - 1), p4 = at(img, x + 1, y),
              p5 = at(img, x + 1, y + 1), p6 = at(img, x, y + 1), p7 = at(img, x - 1, y + 1),
              p8 = at(img, x - 1, y), p9 = at(img, x - 1, y - 1);
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        let A = 0;
        for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) A++;
        if (A !== 1) continue;
        if (step === 0) { if (p2 * p4 * p6 !== 0) continue; if (p4 * p6 * p8 !== 0) continue; }
        else { if (p2 * p4 * p8 !== 0) continue; if (p2 * p6 * p8 !== 0) continue; }
        toRemove.push(idx);
      }
      if (toRemove.length) { changed = true; for (const idx of toRemove) img[idx] = 0; }
    }
  }
  g.data = img;
}

// ── skeleton → graph ──────────────────────────────────────────────────────

const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

function neighborCount(g: Grid, cx: number, cy: number): number {
  let n = 0;
  for (const [dx, dy] of N8) if (g.get(cx + dx, cy + dy)) n++;
  return n;
}

function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / L;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  const left = simplify(pts.slice(0, idx + 1), eps);
  const right = simplify(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

function traceSkeleton(g: Grid, simplifyEpsPx: number, spurPrunePx: number) {
  const key = (cx: number, cy: number) => cy * g.w + cx;
  const deg = new Map<number, number>();
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (!g.get(x, y)) continue;
    deg.set(key(x, y), neighborCount(g, x, y));
  }
  const nodeCells = new Set<number>([...deg.entries()].filter(([, d]) => d !== 2).map(([k]) => k));

  // Pure loops (a ring corridor with no junction) have every cell at
  // degree 2 — pick one cell per such component to act as a node so the
  // loop is still traceable as a (self-returning) edge.
  const visitedForLoopDetect = new Set<number>();
  for (const [k, d] of deg) {
    if (d !== 2 || nodeCells.has(k) || visitedForLoopDetect.has(k)) continue;
    // BFS this component; if it never touches a node cell, it's a pure loop.
    const stack = [k]; const comp: number[] = []; let touchesNode = false;
    visitedForLoopDetect.add(k);
    while (stack.length) {
      const c = stack.pop()!; comp.push(c);
      const cx = c % g.w, cy = Math.floor(c / g.w);
      for (const [dx, dy] of N8) {
        const nx = cx + dx, ny = cy + dy;
        if (!g.inBounds(nx, ny) || !g.get(nx, ny)) continue;
        const nk = key(nx, ny);
        if (nodeCells.has(nk)) { touchesNode = true; continue; }
        if (!visitedForLoopDetect.has(nk)) { visitedForLoopDetect.add(nk); stack.push(nk); }
      }
    }
    if (!touchesNode && comp.length) nodeCells.add(comp[0]);
  }

  const usedConn = new Set<string>(); // `${a}|${b}` for a<b, marks a skeleton-adjacency as already traced
  const edges: { poly: [number, number][] }[] = [];
  const nodeList = [...nodeCells];

  for (const startKey of nodeList) {
    const sx = startKey % g.w, sy = Math.floor(startKey / g.w);
    for (const [dx0, dy0] of N8) {
      const nx0 = sx + dx0, ny0 = sy + dy0;
      if (!g.inBounds(nx0, ny0) || !g.get(nx0, ny0)) continue;
      const connKey = [startKey, key(nx0, ny0)].sort((a, b) => a - b).join('|');
      if (usedConn.has(connKey)) continue;

      // walk from (sx,sy) through (nx0,ny0) until hitting another node cell
      const poly: [number, number][] = [[sx, sy]];
      let px = sx, py = sy, cx = nx0, cy = ny0;
      usedConn.add(connKey);
      let guard = 0;
      while (guard++ < 100000) {
        poly.push([cx, cy]);
        if (nodeCells.has(key(cx, cy)) && !(cx === sx && cy === sy)) break;
        // find the single unvisited forward neighbor (degree-2 chain)
        let next: [number, number] | null = null;
        for (const [dx, dy] of N8) {
          const ax = cx + dx, ay = cy + dy;
          if (ax === px && ay === py) continue;
          if (!g.inBounds(ax, ay) || !g.get(ax, ay)) continue;
          const ck = [key(cx, cy), key(ax, ay)].sort((a, b) => a - b).join('|');
          if (usedConn.has(ck)) continue;
          next = [ax, ay]; usedConn.add(ck); break;
        }
        if (!next) break;
        px = cx; py = cy; [cx, cy] = next;
      }
      if (poly.length >= 2) edges.push({ poly });
    }
  }

  // Convert node cell keys → pixel coords, build initial node/edge index
  const nodeIndexByKey = new Map<number, number>();
  const nodes: [number, number][] = [];
  for (const k of nodeList) {
    const cx = k % g.w, cy = Math.floor(k / g.w);
    nodeIndexByKey.set(k, nodes.length);
    nodes.push([cx, cy]);
  }
  const rawEdges = edges.map(e => {
    const a = key(e.poly[0][0], e.poly[0][1]);
    const b = key(e.poly[e.poly.length - 1][0], e.poly[e.poly.length - 1][1]);
    return { from: nodeIndexByKey.get(a)!, to: nodeIndexByKey.get(b)!, poly: e.poly };
  }).filter(e => e.from !== undefined && e.to !== undefined);

  // Prune short dead-end spurs (thinning artefacts at every room/doorway edge)
  const degCount = new Map<number, number>();
  for (const e of rawEdges) { degCount.set(e.from, (degCount.get(e.from) || 0) + 1); degCount.set(e.to, (degCount.get(e.to) || 0) + 1); }
  const cellLen = (poly: [number, number][]) => {
    let d = 0; for (let i = 1; i < poly.length; i++) d += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
    return d * g.cell;
  };
  const kept = rawEdges.filter(e => {
    const isSpur = (degCount.get(e.from) === 1 || degCount.get(e.to) === 1);
    return !(isSpur && cellLen(e.poly) < spurPrunePx / g.cell * g.cell && cellLen(e.poly) < spurPrunePx);
  });

  return { nodesCell: nodes, edges: kept, simplifyEps: simplifyEpsPx / g.cell };
}

// ── public entry point ──────────────────────────────────────────────────────

export function generatePathGraph(walls: ImportedWall[], rooms: ImportedRoom[], opts: PathGraphOptions = {}): PathGraphResult {
  const warnings: string[] = [];
  if (walls.length === 0) return { nodes: [], edges: [], warnings: ['No walls — cannot derive a walkable path.'] };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of walls) { minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2); minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2); }
  for (const r of rooms) { minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x + r.width); minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y + r.height); }
  const pad = 20; minX -= pad; minY -= pad; maxX += pad; maxY += pad;

  const longSide = Math.max(maxX - minX, maxY - minY);
  const cell = opts.cellSizePx ?? Math.max(2, longSide / 480);
  const wallThicknessPx = opts.wallThicknessPx ?? Math.max(3, cell * 1.5);
  const spurPrunePx = opts.spurPrunePx ?? 14;
  const simplifyEpsPx = opts.simplifyEpsPx ?? Math.max(3, cell);
  const maxRoomSnapPx = opts.maxRoomSnapPx ?? 300;

  const g = new Grid(minX, minY, maxX, maxY, cell);
  for (const w of walls) drawThickLine(g, w.x1, w.y1, w.x2, w.y2, wallThicknessPx, 1);
  // Room interiors are obstacles for THIS pass too — we only want to
  // skeletonize corridor space, not generate a medial-axis maze through
  // every room. Rooms rejoin the graph afterwards via a single connector
  // from their center to the nearest corridor node.
  const margin = Math.max(1, cell);
  for (const r of rooms) fillRect(g, r.x + margin, r.y + margin, Math.max(0, r.width - 2 * margin), Math.max(0, r.height - 2 * margin), 1);

  // Seed the flood fill from just outside each room's boundary (where a
  // door almost always faces straight onto the corridor), not the room's
  // center — the center is now inside an obstacle we just drew. Several
  // offset points per room are tried; any that land inside a wall are
  // simply not free and are skipped by floodFillFreeSpace.
  const seeds: Array<readonly [number, number]> = [];
  const off = wallThicknessPx + cell;
  for (const r of rooms) {
    const cxm = r.x + r.width / 2, cym = r.y + r.height / 2;
    seeds.push([cxm, r.y - off], [cxm, r.y + r.height + off], [r.x - off, cym], [r.x + r.width + off, cym]);
  }
  if (rooms.length === 0) seeds.push([minX + (maxX - minX) / 2, minY + (maxY - minY) / 2]);
  const { touchesBorder } = floodFillFreeSpace(g, seeds);
  if (touchesBorder) warnings.push('The walkable area reached the edge of the drawing — the outer wall may have a gap. Check the graph before publishing.');

  const freeCells = g.data.reduce((s, v) => s + v, 0);
  if (freeCells < 4) return { nodes: [], edges: [], warnings: [...warnings, 'No connected free space found — check that rooms are actually enclosed by the wall layer, and that room centers fall inside their walls.'] };

  thin(g);
  const { nodesCell, edges, simplifyEps } = traceSkeleton(g, simplifyEpsPx, spurPrunePx);
  if (nodesCell.length === 0) return { nodes: [], edges: [], warnings: [...warnings, 'Skeletonization produced no graph — the free space may be too thin or fragmented at this resolution. Try a smaller wall thickness.'] };

  let nodes: GraphNode[] = nodesCell.map(([cx, cy]) => {
    const [x, y] = g.px(cx, cy);
    return { x, y, isHallway: true, roomIndex: null };
  });
  let graphEdges: GraphEdge[] = [];
  for (const e of edges) {
    const polyPx = simplify(e.poly, simplifyEps).map(([cx, cy]) => g.px(cx, cy));
    let weight = 0; for (let i = 1; i < polyPx.length; i++) weight += Math.hypot(polyPx[i][0] - polyPx[i - 1][0], polyPx[i][1] - polyPx[i - 1][1]);
    if (e.from === e.to && polyPx.length < 3) continue; // degenerate self-loop artefact
    graphEdges.push({ from: e.from, to: e.to, weight: Math.round(weight) });
  }

  // Junction clustering: Zhang–Suen thinning routinely produces a small
  // knot of 3-5 adjacent junction pixels at a real T/X junction instead of
  // one clean point (visible as several near-zero-weight edges between
  // nodes a few px apart). Merge any nodes within mergeRadius of each other
  // into one, at their average position, and collapse/drop edges that
  // become self-loops or duplicates as a result.
  const mergeRadius = Math.max(wallThicknessPx, cell * 2);
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (const e of graphEdges) if (e.weight <= mergeRadius) union(e.from, e.to);

  const groups = new Map<number, number[]>();
  nodes.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(i); });
  const remap = new Map<number, number>();
  const mergedNodes: GraphNode[] = [];
  for (const [, members] of groups) {
    const mx = members.reduce((s, i) => s + nodes[i].x, 0) / members.length;
    const my = members.reduce((s, i) => s + nodes[i].y, 0) / members.length;
    const newIdx = mergedNodes.length;
    mergedNodes.push({ x: mx, y: my, isHallway: true, roomIndex: null });
    for (const i of members) remap.set(i, newIdx);
  }
  const seenEdge = new Set<string>();
  const mergedEdges: GraphEdge[] = [];
  for (const e of graphEdges) {
    const a = remap.get(e.from)!, b = remap.get(e.to)!;
    if (a === b) continue; // collapsed into the same junction cluster
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenEdge.has(k)) continue; // duplicate corridor segment between the same two junctions
    seenEdge.add(k);
    mergedEdges.push({ from: a, to: b, weight: e.weight });
  }
  nodes = mergedNodes; graphEdges = mergedEdges;

  // Collapse pass-through nodes: a hallway node with exactly two edges isn't
  // a real branching point, it's a straight/gently-curving corridor that the
  // raster happened to pass a skeleton pixel through (very common at the
  // "corners" of a plain rectangular room/corridor, which is where most of
  // the noise above the junction-merge step comes from). Fold it into one
  // edge between its two neighbours, summing the path length so distances
  // stay correct even though the rendered edge is now a straight line
  // between the two survivors — the same approximation the app already
  // makes for every manually-drawn edge (edges are straight lines with an
  // independent weight; see the `edges` table / FloorEditor's Add Edge tool).
  for (let guard = 0; guard < 500; guard++) {
    const adj = new Map<number, { other: number; w: number; ei: number }[]>();
    graphEdges.forEach((e, ei) => {
      if (!adj.has(e.from)) adj.set(e.from, []);
      if (!adj.has(e.to)) adj.set(e.to, []);
      adj.get(e.from)!.push({ other: e.to, w: e.weight, ei });
      adj.get(e.to)!.push({ other: e.from, w: e.weight, ei });
    });
    let collapsedAny = false;
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i].isHallway) continue; // never collapse a room anchor — it's a real destination
      const links = adj.get(i);
      if (!links || links.length !== 2) continue;
      const [a, b] = links;
      if (a.other === b.other) continue; // would create a duplicate/parallel edge — leave as-is
      if (a.ei === b.ei) continue;
      graphEdges = graphEdges.filter((_, ei) => ei !== a.ei && ei !== b.ei);
      graphEdges.push({ from: a.other, to: b.other, weight: Math.round(a.w + b.w) });
      collapsedAny = true;
      break; // adjacency map is now stale — rebuild before continuing
    }
    if (!collapsedAny) break;
  }
  // Dedupe parallel edges left over from the collapse pass (two different
  // skeleton branches that both reduced down to the same pair of nodes) —
  // keep the shorter one.
  {
    const best = new Map<string, GraphEdge>();
    for (const e of graphEdges) {
      const k = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`;
      const prev = best.get(k);
      if (!prev || e.weight < prev.weight) best.set(k, e);
    }
    graphEdges = [...best.values()];
  }

  // Drop hallway nodes that lost every edge in the collapse above.
  {
    const used = new Set<number>();
    graphEdges.forEach(e => { used.add(e.from); used.add(e.to); });
    const keepIdx = nodes.map((n, i) => (n.isHallway ? used.has(i) : true) ? i : -1).filter(i => i >= 0);
    const remap2 = new Map<number, number>();
    keepIdx.forEach((oldI, newI) => remap2.set(oldI, newI));
    nodes = keepIdx.map(i => nodes[i]);
    graphEdges = graphEdges.map(e => ({ from: remap2.get(e.from)!, to: remap2.get(e.to)!, weight: e.weight })).filter(e => e.from !== undefined && e.to !== undefined);
  }

  // Snap each room's center to the nearest existing node (straight connector —
  // good enough since the target is almost always just across the doorway).
  let farRooms = 0;
  rooms.forEach((r, ri) => {
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    let best = -1, bestD = Infinity;
    nodes.forEach((n, ni) => { const d = Math.hypot(n.x - cx, n.y - cy); if (d < bestD) { bestD = d; best = ni; } });
    if (best === -1) return;
    if (bestD > maxRoomSnapPx) farRooms++;
    const roomNodeIdx = nodes.length;
    nodes.push({ x: cx, y: cy, isHallway: false, roomIndex: ri });
    graphEdges.push({ from: roomNodeIdx, to: best, weight: Math.round(bestD) });
  });
  if (farRooms > 0) warnings.push(`${farRooms} room(s) are far from the nearest corridor — their connector may cross a wall; check them in the editor.`);

  return { nodes, edges: graphEdges, warnings };
}