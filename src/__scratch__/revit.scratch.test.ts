// @vitest-environment node
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readCadFile } from '@/lib/cad/readFile';
import { partsFromDrawing, levelFromName } from '@/lib/cad/floorParts';
it('revit', async () => {
  for (const f of (process.env.FILES ?? '').split('|')) {
    const d = await readCadFile(new File([readFileSync(`ml/data/shared/${f}`)], f));
    console.log(`### ${f}`);
    for (const p of partsFromDrawing(f, d)) {
      const counts: Record<string, number> = {};
      for (const e of p.drawing.entities as any[]) {
        if (e.kind !== 'INSERT') continue;
        const m = /-\d+-([^-]*?(?:floor|level|basement|roof|terrace|storey)[^-]*)$/i.exec(e.block);
        if (m) counts[m[1].trim()] = (counts[m[1].trim()] ?? 0) + 1;
      }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4);
      console.log(`  ${p.name} (${p.include === false ? 'off' : 'on'}) ->`, top.map(([k, v]) => `${k}=${v} (L${levelFromName(k)})`).join(' | '));
    }
  }
}, 1800000);
