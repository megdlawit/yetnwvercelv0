// Floors from plans: a building's floors arrive either together (one CAD
// sheet with several plans side by side, or an IFC / 3D model with levels)
// or one file per floor. Either way each floor becomes a "part" with a
// suggested name and level, ready to build and save as its own floor.

import { readCadFile } from './readFile';
import { classifyLayers } from './classify';
import { buildVenue, type BuiltVenue } from './buildVenue';
import { findDrawings, findFloorPlans, inferUnits, quarterArcs, withinArea, type DrawingArea } from './analyze';
import type { CadDrawing, LayerMapping } from './types';

export type Units = { perMeter: number; source: 'file' | 'inferred' | 'assumed' | 'manual'; reason: string };

const MODEL_FORMATS = ['ifc', 'obj', 'glb', 'gltf'];
const PDF_POINTS_PER_METER = 72 / 0.0254;

/**
 * Units for a drawing: 3D formats are metres by definition; for drawings the
 * geometry decides (door swings, plan size), since files often declare the
 * wrong unit or none at all.
 */
export function detectUnits(d: CadDrawing, arcs: ReturnType<typeof quarterArcs>): Units {
  if (MODEL_FORMATS.includes(d.format)) return { perMeter: 1, source: 'file', reason: `${d.format.toUpperCase()} models are in metres` };
  const g = inferUnits(d, arcs);
  if (g.source !== 'assumed' || d.format === 'dxf' || d.format === 'dwg') return { perMeter: g.perMeter, source: g.source, reason: g.reason };
  // No doors to measure: PDFs default to 1:100, other drawings to ~50 m across.
  if (d.format === 'pdf') return { perMeter: PDF_POINTS_PER_METER / 100, source: 'assumed', reason: 'assumed 1:100 — set the drawing scale' };
  const b = d.bounds;
  const longest = b ? Math.max(b.maxX - b.minX, b.maxY - b.minY) : 50;
  return { perMeter: Math.max(longest / 50, 1e-6), source: 'assumed', reason: 'assumed about 50 m across — set the scale' };
}

export interface FloorPart {
  key: string;
  /** The file it came from. */
  file: string;
  /** Where in the file: "Level 2", "Drawing 3 of 4", or the whole file. */
  origin: string;
  drawing: CadDrawing;
  units: Units;
  /** Suggested floor name and level number (null: not known — placed by order). */
  name: string;
  level: number | null;
  /** Imported unless unticked; off for a small separate plan at a level a bigger plan has. */
  include?: boolean;
  /** Why it is off, or that it repeats another plan ("same plan as 2nd floor"). */
  note?: string;
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

/** A floor's level from its name: "Ground floor" 0, "Level 2" 2, "B1" -1, "Second floor" 2. */
export function levelFromName(raw: string): number | null {
  const s = raw.toLowerCase().replace(/[_.-]+/g, ' ');
  // Also as typed on real sheets: "BASMENT", "GROUN FLOOR".
  const basement = /\b(?:bas[e]?m[e]?nt|cellar|underground|b(\d+)|lower ground)\b/.exec(s);
  if (basement) return -(Number(basement[1]) || 1);
  if (/\b(?:ground|groun\s+(?:floor|level|plan)|gf|g\/f|lobby|entrance level|street level)\b/.test(s)) return 0;
  const ord = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/.exec(s);
  if (ord) return ORDINALS[ord[1]];
  const numbered = /\b(?:level|floor|storey|story|fl|lvl|l)\s*(-?\d{1,2})\b/.exec(s) ?? /\b(-?\d{1,2})(?:st|nd|rd|th)?\s*(?:floor|level|storey|story)\b/.exec(s);
  if (numbered) return Number(numbered[1]);
  return null;
}

/**
 * The levels one plan stands for: a typical-floor plan is titled "2nd -4th FLOOR"
 * or "Floors 2-4" and is the plan of each of them. Otherwise its one level, or [].
 */
export function levelsFromName(raw: string): number[] {
  const s = raw.toLowerCase();
  const range = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|–|to)\s*(\d{1,2})(?:st|nd|rd|th)?\s*(?:floor|level|storey|story)?/.exec(s);
  if (range && /(floor|level|storey|story)/.test(s)) {
    const a = Number(range[1]), b = Number(range[2]);
    if (b > a && b - a <= 20) return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  const one = levelFromName(raw);
  return one == null ? [] : [one];
}

const ORDINAL_NAME = (n: number) => (n < 0 ? (n === -1 ? 'Basement' : `Basement ${-n}`) : n === 0 ? 'Ground floor'
  : `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'} floor`);

/** A tidy floor name from a file name or title ("unity_level-2_plan.dxf" → "Unity level 2 plan"). */
export function floorNameFrom(raw: string): string {
  let base = raw.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  // CAD titles are usually in capitals: "GROUND FLOOR" → "Ground floor".
  if (base === base.toUpperCase() && /[A-Z]/.test(base)) base = base.toLowerCase();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Floor';
}

const TITLE_WORDS = /(floor|level|storey|story|ground|basement|mezzanine|roof|plan|ፎቅ)/i;

/** The title written in (or just below) a drawing on the sheet, if there is one. */
function titleOf(d: CadDrawing, area: { minX: number; minY: number; maxX: number; maxY: number }): string | null {
  const h = area.maxY - area.minY, w = area.maxX - area.minX;
  const near = (p: { x: number; y: number }) => p.x >= area.minX - w * 0.05 && p.x <= area.maxX + w * 0.05 && p.y >= area.minY - h * 0.2 && p.y <= area.maxY + h * 0.2;
  const hit = d.entities.find(e => e.kind === 'TEXT' && near(e.pos) && TITLE_WORDS.test(e.text) && e.text.length < 40);
  return hit && hit.kind === 'TEXT' ? hit.text.trim() : null;
}

/** "GROUND FLOOR A= 201.1 M² Sc=1:50" → "GROUND FLOOR": area and scale notes after a title. */
const cleanTitle = (t: string) => t.split(/\s+(?:A\s*=|AREA\b|SC\s*=|SCALE\b)/i)[0].trim();

/**
 * A floor plan's title: the floor/level text just BELOW the plan (where drawings are
 * titled), horizontally within it; the one nearest the plan's bottom edge.
 */
function titleBelow(d: CadDrawing, a: DrawingArea): string | null {
  const h = a.maxY - a.minY, w = a.maxX - a.minX;
  // Below on paper: smaller y when the drawing's y axis points up (CAD), larger otherwise.
  const gap = (y: number) => (d.flipY ? a.minY - y : y - a.maxY);
  let best: { t: string; g: number } | null = null;
  for (const e of d.entities) {
    if (e.kind !== 'TEXT' || e.text.length > 80 || !TITLE_WORDS.test(e.text)) continue;
    if (!levelsFromName(e.text).length && !/floor plan/i.test(e.text)) continue;
    if (e.pos.x < a.minX - 0.1 * w || e.pos.x > a.maxX + 0.1 * w) continue;
    const g = gap(e.pos.y);
    if (g < -0.25 * h || g > 0.35 * h) continue;   // titles often overlap the plan's bottom edge
    if (!best || Math.abs(g) < Math.abs(best.g)) best = { t: cleanTitle(e.text), g };
  }
  return best?.t ?? null;
}

/**
 * The floors on a sheet of plans, by their walls (see findFloorPlans): one part per
 * floor, named from its title. A "2nd–4th floor" plan becomes one part per floor; a
 * plan drawn twice (another copy elsewhere on the sheet) is imported once; a small
 * separate plan at a level a bigger plan already has (an annex on the site) is off.
 */
function sheetFloors(fileName: string, d: CadDrawing, units: Units, plans: DrawingArea[]): FloorPart[] {
  const found = plans.map(a => ({ a, title: titleBelow(d, a), size: (a.maxX - a.minX) * (a.maxY - a.minY) }));
  const norm = (t: string | null) => (t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const kept = found.filter(p => !found.some(o => o !== p && p.title && norm(o.title) === norm(p.title)
    && Math.abs(o.size - p.size) <= 0.2 * p.size && (o.a.doors > p.a.doors || (o.a.doors === p.a.doors && found.indexOf(o) < found.indexOf(p)))));
  const biggest = Math.max(...kept.map(p => p.size));
  const parts: FloorPart[] = [];
  kept.forEach((p, i) => {
    // No title on the sheet: a file with one plan is named by its file name ("level-2.dxf").
    const levels = p.title ? levelsFromName(p.title) : kept.length === 1 ? levelsFromName(fileName) : [];
    const small = p.size < 0.4 * biggest;
    const origin = `Plan ${i + 1} of ${kept.length}${p.title ? ` — “${p.title}”` : ''}`;
    const drawing = withinArea(d, p.a);
    if (levels.length > 1) {
      levels.forEach(lv => parts.push({
        key: `${fileName}#P${i}L${lv}`, file: fileName, origin, drawing, units, name: ORDINAL_NAME(lv), level: lv,
        note: `One plan for floors ${levels[0]}–${levels[levels.length - 1]}`,
      }));
      return;
    }
    const level = levels[0] ?? null;
    const clash = small && kept.some(o => o !== p && o.size >= 0.4 * biggest && o.title && levelsFromName(o.title).includes(level as number));
    // Untitled among plans titled by floor: the roof or site plan, most likely.
    const untitled = !p.title && kept.some(o => o.title && levelsFromName(o.title).length);
    parts.push({
      key: `${fileName}#P${i}`, file: fileName, origin, drawing, units,
      name: level != null ? ORDINAL_NAME(level) : p.title ? floorNameFrom(p.title) : kept.length === 1 ? floorNameFrom(fileName) : `Floor ${i}`, level,
      ...(clash || (small && level == null) ? { include: false, note: 'Small separate plan — another building on the site? Tick it to import it.' }
        : untitled ? { include: false, note: 'Plan without a floor title — the roof or site plan? Tick it to import it.' } : {}),
    });
  });
  return parts;
}

/**
 * Every floor in one file — the same way however it was uploaded (one file with all the
 * floors, or one file per floor): the floor plans are found by their walls and doors
 * (elevations, sections and the site plan are not floors), named from their titles, then
 * from the file name. `mapping`: which layers are walls (the reviewed labels; default: the
 * name rules).
 */
export async function partsFromFile(file: File, opts: { mapping?: LayerMapping } = {}): Promise<FloorPart[]> {
  return partsFromDrawing(file.name, await readCadFile(file), opts.mapping);
}

/** partsFromFile for a drawing already read (the import dialog has it). */
export function partsFromDrawing(fileName: string, d: CadDrawing, reviewed?: LayerMapping): FloorPart[] {
  const file = { name: fileName };
  const arcs = quarterArcs(d.entities);
  const units = detectUnits(d, arcs);
  const split = true;

  // A model with levels: one part per level, all in the same frame so the floors stack exactly.
  if (split && d.levels && d.levels.length > 1 && d.atLevel) {
    const levels = d.levels.map((lv, i) => ({ lv, drawing: d.atLevel!(i) }));
    const all = levels.map(l => l.drawing.bounds).filter(Boolean) as NonNullable<CadDrawing['bounds']>[];
    const frame = all.length ? {
      minX: Math.min(...all.map(b => b.minX)), minY: Math.min(...all.map(b => b.minY)),
      maxX: Math.max(...all.map(b => b.maxX)), maxY: Math.max(...all.map(b => b.maxY)),
    } : undefined;
    const byHeight = [...levels].sort((a, b) => a.lv.elevation - b.lv.elevation);
    const groundIdx = Math.max(0, byHeight.findIndex(l => l.lv.elevation >= -0.5));
    return levels.map(({ lv, drawing }, i) => ({
      key: `${file.name}#L${i}`, file: file.name, origin: `${lv.name} (+${lv.elevation.toFixed(1)} m)`,
      drawing: { ...drawing, bounds: frame ?? drawing.bounds }, units,
      name: floorNameFrom(lv.name), level: levelFromName(lv.name) ?? byHeight.findIndex(l => l === levels[i]) - groundIdx,
    }));
  }

  // A sheet of floor plans (among elevations, sections, site plan…): found by their walls.
  if (split && !MODEL_FORMATS.includes(d.format)) {
    const rules: LayerMapping = Object.fromEntries(classifyLayers(d).map(l => [l.name, l.suggested]));
    const mapping = reviewed ? { ...rules, ...reviewed } : rules;
    const plans = findFloorPlans(d, layer => mapping[layer] === 'walls', units.perMeter, arcs);
    if (plans.length) return sheetFloors(fileName, d, units, plans);
  }

  // No plan with walls and doors (an unlabelled drawing, a PDF trace): drawings found by any geometry.
  const areas = split && !MODEL_FORMATS.includes(d.format) ? findDrawings(d, units.perMeter, arcs) : [];
  const plans = areas.filter(a => a.entities >= 30);
  if (plans.length > 1) {
    const ordered = [...plans].sort((a, b) => (Math.abs(a.minY - b.minY) > (a.maxY - a.minY) * 0.5 ? (d.flipY ? b.minY - a.minY : a.minY - b.minY) : a.minX - b.minX));
    return ordered.map((a, i) => {
      const title = titleOf(d, a);
      return {
        key: `${file.name}#D${i}`, file: file.name, origin: `Drawing ${i + 1} of ${ordered.length}`,
        drawing: withinArea(d, a), units,
        name: title ? floorNameFrom(title) : `Floor ${i}`, level: title ? levelFromName(title) : null,
      };
    });
  }

  // One plan: the whole file (or its main drawing when the sheet has extras).
  const main = areas.length > 1 ? withinArea(d, areas[0]) : d;
  const level = levelFromName(file.name);
  return [{ key: file.name, file: file.name, origin: 'Whole file', drawing: main, units, name: level != null ? ORDINAL_NAME(level) : floorNameFrom(file.name), level }];
}

/** Levels for parts that have none: after the known ones, in the order found. */
export function fillLevels<T extends { level: number | null }>(parts: T[], taken: number[] = []): (T & { level: number })[] {
  const used = new Set<number>([...taken, ...parts.flatMap(p => (p.level == null ? [] : [p.level]))]);
  let next = 0;
  return parts.map(p => {
    if (p.level != null) return p as T & { level: number };
    while (used.has(next)) next++;
    used.add(next);
    return { ...p, level: next };
  });
}

/** Build a part with the reviewed layer mapping (default: the name rules) and the usual clean-up. */
export function buildPart(part: FloorPart, pxPerMeter: number, reviewed?: LayerMapping): BuiltVenue {
  const rules: LayerMapping = Object.fromEntries(classifyLayers(part.drawing).map(l => [l.name, l.suggested]));
  const mapping: LayerMapping = reviewed ? { ...rules, ...reviewed } : rules;
  return buildVenue(part.drawing, mapping, {
    unitsPerMeter: part.units.perMeter, pxPerMeter, flipY: part.drawing.flipY,
    fix: { gaps: true, overlaps: true, rooms: true, floating: false },
  });
}
