// @vitest-environment node
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readCadFile } from '@/lib/cad/readFile';
import { classifyLayers } from '@/lib/cad/classify';
import { partsFromDrawing } from '@/lib/cad/floorParts';
it('crash', async () => {
  const f = process.env.IMPORT_FILE!;
  let stage = 'read';
  try {
    const d = await readCadFile(new File([readFileSync(f)], f.split('/').pop()!));
    console.log('READ ok', d.entities.length);
    stage = 'classify'; classifyLayers(d);
    stage = 'parts'; const p = partsFromDrawing(f, d); console.log('PARTS', p.length);
  } catch (e: any) { console.log('CRASH at', stage, e.message, '\n', String(e.stack).split('\n').slice(0, 14).join('\n')); }
}, 900000);
