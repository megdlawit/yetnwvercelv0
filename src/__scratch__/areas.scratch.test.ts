// @vitest-environment node
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readCadFile } from '@/lib/cad/readFile';
import { findDrawings, findFloorPlans, quarterArcs } from '@/lib/cad/analyze';
import { classifyLayers } from '@/lib/cad/classify';
import { detectUnits } from '@/lib/cad/floorParts';
it('areas', async () => {
  const f = process.env.IMPORT_FILE!;
  const d = await readCadFile(new File([readFileSync(f)], f.split('/').pop()!));
  const arcs = quarterArcs(d.entities); const u = detectUnits(d, arcs); const m = u.perMeter;
  const map = Object.fromEntries(classifyLayers(d).map(l => [l.name, l.suggested]));
  const texts = d.entities.filter((e: any) => e.kind === 'TEXT' && /plan|floor/i.test(e.text)) as any[];
  const near = (a: any) => texts.filter(t => t.pos.x > a.minX - 2 * m && t.pos.x < a.maxX + 2 * m && t.pos.y > a.minY - 8 * m && t.pos.y < a.maxY + 2 * m).map(t => t.text.slice(0, 30));
  console.log('UNITS', u.reason);
  for (const a of findDrawings(d, m, arcs).filter(a => a.entities >= 30).slice(0, 14)) console.log('AREA', Math.round(a.minX), Math.round(a.minY), ((a.maxX - a.minX) / m).toFixed(1), 'x', ((a.maxY - a.minY) / m).toFixed(1), 'm ents', a.entities, 'doors', a.doors, '|', near(a).slice(0, 3).join(' ; '));
  for (const a of findFloorPlans(d, l => map[l] === 'walls', m, arcs)) console.log('PLAN', Math.round(a.minX), Math.round(a.minY), ((a.maxX - a.minX) / m).toFixed(1), 'x', ((a.maxY - a.minY) / m).toFixed(1), 'doors', a.doors, '|', near(a).slice(0, 3).join(' ; '));
}, 900000);
