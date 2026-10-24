// @vitest-environment node
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readCadFile } from '@/lib/cad/readFile';
import { partsFromDrawing } from '@/lib/cad/floorParts';
it('titles', async () => {
  for (const f of (process.env.FILES ?? '').split('|')) {
    const d = await readCadFile(new File([readFileSync(`ml/data/shared/${f}`)], f));
    const parts = partsFromDrawing(f, d).filter(p => p.include !== false);
    const texts = d.entities.filter((e: any) => (e.kind === 'TEXT' || e.kind === 'MTEXT') && /floor|plan|ground|basement|first|second|third|terrace|roof|level/i.test(e.text) && e.text.length < 60) as any[];
    console.log(`### ${f}`);
    for (const p of parts) {
      const b = p.drawing.bounds!, W = b.maxX - b.minX, H = b.maxY - b.minY;
      const near = texts.map(t => { const q = t.pos ?? t.at; return { t: t.text.replace(/\s+/g, ' ').slice(0, 45), h: (t.height ?? 0) / p.units.perMeter, dx: ((q.x - b.minX) / W).toFixed(2), dy: ((q.y - b.minY) / H).toFixed(2), layer: t.layer }; })
        .filter(t => Number(t.dx) > -0.3 && Number(t.dx) < 1.3 && Number(t.dy) > -0.5 && Number(t.dy) < 1.5);
      console.log(`  ${p.name} [${(W / p.units.perMeter).toFixed(0)}x${(H / p.units.perMeter).toFixed(0)} m] ->`, near.slice(0, 8).map(t => `"${t.t}"@(${t.dx},${t.dy}) h${t.h.toFixed(2)} ${t.layer}`).join(' | '));
    }
  }
}, 1800000);
