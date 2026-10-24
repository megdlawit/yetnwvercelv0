// src/lib/dxf/parseDxf.ts
//
// An ASCII DXF reader for floor plans. DXF is a flat stream of (group code,
// value) line pairs; this reads the HEADER (units), the BLOCKS (reusable
// symbols) and the ENTITIES, and returns the geometry a plan uses.
//
// Real-world files are messy, so beyond lines and polylines this handles:
//  - polyline bulges (curved segments). A quarter-circle bulge is emitted as
//    an ARC, because that is how many exporters draw door swings;
//  - SPLINE and ELLIPSE, approximated as polylines (fixtures, furniture);
//  - block INSERTs, exploded with their position / scale / rotation so the
//    geometry inside door, furniture and room-tag blocks is visible (the
//    INSERT itself is kept too, so its block name can still classify it);
//  - ATTRIB values on inserts (room-tag blocks carry the room name there).
// Hatches, dimensions and 3D/mesh entities are skipped.

export interface DxfPoint { x: number; y: number }

export interface DxfLine { kind: 'LINE'; layer: string; a: DxfPoint; b: DxfPoint }
export interface DxfPolyline { kind: 'POLYLINE'; layer: string; closed: boolean; pts: DxfPoint[] }
export interface DxfCircle { kind: 'CIRCLE'; layer: string; center: DxfPoint; radius: number }
export interface DxfArc { kind: 'ARC'; layer: string; center: DxfPoint; radius: number; startDeg: number; endDeg: number }
export interface DxfText { kind: 'TEXT'; layer: string; pos: DxfPoint; text: string }
export interface DxfInsert { kind: 'INSERT'; layer: string; block: string; pos: DxfPoint; rotationDeg: number }

export type DxfEntity = DxfLine | DxfPolyline | DxfCircle | DxfArc | DxfText | DxfInsert;

/** A hatch's outline (its boundary loops), kept apart from the lines: see buildVenue's wall hatches. */
export interface DxfHatch { layer: string; pattern: string; loops: DxfPoint[][] }

export interface ParsedDxf {
  entities: DxfEntity[];
  /** Top-level hatches' outlines. Many offices draw walls as hatched areas, with no lines. */
  hatches?: DxfHatch[];
  layers: string[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  insunits: number | null; // HEADER $INSUNITS, the drawing's declared unit (0 = unitless)
}

// $INSUNITS code → drawing units per metre. Only the units real floor plans
// use; anything else (including 0, "unitless") returns null = unknown.
const UNITS_PER_METER: Record<number, { perMeter: number; name: string }> = {
  1: { perMeter: 39.3701, name: 'inches' },
  2: { perMeter: 3.28084, name: 'feet' },
  4: { perMeter: 1000, name: 'millimetres' },
  5: { perMeter: 100, name: 'centimetres' },
  6: { perMeter: 1, name: 'metres' },
};
export function unitsFromInsunits(code: number | null): { perMeter: number; name: string } | null {
  return code === null ? null : UNITS_PER_METER[code] ?? null;
}

interface Pair { code: number; value: string }

function tokenize(text: string): Pair[] {
  // DXF ASCII is line pairs: group code line, then value line. Normalize
  // BOM and all three line-ending styles (\r\n, \n, and bare \r from old
  // Mac-style exports) before splitting. Only the group-code line is
  // trimmed — values can carry meaningful whitespace.
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = clean.split('\n');
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeStr = lines[i].trim();
    if (codeStr === '') { i--; continue; } // tolerate stray blank lines
    const code = parseInt(codeStr, 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[i + 1] });
  }
  return pairs;
}

function num(v: string | undefined, d = 0): number {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : d;
}

const deg = (r: number) => (r * 180) / Math.PI;

/**
 * Polyline vertices with bulges → entities. A bulge b curves the segment to
 * the next vertex through an angle of 4·atan(b). Quarter-circle segments
 * (door swings) become ARCs; other curves are flattened into the polyline.
 */
function expandBulges(layer: string, pts: DxfPoint[], bulges: number[], closed: boolean): DxfEntity[] {
  if (!bulges.some(b => Math.abs(b) > 1e-9)) return pts.length >= 2 ? [{ kind: 'POLYLINE', layer, closed, pts }] : [];
  const out: DxfEntity[] = [];
  let run: DxfPoint[] = [pts[0]];
  const flush = () => { if (run.length >= 2) out.push({ kind: 'POLYLINE', layer, closed: false, pts: run }); };
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], bulge = bulges[i] ?? 0;
    if (Math.abs(bulge) < 1e-9) { run.push(b); continue; }
    const theta = 4 * Math.atan(bulge);              // signed sweep, CCW positive
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    // centre: perpendicular from the chord midpoint
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const h = r * Math.cos(Math.abs(theta) / 2) * Math.sign(bulge) * (Math.abs(theta) > Math.PI ? -1 : 1);
    const ux = -(b.y - a.y) / chord, uy = (b.x - a.x) / chord;
    const c = { x: mx + ux * h, y: my + uy * h };
    const sweepDeg = Math.abs(deg(theta));
    if (sweepDeg > 80 && sweepDeg < 100) {
      flush(); run = [b];
      const sa = deg(Math.atan2(a.y - c.y, a.x - c.x)), sb = deg(Math.atan2(b.y - c.y, b.x - c.x));
      out.push({ kind: 'ARC', layer, center: c, radius: r, startDeg: theta > 0 ? sa : sb, endDeg: theta > 0 ? sb : sa });
      continue;
    }
    const steps = Math.max(2, Math.ceil(sweepDeg / 15));
    const a0 = Math.atan2(a.y - c.y, a.x - c.x);
    for (let k = 1; k <= steps; k++) {
      const t = a0 + (theta * k) / steps;
      run.push(k === steps ? b : { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
    }
  }
  if (closed && out.length === 0) return [{ kind: 'POLYLINE', layer, closed: true, pts: run.slice(0, -1) }];
  flush();
  return out;
}

interface RawEntity { type: string; body: Pair[] }
interface BlockDef { base: DxfPoint; entities: DxfEntity[] }

/** One entity's group codes → zero or more entities (a curved polyline can become several). */
function toEntities(type: string, body: Pair[], vertices: Pair[][]): DxfEntity[] {
  const layer = body.find(b => b.code === 8)?.value?.trim() || '0';
  const g = (c: number, d = 0) => num(body.find(b => b.code === c)?.value, d);
  const all = (c: number) => body.filter(b => b.code === c).map(b => num(b.value));
  switch (type) {
    case 'LINE':
      return [{ kind: 'LINE', layer, a: { x: g(10), y: g(20) }, b: { x: g(11), y: g(21) } }];
    case 'LWPOLYLINE': {
      const closed = (g(70) & 1) === 1;
      const pts: DxfPoint[] = [], bulges: number[] = [];
      let cur: Partial<DxfPoint> | null = null;
      for (const b of body) {
        if (b.code === 10) { if (cur?.x !== undefined && cur.y !== undefined) pts.push(cur as DxfPoint); cur = { x: num(b.value) }; bulges[pts.length] = 0; }
        else if (b.code === 20 && cur) cur.y = num(b.value);
        else if (b.code === 42 && cur) bulges[pts.length] = num(b.value);
      }
      if (cur?.x !== undefined && cur.y !== undefined) pts.push(cur as DxfPoint);
      return pts.length >= 2 ? expandBulges(layer, pts, bulges, closed) : [];
    }
    case 'POLYLINE': {
      const flags = g(70);
      if (flags & (16 | 64)) return []; // 3D polygon mesh / polyface mesh
      const pts = vertices.map(v => ({ x: num(v.find(p => p.code === 10)?.value), y: num(v.find(p => p.code === 20)?.value) }));
      const bulges = vertices.map(v => num(v.find(p => p.code === 42)?.value));
      return pts.length >= 2 ? expandBulges(layer, pts, bulges, (flags & 1) === 1) : [];
    }
    case 'CIRCLE':
      return [{ kind: 'CIRCLE', layer, center: { x: g(10), y: g(20) }, radius: g(40) }];
    case 'ARC':
      return [{ kind: 'ARC', layer, center: { x: g(10), y: g(20) }, radius: g(40), startDeg: g(50), endDeg: g(51) }];
    case 'TEXT': case 'MTEXT': case 'ATTRIB': {
      // MTEXT can split its string across 3-code chunks plus a final 1-code line.
      const raw = body.filter(b => b.code === 1 || b.code === 3).map(b => b.value).join('');
      // Strip MTEXT formatting (\P newline, \fFont;, \H, \W, {…}) — enough for labels.
      const text = raw.replace(/\\P/g, ' ').replace(/\\[fFHWCTQApLlOoKk][^;\\]*;?/g, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
      return text ? [{ kind: 'TEXT', layer, pos: { x: g(10), y: g(20) }, text }] : [];
    }
    case 'INSERT':
      return [{ kind: 'INSERT', layer, block: body.find(b => b.code === 2)?.value?.trim() ?? '', pos: { x: g(10), y: g(20) }, rotationDeg: g(50) }];
    case 'SPLINE': {
      // Fit points follow the curve; control points only roughly do — good enough for fixtures.
      const fx = all(11), fy = all(21), cx = all(10), cy = all(20);
      const xs = fx.length >= 2 ? fx : cx, ys = fx.length >= 2 ? fy : cy;
      const pts = xs.map((x, i) => ({ x, y: ys[i] ?? 0 }));
      return pts.length >= 2 ? [{ kind: 'POLYLINE', layer, closed: (g(70) & 1) === 1, pts }] : [];
    }
    case 'ELLIPSE': {
      const c = { x: g(10), y: g(20) }, mx = g(11), my = g(21), ratio = g(40, 1);
      const t0 = g(41, 0);
      let t1 = g(42, Math.PI * 2);
      if (t1 <= t0) t1 += Math.PI * 2;
      const rot = Math.atan2(my, mx), a = Math.hypot(mx, my), b = a * ratio;
      const steps = Math.max(8, Math.ceil(((t1 - t0) / (Math.PI * 2)) * 32));
      const pts = Array.from({ length: steps + 1 }, (_, i) => {
        const t = t0 + ((t1 - t0) * i) / steps;
        const x = a * Math.cos(t), y = b * Math.sin(t);
        return { x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) };
      });
      return [{ kind: 'POLYLINE', layer, closed: t1 - t0 >= Math.PI * 2 - 1e-6, pts }];
    }
    default:
      return [];
  }
}

/**
 * A HATCH's boundary loops from its group codes: polyline paths (vertices) and edge paths
 * (lines, arcs; ellipses and splines by their end points). Bulges are drawn straight.
 */
function hatchLoops(body: Pair[]): DxfPoint[][] {
  const loops: DxfPoint[][] = [];
  let k = body.findIndex(b => b.code === 91);
  if (k < 0) return loops;
  const paths = num(body[k].value);
  k++;
  const at = (code: number) => (k < body.length && body[k].code === code ? num(body[k++].value) : NaN);
  const skipTo = (code: number) => { while (k < body.length && body[k].code !== code) k++; };
  for (let n = 0; n < paths && k < body.length; n++) {
    skipTo(92);
    const flags = at(92);
    const pts: DxfPoint[] = [];
    if (flags & 2) {
      at(72); at(73);
      const count = at(93);
      for (let v = 0; v < count && k < body.length; v++) {
        skipTo(10); const x = at(10), y = at(20);
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
        if (k < body.length && body[k].code === 42) k++;
      }
    } else {
      const edges = at(93);
      for (let ed = 0; ed < edges && k < body.length; ed++) {
        skipTo(72);
        const type = at(72);
        if (type === 1) { const x1 = at(10), y1 = at(20), x2 = at(11), y2 = at(21); pts.push({ x: x1, y: y1 }, { x: x2, y: y2 }); }
        else if (type === 2) {
          const cx = at(10), cy = at(20), r = at(40), a0 = at(50), a1 = at(51), ccw = at(73);
          let s0 = a0, s1 = a1;
          if (s1 < s0) s1 += 360;
          const steps = Math.max(2, Math.ceil((s1 - s0) / 15));
          const arc = Array.from({ length: steps + 1 }, (_, i) => {
            const t = ((s0 + ((s1 - s0) * i) / steps) * Math.PI) / 180;
            return { x: cx + r * Math.cos(t), y: cy + (ccw === 0 ? -1 : 1) * r * Math.sin(t) };
          });
          pts.push(...arc);
        } else if (type === 3) { const cx = at(10), cy = at(20), mx = at(11), my = at(21); pts.push({ x: cx + mx, y: cy + my }); }
        else if (type === 4) {
          // spline edge: its control points (code 10/20) until the next edge or path
          while (k < body.length && ![72, 92, 97].includes(body[k].code)) {
            if (body[k].code === 10 && body[k + 1]?.code === 20) { pts.push({ x: num(body[k].value), y: num(body[k + 1].value) }); k += 2; } else k++;
          }
        }
      }
    }
    if (pts.length >= 3) loops.push(pts.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    skipTo(97);
  }
  return loops;
}

/** Walk a run of entity pairs (ENTITIES section or one block), gathering vertices / attributes. */
function readEntities(pairs: Pair[], from: number, until: (p: Pair) => boolean): { entities: DxfEntity[]; next: number } {
  const entities: DxfEntity[] = [];
  let i = from;
  while (i < pairs.length && !until(pairs[i])) {
    if (pairs[i].code !== 0) { i++; continue; }
    const type = pairs[i].value.trim();
    i++;
    const body: Pair[] = [];
    while (i < pairs.length && pairs[i].code !== 0) body.push(pairs[i++]);
    // Old-style POLYLINE: VERTEX entities follow until SEQEND. INSERT with
    // attributes (66 = 1): ATTRIB entities follow until SEQEND.
    const vertices: Pair[][] = [];
    const attribs: RawEntity[] = [];
    const followsUp = type === 'POLYLINE' || (type === 'INSERT' && body.some(b => b.code === 66 && num(b.value) === 1));
    if (followsUp) {
      while (i < pairs.length && pairs[i].code === 0 && ['VERTEX', 'ATTRIB'].includes(pairs[i].value.trim())) {
        const sub = pairs[i].value.trim();
        i++;
        const vb: Pair[] = [];
        while (i < pairs.length && pairs[i].code !== 0) vb.push(pairs[i++]);
        if (sub === 'VERTEX') vertices.push(vb); else attribs.push({ type: 'ATTRIB', body: vb });
      }
      if (i < pairs.length && pairs[i].code === 0 && pairs[i].value.trim() === 'SEQEND') {
        i++;
        while (i < pairs.length && pairs[i].code !== 0) i++;
      }
    }
    entities.push(...toEntities(type, body, vertices));
    for (const a of attribs) entities.push(...toEntities(a.type, a.body, []));
  }
  return { entities, next: i };
}

/** Place a block's contents at an insert: scale, rotate, move; layer "0" takes the insert's layer. */
function explode(ins: DxfInsert & { sx: number; sy: number }, blocks: Map<string, BlockDef>, depth: number, out: DxfEntity[]) {
  const def = blocks.get(ins.block);
  if (!def || depth > 5) return;
  const r = (ins.rotationDeg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const T = (p: DxfPoint): DxfPoint => {
    const x = (p.x - def.base.x) * ins.sx, y = (p.y - def.base.y) * ins.sy;
    return { x: ins.pos.x + x * cos - y * sin, y: ins.pos.y + x * sin + y * cos };
  };
  const mirrored = ins.sx * ins.sy < 0;
  const s = Math.sqrt(Math.abs(ins.sx * ins.sy));
  const layerOf = (l: string) => (l === '0' ? ins.layer : l);
  for (const e of def.entities) {
    const layer = layerOf(e.layer);
    switch (e.kind) {
      case 'LINE': out.push({ ...e, layer, a: T(e.a), b: T(e.b) }); break;
      case 'POLYLINE': out.push({ ...e, layer, pts: e.pts.map(T) }); break;
      case 'CIRCLE': out.push({ ...e, layer, center: T(e.center), radius: e.radius * s }); break;
      case 'ARC': {
        const a0 = mirrored ? 180 - e.endDeg : e.startDeg, a1 = mirrored ? 180 - e.startDeg : e.endDeg;
        out.push({ ...e, layer, center: T(e.center), radius: e.radius * s, startDeg: a0 + ins.rotationDeg, endDeg: a1 + ins.rotationDeg });
        break;
      }
      case 'TEXT': out.push({ ...e, layer, pos: T(e.pos) }); break;
      case 'INSERT': {
        const nested = { ...e, layer, pos: T(e.pos), rotationDeg: e.rotationDeg + ins.rotationDeg, sx: ins.sx, sy: ins.sy };
        out.push({ kind: 'INSERT', layer, block: e.block, pos: nested.pos, rotationDeg: nested.rotationDeg });
        explode(nested, blocks, depth + 1, out);
        break;
      }
    }
  }
}

export function parseDxf(text: string): ParsedDxf {
  const pairs = tokenize(text);
  const blocks = new Map<string, BlockDef>();
  const topLevel: DxfEntity[] = [];
  const hatches: DxfHatch[] = [];
  const insertScales = new Map<DxfInsert, { sx: number; sy: number }>();
  let insunits: number | null = null;

  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i];
    if (!(p.code === 0 && p.value.trim() === 'SECTION')) { i++; continue; }
    const name = pairs[i + 1]?.code === 2 ? pairs[i + 1].value.trim() : '';
    i += 2;
    const isEnd = (q: Pair) => q.code === 0 && q.value.trim() === 'ENDSEC';
    if (name === 'HEADER') {
      for (; i < pairs.length && !isEnd(pairs[i]); i++) {
        if (pairs[i].code === 9 && pairs[i].value.trim() === '$INSUNITS' && pairs[i + 1]?.code === 70) {
          const v = parseInt(pairs[i + 1].value, 10);
          insunits = Number.isNaN(v) ? null : v;
        }
      }
    } else if (name === 'BLOCKS') {
      while (i < pairs.length && !isEnd(pairs[i])) {
        if (!(pairs[i].code === 0 && pairs[i].value.trim() === 'BLOCK')) { i++; continue; }
        i++;
        const head: Pair[] = [];
        while (i < pairs.length && pairs[i].code !== 0) head.push(pairs[i++]);
        const bname = head.find(h => h.code === 2)?.value?.trim() ?? '';
        const base = { x: num(head.find(h => h.code === 10)?.value), y: num(head.find(h => h.code === 20)?.value) };
        const { entities, next } = readEntities(pairs, i, q => q.code === 0 && q.value.trim() === 'ENDBLK');
        i = next + 1;
        // *Model_Space / *Paper_Space hold the drawing itself, not a symbol.
        if (bname && !/^\*(model|paper)_space/i.test(bname)) blocks.set(bname, { base, entities });
      }
    } else if (name === 'ENTITIES') {
      const start = i;
      const { entities, next } = readEntities(pairs, i, isEnd);
      // read insert scales for exploding (kept off the public entity shape)
      const inserts = entities.filter((e): e is DxfInsert => e.kind === 'INSERT');
      let k = 0;
      for (let j = start; j < next; j++) {
        if (pairs[j].code === 0 && pairs[j].value.trim() === 'INSERT') {
          const body: Pair[] = [];
          for (let m = j + 1; m < next && pairs[m].code !== 0; m++) body.push(pairs[m]);
          const ins = inserts[k++];
          if (ins) insertScales.set(ins, { sx: num(body.find(b => b.code === 41)?.value, 1) || 1, sy: num(body.find(b => b.code === 42)?.value, 1) || 1 });
        }
      }
      for (const e of entities) topLevel.push(e); // not push(...entities): a big drawing overflows the call stack
      for (let j = start; j < next; j++) {
        if (pairs[j].code !== 0 || pairs[j].value.trim() !== 'HATCH') continue;
        const body: Pair[] = [];
        for (let m = j + 1; m < next && pairs[m].code !== 0; m++) body.push(pairs[m]);
        const loops = hatchLoops(body);
        if (loops.length) hatches.push({ layer: body.find(b => b.code === 8)?.value?.trim() || '0', pattern: body.find(b => b.code === 2)?.value?.trim() ?? '', loops });
      }
      i = next;
    }
    i++;
  }

  const entities: DxfEntity[] = [];
  for (const e of topLevel) {
    entities.push(e);
    if (e.kind === 'INSERT') explode({ ...e, ...(insertScales.get(e) ?? { sx: 1, sy: 1 }) }, blocks, 0, entities);
  }

  const layerSet = new Set(entities.map(e => e.layer));
  let bounds: ParsedDxf['bounds'] = null;
  const extend = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!bounds) { bounds = { minX: x, maxX: x, minY: y, maxY: y }; return; }
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
  };
  for (const e of entities) {
    if (e.kind === 'LINE') { extend(e.a.x, e.a.y); extend(e.b.x, e.b.y); }
    else if (e.kind === 'POLYLINE') { for (const p of e.pts) extend(p.x, p.y); }
    else if (e.kind === 'CIRCLE' || e.kind === 'ARC') { extend(e.center.x - e.radius, e.center.y - e.radius); extend(e.center.x + e.radius, e.center.y + e.radius); }
    else if (e.kind === 'TEXT') { extend(e.pos.x, e.pos.y); }
    // INSERT positions aren't geometry; their exploded contents are counted above.
  }

  return { entities, hatches, layers: [...layerSet].sort(), bounds, insunits };
}

// ── Diagnostics ────────────────────────────────────────────────────────────
// When an import finds nothing, "No entities found" is useless on its own.
// This inspects the raw text and says WHICH of the usual causes it is.

export interface DxfDiagnosis {
  format: 'ascii-dxf' | 'binary-dxf' | 'dwg' | 'not-dxf';
  sections: string[];
  entityCounts: Record<string, number>;      // everything in ENTITIES, supported or not
  blockEntityCounts: Record<string, number>; // everything inside BLOCKS definitions
  unsupported: string[];                     // entity types present but not parsed
  hints: string[];                           // human-readable, most likely cause first
}

const SUPPORTED = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE', 'VERTEX', 'SEQEND', 'CIRCLE', 'ARC', 'TEXT', 'MTEXT', 'INSERT']);

export function diagnoseDxf(text: string): DxfDiagnosis {
  const d: DxfDiagnosis = { format: 'ascii-dxf', sections: [], entityCounts: {}, blockEntityCounts: {}, unsupported: [], hints: [] };
  const head = text.slice(0, 22);
  if (head.startsWith('AutoCAD Binary DXF')) {
    d.format = 'binary-dxf';
    d.hints.push('This is a BINARY DXF. Re-export as ASCII DXF (in AutoCAD: SAVEAS → "AutoCAD 2000/LT2000 DXF" or any non-binary DXF; in LibreCAD/QCAD the default is ASCII).');
    return d;
  }
  if (/^AC10\d\d/.test(text)) {
    d.format = 'dwg';
    d.hints.push('This is a DWG, not a DXF. Convert with Save As → DXF, or upload it as .dwg so the converter is used.');
    return d;
  }
  // High ratio of NUL bytes = UTF-16 that was decoded as UTF-8.
  const sample = text.slice(0, 4000);
  const nulRatio = sample.length ? (sample.match(/\u0000/g)?.length ?? 0) / sample.length : 0;
  if (nulRatio > 0.2) {
    d.format = 'not-dxf';
    d.hints.push('File looks UTF-16 encoded but was read as UTF-8 (mostly NUL characters). Re-save the DXF as ASCII/UTF-8, or re-upload — the reader normally auto-detects this.');
    return d;
  }

  const pairs = tokenize(text);
  if (pairs.length === 0) {
    d.format = 'not-dxf';
    d.hints.push('No DXF group-code/value pairs found — the file is empty or not a DXF.');
    return d;
  }

  let section = '';
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const v = p.value.trim();
    if (p.code === 0 && v === 'SECTION') { section = pairs[i + 1]?.code === 2 ? pairs[i + 1].value.trim() : ''; if (section) d.sections.push(section); continue; }
    if (p.code === 0 && v === 'ENDSEC') { section = ''; continue; }
    if (p.code !== 0) continue;
    if (section === 'ENTITIES') d.entityCounts[v] = (d.entityCounts[v] ?? 0) + 1;
    else if (section === 'BLOCKS' && v !== 'BLOCK' && v !== 'ENDBLK') d.blockEntityCounts[v] = (d.blockEntityCounts[v] ?? 0) + 1;
  }

  const types = Object.keys(d.entityCounts);
  d.unsupported = types.filter(t => !SUPPORTED.has(t));

  if (!d.sections.includes('ENTITIES')) {
    d.hints.push('No ENTITIES section found — this does not look like a complete DXF (R12+ exports always have one).');
  } else if (types.length === 0) {
    const inBlocks = Object.keys(d.blockEntityCounts).filter(t => SUPPORTED.has(t)).length > 0;
    d.hints.push(inBlocks
      ? 'ENTITIES is empty but BLOCKS contain geometry — the drawing is probably all inside blocks/xrefs. In CAD, run EXPLODE (or BIND xrefs) on everything and re-export.'
      : 'ENTITIES section is empty. The plan may live in a paper-space layout or an external reference — open the drawing, switch to Model space, and re-export.');
  } else if (types.every(t => !SUPPORTED.has(t))) {
    d.hints.push(`The file only contains entity types this reader skips: ${d.unsupported.join(', ')}. Walls must be LINE / POLYLINE / LWPOLYLINE. For SPLINE/HATCH/3DSOLID-based plans, explode to lines first.`);
  } else if (types.length === 1 && d.entityCounts['INSERT']) {
    d.hints.push('The drawing is a single block INSERT (everything is nested). EXPLODE it in CAD and re-export.');
  }
  return d;
}
