// @vitest-environment node
import { it } from 'vitest';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { readCadFile } from '@/lib/cad/readFile';
import { partsFromDrawing, buildPart } from '@/lib/cad/floorParts';
import { walkableGraph } from '@/lib/cad/commitVenue';
import { classifyLayers } from '@/lib/cad/classify';
const files = [process.env.IMPORT_FILE!];
it('testset', async () => {
  const rep: any = {};
  for (const path of files) {
    const f = path.split('/').pop()!; const t0 = Date.now(); const r: any = rep[f] = { floors: [] };
    try {
      const d = await readCadFile(new File([readFileSync(path)], f));
      const cls = classifyLayers(d); const rules = Object.fromEntries(cls.map(l => [l.name, l.suggested]));
      r.units = d.unitsName; r.layers = cls.map(l => [l.name, l.suggested, Math.round(l.confidence * 100) / 100]);
      const parts = partsFromDrawing(f, d, rules);
      for (const p of parts) {
        const fr: any = { name: p.name, level: p.level, include: p.include !== false, origin: p.origin };
        r.floors.push(fr);
        if (p.include === false) continue;
        const t1 = Date.now(); const v = buildPart(p, 40, rules); const g = walkableGraph(v, 40);
        const par = g.nodes.map((_, i) => i); const fd = (i: number): number => (par[i] === i ? i : (par[i] = fd(par[i]))); for (const e of g.edges) par[fd(e.from)] = fd(e.to);
        Object.assign(fr, { ms: Date.now() - t1, walls: v.walls.length, rooms: v.rooms.map(x => x.name), doors: v.features.filter(x => x.kind === 'door').length,
          labels: v.features.filter(x => x.kind === 'label').map(x => x.label), networks: new Set(g.nodes.map((_, i) => fd(i))).size, nodes: g.nodes.length, warnings: v.warnings,
          geo: { walls: v.walls, glass: v.glass ?? [], rooms: v.rooms.map(x => ({ name: x.name, poly: x.polygon })), features: v.features.map(x => ({ k: x.kind, x: x.x, y: x.y, label: x.label ?? null, rot: x.rotationDeg ?? 0, w: x.width ?? 0 })), edges: g.edges.map(e => [g.nodes[e.from].x, g.nodes[e.from].y, g.nodes[e.to].x, g.nodes[e.to].y]) } });
      }
    } catch (e: any) { r.error = String(e?.message ?? e); }
    r.ms = Date.now() - t0;
    console.log(`\n### ${f} (${r.ms} ms) units=${r.units} ${r.error ?? ''}`);
    for (const fr of r.floors) console.log(`  [${fr.include ? 'x' : ' '}] ${fr.name} L${fr.level} | walls ${fr.walls} rooms ${fr.rooms?.length} doors ${fr.doors} nets ${fr.networks} | ${fr.rooms?.slice(0, 12).join(', ')} | ${fr.warnings?.join(' / ') ?? ''}`);
  }
  writeFileSync(process.env.IMPORT_OUT!, JSON.stringify(rep));
}, 1800000);
