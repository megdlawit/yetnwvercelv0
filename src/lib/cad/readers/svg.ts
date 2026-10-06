// SVG → CadDrawing. Handles what CAD and illustration tools export for plans:
// line, polyline, polygon, rect, circle, ellipse, path (curves and arcs are
// flattened) and text, with nested transforms. Layers are the nearest named
// group (Inkscape layer label, Illustrator data-name, or id).

import type { DxfEntity, DxfPoint } from '../../dxf/parseDxf';
import type { CadDrawing } from '../types';

type M = [number, number, number, number, number, number]; // a b c d e f
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, x: number, y: number): DxfPoint => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

export function parseTransform(t: string | null): M {
  if (!t) return I;
  let m = I;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(t))) {
    const v = hit[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n: M = I;
    switch (hit[1]) {
      case 'matrix': n = v as M; break;
      case 'translate': n = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0]; break;
      case 'scale': n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const r = ((v[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
        n = [c, s, -s, c, 0, 0];
        if (v.length === 3) n = mul(mul([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
        break;
      }
      case 'skewX': n = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, n);
  }
  return m;
}

/** Flatten SVG path data into polylines (one per subpath). */
export function flattenPath(d: string): { pts: DxfPoint[]; closed: boolean }[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: { pts: DxfPoint[]; closed: boolean }[] = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
  let lastCtrl: DxfPoint | null = null, lastCmd = '';
  let cur: DxfPoint[] = [];
  const num = () => parseFloat(tokens[i++]);
  const isNum = () => i < tokens.length && !/[A-Za-z]/.test(tokens[i]);
  const flush = (closed: boolean) => { if (cur.length > 1) out.push({ pts: cur, closed }); cur = []; };
  const bez = (p0: DxfPoint, c1: DxfPoint, c2: DxfPoint, p3: DxfPoint) => {
    for (let k = 1; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
      cur.push({
        x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
      });
    }
  };
  while (i < tokens.length) {
    if (!isNum()) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { cur.push({ x: sx, y: sy }); flush(true); x = sx; y = sy; lastCtrl = null; lastCmd = 'Z'; continue; }
    if (!isNum()) break;
    if (C === 'M') {
      flush(false);
      x = ox + num(); y = oy + num(); sx = x; sy = y; cur = [{ x, y }];
      cmd = rel ? 'l' : 'L'; // further pairs are implicit lineTo
    } else if (C === 'L') { x = ox + num(); y = oy + num(); cur.push({ x, y }); }
    else if (C === 'H') { x = (rel ? x : 0) + num(); cur.push({ x, y }); }
    else if (C === 'V') { y = (rel ? y : 0) + num(); cur.push({ x, y }); }
    else if (C === 'C') {
      const c1 = { x: ox + num(), y: oy + num() }, c2 = { x: ox + num(), y: oy + num() }, p = { x: ox + num(), y: oy + num() };
      bez({ x, y }, c1, c2, p); lastCtrl = c2; x = p.x; y = p.y;
    } else if (C === 'S') {
      const c1 = lastCtrl && /[CS]/i.test(lastCmd) ? { x: 2 * x - lastCtrl.x, y: 2 * y - lastCtrl.y } : { x, y };
      const c2 = { x: ox + num(), y: oy + num() }, p = { x: ox + num(), y: oy + num() };
      bez({ x, y }, c1, c2, p); lastCtrl = c2; x = p.x; y = p.y;
    } else if (C === 'Q' || C === 'T') {
      const q = C === 'Q' ? { x: ox + num(), y: oy + num() }
        : lastCtrl && /[QT]/i.test(lastCmd) ? { x: 2 * x - lastCtrl.x, y: 2 * y - lastCtrl.y } : { x, y };
      const p = { x: ox + num(), y: oy + num() };
      bez({ x, y }, { x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) }, { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p);
      lastCtrl = q; x = p.x; y = p.y;
    } else if (C === 'A') {
      const rx = Math.abs(num()), ry = Math.abs(num()), rot = num(), large = num(), sweep = num();
      const p = { x: ox + num(), y: oy + num() };
      arc(cur, { x, y }, p, rx, ry, rot, !!large, !!sweep);
      x = p.x; y = p.y; lastCtrl = null;
    } else { i++; }
    lastCmd = C;
  }
  flush(false);
  return out;
}

// SVG endpoint arc → points (SVG spec F.6.5 centre parameterisation).
function arc(out: DxfPoint[], p0: DxfPoint, p1: DxfPoint, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean) {
  if (rx === 0 || ry === 0) { out.push(p1); return; }
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p1.x) / 2, cy = sin * cx1 + cos * cy1 + (p0.y + p1.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 8)));
  for (let s = 1; s <= n; s++) {
    const t = t1 + (dt * s) / n;
    out.push({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  }
}

const LENGTH_PER_METER: Record<string, number> = { mm: 1000, cm: 100, m: 1, in: 39.3701, pt: 2834.65, px: 3779.53 };

export function readSvg(text: string): CadDrawing {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) {
    throw new Error('This file is not a valid SVG.');
  }
  const entities: DxfEntity[] = [];
  const layers = new Set<string>();
  const notes: string[] = [];

  const layerOf = (el: Element): string => {
    for (let p: Element | null = el.parentElement; p && p !== svg; p = p.parentElement) {
      if (p.nodeName.toLowerCase() !== 'g') continue;
      const name = p.getAttribute('inkscape:label') || p.getAttribute('data-name') || p.getAttribute('id');
      if (name) return name;
    }
    return 'SVG';
  };
  const n = (el: Element, a: string) => parseFloat(el.getAttribute(a) ?? '0') || 0;

  const walk = (el: Element, m: M) => {
    const tag = el.nodeName.toLowerCase().replace(/^svg:/, '');
    if (['defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'style', 'metadata', 'title', 'desc'].includes(tag)) return;
    const mm = mul(m, parseTransform(el.getAttribute('transform')));
    const layer = layerOf(el);
    const poly = (pts: DxfPoint[], closed: boolean) => {
      if (pts.length >= 2) { entities.push({ kind: 'POLYLINE', layer, closed, pts: pts.map(p => apply(mm, p.x, p.y)) }); layers.add(layer); }
    };
    switch (tag) {
      case 'line': {
        const a = apply(mm, n(el, 'x1'), n(el, 'y1')), b = apply(mm, n(el, 'x2'), n(el, 'y2'));
        entities.push({ kind: 'LINE', layer, a, b }); layers.add(layer); break;
      }
      case 'polyline': case 'polygon': {
        const v = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
        const pts: DxfPoint[] = [];
        for (let i = 0; i + 1 < v.length; i += 2) pts.push({ x: v[i], y: v[i + 1] });
        poly(pts, tag === 'polygon'); break;
      }
      case 'rect': {
        const x = n(el, 'x'), y = n(el, 'y'), w = n(el, 'width'), h = n(el, 'height');
        if (w > 0 && h > 0) poly([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true);
        break;
      }
      case 'circle': case 'ellipse': {
        const cx = n(el, 'cx'), cy = n(el, 'cy');
        const rx = tag === 'circle' ? n(el, 'r') : n(el, 'rx'), ry = tag === 'circle' ? n(el, 'r') : n(el, 'ry');
        if (Math.abs(rx - ry) < 1e-6 && Math.abs(mm[1]) < 1e-9 && Math.abs(mm[2]) < 1e-9 && Math.abs(mm[0] - mm[3]) < 1e-9) {
          entities.push({ kind: 'CIRCLE', layer, center: apply(mm, cx, cy), radius: rx * Math.abs(mm[0]) }); layers.add(layer);
        } else {
          poly(Array.from({ length: 24 }, (_, i) => ({ x: cx + rx * Math.cos((i / 24) * 2 * Math.PI), y: cy + ry * Math.sin((i / 24) * 2 * Math.PI) })), true);
        }
        break;
      }
      case 'path':
        for (const sp of flattenPath(el.getAttribute('d') ?? '')) poly(sp.pts, sp.closed);
        break;
      case 'text': {
        const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        const tspan = el.querySelector('tspan');
        const x = el.hasAttribute('x') ? n(el, 'x') : tspan ? n(tspan, 'x') : 0;
        const y = el.hasAttribute('y') ? n(el, 'y') : tspan ? n(tspan, 'y') : 0;
        if (t) { entities.push({ kind: 'TEXT', layer, pos: apply(mm, x, y), text: t }); layers.add(layer); }
        return; // don't descend into tspans
      }
    }
    for (const child of Array.from(el.children)) walk(child, mm);
  };

  // viewBox → user space; width/height with real units tell us the scale.
  const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  walk(svg, I);

  let unitsPerMeter: number | null = null;
  let unitsName = 'unknown';
  const wAttr = svg.getAttribute('width') ?? '';
  const unit = /([a-z]+)\s*$/i.exec(wAttr)?.[1]?.toLowerCase();
  if (unit && unit !== 'px' && LENGTH_PER_METER[unit] && vb.length === 4 && vb[2] > 0) {
    // 1 user unit = (width / viewBox width) <unit> on paper.
    const userPerUnit = vb[2] / parseFloat(wAttr);
    unitsPerMeter = LENGTH_PER_METER[unit] * userPerUnit;
    unitsName = `${unit} (from the SVG size)`;
    notes.push(`The SVG declares its size in ${unit}. If it is a scaled drawing (e.g. 1:100), set the scale before importing.`);
  } else {
    notes.push('The SVG has no real-world units. Set the scale before importing.');
  }

  return { ...finish(entities, layers), format: 'svg', unitsPerMeter, unitsName, flipY: false, notes };
}

/** Bounds + sorted layers for an entity list (shared by the non-DXF readers). */
export function finish(entities: DxfEntity[], layers: Set<string>): Pick<CadDrawing, 'entities' | 'layers' | 'bounds' | 'insunits'> {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (p: DxfPoint) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); };
  for (const e of entities) {
    if (e.kind === 'LINE') { ext(e.a); ext(e.b); }
    else if (e.kind === 'POLYLINE') e.pts.forEach(ext);
    else if (e.kind === 'CIRCLE' || e.kind === 'ARC') { ext({ x: e.center.x - e.radius, y: e.center.y - e.radius }); ext({ x: e.center.x + e.radius, y: e.center.y + e.radius }); }
    else ext(e.pos);
  }
  return {
    entities,
    layers: [...layers].sort(),
    bounds: Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null,
    insunits: null,
  };
}
