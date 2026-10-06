// Closed-shape detection for the wall tool: when a new wall closes a loop of
// walls, the loop's corners (to offer "make a room here").

export interface Seg { x1: number; y1: number; x2: number; y2: number }
interface Pt { x: number; y: number }

/**
 * The corners of the smallest loop the wall a→b closes with `walls`
 * (ends within `tol` count as joined), starting at a; null when it closes none.
 */
export function closedLoop(walls: Seg[], a: Pt, b: Pt, tol = 3): Pt[] | null {
  const pts: Pt[] = [];
  const idOf = (p: Pt) => {
    let i = pts.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) <= tol);
    if (i < 0) { pts.push({ x: p.x, y: p.y }); i = pts.length - 1; }
    return i;
  };
  const adj = new Map<number, number[]>();
  const link = (i: number, j: number) => { if (i === j) return; (adj.get(i) ?? adj.set(i, []).get(i)!).push(j); (adj.get(j) ?? adj.set(j, []).get(j)!).push(i); };
  for (const w of walls) link(idOf({ x: w.x1, y: w.y1 }), idOf({ x: w.x2, y: w.y2 }));
  const A = idOf(a), B = idOf(b);
  if (A === B) return null;
  // Shortest way back from b to a over the other walls (breadth first: fewest corners).
  const prev = new Map<number, number>([[B, -1]]);
  const queue = [B];
  while (queue.length) {
    const u = queue.shift()!;
    if (u === A) break;
    for (const v of adj.get(u) ?? []) if (!prev.has(v)) { prev.set(v, u); queue.push(v); }
  }
  if (!prev.has(A)) return null;
  const ring: Pt[] = [];
  for (let at = A; at !== -1; at = prev.get(at)!) ring.push(pts[at]);
  // ring runs a → … → b; the new wall b → a closes it.
  return ring.length >= 3 ? ring : null;
}
