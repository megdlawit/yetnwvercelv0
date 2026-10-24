// @vitest-environment node
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { readCadFile } from '@/lib/cad/readFile';
import { partsFromDrawing } from '@/lib/cad/floorParts';
it('where', async () => {
  const f = 'fortraining.from-dwg.dxf';
  const d = await readCadFile(new File([readFileSync(`ml/data/shared/${f}`)], f));
  const plans = partsFromDrawing(f, d).filter(p => p.include !== false).map(p => p.drawing.bounds!);
  const pt = (e: any) => e.a ?? e.pts?.[0] ?? e.center ?? e.pos ?? e.at;
  const out: Record<string, { total: number; inPlan: number; kinds: Record<string, number> }> = {};
  for (const e of d.entities) {
    const p = pt(e); const o = (out[e.layer] ??= { total: 0, inPlan: 0, kinds: {} });
    o.total++; o.kinds[e.kind] = (o.kinds[e.kind] ?? 0) + 1;
    if (p && plans.some(b => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY)) o.inPlan++;
  }
  writeFileSync('ml/data/gold/fortraining_where.json', JSON.stringify(out));
}, 900000);
