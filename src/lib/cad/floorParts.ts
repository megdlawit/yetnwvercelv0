// Floors from plans: a building's floors arrive either together (one CAD
// sheet with several plans side by side, or an IFC / 3D model with levels)
// or one file per floor. Either way each floor becomes a "part" with a
// suggested name and level, ready to build and save as its own floor.

import { readCadFile } from './readFile';
import { classifyLayers } from './classify';
import { buildVenue, type BuiltVenue } from './buildVenue';
import { findDrawings, inferUnits, quarterArcs, withinArea } from './analyze';
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
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

/** A floor's level from its name: "Ground floor" 0, "Level 2" 2, "B1" -1, "Second floor" 2. */
export function levelFromName(raw: string): number | null {
  const s = raw.toLowerCase().replace(/[_.-]+/g, ' ');
  const basement = /\b(?:basement|cellar|underground|b(\d+)|lower ground)\b/.exec(s);
  if (basement) return -(Number(basement[1]) || 1);
  if (/\b(?:ground|gf|g\/f|lobby|entrance level|street level)\b/.test(s)) return 0;
  const ord = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/.exec(s);
  if (ord) return ORDINALS[ord[1]];
  const numbered = /\b(?:level|floor|storey|story|fl|lvl|l)\s*(-?\d{1,2})\b/.exec(s) ?? /\b(-?\d{1,2})(?:st|nd|rd|th)?\s*(?:floor|level|storey|story)\b/.exec(s);
  if (numbered) return Number(numbered[1]);
  return null;
}

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

/** Every floor found in one file. */
export async function partsFromFile(file: File, opts: { split?: boolean } = {}): Promise<FloorPart[]> {
  const d = await readCadFile(file);
  const arcs = quarterArcs(d.entities);
  const units = detectUnits(d, arcs);
  const split = opts.split ?? true;

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

  // A sheet with several plans: one part per plan, named from its title, in reading order.
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
  return [{ key: file.name, file: file.name, origin: 'Whole file', drawing: main, units, name: floorNameFrom(file.name), level: levelFromName(file.name) }];
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

/** Build a part with the suggested layer mapping and the usual clean-up. */
export function buildPart(part: FloorPart, pxPerMeter: number): BuiltVenue {
  const mapping: LayerMapping = Object.fromEntries(classifyLayers(part.drawing).map(l => [l.name, l.suggested]));
  return buildVenue(part.drawing, mapping, {
    unitsPerMeter: part.units.perMeter, pxPerMeter, flipY: part.drawing.flipY,
    fix: { gaps: true, overlaps: true, rooms: true, floating: false },
  });
}
