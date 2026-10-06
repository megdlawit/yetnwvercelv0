// A floor plan image under the editor's drawing: where it sits, how big and
// how turned (floors.plan_underlay), and calibrating it from two points whose
// real distance is known.
//
// Image pixel (u, v) → editor (x, y): translate(x, y) · rotate(θ) · scale(s),
// rotation clockwise on screen (the editor's y points down), about the
// image's top-left corner — exactly SVG's transform, so the <image> uses it as is.

import { EDITOR_PX_PER_METER } from '@/lib/navScale';

export interface Underlay {
  /** File in the floor-plans bucket. */
  path: string;
  /** Image size in pixels. */
  width: number;
  height: number;
  /** Editor position of the image's top-left corner. */
  x: number;
  y: number;
  /** Editor px per image px. */
  scale: number;
  rotationDeg: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}

export interface Pt { x: number; y: number }

export type Align = 'as-drawn' | 'horizontal' | 'vertical';

const rad = (d: number) => (d * Math.PI) / 180;

export function imageToEditor(t: Pick<Underlay, 'x' | 'y' | 'scale' | 'rotationDeg'>, p: Pt): Pt {
  const c = Math.cos(rad(t.rotationDeg)), s = Math.sin(rad(t.rotationDeg));
  const u = p.x * t.scale, v = p.y * t.scale;
  return { x: t.x + c * u - s * v, y: t.y + s * u + c * v };
}

export function editorToImage(t: Pick<Underlay, 'x' | 'y' | 'scale' | 'rotationDeg'>, p: Pt): Pt {
  const c = Math.cos(rad(t.rotationDeg)), s = Math.sin(rad(t.rotationDeg));
  const dx = p.x - t.x, dy = p.y - t.y;
  return { x: (c * dx + s * dy) / t.scale, y: (-s * dx + c * dy) / t.scale };
}

/**
 * Scale (and optionally straighten) the plan so that A→B measures `metres`.
 * A stays where it is on the drawing; `align` turns AB to run left–right or
 * up–down (or keeps its angle).
 */
export function calibrate<T extends Pick<Underlay, 'x' | 'y' | 'scale' | 'rotationDeg'>>(t: T, a: Pt, b: Pt, metres: number, align: Align = 'as-drawn'): T {
  const ai = editorToImage(t, a), bi = editorToImage(t, b);
  const imgDist = Math.hypot(bi.x - ai.x, bi.y - ai.y);
  if (!(imgDist > 1e-6) || !(metres > 0)) return t;
  const scale = (metres * EDITOR_PX_PER_METER) / imgDist;
  const drawn = Math.atan2(b.y - a.y, b.x - a.x);
  const want = align === 'horizontal' ? (Math.abs(drawn) <= Math.PI / 2 ? 0 : Math.PI)
    : align === 'vertical' ? (drawn >= 0 ? Math.PI / 2 : -Math.PI / 2)
    : drawn;
  const inImage = Math.atan2(bi.y - ai.y, bi.x - ai.x);
  let rotationDeg = ((want - inImage) * 180) / Math.PI;
  rotationDeg = ((rotationDeg % 360) + 540) % 360 - 180;
  const next = { ...t, scale, rotationDeg, x: 0, y: 0 };
  const placed = imageToEditor(next, ai);
  return { ...next, x: a.x - placed.x, y: a.y - placed.y };
}

/** A first placement: the image fitted over what's drawn (or 40 m wide on an empty floor). */
export function initialPlacement(width: number, height: number, content: { minX: number; minY: number; maxX: number; maxY: number } | null): Pick<Underlay, 'x' | 'y' | 'scale' | 'rotationDeg'> {
  if (content && content.maxX - content.minX > 40) {
    const scale = Math.min((content.maxX - content.minX) / width, (content.maxY - content.minY || Infinity) / height);
    return { x: content.minX, y: content.minY, scale, rotationDeg: 0 };
  }
  return { x: 0, y: 0, scale: (40 * EDITOR_PX_PER_METER) / width, rotationDeg: 0 };
}

/** Parse floors.plan_underlay defensively. */
export function parseUnderlay(v: unknown): Underlay | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const n = (k: string, d: number) => (typeof o[k] === 'number' && Number.isFinite(o[k] as number) ? (o[k] as number) : d);
  if (typeof o.path !== 'string' || !o.path) return null;
  return {
    path: o.path, width: n('width', 1000), height: n('height', 1000), x: n('x', 0), y: n('y', 0), scale: n('scale', 1) || 1,
    rotationDeg: n('rotationDeg', 0), opacity: Math.min(1, Math.max(0.05, n('opacity', 0.5))), visible: o.visible !== false, locked: o.locked === true,
  };
}

/** Render the first page of a PDF to a PNG (about `targetWidth` px wide). */
export async function pdfPageToPng(file: File, targetWidth = 3000): Promise<{ blob: Blob; width: number; height: number }> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(6, targetWidth / base.width) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not draw the PDF page'))), 'image/png'));
  return { blob, width: canvas.width, height: canvas.height };
}

/** An image file's pixel size. */
export function imageSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { res({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { rej(new Error('Not an image we can read')); URL.revokeObjectURL(url); };
    img.src = url;
  });
}
