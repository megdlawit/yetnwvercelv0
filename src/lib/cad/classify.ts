// Suggests what each CAD layer is, with a confidence the user can see and
// override. Names are the strongest signal: most offices follow the AIA/NCS
// convention (A-WALL, A-DOOR, A-FLOR-STRS, A-FURN, L-PLNT …) or something
// close in English, French or German. Content backs the name up or, when the
// name says nothing ("0", "Layer 3"), decides on its own.

import type { CadDrawing, Category } from './types';

/** A floor plan's outline on the sheet (drawing units). */
export interface PlanBox { minX: number; minY: number; maxX: number; maxY: number }

export interface LayerInfo {
  name: string;
  counts: { lines: number; closed: number; open: number; texts: number; inserts: number; circles: number; arcs: number };
  blocks: string[];          // most common block names inserted on this layer
  suggested: Category;
  confidence: number;        // 0..1
  reason: string;
}

// Order matters: the first rule that matches wins ("A-WALL-HATCH" is a fill, not a wall).
// Also common in real drawings: misspellings (DIMANTION, HACTH, FIRNTUR, BOARDER),
// Turkish (DUVAR wall, PENCERE window, KAPI door, ÖLÇÜ dimension), Spanish and
// Vietnamese (NOI THAT furniture, THIET BI equipment, CAY tree) template names.
const NAME_RULES: [RegExp, Category][] = [
  // Elevations and sections are other drawings of the building, not the floor plan:
  // "ELEV 1", "Elevation 01", "ele 2" are façades, not lifts (lifts: ELEVATOR, LIFT, EVTR).
  [/ELEVATION|\bELEV?[\s_-]*\d|SECTION|\bSECT\b|\bROOF/i, 'ignore'],
  [/DIM|DAIMEN|HATCH|HTCH|HACTH|HACHE|PATT|GRID|AXIS|TITLE|BORDER|BOARDER|FRAME|DEFPOINTS|VPORT|VIEWPORT|XREF|NOPLOT|CENTER|CNTR|REVISION|SHEET/i, 'ignore'],
  [/PEOPLE|PERSON|HUMAN|\bCARS?\b|VEHICLE|PARCEL|STREET|\bPLOT\b|LEGEND|GENERAL.?NOTE|[ÖO]L[ÇC][ÜU]/i, 'ignore'],
  // Electrical, hidden and drafting-only layers aren't part of a visitor's map; an "out door
  // walk way" is a walkway, not doors. DIAMENSION is a common misspelling.
  [/(^|[^A-Z])E-[A-Z]|LIGHTING|\bLAMPS?\b|SOCKET|SWITCH|EARTH|TELEPHONE|ELECTR|CALLOUT|(^|[^A-Z])HIDDEN|\bHIDD\b|PROP-?LINE|\bSYMBOL|\bARROW|DIAMEN|OUT\s*DOOR|WALK\s*WAY/i, 'ignore'],
  // The NCS "-IDEN" (identification) and "-NMBR" layers are the names and numbers of things: S-STRS-IDEN is text, not stairs.
  [/[-_ ]IDEN\b|[-_ ](NMBR|NUMB|TAGS?)\b/i, 'labels'],
  // TÜR / TUR only as a word (German "door"): FURNITUR, STRUCTUR are not doors.
  [/DOOR|PORTE|(^|[^A-Z])T[ÜU]R\b|TUER|IFCDOOR|KAPI|PUERTA/i, 'doors'],
  [/WIND|GLAZ|FENSTER|FEN[EÊ]TRE|IFCWINDOW|CURTAIN|PENCERE|VENTANA|(^|[^A-Z])WIN($|[^A-Z])/i, 'windows'],
  [/STAIR|STRS|TREPP|ESCALIER|IFCSTAIR|MERDIVEN|ESCALERA/i, 'stairs'],
  [/ELEV|LIFT|EVTR|ASCENSEUR|AUFZUG|IFCTRANSPORT|ESCALATOR|ASCENSOR|ASANS[ÖO]R/i, 'elevators'],
  // "L-" is the landscape discipline prefix (L-PLNT) — only at a word start,
  // or "A-WALL-EXTR" would match it.
  [/TREE|PLNT|PLANT|VEG|ARBRE|BAUM|SHRUB|LANDSCAPE|(^|[^A-Z])L-|\bCAY\b|A[GĞ]A[CÇ]|[AÁ]RBOL|\bGREEN/i, 'trees'],
  [/FURN|FIRNTUR|FERNIT|FIXT|FIXIT|SANITAR|SANR|\bFUR\b|\bFRN\b|EQPM|EQUIP|CHAIR|TABLE|DESK|BENCH|SEAT|MOBIL|IFCFURN|CASEWORK|NOI.?THAT|THIET.?BI|MUEBLE/i, 'furniture'],
  [/ROOM|SPACE|AREA|ZONE|RAUM|PI[EÈ]CE|IFCSPACE|POLY.*ROOM/i, 'rooms'],
  [/TEXT|\bTEX\b|TEXET|ANNO|LABEL|NAME|TAG|TXT|IDEN|NOTE/i, 'labels'],
  [/WALL|\bWAL\b|\bWAL\d|\bMUR|MURS|WAND|W[ÄA]NDE|PARTITION|PRTN|IFCWALL|COLUM|COLON|\bCOLS?\b|STRUCT|DUVAR|PARED|MURO|(^|[-_ $])CONCRETE$|^R\.?C\.?$/i, 'walls'],
];

// Block names decide individual inserts too (a "DOOR-900" block on layer 0 is still a door).
const BLOCK_RULES: [RegExp, Category][] = [
  [/DOOR|PORTE|T[ÜU]R|DR\d/i, 'doors'],
  [/^COL(UMN)?S?\b|[-_ ]COL(UMN)?S?$/i, 'walls'],
  [/WIND|FENSTER|FEN[EÊ]TRE|WIN\d/i, 'windows'],
  [/STAIR|TREPP|ESCAL/i, 'stairs'],
  [/ELEV|LIFT|AUFZUG|ASCENS/i, 'elevators'],
  [/TREE|PLANT|PALM|ARBRE|BAUM|SHRUB|BUSH/i, 'trees'],
  [/BENCH|CHAIR|SEAT|TABLE|DESK|SOFA|BED|SHELF|CABINET|FURN|TOILET|WC|SINK/i, 'furniture'],
];

export function categoryFromName(name: string): Category | null {
  return NAME_RULES.find(([re]) => re.test(name))?.[1] ?? null;
}

export function categoryFromBlock(block: string): Category | null {
  return BLOCK_RULES.find(([re]) => re.test(block))?.[1] ?? null;
}

/**
 * `plans`: where the floor plans are on the sheet, when it holds other drawings too. A layer
 * drawn (almost) only outside them is part of an elevation, section, site plan or title block:
 * it becomes nothing on the floor map, whatever its name says.
 */
export function classifyLayers(d: CadDrawing, opts: { plans?: PlanBox[] } = {}): LayerInfo[] {
  const byLayer = new Map<string, LayerInfo>();
  const blockCounts = new Map<string, Map<string, number>>();
  const info = (name: string) => {
    let l = byLayer.get(name);
    if (!l) {
      l = { name, counts: { lines: 0, closed: 0, open: 0, texts: 0, inserts: 0, circles: 0, arcs: 0 }, blocks: [], suggested: 'ignore', confidence: 0, reason: '' };
      byLayer.set(name, l);
    }
    return l;
  };
  for (const name of d.layers) info(name);
  const plans = opts.plans?.length ? opts.plans : null;
  const inPlans = new Map<string, number>();
  const outside = new Set<string>();
  for (const e of d.entities) {
    if (plans) {
      const p = e.kind === 'LINE' ? e.a : e.kind === 'POLYLINE' ? e.pts[0] : e.kind === 'TEXT' || e.kind === 'INSERT' ? e.pos : e.center;
      if (p && plans.some(b => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY)) inPlans.set(e.layer, (inPlans.get(e.layer) ?? 0) + 1);
    }
    const c = info(e.layer).counts;
    if (e.kind === 'LINE') c.lines++;
    else if (e.kind === 'POLYLINE') { if (e.closed) c.closed++; else c.open++; }
    else if (e.kind === 'TEXT') c.texts++;
    else if (e.kind === 'CIRCLE') c.circles++;
    else if (e.kind === 'ARC') c.arcs++;
    else if (e.kind === 'INSERT') {
      c.inserts++;
      const m = blockCounts.get(e.layer) ?? blockCounts.set(e.layer, new Map()).get(e.layer)!;
      m.set(e.block, (m.get(e.block) ?? 0) + 1);
    }
  }

  const layers = [...byLayer.values()];
  for (const l of layers) {
    l.blocks = [...(blockCounts.get(l.name) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b]) => b);
    const c = l.counts;
    const geometry = c.lines + c.closed + c.open + c.arcs;
    const total = geometry + c.texts + c.inserts + c.circles;
    const byName = categoryFromName(l.name);
    const blockCat = l.blocks.map(categoryFromBlock).find(Boolean) ?? null;

    if (total === 0) { l.suggested = byName ?? 'ignore'; l.confidence = byName ? 0.5 : 0.9; l.reason = 'Layer is empty'; continue; }

    const hint = d.layerHints?.[l.name];
    if (hint) { l.suggested = hint.category; l.confidence = hint.confidence; l.reason = hint.reason; continue; }

    const inside = plans ? (inPlans.get(l.name) ?? 0) / total : 1;
    if (inside < 0.15) {
      outside.add(l.name);
      l.suggested = 'ignore'; l.confidence = inside < 0.05 ? 0.85 : 0.7;
      l.reason = `${Math.round(inside * 100)}% of it is inside the floor plans — the rest is elevations, sections or the site`;
      continue;
    }

    if (byName) {
      l.suggested = byName;
      l.confidence = 0.92;
      l.reason = `Name "${l.name}" matches ${byName}`;
      // Name and content disagree → less sure.
      if (byName === 'walls' && geometry === 0) { l.confidence = 0.5; l.reason += ', but it has no lines'; }
      if (byName === 'rooms' && c.closed === 0) {
        if (c.texts > 0) { l.suggested = 'labels'; l.confidence = 0.7; l.reason = 'Named like rooms but holds only text — room names'; }
        else { l.confidence = 0.45; l.reason += ', but it has no closed outlines'; }
      }
      if (byName === 'labels' && c.texts === 0) { l.confidence = 0.4; l.reason += ', but it has no text'; }
      // "WALL" holding 19 texts and 4 outlines: the walls' labels, not walls.
      if (byName !== 'labels' && byName !== 'ignore' && c.texts >= 3 && c.texts >= total * 0.75) {
        l.suggested = 'labels'; l.confidence = 0.75; l.reason = `Named like ${byName} but holds mostly text — their labels`;
      }
      continue;
    }
    if (blockCat && c.inserts >= geometry) {
      l.suggested = blockCat; l.confidence = 0.8; l.reason = `Contains ${blockCat} blocks (${l.blocks[0]})`; continue;
    }
    if (c.texts > 0 && c.texts >= total * 0.6) {
      l.suggested = 'labels'; l.confidence = 0.7; l.reason = 'Mostly text'; continue;
    }
    if (c.closed >= 3 && c.closed >= geometry * 0.6) {
      l.suggested = 'rooms'; l.confidence = 0.5; l.reason = 'Mostly closed outlines'; continue;
    }
    if (c.circles > 0 && c.circles >= total * 0.6) {
      l.suggested = 'trees'; l.confidence = 0.4; l.reason = 'Mostly circles (often trees on site plans)'; continue;
    }
    l.suggested = 'ignore'; l.confidence = 0.4; l.reason = 'Nothing identifies this layer';
  }

  // No wall layer recognised at all: the layer carrying the most line work is
  // almost always the walls (common when everything is on layer "0").
  if (!layers.some(l => l.suggested === 'walls')) {
    const busiest = layers
      .filter(l => (l.suggested === 'ignore' || l.suggested === 'rooms') && !outside.has(l.name))
      .sort((a, b) => (b.counts.lines + b.counts.open + b.counts.closed) - (a.counts.lines + a.counts.open + a.counts.closed))[0];
    if (busiest && busiest.counts.lines + busiest.counts.open + busiest.counts.closed > 0) {
      busiest.suggested = 'walls'; busiest.confidence = 0.55; busiest.reason = 'Most line work in the drawing';
    }
  }

  return layers.sort((a, b) => entityTotal(b) - entityTotal(a));
}

const entityTotal = (l: LayerInfo) => Object.values(l.counts).reduce((s, n) => s + n, 0);
