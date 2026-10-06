// Vector PDF → CadDrawing. Reads the drawing operators of the first page
// (lines, curves, rectangles, with the graphics-state transform) and its
// text. Scanned/raster PDFs have no vectors to read and are reported as such.
//
// PDFs have no layers in practice, so paths are grouped by how they're drawn
// ("Stroke 0.70pt #000000", "Fill #333333"): plotted plans draw walls with the
// heaviest pens or as filled poché, which the layer hints below point at.

import type { DxfEntity, DxfPoint } from '../../dxf/parseDxf';
import type { CadDrawing } from '../types';
import { finish } from './svg';

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, x: number, y: number): DxfPoint => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Points per metre on paper; divide by the drawing scale (1:N → N) for drawing units per real metre. */
export const PDF_POINTS_PER_METER = 72 / 0.0254;

export async function readPdf(data: ArrayBuffer): Promise<CadDrawing> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const OPS = pdfjs.OPS;

  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const page = await doc.getPage(1);
  const list = await page.getOperatorList();

  const entities: DxfEntity[] = [];
  const layers = new Set<string>();
  const strokeLen = new Map<string, number>();
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: { ctm: M; width: number; stroke: string; fill: string }[] = [];
  let width = 1, stroke = '#000000', fill = '#000000';
  let pending: { pts: DxfPoint[]; closed: boolean }[] = [];

  const buildPath = (ops: number[], args: number[]) => {
    const subs: { pts: DxfPoint[]; closed: boolean }[] = [];
    let cur: DxfPoint[] = [];
    let x = 0, y = 0, j = 0;
    const push = () => { if (cur.length > 1) subs.push({ pts: cur, closed: false }); cur = []; };
    const bez = (c1: DxfPoint, c2: DxfPoint, p: DxfPoint) => {
      const p0 = { x, y };
      for (let k = 1; k <= 6; k++) {
        const t = k / 6, u = 1 - t;
        cur.push(apply(ctm, u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p.x,
          u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p.y));
      }
      x = p.x; y = p.y;
    };
    for (const op of ops) {
      switch (op) {
        case OPS.moveTo: push(); x = args[j++]; y = args[j++]; cur = [apply(ctm, x, y)]; break;
        case OPS.lineTo: x = args[j++]; y = args[j++]; cur.push(apply(ctm, x, y)); break;
        case OPS.curveTo: bez({ x: args[j], y: args[j + 1] }, { x: args[j + 2], y: args[j + 3] }, { x: args[j + 4], y: args[j + 5] }); j += 6; break;
        case OPS.curveTo2: bez({ x, y }, { x: args[j], y: args[j + 1] }, { x: args[j + 2], y: args[j + 3] }); j += 4; break;
        case OPS.curveTo3: bez({ x: args[j], y: args[j + 1] }, { x: args[j + 2], y: args[j + 3] }, { x: args[j + 2], y: args[j + 3] }); j += 4; break;
        case OPS.rectangle: {
          push();
          const rx = args[j++], ry = args[j++], w = args[j++], h = args[j++];
          subs.push({ pts: [apply(ctm, rx, ry), apply(ctm, rx + w, ry), apply(ctm, rx + w, ry + h), apply(ctm, rx, ry + h)], closed: true });
          break;
        }
        case OPS.closePath:
          if (cur.length > 1) { subs.push({ pts: cur, closed: true }); cur = []; }
          break;
      }
    }
    push();
    return subs;
  };

  const paint = (kind: 'Stroke' | 'Fill') => {
    const scale = Math.hypot(ctm[0], ctm[1]);
    const layer = kind === 'Stroke' ? `Stroke ${(width * scale).toFixed(2)}pt ${stroke}` : `Fill ${fill}`;
    for (const sp of pending) {
      entities.push({ kind: 'POLYLINE', layer, closed: sp.closed, pts: sp.pts });
      layers.add(layer);
      let len = 0;
      for (let i = 1; i < sp.pts.length; i++) len += Math.hypot(sp.pts[i].x - sp.pts[i - 1].x, sp.pts[i].y - sp.pts[i - 1].y);
      strokeLen.set(layer, (strokeLen.get(layer) ?? 0) + len);
    }
    pending = [];
  };

  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i], a = list.argsArray[i] as unknown[];
    switch (fn) {
      case OPS.save: stack.push({ ctm, width, stroke, fill }); break;
      case OPS.restore: { const s = stack.pop(); if (s) ({ ctm, width, stroke, fill } = s); break; }
      case OPS.transform: ctm = mul(ctm, a as M); break;
      case OPS.paintFormXObjectBegin: stack.push({ ctm, width, stroke, fill }); if (Array.isArray(a[0])) ctm = mul(ctm, a[0] as M); break;
      case OPS.paintFormXObjectEnd: { const s = stack.pop(); if (s) ({ ctm, width, stroke, fill } = s); break; }
      case OPS.setLineWidth: width = a[0] as number; break;
      case OPS.setStrokeRGBColor: stroke = hex(a[0] as number, a[1] as number, a[2] as number); break;
      case OPS.setFillRGBColor: fill = hex(a[0] as number, a[1] as number, a[2] as number); break;
      case OPS.setStrokeGray: stroke = hex((a[0] as number) * 255, (a[0] as number) * 255, (a[0] as number) * 255); break;
      case OPS.setFillGray: fill = hex((a[0] as number) * 255, (a[0] as number) * 255, (a[0] as number) * 255); break;
      case OPS.constructPath: pending.push(...buildPath(a[0] as number[], a[1] as number[])); break;
      case OPS.stroke: case OPS.closeStroke: paint('Stroke'); break;
      case OPS.fill: case OPS.eoFill: paint('Fill'); break;
      case OPS.fillStroke: case OPS.eoFillStroke: case OPS.closeFillStroke: case OPS.closeEOFillStroke: paint('Stroke'); break;
      case OPS.endPath: pending = []; break; // clipping path, not drawn
    }
  }

  const text = await page.getTextContent();
  for (const item of text.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const t = item.transform as number[];
    entities.push({ kind: 'TEXT', layer: 'Text', pos: { x: t[4], y: t[5] }, text: item.str.trim() });
    layers.add('Text');
  }

  const notes: string[] = [];
  if (doc.numPages > 1) notes.push(`Page 1 of ${doc.numPages} was used.`);
  const lineCount = entities.filter(e => e.kind !== 'TEXT').length;
  if (lineCount === 0) {
    throw new Error('This PDF has no vector lines — it is probably a scanned image. Export the plan as a vector PDF or DXF from your CAD software.');
  }
  notes.push('PDFs have no real-world scale. Set the drawing scale (e.g. 1:100) before importing.');

  // Walls: the heaviest stroke weight that carries a real share of the line
  // work, or a dark fill (solid poché walls).
  const hints: NonNullable<CadDrawing['layerHints']> = {};
  const total = [...strokeLen.values()].reduce((s, v) => s + v, 0) || 1;
  const strokes = [...strokeLen.entries()].filter(([l]) => l.startsWith('Stroke'))
    .map(([l, len]) => ({ l, len, w: parseFloat(l.split(' ')[1]) }))
    .filter(s => s.len / total > 0.05)
    .sort((a, b) => b.w - a.w);
  if (strokes[0]) hints[strokes[0].l] = { category: 'walls', confidence: 0.6, reason: 'Heaviest lines in the PDF — usually walls' };
  for (const [l] of strokeLen) {
    if (l.startsWith('Fill') && /#(0|1|2|3)[0-9a-f]{5}/i.test(l.split(' ')[1]) && !hints[l]) {
      hints[l] = { category: 'walls', confidence: 0.5, reason: 'Dark solid fill — often walls drawn as poché' };
    }
  }
  if (layers.has('Text')) hints['Text'] = { category: 'labels', confidence: 0.8, reason: 'Text on the page' };

  return { ...finish(entities, layers), format: 'pdf', unitsPerMeter: null, unitsName: 'PDF points', flipY: true, notes, layerHints: hints };
}
