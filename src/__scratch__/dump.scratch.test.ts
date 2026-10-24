// @vitest-environment node
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { readCadFile } from '@/lib/cad/readFile';
import { partsFromDrawing } from '@/lib/cad/floorParts';
it('dump', async () => {
  const f = process.env.IMPORT_FILE!;
  const d = await readCadFile(new File([readFileSync(f)], f.split('/').pop()!));
  const parts = partsFromDrawing(f, d); const p = parts[Number(process.env.PART ?? 0)];
  const segs: any[] = [];
  for (const e of p.drawing.entities as any[]) {
    if (e.kind === 'LINE') segs.push([e.layer, e.a.x, e.a.y, e.b.x, e.b.y]);
    else if (e.kind === 'POLYLINE') for (let i = 1; i < e.pts.length; i++) segs.push([e.layer, e.pts[i - 1].x, e.pts[i - 1].y, e.pts[i].x, e.pts[i].y]);
    else if (e.kind === 'HATCH') for (const loop of e.loops ?? []) for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; segs.push(['HATCH:' + e.layer, a.x, a.y, b.x, b.y]); }
  }
  console.log('PART', p.name, 'kinds', JSON.stringify(Object.entries((p.drawing.entities as any[]).reduce((m: any, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {}))));
  writeFileSync(process.env.OUT!, JSON.stringify(segs));
}, 900000);
