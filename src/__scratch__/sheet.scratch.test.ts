// @vitest-environment node
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { readCadFile } from '@/lib/cad/readFile';
import { partsFromDrawing } from '@/lib/cad/floorParts';
it('sheet', async () => {
  const f = process.env.IMPORT_FILE!;
  const d = await readCadFile(new File([readFileSync(f)], f.split('/').pop()!));
  const [x0, y0, x1, y1] = (process.env.BOX ?? '').split(',').map(Number);
  const inBox = (p: any) => !process.env.BOX || (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
  const segs: number[][] = []; const texts: any[] = [];
  for (const e of d.entities as any[]) {
    if (e.kind === 'LINE' && inBox(e.a)) segs.push([e.a.x, e.a.y, e.b.x, e.b.y]);
    else if (e.kind === 'POLYLINE' && inBox(e.pts[0])) for (let i = 1; i < e.pts.length; i++) segs.push([e.pts[i - 1].x, e.pts[i - 1].y, e.pts[i].x, e.pts[i].y]);
    else if (e.kind === 'TEXT' && inBox(e.pos) && e.text.length < 40 && /plan|floor|level|elev|section|site|roof|terrace/i.test(e.text)) texts.push([e.pos.x, e.pos.y, e.text]);
  }
  const parts = partsFromDrawing(f, d).map(p => ({ name: p.name, on: p.include !== false, b: p.drawing.bounds }));
  writeFileSync(process.env.OUT!, JSON.stringify({ segs: segs.length > 400000 ? segs.filter((_, i) => i % 3 === 0) : segs, texts, parts }));
}, 900000);
