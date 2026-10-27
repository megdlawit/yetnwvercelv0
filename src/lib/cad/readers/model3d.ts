// 3D sources (IFC building models, OBJ / GLB / GLTF) → a 2D plan.
//
// Both are reduced to "elements": a world-space triangle mesh in metres with
// Y up, plus what it is (an IFC class, or a node name). An IFC model says
// which storey each element is on; other models' levels are found by
// clustering where elements start vertically. For the chosen level the plan
// is drawn the way an architect's plan view is: walls cut by a horizontal
// plane 1 m above the floor (solid outlines), windows and doors cut through
// their glass and leaves, doors with their swing, stairs and furniture seen
// from above (tread and top outlines), rooms from the spaces.

import type { DxfEntity, DxfPoint } from '../../dxf/parseDxf';
import type { CadDrawing, Category } from '../types';
import { categoryFromBlock } from '../classify';
import { sliceMesh, mergeCollinear, chainLoops, polygonCentroid, polygonArea, type Seg } from '../geometry';
import { distToSeg } from '../detectRooms';
import { finish } from './svg';

export interface Element {
  layer: string;            // IFC class name, or "Model" for plain 3D files
  name: string;
  /**
   * How it becomes 2D: `slice` cut at the plan height (walls); `cut` cut through itself
   * (windows, doors: at the plan height, or halfway up when it's above or below it);
   * `top` seen from above (stairs, railings); `object` seen from above plus a marker
   * (furniture, fixtures); `space` a room; `box` its footprint (lifts).
   */
  role: 'slice' | 'cut' | 'top' | 'object' | 'space' | 'box';
  positions: Float32Array;  // world xyz, metres, Y up
  index: Uint32Array | null;
  min: [number, number, number];
  max: [number, number, number];
  /** The storey the model puts it on (IFC). */
  storey?: number;
  /**
   * Door leaves: hinge, closed and open directions (unit) and width, in plan (x, z), metres.
   * `depth`: the door's thickness, to hinge it on the other face; `sure`: the model said which
   * way it opens (else it opens to the side where it doesn't hit a wall).
   */
  swings?: { hinge: DxfPoint; closed: DxfPoint; open: DxfPoint; width: number; depth: number; sure: boolean }[];
}

/** A storey of the model: its name and where its floor is (metres, from its walls). */
export interface Storey { id: number; name: string; elevation: number }

export function boundsOf(p: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[i + k]); max[k] = Math.max(max[k], p[i + k]); }
  }
  return { min, max };
}

/** Floor levels: cluster the bottoms of slice elements; a gap of 2 m starts a new level. */
export function findLevels(elements: Element[]): number[] {
  const bottoms = elements.filter(e => e.role === 'slice').map(e => e.min[1]).sort((a, b) => a - b);
  if (!bottoms.length) return [Math.min(...elements.map(e => e.min[1]), 0)];
  const levels = [bottoms[0]];
  for (const y of bottoms) if (y - levels[levels.length - 1] > 2) levels.push(y);
  return levels;
}

/**
 * The outline of a mesh seen from above: the edges of its horizontal faces that no other
 * horizontal face at the same height shares — a tread's nosing, a table top, a basin rim.
 */
export function topOutline(positions: Float32Array, index: Uint32Array | null, maxSegs = 400): Seg[] {
  const tri = index ? index.length / 3 : positions.length / 9;
  const v = (i: number) => (index ? index[i] : i) * 3;
  const q = (n: number) => Math.round(n * 200);   // 5 mm
  const edges = new Map<string, { s: Seg; n: number }>();
  for (let t = 0; t < tri; t++) {
    const a = v(t * 3), b = v(t * 3 + 1), c = v(t * 3 + 2);
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a], wy = positions[c + 1] - positions[a + 1], wz = positions[c + 2] - positions[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12 || Math.abs(ny) < 0.95 * len) continue;   // not a horizontal face
    for (const [p, r] of [[a, b], [b, c], [c, a]]) {
      const k1 = `${q(positions[p])},${q(positions[p + 1])},${q(positions[p + 2])}`, k2 = `${q(positions[r])},${q(positions[r + 1])},${q(positions[r + 2])}`;
      const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      const e = edges.get(key);
      if (e) e.n++;
      else edges.set(key, { s: { x1: positions[p], y1: positions[p + 2], x2: positions[r], y2: positions[r + 2] }, n: 1 });
    }
  }
  const segs = [...edges.values()].filter(e => e.n === 1).map(e => e.s).filter(s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.01);
  const merged = mergeCollinear(segs, 0.005, 0.005).segs;
  return merged.length <= maxSegs ? merged : merged.sort((s, z) => Math.hypot(z.x2 - z.x1, z.y2 - z.y1) - Math.hypot(s.x2 - s.x1, s.y2 - s.y1)).slice(0, maxSegs);
}

export function elementsToDrawing(
  elements: Element[], format: CadDrawing['format'], hints: CadDrawing['layerHints'], notes: string[], levelIndex = 0,
  storeys?: Storey[],
): CadDrawing {
  const levels = storeys?.length ? storeys.map(s => s.elevation) : findLevels(elements);
  const li = Math.min(Math.max(levelIndex, 0), levels.length - 1);
  const floorY = levels[li];
  const nextY = levels[li + 1] ?? Infinity;
  const cutY = floorY + 1.0;
  const storey = storeys?.[li];
  // On this level: the model says so (its storey), or it stands between this floor and the next.
  const onLevel = (e: Element) => (storey && e.storey != null ? e.storey === storey.id : e.min[1] < nextY - 0.5 && e.max[1] > floorY + 0.05);

  const entities: DxfEntity[] = [];
  const layers = new Set<string>();
  const add = (e: DxfEntity) => { entities.push(e); layers.add(e.layer); };
  const lines = (layer: string, segs: Seg[]) => { for (const s of segs) add({ kind: 'LINE', layer, a: { x: s.x1, y: s.y1 }, b: { x: s.x2, y: s.y2 } }); };

  // Walls are cut first: a door the model doesn't say the side of opens away from them.
  const cutWalls: Seg[] = [];
  const grid = new Map<string, Seg[]>();
  const cell = (x: number, y: number) => `${Math.floor(x)},${Math.floor(y)}`;
  const nearWall = (p: DxfPoint) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const s of grid.get(cell(p.x + dx, p.y + dy)) ?? []) if (distToSeg(p, s) < 0.04) return true;
    }
    return false;
  };
  const blocked = (h: DxfPoint, c: DxfPoint, o: DxfPoint, w: number) => {
    let n = 0;
    for (let k = 1; k <= 8; k++) {
      const t = (k / 8) * (Math.PI / 2), r = 0.9 * w;
      if (nearWall({ x: h.x + (c.x * Math.cos(t) + o.x * Math.sin(t)) * r, y: h.y + (c.y * Math.cos(t) + o.y * Math.sin(t)) * r })) n++;
      if (nearWall({ x: h.x + o.x * r * (k / 8), y: h.y + o.y * r * (k / 8) })) n++;
    }
    return n;
  };
  const ordered = [...elements.filter(e => e.role === 'slice'), ...elements.filter(e => e.role !== 'slice')];
  let indexed = false;

  for (const el of ordered) {
    const cx = (el.min[0] + el.max[0]) / 2, cz = (el.min[2] + el.max[2]) / 2;
    if (el.role !== 'slice' && !indexed) {
      indexed = true;
      for (const s of cutWalls) {
        const n = Math.max(1, Math.ceil(Math.hypot(s.x2 - s.x1, s.y2 - s.y1)));
        const keys = new Set<string>();
        for (let i = 0; i <= n; i++) keys.add(cell(s.x1 + ((s.x2 - s.x1) * i) / n, s.y1 + ((s.y2 - s.y1) * i) / n));
        for (const k of keys) (grid.get(k) ?? grid.set(k, []).get(k)!).push(s);
      }
    }
    if (el.role === 'slice') {
      // The plane cuts whatever stands through it, whichever storey the model files it under
      // (a double-height hall's wall, a column through two floors).
      if (el.min[1] > cutY || el.max[1] < cutY) continue;
      const segs = mergeCollinear(sliceMesh(el.positions, el.index, cutY), 0.005, 0.005).segs;
      if (el.layer !== 'IfcCurtainWall') cutWalls.push(...segs);
      // A cut wall is a closed outline: drawn as one, it's filled solid on the plan.
      const loops = chainLoops(segs, 0.01).filter(l => l.length >= 3);
      const inLoops = loops.reduce((s, l) => s + l.reduce((p, pt, i) => p + Math.hypot(l[(i + 1) % l.length].x - pt.x, l[(i + 1) % l.length].y - pt.y), 0), 0);
      const total = segs.reduce((s, x) => s + Math.hypot(x.x2 - x.x1, x.y2 - x.y1), 0);
      if (loops.length && inLoops >= 0.9 * total) for (const pts of loops) add({ kind: 'POLYLINE', layer: el.layer, closed: true, pts });
      else lines(el.layer, segs);
    } else if (!onLevel(el)) {
      continue;
    } else if (el.role === 'cut') {
      // A window above the plan height (a bathroom's high window) is still shown, cut halfway up.
      const y = el.min[1] < cutY && el.max[1] > cutY ? cutY : (el.min[1] + el.max[1]) / 2;
      lines(el.layer, mergeCollinear(sliceMesh(el.positions, el.index, y), 0.005, 0.005).segs);
      for (const sw of el.swings ?? []) {
        let { hinge: h, open: o } = sw;
        const { closed: c, width: w } = sw;
        // The other face, opening the other way: when the model doesn't say and that's clearer.
        const back = { x: h.x - o.x * sw.depth, y: h.y - o.y * sw.depth }, away = { x: -o.x, y: -o.y };
        if (!sw.sure && blocked(back, c, away, w) < blocked(h, c, o, w)) { h = back; o = away; }
        const ac = (Math.atan2(c.y, c.x) * 180) / Math.PI, ao = (Math.atan2(o.y, o.x) * 180) / Math.PI;
        const ccw = (((ao - ac) % 360) + 360) % 360 < 180;
        add({ kind: 'ARC', layer: el.layer, center: h, radius: w, startDeg: ccw ? ac : ao, endDeg: ccw ? ao : ac });
        add({ kind: 'LINE', layer: el.layer, a: h, b: { x: h.x + o.x * w, y: h.y + o.y * w } });
      }
      if (el.layer === 'IfcDoor') add({ kind: 'INSERT', layer: el.layer, block: el.name || el.layer, pos: { x: cx, y: cz }, rotationDeg: 0 });
    } else if (el.role === 'space') {
      const y = Math.min(Math.max(cutY, el.min[1] + 0.05), el.max[1] - 0.05);
      const loops = chainLoops(mergeCollinear(sliceMesh(el.positions, el.index, y), 0.005, 0.005).segs, 0.01);
      const loop = loops.sort((a, b) => polygonArea(b) - polygonArea(a))[0];
      const pts = loop ?? [{ x: el.min[0], y: el.min[2] }, { x: el.max[0], y: el.min[2] }, { x: el.max[0], y: el.max[2] }, { x: el.min[0], y: el.max[2] }];
      add({ kind: 'POLYLINE', layer: el.layer, closed: true, pts });
      if (el.name) add({ kind: 'TEXT', layer: el.layer, pos: polygonCentroid(pts), text: el.name });
    } else if (el.role === 'box') {
      // lifts: their footprint, so the venue builder knows their size
      add({ kind: 'POLYLINE', layer: el.layer, closed: true, pts: [
        { x: el.min[0], y: el.min[2] }, { x: el.max[0], y: el.min[2] }, { x: el.max[0], y: el.max[2] }, { x: el.min[0], y: el.max[2] },
      ] });
    } else if (el.role === 'top') {
      lines(el.layer, topOutline(el.positions, el.index));
    } else {
      // Furniture and fixtures on the floor; light fittings and other things up at the ceiling aren't on a plan.
      if (el.min[1] > floorY + 1.8) continue;
      if (el.index) lines(el.layer, topOutline(el.positions, el.index, 150));
      const w = el.max[0] - el.min[0], d = el.max[2] - el.min[2];
      add({ kind: 'INSERT', layer: el.layer, block: el.name || el.layer, pos: { x: cx, y: cz }, rotationDeg: d > w ? 90 : 0 });
    }
  }

  if (levels.length > 1) {
    const label = storey ? `“${storey.name}”` : `Level ${li + 1} of ${levels.length}`;
    notes = [...notes, `${label} (floor at ${floorY.toFixed(2)} m). Choose another level below if needed.`];
  }
  return {
    ...finish(entities, layers),
    format, unitsPerMeter: 1, unitsName: 'metres', flipY: false, notes, layerHints: hints,
    levels: levels.map((y, i) => ({ name: storeys?.[i]?.name || `Level ${i + 1}`, elevation: y })), level: li,
    atLevel: (i: number) => elementsToDrawing(elements, format, hints, notes.filter(n => !/\(floor at /.test(n)), i, storeys),
  };
}

// ── IFC ──────────────────────────────────────────────────────────────────────

type Handle = { value: number } | number | null | undefined;
const ref = (h: Handle) => (typeof h === 'number' ? h : h?.value ?? null);
const text = (v: unknown) => decodeIfcString(v && typeof v === 'object' && 'value' in v ? String((v as { value: unknown }).value ?? '') : '').trim();

/**
 * IFC (ISO 10303-21) writes non-ASCII as escapes: \X2\00FC\X0\ (UTF-16 hex), \X\FC (Latin-1),
 * \S\| (Latin-1 high half). "Wohnk\X2\00FC\X0\che" → "Wohnküche".
 */
export function decodeIfcString(s: string): string {
  return s
    .replace(/\\X2\\((?:[0-9A-F]{4})+)\\X0\\/gi, (_, hex: string) => String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map(h => parseInt(h, 16))))
    .replace(/\\X\\([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (_, c: string) => String.fromCharCode(c.charCodeAt(0) + 128));
}

/**
 * A door's leaves from its placement: IFC doors open towards their local +y, hinged on the
 * left (SINGLE_SWING_LEFT, and when the type doesn't say) or right as seen along +y.
 * Sliding, folding and revolving doors have no swing.
 *
 * Exporters set the frame up differently (Revit's door geometry has its y axis pointing up,
 * models in millimetres scale it by 0.001), so the door's two horizontal axes are found
 * whichever they are: the one it's wider along is its width, it swings across the other.
 */
export function doorSwings(m: ArrayLike<number>, positions: Float32Array, operation: string): Element['swings'] {
  const axes = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]].map((c, i) => {
    const l = Math.hypot(c[0], c[1], c[2]);
    return l > 1e-12 && Math.abs(c[1] / l) < 0.1 ? { i, x: c[0] / l, y: c[2] / l } : null;   // horizontal ones
  }).filter((a): a is { i: number; x: number; y: number } => !!a);
  if (axes.length < 2 || Math.abs(axes[0].x * axes[1].x + axes[0].y * axes[1].y) > 0.1) return [];   // not a level door
  const extent = (a: { x: number; y: number }) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < positions.length; i += 3) { const t = positions[i] * a.x + positions[i + 2] * a.y; if (t < lo) lo = t; if (t > hi) hi = t; }
    return [lo, hi] as const;
  };
  const [a, b] = axes;
  const [ea, eb] = [extent(a), extent(b)];
  const wide = ea[1] - ea[0] >= eb[1] - eb[0];
  // The width axis, and the swing axis: IFC's local +y when that's the other horizontal one.
  const X = wide ? a : b, Y = wide ? b : a;
  const [u0, u1] = wide ? ea : eb, [v0, v1] = wide ? eb : ea;
  const width = u1 - u0, depth = v1 - v0;
  const said = /SWING/i.test(operation);
  // A door this wide that the model doesn't describe is a garage, overhead or sliding door.
  if (!(width > 0.4 && width < (said ? 3.5 : 2.6)) || /SLIDING|FOLDING|REVOLVING|ROLLINGUP|SWING_FIXED|NOTDEFINED_SLIDING/i.test(operation)) return [];
  const at = (u: number) => ({ x: X.x * u + Y.x * v1, y: X.y * u + Y.y * v1 });
  const minus = { x: -X.x, y: -X.y };
  // The y axis is IFC's swing side only when it's the door's own local y (column 2 of its frame).
  const sure = said && Y.i === 1;
  if (/DOUBLE/i.test(operation) || (!said && width > 1.5)) {
    return [{ hinge: at(u0), closed: X, open: Y, width: width / 2, depth, sure }, { hinge: at(u1), closed: minus, open: Y, width: width / 2, depth, sure }];
  }
  return /RIGHT/i.test(operation) ? [{ hinge: at(u1), closed: minus, open: Y, width, depth, sure }] : [{ hinge: at(u0), closed: X, open: Y, width, depth, sure }];
}

/** `wasmPath`: where web-ifc's WebAssembly is, outside the browser (tests, scripts). */
export async function readIfc(data: ArrayBuffer, wasmPath?: string): Promise<CadDrawing> {
  const WebIFC = await import('web-ifc');
  const wasmUrl = wasmPath ?? (await import('web-ifc/web-ifc.wasm?url')).default;
  const api = new WebIFC.IfcAPI();
  await api.Init((path: string) => (path.endsWith('.wasm') ? wasmUrl : path), true);
  const modelID = api.OpenModel(new Uint8Array(data));

  const classes: [number, string, Element['role'], Category][] = [
    [WebIFC.IFCWALL, 'IfcWall', 'slice', 'walls'],
    [WebIFC.IFCWALLSTANDARDCASE, 'IfcWall', 'slice', 'walls'],
    [WebIFC.IFCCOLUMN, 'IfcColumn', 'slice', 'walls'],
    // A glass façade: its panels and mullions (only those of a curtain wall, see below).
    [WebIFC.IFCCURTAINWALL, 'IfcCurtainWall', 'slice', 'windows'],
    [WebIFC.IFCPLATE, 'IfcCurtainWall', 'slice', 'windows'],
    [WebIFC.IFCMEMBER, 'IfcCurtainWall', 'slice', 'windows'],
    [WebIFC.IFCSPACE, 'IfcSpace', 'space', 'rooms'],
    [WebIFC.IFCDOOR, 'IfcDoor', 'cut', 'doors'],
    [WebIFC.IFCWINDOW, 'IfcWindow', 'cut', 'windows'],
    [WebIFC.IFCSTAIR, 'IfcStair', 'top', 'stairs'],
    [WebIFC.IFCSTAIRFLIGHT, 'IfcStair', 'top', 'stairs'],
    [WebIFC.IFCRAMP, 'IfcStair', 'top', 'stairs'],
    [WebIFC.IFCRAMPFLIGHT, 'IfcStair', 'top', 'stairs'],
    [WebIFC.IFCRAILING, 'IfcRailing', 'top', 'furniture'],
    [WebIFC.IFCTRANSPORTELEMENT, 'IfcTransportElement', 'box', 'elevators'],
    [WebIFC.IFCFURNISHINGELEMENT, 'IfcFurnishingElement', 'object', 'furniture'],
    [WebIFC.IFCFURNITURE, 'IfcFurnishingElement', 'object', 'furniture'],
    [WebIFC.IFCSANITARYTERMINAL, 'IfcSanitaryTerminal', 'object', 'furniture'],
    [WebIFC.IFCFLOWTERMINAL, 'IfcSanitaryTerminal', 'object', 'furniture'],
  ];
  // (a class this web-ifc build doesn't know is skipped)
  for (let i = classes.length - 1; i >= 0; i--) if (typeof classes[i][0] !== 'number') classes.splice(i, 1);
  const byType = new Map(classes.map(c => [c[0], c] as const));
  const elements: Element[] = [];
  const storeyNames = new Map<number, string>();

  try {
    // Which storey each element is on: contained in it, or part of something that is (a stair's
    // flights, a curtain wall's panels; a storey's spaces are parts of the storey itself).
    const ids = (type: number) => { const v = api.GetLineIDsWithType(modelID, type); return Array.from({ length: v.size() }, (_, i) => v.get(i)); };
    for (const id of ids(WebIFC.IFCBUILDINGSTOREY)) {
      const s = api.GetLine(modelID, id);
      storeyNames.set(id, text(s?.Name) || text(s?.LongName) || `Storey ${storeyNames.size + 1}`);
    }
    const container = new Map<number, number>(), parent = new Map<number, number>();
    for (const id of ids(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
      const r = api.GetLine(modelID, id);
      const at = ref(r?.RelatingStructure);
      if (at != null) for (const h of r?.RelatedElements ?? []) { const e = ref(h); if (e != null) container.set(e, at); }
    }
    for (const id of ids(WebIFC.IFCRELAGGREGATES)) {
      const r = api.GetLine(modelID, id);
      const at = ref(r?.RelatingObject);
      if (at != null) for (const h of r?.RelatedObjects ?? []) { const e = ref(h); if (e != null) parent.set(e, at); }
    }
    const storeyOf = (id: number, depth = 0): number | undefined => {
      if (storeyNames.has(id)) return id;
      const c = container.get(id);
      if (c != null) return storeyNames.has(c) ? c : storeyOf(c, depth + 1);
      const p = parent.get(id);
      return p != null && depth < 8 ? storeyOf(p, depth + 1) : undefined;
    };
    const inCurtainWall = (id: number) => { const p = parent.get(id); return p != null && api.GetLineType(modelID, p) === WebIFC.IFCCURTAINWALL; };

    api.StreamAllMeshesWithTypes(modelID, classes.map(c => c[0]), mesh => {
      const type = api.GetLineType(modelID, mesh.expressID) as number;
      const cls = byType.get(type);
      if (!cls) return;
      if ((type === WebIFC.IFCPLATE || type === WebIFC.IFCMEMBER) && !inCurtainWall(mesh.expressID)) return;
      const pos: number[] = [], idx: number[] = [];
      let placement: ArrayLike<number> | null = null;
      for (let g = 0; g < mesh.geometries.size(); g++) {
        const pg = mesh.geometries.get(g);
        const geom = api.GetGeometry(modelID, pg.geometryExpressID);
        const v = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const ix = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
        const m = pg.flatTransformation; // column-major 4x4
        placement ??= m;
        const base = pos.length / 3;
        for (let i = 0; i < v.length; i += 6) { // x y z nx ny nz
          const x = v[i], y = v[i + 1], z = v[i + 2];
          pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        }
        for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base);
        geom.delete();
      }
      if (!pos.length) return;
      const positions = new Float32Array(pos);
      let name = '', swings: Element['swings'];
      if (cls[2] === 'space' || type === WebIFC.IFCDOOR) {
        try {
          const line = api.GetLine(modelID, mesh.expressID);
          if (cls[2] === 'space') name = text(line?.LongName) || text(line?.Name);
          else if (placement) swings = doorSwings(placement, positions, text(line?.OperationType));
        } catch { /* unnamed */ }
      }
      elements.push({
        layer: cls[1], name, role: cls[2], positions, index: new Uint32Array(idx), ...boundsOf(positions),
        storey: storeyOf(mesh.expressID), ...(swings?.length ? { swings } : {}),
      });
    });
  } finally {
    api.CloseModel(modelID);
  }

  if (!elements.length) throw new Error('No walls, spaces or doors were found in this IFC file.');
  const hints: NonNullable<CadDrawing['layerHints']> = {};
  for (const [, layer, , category] of classes) hints[layer] = { category, confidence: 0.98, reason: `IFC class ${layer}` };
  return elementsToDrawing(elements, 'ifc', hints, ['Walls are cut 1 m above each floor, like a plan view.'], 0, storeysOf(elements, storeyNames));
}

/** Storeys that are a building's footing or roof, not a floor people walk ("T/FDN", "Roof - Main", "04 dak"). */
const NOT_A_FLOOR = /\b(?:t\/?fdn|fdn|foundations?|footings?|tof|roofs?|site|grade|gelände|fundament|fundering|dach|dak)\b/i;

/**
 * The model's storeys that are floors, bottom up: those holding walls or rooms, each at the
 * height its walls start (its spaces' when it has no walls). Foundation and roof storeys are
 * left out unless they have doors (a roof terrace with a stair hall is a floor; an attic void
 * or a footing isn't). None when the model doesn't place its elements.
 */
export function storeysOf(elements: Element[], names: Map<number, string>): Storey[] | undefined {
  const placed = elements.filter(e => e.storey != null);
  if (placed.length < 0.6 * elements.length) return undefined;
  const out: Storey[] = [];
  for (const [id, name] of names) {
    const mine = placed.filter(e => e.storey === id);
    const floors = mine.filter(e => e.role === 'slice').map(e => e.min[1]);
    const spaces = mine.filter(e => e.role === 'space').map(e => e.min[1]);
    const ys = (floors.length ? floors : spaces).sort((a, b) => a - b);
    if (!ys.length || (NOT_A_FLOOR.test(name) && !mine.some(e => e.layer === 'IfcDoor'))) continue;
    // the common bottom: walls standing on the floor (a few start lower, on the slab below)
    out.push({ id, name, elevation: ys[Math.floor(ys.length / 2)] });
  }
  return out.length ? out.sort((a, b) => a.elevation - b.elevation) : undefined;
}

// ── OBJ / GLB / GLTF ─────────────────────────────────────────────────────────

export async function readModel(data: ArrayBuffer, format: 'obj' | 'glb' | 'gltf'): Promise<CadDrawing> {
  const THREE = await import('three');
  let root: import('three').Object3D;
  if (format === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    root = new OBJLoader().parse(new TextDecoder().decode(data));
  } else {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    root = await new Promise((resolve, reject) => new GLTFLoader().parse(data, '', g => resolve(g.scene), e => reject(
      new Error(format === 'gltf'
        ? 'This .gltf needs files that weren\'t uploaded (textures or .bin). Export it as a single .glb instead.'
        : `Could not read this model: ${(e as unknown as Error)?.message ?? e}`),
    )));
  }
  root.updateMatrixWorld(true);

  const elements: Element[] = [];
  const v = new THREE.Vector3();
  root.traverse(obj => {
    const mesh = obj as import('three').Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const attr = mesh.geometry.attributes.position;
    const positions = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
      positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
    }
    const index = mesh.geometry.index ? new Uint32Array(mesh.geometry.index.array) : null;
    // Objects named like a tree, bench, door … become markers instead of
    // being cut into the walls (a sliced trunk is not a wall).
    const name = (mesh.name || mesh.parent?.name || '').trim();
    const objectCat = name ? categoryFromBlock(name) : null;
    elements.push({
      layer: objectCat ? 'Model objects' : 'Model', name, role: objectCat ? 'object' : 'slice',
      positions, index, ...boundsOf(positions),
    });
  });
  if (!elements.length) throw new Error('This model has no meshes.');
  return elementsToDrawing(elements, format, {
    Model: { category: 'walls', confidence: 0.6, reason: 'The model cut 1 m above the floor' },
  }, ['3D models are assumed to be in metres with Y up (the glTF standard). Walls are the model cut 1 m above each floor.']);
}
