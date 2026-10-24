// @vitest-environment node
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readCadFile } from '@/lib/cad/readFile';
import { partsFromDrawing } from '@/lib/cad/floorParts';
it('fp', async () => {
  const f = process.env.IMPORT_FILE!;
  const d = await readCadFile(new File([readFileSync(f)], f.split('/').pop()!));
  for (const p of partsFromDrawing(f, d)) console.log('FP', p.name, p.level, p.include === false ? 'off' : 'on', '|', p.origin, '|', p.note ?? '');
}, 900000);
