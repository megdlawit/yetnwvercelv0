// Floors from plans: a building's floors arrive either together (one CAD
// sheet with several plans side by side, or an IFC / 3D model with levels)
// or one file per floor. Either way each floor becomes a "part" with a
// suggested name and level, ready to build and save as its own floor.

import { readCadFile } from './readFile';
import { classifyLayers } from './classify';
import { buildVenue, placeLabelFrom, type BuiltVenue } from './buildVenue';
import { findDrawings, findFloorPlans, inferUnits, quarterArcs, withinArea, type DrawingArea } from './analyze';
import type { DxfEntity } from '../dxf/parseDxf';
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
  /** The text the floor was named from: its title on the sheet, or the file name. */
  named?: string;
}

/**
 * A semi-basement is the level just below ground, so plain basements go under it ("Basement 1"
 * becomes −2). Across every part of an upload — one sheet, or one file per floor.
 */
export function orderBasements<T extends { level: number | null; name: string; named?: string }>(parts: T[]): T[] {
  const semi = (q: T) => /semi[\s-]*bas/i.test(q.named ?? '');
  if (parts.some(q => semi(q) && q.level === -1)) {
    for (const q of parts) {
      if (semi(q)) q.name = 'Semi-basement';
      else if (q.level != null && q.level < 0) {
        q.level -= 1;
        // The architect's own number stays ("Basement 1" is still Basement 1, one level lower).
        const own = /bas[e]?m[e]?nt[\s_-]*(\d)|\bb(\d)\b/i.exec(q.named ?? '');
        q.name = own ? `Basement ${own[1] ?? own[2]}` : ORDINAL_NAME(q.level);
      }
    }
  }
  return parts;
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
  forth: 4 }; // "FORTH" is a common misspelling of fourth

/** A floor's level from its name: "Ground floor" 0, "Level 2" 2, "B1" -1, "Second floor" 2. */
export function levelFromName(raw: string): number | null {
  const s = raw.toLowerCase().replace(/[_.-]+/g, ' ');
  // Also as typed on real sheets: "BASMENT", "GROUN FLOOR".
  // "Basement 2" is two below ground; a semi-basement is one (a plain basement under it goes lower — see sheetFloors).
  const basement = /\b(?:bas[e]?m[e]?nt(?:\s*(\d))?|cellar|underground|b(\d+)|lower ground)\b/.exec(s);
  if (basement) return -(Number(basement[1] ?? basement[2]) || 1);
  if (/\b(?:ground|groun\s+(?:floor|level|plan)|gf|g\/f|lobby|entrance level|street level)\b/.test(s)) return 0;
  const ord = /\b(first|second|third|fourth|forth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\b/.exec(s);
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
  // "SECOND - THIRD FLOOR" reads as "2nd - 3rd floor"; "A-111_5th" as "a-111 5th" (an underscore joins words).
  const s = raw.toLowerCase().replace(/_+/g, ' ').replace(/\b(first|second|third|fourth|forth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\b/g, w => `${ORDINALS[w]}th`);
  const range = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|–|to)\s*(\d{1,2})(?:st|nd|rd|th)?\s*(?:floor|level|storey|story)?/.exec(s);
  if (range && /(floor|level|storey|story)/.test(s)) {
    const a = Number(range[1]), b = Number(range[2]);
    if (b > a && b - a <= 20) return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  // A list: "5th, 6th, 7th, 8th & 9th FLOOR PLAN".
  const list = /\b\d{1,2}(?:st|nd|rd|th)(?:\s*(?:,|&|and)\s*\d{1,2}(?:st|nd|rd|th))+\s*(?:floor|level|storey|story)/.exec(s);
  if (list) {
    const levels = [...new Set((list[0].match(/\d{1,2}(?=st|nd|rd|th)/g) ?? []).map(Number))].sort((x, y) => x - y);
    if (levels.length > 1 && levels.length <= 20) return levels;
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

/** A storey name that only numbers it ("Level 1") or is a drawing code ("BT-A_0990_UG01_RDOK_0,000", "E00_OKRD"). */
const GENERIC_LEVEL = /^(?:(?:level|floor|storey|story|ebene|niveau)\s*-?\d+|[A-Z0-9.,]+(?:[_-][A-Z0-9.,]+)+)$/i;

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
function titleBelow(d: CadDrawing, a: DrawingArea, perMeter: number): string | null {
  const h = a.maxY - a.minY, w = a.maxX - a.minX;
  // A third of the plan's height below it — and at least 6 m: a small house's title sits as far off as a big one's.
  const reach = Math.max(0.35 * h, 6 * perMeter);
  // Below on paper: smaller y when the drawing's y axis points up (CAD), larger otherwise.
  const gap = (y: number) => (d.flipY ? a.minY - y : y - a.maxY);
  let best: { t: string; g: number } | null = null;
  for (const e of d.entities) {
    if (e.kind !== 'TEXT' || e.text.length > 80 || !TITLE_WORDS.test(e.text)) continue;
    if (!levelsFromName(e.text).length && !/floor plan/i.test(e.text)) continue;
    if (e.pos.x < a.minX - 0.1 * w || e.pos.x > a.maxX + 0.1 * w) continue;
    const g = gap(e.pos.y);
    if (g < -0.25 * h || g > reach) continue;   // titles often overlap the plan's bottom edge
    if (!best || Math.abs(g) < Math.abs(best.g)) best = { t: cleanTitle(e.text), g };
  }
  return best?.t ?? null;
}

/** Every point of an entity moved by (dx, dy). */
function moved(e: DxfEntity, dx: number, dy: number): DxfEntity {
  const m = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  switch (e.kind) {
    case 'LINE': return { ...e, a: m(e.a), b: m(e.b) };
    case 'POLYLINE': return { ...e, pts: e.pts.map(m) };
    case 'CIRCLE': case 'ARC': return { ...e, center: m(e.center) };
    case 'TEXT': case 'INSERT': return { ...e, pos: m(e.pos) };
  }
}

/**
 * A floor's drawing with an outbuilding's beside it: the outbuilding keeps its place on the
 * sheet, moved off just far enough to leave `gap` between them (sheets draw it touching).
 */
function beside(host: CadDrawing, extra: CadDrawing, gap: number): CadDrawing {
  const H = host.bounds!, A = extra.bounds!;
  const hc = { x: (H.minX + H.maxX) / 2, y: (H.minY + H.maxY) / 2 }, ac = { x: (A.minX + A.maxX) / 2, y: (A.minY + A.maxY) / 2 };
  let dx = 0, dy = 0;
  // Off the side it's drawn on: across the longer way between the centres.
  if (Math.abs(ac.y - hc.y) / (H.maxY - H.minY) >= Math.abs(ac.x - hc.x) / (H.maxX - H.minX)) {
    dy = ac.y < hc.y ? Math.min(0, H.minY - gap - A.maxY) : Math.max(0, H.maxY + gap - A.minY);
  } else {
    dx = ac.x < hc.x ? Math.min(0, H.minX - gap - A.maxX) : Math.max(0, H.maxX + gap - A.minX);
  }
  const entities = [...host.entities, ...extra.entities.map(e => moved(e, dx, dy))];
  const hatches = [...(host.hatches ?? []), ...(extra.hatches ?? []).map(h => ({ ...h, loops: h.loops.map(l => l.map(p => ({ x: p.x + dx, y: p.y + dy }))) }))];
  return {
    ...host, entities, hatches, layers: [...new Set([...host.layers, ...extra.layers])].sort(),
    bounds: { minX: Math.min(H.minX, A.minX + dx), minY: Math.min(H.minY, A.minY + dy), maxX: Math.max(H.maxX, A.maxX + dx), maxY: Math.max(H.maxY, A.maxY + dy) },
  };
}

/** An outbuilding's name: its biggest room's ("Guard House Ceramic ff A=11.75m²" → "guard house"). */
function outbuildingName(d: CadDrawing): string | null {
  const named = d.entities.flatMap(e => {
    if (e.kind !== 'TEXT') return [];
    const name = placeLabelFrom(e.text);
    if (!name || /toilet|wc|bath|shower|store|corridor|stair/i.test(name)) return [];
    return [{ name, area: Number(/A\s*=\s*([\d.]+)/i.exec(e.text)?.[1] ?? 0) }];
  });
  const best = named.sort((a, b) => b.area - a.area)[0];
  return best ? best.name.toLowerCase() : null;
}

/**
 * The floors on a sheet of plans, by their walls (see findFloorPlans): one part per
 * floor, named from its title. A "2nd–4th floor" plan becomes one part per floor; a
 * plan drawn twice (another copy elsewhere on the sheet) is imported once; a small
 * separate plan at a level a bigger plan already has (an annex on the site) is off.
 */
function sheetFloors(fileName: string, d: CadDrawing, units: Units, plans: DrawingArea[]): FloorPart[] {
  // An elevation or section can have the plans' width, but it names three or more levels: with no
  // doors at all, or (a door drawn in a section) with its level markers stacked up the side, each
  // higher level higher on the page. An area table beside a plan lists levels going down the page.
  // Each marker counts for the drawing nearest to it (a neighbour's markers can be within reach).
  const gapTo = (p: { x: number; y: number }, a: DrawingArea) => Math.hypot(Math.max(a.minX - p.x, 0, p.x - a.maxX), Math.max(a.minY - p.y, 0, p.y - a.maxY));
  const elevation = (a: DrawingArea) => {
    if (a.doors >= 8) return false;   // door swings are drawn in plans, not in elevations
    const at = new Map<number, number[]>(), side = 6 * units.perMeter;   // markers are written beside the building, anchored at their left end
    for (const e of d.entities) {
      if (e.kind !== 'TEXT' || e.text.length > 40 || e.pos.x < a.minX - side || e.pos.x > a.maxX + side || e.pos.y < a.minY || e.pos.y > a.maxY) continue;
      // In a plan with doors, "RAMP FROM GROUND FLOOR" is a label, not a level marker.
      if (a.doors > 0 && /\b(?:ramp|from|to|up|down|stairs?|plan|scale)\b/i.test(e.text)) continue;
      if (plans.some(o => o !== a && gapTo(e.pos, o) < gapTo(e.pos, a))) continue;
      const l = levelFromName(e.text);
      if (l != null) at.set(l, [...(at.get(l) ?? []), d.flipY ? e.pos.y : -e.pos.y]);
    }
    if (at.size < 3) return false;
    if (a.doors === 0) return true;   // no doors and three levels: not a floor either way
    const heights = [...at.entries()].sort((p, q) => p[0] - q[0]).map(([, ys]) => ys.reduce((s, y) => s + y, 0) / ys.length);
    return heights.every((h, i) => i === 0 || h > heights[i - 1]);
  };
  const found = plans.filter(a => !elevation(a)).map(a => ({ a, title: titleBelow(d, a, units.perMeter), size: (a.maxX - a.minX) * (a.maxY - a.minY) }));
  const norm = (t: string | null) => (t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const kept = found.filter(p => !found.some(o => o !== p && p.title && norm(o.title) === norm(p.title)
    && Math.abs(o.size - p.size) <= 0.2 * p.size && (o.a.doors > p.a.doors || (o.a.doors === p.a.doors && found.indexOf(o) < found.indexOf(p)))));
  const biggest = Math.max(...kept.map(p => p.size));
  // A building's floors are drawn side by side; another building on the sheet (a shop block
  // beside a G+4) sits further off. The building with the most floors is the venue: where
  // the other one has a floor of the same level, the venue's own plan is that floor.
  const group = kept.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])));
  const span = (a: DrawingArea) => Math.max(a.maxX - a.minX, a.maxY - a.minY);
  kept.forEach((p, i) => kept.forEach((o, j) => { if (j > i && gapTo({ x: (o.a.minX + o.a.maxX) / 2, y: (o.a.minY + o.a.maxY) / 2 }, p.a) - span(o.a) / 2 <= Math.max(span(p.a), span(o.a))) group[root(i)] = root(j); }));
  const levelsIn = (g: number) => new Set(kept.flatMap((p, i) => (root(i) === g && p.title ? levelsFromName(p.title) : [])));
  const roots = [...new Set(kept.map((_, i) => root(i)))];
  const area = (g: number) => kept.reduce((s, p, i) => s + (root(i) === g ? p.size : 0), 0);
  const main = roots.sort((a, b) => levelsIn(b).size - levelsIn(a).size || area(b) - area(a))[0];
  const inMain = (i: number) => root(i) === main;
  // An outbuilding drawn beside the building's plans (a guard house titled "GROUND FLOOR"): small,
  // at a level a plan of the same building already has, with far fewer doors than that plan (a
  // smaller copy of the same floor has as many). It's part of that floor, not a second one.
  const singleLevel = (p: (typeof kept)[number]) => (p.title ? levelsFromName(p.title) : []);
  const annexOf = new Map<number, number>();
  kept.forEach((p, i) => {
    const lv = singleLevel(p);
    if (lv.length !== 1 || p.size >= 0.4 * biggest) return;
    const host = kept.findIndex((o, j) => j !== i && root(j) === root(i) && o.size >= 0.4 * biggest
      && singleLevel(o).length === 1 && singleLevel(o)[0] === lv[0] && p.a.doors <= 0.5 * o.a.doors);
    if (host >= 0) annexOf.set(i, host);
  });
  const parts: FloorPart[] = [];
  const detail = new Map<string, number>();   // part key → its plan's doors (and size), to pick between drawings of one floor
  kept.forEach((p, i) => {
    // No title on the sheet: a file with one plan is named by its file name ("level-2.dxf").
    const levels = p.title ? levelsFromName(p.title) : kept.length === 1 ? levelsFromName(fileName) : [];
    const small = p.size < 0.4 * biggest;
    if (annexOf.has(i)) return;   // drawn into its floor (below)
    const origin = `Plan ${i + 1} of ${kept.length}${p.title ? ` — “${p.title}”` : ''}`;
    let drawing = withinArea(d, p.a);
    const annexes = [...annexOf].filter(([, host]) => host === i).map(([a]) => kept[a].a);
    for (const a of annexes) drawing = beside(drawing, withinArea(d, a), 4 * units.perMeter);
    const annexNote = annexes.length ? annexes.map(a => {
      const name = outbuildingName(withinArea(d, a));
      return `Includes ${name ? `the ${name}` : 'a small separate building'} drawn beside it on the sheet, placed 4 m off the building — drag it to where it stands in the editor.`;
    }).join(' ') : null;
    if (levels.length > 1) {
      levels.forEach(lv => detail.set(`${fileName}#P${i}L${lv}`, (inMain(i) ? 1e18 : 0) + p.a.doors * 1e12 + p.size));
      levels.forEach(lv => parts.push({
        key: `${fileName}#P${i}L${lv}`, file: fileName, origin, drawing, units, name: ORDINAL_NAME(lv), level: lv, named: p.title ?? undefined,
        note: `One plan for floors ${levels[0]}–${levels[levels.length - 1]}`,
      }));
      return;
    }
    const level = levels[0] ?? null;
    const sameLevel = (o: (typeof kept)[number]) => !!o.title && levelsFromName(o.title).includes(level as number);
    const otherBuilding = !inMain(i) && kept.some((o, j) => inMain(j) && sameLevel(o));
    const clash = otherBuilding || (small && kept.some((o, j) => o !== p && (inMain(j) || !inMain(i)) && o.size >= 0.4 * biggest && sameLevel(o)));
    // Untitled among plans titled by floor: the roof or site plan, most likely.
    const untitled = !p.title && kept.some(o => o.title && levelsFromName(o.title).length);
    // No floor titles anywhere on the sheet: the plans are laid out from the ground floor up,
    // so they're named in that order — and the note says to check.
    const byOrder = !p.title && kept.length > 1 && !kept.some(o => o.title && levelsFromName(o.title).length);
    detail.set(`${fileName}#P${i}`, (inMain(i) ? 1e18 : 0) + p.a.doors * 1e12 + p.size);
    parts.push({
      key: `${fileName}#P${i}`, file: fileName, origin, drawing, units, named: p.title ?? (kept.length === 1 ? fileName : undefined),
      name: level != null ? ORDINAL_NAME(level) : p.title ? (floorNameFrom(p.title).replace(/\s+(?:floor\s+)?plan\b.*$/i, '') || floorNameFrom(p.title)) : kept.length === 1 ? floorNameFrom(fileName) : byOrder ? ORDINAL_NAME(i) : `Floor ${i}`,
      level: level ?? (byOrder ? i : null),
      ...(otherBuilding ? { include: false, note: 'Another building drawn on this sheet — import it as its own venue, or tick it to add it here.' }
        : clash || (small && level == null) ? { include: false, note: 'Small separate plan — another building on the site? Tick it to import it.' }
        : untitled ? { include: false, note: 'Plan without a floor title — the roof or site plan? Tick it to import it.' }
        : byOrder ? { note: 'The sheet has no floor titles — named in order, left to right. Check the floor.' }
        : annexNote ? { note: annexNote } : {}),
    });
  });
  orderBasements(parts);
  // Two drawings of one floor (a detailed plan and a simpler copy, a different size so not caught
  // as a copy above): the one with more doors is the floor; the other is listed, unticked.
  for (const q of parts) {
    if (q.include === false || q.level == null) continue;
    const better = parts.find(o => o !== q && o.include !== false && o.level === q.level && (detail.get(o.key) ?? 0) > (detail.get(q.key) ?? 0));
    if (better) Object.assign(q, { include: false, note: `Another drawing of the ${better.name.toLowerCase()} (fewer doors) — tick it to use it instead.` });
  }
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
    // The order by height decides the level: models call their ground floor "Level 1" (Revit),
    // "Level 0" or "Erdgeschoss" alike. The model's own storey name is kept unless it's a bare
    // number like that ("Level 1" reads better as "Ground floor").
    return levels.map(({ lv, drawing }, i) => {
      const level = byHeight.findIndex(l => l === levels[i]) - groundIdx;
      return {
        key: `${file.name}#L${i}`, file: file.name, origin: `${lv.name} (${lv.elevation >= 0 ? '+' : ''}${lv.elevation.toFixed(1)} m)`,
        drawing: { ...drawing, bounds: frame ?? drawing.bounds }, units,
        name: GENERIC_LEVEL.test(lv.name.trim()) ? ORDINAL_NAME(level) : floorNameFrom(lv.name), level,
      };
    });
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
        key: `${file.name}#D${i}`, file: file.name, origin: `Drawing ${i + 1} of ${ordered.length}`, named: title ?? undefined,
        drawing: withinArea(d, a), units,
        name: title ? floorNameFrom(title) : `Floor ${i}`, level: title ? levelFromName(title) : null,
      };
    });
  }

  // One plan: the whole file (or its main drawing when the sheet has extras).
  const main = areas.length > 1 ? withinArea(d, areas[0]) : d;
  const level = levelFromName(file.name);
  return orderBasements([{ key: file.name, file: file.name, origin: 'Whole file', drawing: main, units, name: level != null ? ORDINAL_NAME(level) : floorNameFrom(file.name), level, named: file.name }]);
}

/** A floor's name from a sheet file name: "AR_HOTEL A-105_MEZZANINE  FLOOR PLAN JAN_26.dxf" → "Mezzanine floor". */
function floorNameFromSheet(fileName: string): string {
  const core = fileName.replace(/\.[a-z0-9]+$/i, '')
    .replace(/^.*?\b[A-Z]{1,2}-?\d{2,4}[_\s.-]+/i, '')            // the sheet number and what comes before it
    .replace(/\s*(?:floor\s*)?plans?\b.*$/i, '')                   // "… FLOOR PLAN JAN_26"
    .replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const name = floorNameFrom(core || fileName);
  return /floor|roof|terrace|level|storey|deck/i.test(name) ? name : `${name} floor`;
}

/**
 * "One file per floor": each file is the floor it's named after. Its biggest plan (or the one
 * at the file's level) is that floor; the sheet's other drawings — key plans, sections, copies —
 * are listed, unticked. Files without a level in their name (mezzanine, duct floor, roof) go
 * between their neighbours in file order (sheets are numbered A-104, A-105, A-106…), and the
 * floors are then numbered in that order with the ground floor at 0.
 */
export function oneFloorPerFile(files: { name: string; parts: FloorPart[] }[]): FloorPart[] {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const area = (p: FloorPart) => { const b = p.drawing.bounds; return b ? (b.maxX - b.minX) * (b.maxY - b.minY) : 0; };
  const floors: { part: FloorPart; key: number | null }[] = [], others: FloorPart[] = [];
  for (const f of sorted) {
    if (!f.parts.length) continue;
    const pool = f.parts.some(p => p.include !== false) ? f.parts.filter(p => p.include !== false) : f.parts;
    const biggest = (ps: FloorPart[]) => ps.reduce((a, b) => (area(b) > area(a) ? b : a));
    const levels = levelsFromName(f.name);
    const chosen = new Set<FloorPart>();
    if (levels.length) {
      for (const lv of levels) {
        const at = pool.filter(p => p.level === lv);
        const p = at.length ? biggest(at) : biggest(pool);
        chosen.add(p);
        floors.push({ part: { ...p, key: `${f.name}#F${lv}`, level: lv, name: ORDINAL_NAME(lv), named: f.name, include: true, note: undefined }, key: lv });
      }
    } else {
      const p = biggest(pool);
      chosen.add(p);
      floors.push({ part: { ...p, key: `${f.name}#F`, level: null, name: floorNameFromSheet(f.name), named: f.name, include: true, note: undefined }, key: null });
    }
    for (const p of f.parts) if (!chosen.has(p)) others.push({ ...p, include: false, note: 'Another drawing on this sheet — tick it to add it as a floor too.' });
  }
  orderBasements(floors.map(x => x.part));
  for (const x of floors) if (x.key != null) x.key = x.part.level;
  // Floors named without a level sit between their neighbours (in file order).
  if (floors.some(x => x.key == null)) {
    floors.forEach((x, i) => {
      if (x.key != null) return;
      const prev = floors.slice(0, i).reverse().find(o => o.key != null)?.key ?? null;
      const next = floors.slice(i + 1).find(o => o.key != null)?.key ?? null;
      x.key = prev != null && next != null ? (prev + next) / 2 : prev != null ? prev + 0.5 : next != null ? next - 0.5 : i;
    });
    // Known levels keep their numbers; each inserted floor moves the ones above it up by one.
    let prev = -Infinity, shift = 0;
    for (const x of [...floors].sort((a, b) => a.key! - b.key!)) {
      let level = Number.isInteger(x.key) ? x.key! + shift : prev + 1;
      if (!Number.isInteger(x.key)) shift += 1;
      if (level <= prev) { shift += prev + 1 - level; level = prev + 1; }
      x.part.level = level;
      prev = level;
    }
  }
  return [...floors.map(x => x.part), ...others];
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
