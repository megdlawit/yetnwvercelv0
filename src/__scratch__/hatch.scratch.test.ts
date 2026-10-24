// @vitest-environment node
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readCadFile } from '@/lib/cad/readFile';
import { partsFromDrawing } from '@/lib/cad/floorParts';
it('hatch', async () => {
  const f = process.env.IMPORT_FILE!;
  const d = await readCadFile(new File([readFileSync(f)], f.split('/').pop()!));
  console.log('HATCHES total', d.hatches?.length, 'loops', d.hatches?.reduce((s, h) => s + h.loops.length, 0));
  const p = partsFromDrawing(f, d)[Number(process.env.PART ?? 0)];
  console.log('PART', p.name, 'hatches in part', p.drawing.hatches?.length);
  for (const h of (p.drawing.hatches ?? []).slice(0, 25)) for (const loop of h.loops.slice(0, 2)) {
    let A = 0, P = 0; for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; A += a.x * b.y - b.x * a.y; P += Math.hypot(b.x - a.x, b.y - a.y); }
    A = Math.abs(A) / 2; const m = p.units.perMeter;
    console.log('LOOP', h.layer, h.pattern, 'pts', loop.length, 'thick', ((2 * A) / P / m).toFixed(2), 'long', (P / 2 / m).toFixed(2), 'first', JSON.stringify(loop.slice(0, 3).map(q => [Math.round(q.x), Math.round(q.y)])));
  }
}, 900000);
