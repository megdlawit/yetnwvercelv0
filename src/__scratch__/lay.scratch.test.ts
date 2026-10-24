// @vitest-environment node
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readCadFile } from '@/lib/cad/readFile';
import { partsFromDrawing } from '@/lib/cad/floorParts';
import { classifyLayers } from '@/lib/cad/classify';
it('lay', async () => {
  const f = process.env.IMPORT_FILE!;
  const d = await readCadFile(new File([readFileSync(f)], f.split('/').pop()!));
  const rule = Object.fromEntries(classifyLayers(d).map(l => [l.name, `${l.suggested}/${l.confidence}`]));
  for (const p of partsFromDrawing(f, d).slice(0, Number(process.env.N ?? 2))) {
    const len = new Map<string, number>(); const cnt = new Map<string, number>();
    for (const e of p.drawing.entities) {
      let L = 0;
      if (e.kind === 'LINE') L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      else if (e.kind === 'POLYLINE') for (let i = 1; i < e.pts.length; i++) L += Math.hypot(e.pts[i].x - e.pts[i - 1].x, e.pts[i].y - e.pts[i - 1].y);
      len.set(e.layer, (len.get(e.layer) ?? 0) + L / p.units.perMeter); cnt.set(e.layer, (cnt.get(e.layer) ?? 0) + 1);
    }
    console.log('LAY', p.name, p.include === false ? '(off)' : '', [...len].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}[${rule[k] ?? '?'}]:${v.toFixed(0)}m/${cnt.get(k)}`).join(' | '));
  }
}, 900000);
