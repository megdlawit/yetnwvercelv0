// What someone wants done to their map, in plain words → a small list of map
// changes. The phrase parser here understands it instantly, on the device; the
// same vocabulary is what our own assistant model (ml/, POST /assistant) is
// trained to answer in. References stay words here ("Room 1", "this", "it", "the
// elevator"); the editor resolves them against the map.

export type Direction = 'left' | 'right' | 'up' | 'down';

export type MapAction =
  | { op: 'connect'; from: string; to: string; accessible?: boolean }
  | { op: 'disconnect'; a: string; b?: string | null }
  | { op: 'block'; target: string }
  | { op: 'walkable'; target: string }
  | { op: 'add'; what: string; name?: string | null; near?: string | null; side?: Direction | null }
  | { op: 'move'; target: string; near?: string | null; direction?: Direction | null; amount?: 'little' | 'lot' | null }
  | { op: 'rename'; target: string; name: string }
  | { op: 'remove'; target: string }
  | { op: 'connect_floors'; via?: string | null; floor?: string | null }
  | { op: 'accessible'; target?: string | null }
  | { op: 'fix_all' }
  | { op: 'health' }
  | { op: 'undo' }
  | { op: 'show'; target: string }
  // ── Everything else the editor can do ──
  | { op: 'redo' }
  | { op: 'set_type'; target: string; kind: string }
  | { op: 'add_room'; name?: string | null; kind?: string | null; width?: number | null; depth?: number | null; near?: string | null; side?: Direction | null }
  | { op: 'resize'; target: string; width?: number | null; depth?: number | null; scale?: number | null }
  | { op: 'rotate'; target: string; degrees: number }
  | { op: 'duplicate'; target: string }
  /** 3D details: wall height / thickness / material, a room's floor finish or ceiling, the floor's ceiling height, Amharic names… */
  | { op: 'set_3d'; target: string; field: string; value: string }
  | { op: 'view'; mode: ViewMode }
  | { op: 'go_floor'; floor: string }
  | { op: 'fit' }
  | { op: 'setting'; setting: 'grid' | 'snap'; on?: boolean | null }
  | { op: 'tool'; tool: string }
  | { op: 'select'; target: string }
  | { op: 'publish' }
  | { op: 'open'; panel: Panel }
  | { op: 'measure'; from: string; to: string }
  | { op: 'list'; what?: string | null }
  | { op: 'describe'; target: string };

import { PLACE_WORDS } from './lexicon';

export type ViewMode = '2d' | '3d' | 'split';
export type Panel = 'import' | 'add_floor' | 'tour' | 'shortcuts' | 'world_map';

/** The editor's drawing tools, by the words people use for them. */
export const TOOL_WORDS: Record<string, string> = {
  wall: 'wall', walls: 'wall', door: 'door', doors: 'door', room: 'room', rooms: 'room', path: 'add-edge', paths: 'add-edge', route: 'add-edge',
  poi: 'add-node', place: 'add-node', places: 'add-node', point: 'add-node', object: 'object', objects: 'object', furniture: 'object',
  scenery: 'scenery', tree: 'scenery', trees: 'scenery', text: 'text', label: 'text', labels: 'text', measure: 'measure', ruler: 'measure',
  area: 'area', areas: 'area', select: 'select', pan: 'hand', hand: 'hand', eraser: 'delete', delete: 'delete',
  trim: 'trim', extend: 'extend', split: 'split', join: 'join', offset: 'offset',
};

/**
 * Every word the phrases below understand. Typos are corrected towards these ("grdi" → grid,
 * "liev" → live, "distacne" → distance), so a request typed fast still reads. intent.test.ts
 * checks this list against the phrases, so a new phrase can't leave its words out.
 */
export const PARSER_WORDS = `about above access accessibility accessible accessibly across actually add added afternoon all alright also amharic
  and another any anything are area around auto away back basement bathroom bathrooms bed behind below bench benches
  beside between big bigger bird bit block both boulder brick bring building bush bushes cad call called can carpet
  ceiling change changes check clear clockwise clone close closer concrete conference connect connected connection
  connects continue copy corridor could count counter create created cut delete describe deselect details disconnect
  distance door doors doorway down downstairs draw drawing drop duplicate dwg dxf east edit editor elevator elevators
  entire entrance entrances entry erase errors escalator evening every everything exit exits extra eye fact far farther
  file find fit fix flat floor floors flower flowers for fountain free from front full further garden gate get give
  glass goes good grab grass great grid half hallway have health height heights hello help here hey hide high how image
  import info insert inside instead into issues its join just keyboard kindly know lamp large larger last lawn left let
  lets level levels lift lifts light like line link linked links list little live locate location lot made main make
  many map marble mark meant measure meeting meters metres mind mistakes mode more morning move much must name named
  near nearer need network never new next north not nothing now object objects off office offices okay one onto open
  our out outdoor over overview palm path paths perspective pick pin place places plan plant planter plaster please pls
  plz pond pool position post pot problems publish put quarter question quick ramp reachable ready real really
  reception redo remove rename repair restroom restrooms return revert review rid right rock room rooms rotate route
  routes runs salam same satellite scale screen seat seating see selam select selection set shortcuts should show shrub
  size sketch slightly smaller snap some south spin split spot staircase staircases stairs stairway started step steps
  stone stop storage store storey story street supposed svg switch take tall tell test thanks that the them then there
  these thick thickness thing things this those three through tile time tiny toggle toilet toilets tool top touch tour
  tree trees turn twice undo unlink unselect upload upstairs use using utility venue via view visitors walk walkable
  walking walkway wall walls want was water way west what whatever wheelchair wheelchairs where which whole will window
  with wood world would wrong you zoom`;

/** Room kinds the editor knows ("meeting room" → meeting). */
export const ROOM_KINDS: [RegExp, string][] = [
  [/rest ?room|toilet|wc|bathroom|lavatory|washroom/, 'restroom'], [/reception|front desk|info(rmation)?( desk)?|lobby/, 'reception'],
  [/meeting|conference|board ?room|class ?room|seminar/, 'meeting'], [/entrance|entry|exit|gate/, 'entrance'], [/stair/, 'stairs'],
  [/elevator|lift/, 'elevator'], [/utility|storage|store ?room|server|electrical|plant|janitor|kitchen/, 'utility'], [/office|room|space|hall|gallery|shop|cafe|café/, 'office'],
];
/**
 * A room kind from its name: the patterns above, and the word bank's names for rooms when they
 * say no more than "a room" ("loo" → restroom, "guard house" → utility).
 */
export const roomKind = (w: string) => {
  const byPattern = ROOM_KINDS.find(([re]) => re.test(w.toLowerCase()))?.[1] ?? null;
  if (byPattern && byPattern !== 'office') return byPattern;
  return lexiconKind(w) ?? byPattern;
};
function lexiconKind(w: string): string | null {
  const t = ` ${w.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
  let best: { kind: string; len: number } | null = null;
  for (const [kind, names] of Object.entries(PLACE_WORDS)) {
    if (kind === 'office') continue;
    for (const n of names) if (t.includes(` ${n} `) && (!best || n.length > best.len)) best = { kind, len: n.length };
  }
  return best?.kind ?? null;
}

const num = (s: string | undefined) => (s == null ? null : Number(s.replace(',', '.')));
const SIZE = String.raw`(\d+(?:[.,]\d+)?)\s*(?:m|meters?|metres?)?\s*(?:x|by|×|\*)\s*(\d+(?:[.,]\d+)?)\s*(?:m|meters?|metres?)?`;

/** Words that point at what's selected / what was just talked about / where they clicked. */
export const THIS = 'this', IT = 'it', HERE = 'here';

const clean = (s: string) => s.trim().replace(/[.!?]+$/, '').replace(/^["“]|["”]$/g, '').trim();
/** "the main entrance" → "main entrance"; "this room" → this; "it" / "that" → it. */
export function ref(raw: string): string {
  const s = clean(raw).replace(/^(the|a|an|our|my)\s+/i, '');
  if (/^(this|this (one|room|place|area|hallway|corridor|path|spot|object|thing))$/i.test(s)) return THIS;
  if (/^(it|that|that one|that (room|place|path|one)|the same)$/i.test(s)) return IT;
  if (/^(here|there|this spot|over here)$/i.test(s)) return HERE;
  return s;
}

const DIR: Record<string, Direction> = { left: 'left', right: 'right', up: 'up', down: 'down', north: 'up', south: 'down', east: 'right', west: 'left', above: 'up', below: 'down' };

/**
 * The local understanding: common requests, phrased many ways. Returns null
 * when it doesn't recognise the request (then Claude gets a go, if set up).
 */
/**
 * Greetings and politeness around a request: "hi, connect Room 1 and Room 2",
 * "hey can u add a bench here pls", "good morning! fix everything, thanks".
 * Stripped before understanding, so they never send a request to the slow AI.
 */
const LEADING_SOCIAL = /^((hi|hii+|hello|hey|heya|hey there|hi there|yo|good (morning|afternoon|evening)|selam|salam|ሰላም|please|pls|plz|kindly|so|ok|okay|alright|right|um+|uh+|can (you|u)|could (you|u)|would you|will you|quick one|quick question|i want (you )?to|i'd like (you )?to|i need you to)[,!.:]?\s+)+/i;
const TRAILING_SOCIAL = /[,!.\s]+(please|pls|plz|thanks|thank you|thx|ty)[!.\s]*$/i;
export const stripSocial = (text: string) => text.replace(LEADING_SOCIAL, '').replace(TRAILING_SOCIAL, '').trim();

// Quick typing: "moev it nxet to the Library", "chcek the map", "go bakc". Only the command word at
// the start and a few fixed phrases are corrected — never names — and only when the text as typed
// isn't understood, so a real word ("lift is on both floors") is never "corrected".
const COMMAND_WORDS = ['move', 'connect', 'check', 'remove', 'delete', 'rename', 'where', 'show', 'undo', 'redo', 'copy', 'duplicate',
  'publish', 'rotate', 'resize', 'disconnect', 'make', 'block', 'list', 'describe', 'measure', 'import', 'select', 'bring', 'link',
  'place', 'create', 'insert', 'switch', 'zoom', 'open', 'draw'];
/** One letter wrong, missing or extra, or two neighbours swapped. */
function oneSlip(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const d = [...a].flatMap((c, i) => (c !== b[i] ? [i] : []));
    return d.length === 1 || (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]);
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return [...long].some((_, i) => long.slice(0, i) + long.slice(i + 1) === short);
}
export function fixTypos(text: string): string {
  const m = text.match(/^(\S+)([\s\S]*)$/);
  let out = text;
  if (m) {
    const w = m[1].toLowerCase();
    const word = w.length >= 3 && !COMMAND_WORDS.includes(w) ? COMMAND_WORDS.find(c => oneSlip(w, c)) : undefined;
    if (word) out = word + m[2];
  }
  return out.replace(/^go (bakc|bcak|abck|bak|backk|bck)$/i, 'go back');
}
/** Misspellings that are never a real word or name: safe to fix before parsing. */
const fixPhrases = (text: string) => text.replace(/\b(nxet|enxt|nexr|netx|nexy) to\b/gi, 'next to').replace(/\b(rihgt|rigth|rgiht|rght|riht) (here|there)\b/gi, 'right $2');

/** `names`: the map's names, when known — they tell where one name ends ("call Main Gate Book Shop instead"). */
export function parseIntent(input: string, names: readonly string[] = []): MapAction[] | null {
  const typed = fixPhrases(clean(stripSocial(input.replace(/\s+/g, ' '))));
  if (!typed) return null;
  const asTyped = parseText(typed, names);
  if (asTyped) return asTyped;
  const fixed = fixTypos(typed);
  return fixed !== typed ? parseText(fixed, names) : null;
}

function parseText(text: string, names: readonly string[]): MapAction[] | null {
  // Several requests in one: "add a reception near the entrance and connect it to room 1".
  const parts = text.split(/\s*(?:,?\s+and then\s+|;\s*|\.\s+|,?\s+then\s+|\s+and\s+(?=(?:connect|add|move|rename|remove|delete|make|link|put)\b))/i).filter(Boolean);
  if (parts.length > 1) {
    const all = parts.map(p => one(p, names));
    return all.every(Boolean) ? all.flat() as MapAction[] : null;
  }
  return one(text, names);
}

function one(raw: string, names: readonly string[]): MapAction[] | null {
  const t = clean(raw).replace(/^((please|can you|could you|i want to|i'd like to|let's|lets|now|ok|okay|also|and|then|great|thanks),?\s+)+/i, '').replace(/\s+please$/i, '');
  const l = t.toLowerCase();
  // Names keep the capitals they were typed with ("Room 1"), matching runs on lower case.
  const R = (s: string) => { const i = l.indexOf(s); return ref(i >= 0 ? t.slice(i, i + s.length) : s); };
  let m: RegExpMatchArray | null;

  // Undo.
  if (/^(undo( that| it| the last( change| one)?)?|go back|revert( that)?|take (that|it) back|never ?mind|actually,? (undo|remove|delete) (that|it|the (connection|path|change) (we|you|i) just (made|created|added)))$/i.test(l)) return [{ op: 'undo' }];
  // Fix / health.
  if (/^(fix (everything|it all|all( of it| issues| problems)?|the map|(what|whatever|all|everything) (you|u) can|all the (issues|problems))|auto ?fix|repair (the )?map)$/.test(l)) return [{ op: 'fix_all' }];
  if (/^(what('s| is) wrong|(check|review) (the |my )?map( for (me|problems|issues|errors|mistakes))?|map health|(is there )?anything wrong|(are there )?any (problems|issues)|is (the|my) map (ok|okay|ready|good))\??$/.test(l)) return [{ op: 'health' }];
  const editorAction = editorOne(t, l, R);
  if (editorAction) return editorAction;

  // Floors: "connect floor 1 to floor 2 using the elevator", "add the stairs between these floors", "the elevator is here on both floors".
  if ((m = l.match(/^(?:connect|link|join) (?:floor|level) ?(\w+) (?:and|to|with) (?:floor|level) ?(\w+)(?: (?:using|via|with|through|by) (?:the )?(.+))?$/))) {
    return [{ op: 'connect_floors', floor: m[2], via: m[3] ? R(m[3]) : null }];
  }
  if ((m = l.match(/^(?:add|put|connect) (?:the |a )?(elevator|lift|stairs|staircase|ramp|escalator) (?:between|across|to) (?:these|the|both) floors$/))) return [{ op: 'connect_floors', via: m[1], floor: null }];
  if ((m = l.match(/^(?:the )?(elevator|lift|stairs|staircase|ramp|escalator) (?:goes?|runs?|connects?|links?) (?:between |across )?(?:the |both |all )?(?:floors|levels)$/))) return [{ op: 'connect_floors', via: m[1], floor: null }];
  if ((m = l.match(/^(?:the )?(elevator|lift|stairs|staircase|ramp) (?:is|are) (?:here )?on (?:both|all|every) floors?$/))) return [{ op: 'connect_floors', via: m[1], floor: null }];
  if ((m = l.match(/^connect (?:this|it|the (elevator|lift|stairs)) to (?:the )?(?:floor|level) ?(\w+)$/))) return [{ op: 'connect_floors', via: m[1] ?? THIS, floor: m[2] }];
  // "connect the floors via the elevator" (the health check's own suggestion), "link floors with the stairs".
  if ((m = l.match(/^(?:connect|link|join) (?:the |these |both |all )?(?:floors|levels)(?: (?:via|using|with|through|by) (?:the )?(.+))?$/))) return [{ op: 'connect_floors', via: m[1] ? R(m[1]) : null, floor: null }];

  // Accessibility.
  if (/^(check|test|review) (the )?(accessibility|wheelchair access|step[- ]free access)( of (the|this) (map|floor))?$/.test(l)) return [{ op: 'accessible', target: null }];
  if (/(wheelchair|step[- ]free|accessible|avoid (the )?stairs|no stairs)/.test(l) && !/^add /.test(l)) {
    if ((m = l.match(/^(?:create|make|add) an? accessible (?:route|path|way) (?:to|for) (.+)$/))) return [{ op: 'accessible', target: R(m[1]) }];
    m = l.match(/(?:make|mark) (.+?) (?:wheelchair[- ]accessible|accessible|step[- ]free)/);
    const target = m ? R(m[1]) : IT;
    return [{ op: 'accessible', target }];
  }

  // Paths: remove / block.
  if ((m = l.match(/^(?:there should be )?no (?:walking |walkable )?(?:path|route|way)s? (?:through|across|in) (.+)$/)) ||
      (m = l.match(/^(?:block|close off|stop paths through|don't walk through|do not walk through) (.+)$/))) return [{ op: 'block', target: R(m[1]) }];
  if ((m = l.match(/^(?:remove|delete|cut|drop) (?:the )?(?:path|connection|route|link)s? (?:between|from) (.+?) (?:and|to) (.+)$/))) return [{ op: 'disconnect', a: R(m[1]), b: R(m[2]) }];
  if ((m = l.match(/^(?:remove|delete|cut) (?:the )?(?:path|connection|route|link)s? (?:through|in|across) (.+)$/))) return [{ op: 'block', target: R(m[1]) }];
  if ((m = l.match(/^(?:remove|delete|cut) (?:the |this |that )?(?:path|connection|route|link)s?(?: (?:of|at|to|from) (.+))?$/))) return [{ op: 'disconnect', a: m[1] ? R(m[1]) : THIS, b: null }];
  if (/^this path is wrong$/.test(l)) return [{ op: 'disconnect', a: THIS, b: null }];
  // "don't connect X and Y", "no path between X and Y": NOT a connect (a model could read "connect" and do it).
  if ((m = l.match(/^(?:don'?t|do not|never) (?:connect|link|join) (.+?) (?:and|to|with) (.+)$/)) ||
      (m = l.match(/^(?:there should be |there is )?no (?:walking |walkable )?(?:path|route|link|connection|way)s? (?:between (.+?) and|from (.+?) to) (.+)$/))) {
    const [a, b] = m[3] !== undefined ? [m[1] ?? m[2], m[3]] : [m[1], m[2]];
    return [{ op: 'disconnect', a: R(a), b: R(b) }];
  }
  if ((m = l.match(/^(?:disconnect|unlink) (.+?) (?:and|from) (.+)$/)) || (m = l.match(/^(.+?) and (.+?) (?:shouldn'?t|should not|must not|mustn'?t|don'?t need to) be (?:connected|linked)$/))) return [{ op: 'disconnect', a: R(m[1]), b: R(m[2]) }];
  // "put the Canteen on the walking routes" — onto the paths, not a new place called "canteen on the walking routes".
  if ((m = l.match(/^(?:put|add|connect|link|join) (.+?) (?:on|onto|to|into) (?:the )?(?:walking |walkable )?(?:routes?|paths?|path network)$/)) || (m = l.match(/^make (.+?) reachable$/))) return [{ op: 'walkable', target: R(m[1]) }];

  // Paths: connect.
  if ((m = l.match(/^(?:connect|link|join) (.+?) to (.+?) and (.+?) to (.+)$/))) {
    return [{ op: 'connect', from: R(m[1]), to: R(m[2]), accessible: false }, { op: 'connect', from: R(m[3]), to: R(m[4]), accessible: false }];
  }
  if ((m = l.match(/^(?:there should be a (?:connection|path|route|way) between|(?:create|make|add|draw) (?:a |the )?(?:path|route|connection|walkway|link) (?:between|from)|connect|link|join|join up|route) (.+?) (?:and|to|with|&) (.+?)( (?:accessibly|step[- ]free|for wheelchairs))?$/))) {
    return [{ op: 'connect', from: R(m[1]), to: R(m[2]), accessible: !!m[3] }];
  }
  if ((m = l.match(/^(?:connect|link) (?!(?:them|these|those|everything|it all|all)$)(.+)$/))) return [{ op: 'connect', from: THIS, to: R(m[1]) }];
  if ((m = l.match(/^(?:make|mark) (.+?) walkable$/)) || (m = l.match(/^(.+?) should be walkable$/)) || (m = l.match(/^the (?:hallway|corridor|path) should continue (here|there)$/))) {
    return [{ op: 'walkable', target: R(m[1]) }];
  }

  // Rename. "call Main Gate Book Shop instead": the map's names say where the old name ends.
  if ((m = l.match(/^(?:call|name|rename) (.+) (?:instead|from now on)$/))) {
    const said = m[1];
    const known = [...names].map(n => n.toLowerCase()).filter(n => said.startsWith(`${n} `)).sort((a, b) => b.length - a.length)[0];
    if (known) return [{ op: 'rename', target: R(known), name: titleCase(clean(t.slice(l.indexOf(said) + known.length + 1, l.indexOf(said) + said.length))) }];
  }
  if ((m = l.match(/^(?:rename|call|name) (.+?) (?:to|as) (.+)$/)) || (m = l.match(/^(.+?) should be (?:called|named) (.+)$/)) || (m = l.match(/^change the name of (.+?) to (.+)$/))) {
    return [{ op: 'rename', target: R(m[1]), name: titleCase(clean(t.slice(t.toLowerCase().lastIndexOf(m[2])))) }];
  }

  // Move.
  if ((m = l.match(/^(?:the )?(.+?) is (?:actually )?(?:over )?(here|there)$/))) return [{ op: 'move', target: R(m[1]), near: HERE }];
  if ((m = l.match(/^move (.+?) (a (?:little|bit|touch|tiny bit)|slightly|a lot|far|much) (?:to the |more |further |farther )?(left|right|up|down|north|south|east|west)$/))) {
    return [{ op: 'move', target: R(m[1]), direction: DIR[m[3]], amount: /lot|far|much/.test(m[2]) ? 'lot' : 'little' }];
  }
  if ((m = l.match(/^move (.+?) (?:to the |more |further )?(left|right|up|down|north|south|east|west)$/))) return [{ op: 'move', target: R(m[1]), direction: DIR[m[2]], amount: null }];
  if ((m = l.match(/^move (.+?) (?:closer to|nearer to|near|next to|beside|by|to) (.+)$/))) return [{ op: 'move', target: R(m[1]), near: R(m[2]) }];
  if ((m = l.match(/^move (.+?) (here|there)$/))) return [{ op: 'move', target: R(m[1]), near: HERE }];

  // Remove.
  if ((m = l.match(/^(?:remove|delete|get rid of|take away|erase) (.+?)(?: from (?:the |this )?(?:map|floor|plan))?$/))) return [{ op: 'remove', target: R(m[1]) }];

  // Show.
  if ((m = l.match(/^(?:show(?: me)?|where is|where's|find|zoom (?:in )?to|go to|select) (.+?)\??$/))) return [{ op: 'show', target: R(m[1]) }];

  // Add: "add a restroom next to room 3", "put a reception here", "add another entrance here".
  // "make" adds only with an article ("make a bench"): "make it live" / "make it nicer" are something else.
  if ((m = l.match(/^(?:(?:add|put|place|create|insert|i need|we need|there should be) (?:a |an |another |one more |the |some )?|make (?:a |an |another |one more |some ))(.+?)(?: (?:called|named) (.+?))?(?: (?:right )?(here|there)| (?:next to|near|beside|by|close to|at|in|inside) (.+?)| (?:to the |on the )?(left|right) of (.+?)| (above|below|behind|in front of) (.+?))?$/))) {
    const what = m[1].trim();
    if (!what || /^(path|connection|route)$/.test(what)) return null;
    const near = m[3] ? HERE : m[4] ? R(m[4]) : m[6] ? R(m[6]) : m[8] ? R(m[8]) : null;
    const side = (m[5] ? DIR[m[5]] : m[7] ? ({ above: 'up', below: 'down', behind: 'up', 'in front of': 'down' } as Record<string, Direction>)[m[7]] : null) ?? null;
    return [{ op: 'add', what, name: m[2] ? titleCase(m[2]) : null, near, side }];
  }
  return null;
}

/** The rest of the editor: views, floors, tools, sizes, rotation, 3D details, questions. */
function editorOne(t: string, l: string, R: (s: string) => string): MapAction[] | null {
  let m: RegExpMatchArray | null;
  if (/^(redo( that| it)?|(bring|put) (that|it) back|undo (the |my )?undo)$/.test(l)) return [{ op: 'redo' }];
  if (/^(publish( (it|the map|the venue|my map|my venue|(the |my )?changes|now))?( for visitors)?|(make|put) (it|the map|the venue|my map) live( for visitors| now)?|go live( now)?)$/.test(l)) return [{ op: 'publish' }];

  // Views and the camera.
  if ((m = l.match(/^(?:switch (?:back )?to |show(?: me)?(?: it)?(?: in)? |go (?:back )?to |back to |return to |open |view(?: it)? in |see (?:it )?in |change to |put it in )?(?:the )?(2d|3d|split)(?: view| mode| screen| please)?$/))) return [{ op: 'view', mode: m[1] as ViewMode }];
  if (/^(flat|top down|top-down|plan|from above)( view)?$/.test(l)) return [{ op: 'view', mode: '2d' }];
  if (/^(3d|three d|perspective|bird'?s? eye)( view)?$/.test(l)) return [{ op: 'view', mode: '3d' }];
  if (/^(fit|zoom to fit|fit (the )?(plan|map|floor|everything)|show (me )?(the )?(whole|entire|full) (plan|map|floor)|zoom (all the way )?out|see everything)$/.test(l)) return [{ op: 'fit' }];
  if ((m = l.match(/^(?:go|move|switch|take me) (up|down)(?:stairs| a floor| one floor)?$/)) || (m = l.match(/^(?:go )?(upstairs|downstairs)$/))) return [{ op: 'go_floor', floor: m[1].startsWith('up') ? 'up' : 'down' }];
  if ((m = l.match(/^(?:go to|open|switch to|show(?: me)?|edit) (?:the )?((?:floor|level) ?\w+(?: floor)?|basement|\w+ floor)$/))) return [{ op: 'go_floor', floor: m[1].replace(/ floor$/, '').replace(/^(floor|level) ?/, '') }];

  // Settings and tools.
  if ((m = l.match(/^(?:turn|switch) (on|off) (?:the )?(grid|snap(?:ping)?)$/)) || (m = l.match(/^(?:turn|switch) (?:the )?(grid|snap(?:ping)?) (on|off)$/))) {
    const on = m[1] === 'on' || m[2] === 'on';
    return [{ op: 'setting', setting: /grid/.test(m[0]) ? 'grid' : 'snap', on }];
  }
  if ((m = l.match(/^(show|hide|toggle) (?:the )?(grid|snap(?:ping)?)$/))) return [{ op: 'setting', setting: m[2] === 'grid' ? 'grid' : 'snap', on: m[1] === 'toggle' ? null : m[1] === 'show' }];
  if ((m = l.match(/^(?:i want to |let me |i'll |i will |time to )?(?:draw|sketch|use the|pick the|select the|switch to the) (?:a |an |some |the )?(\w+)(?: tool)?$/)) && TOOL_WORDS[m[1]]) return [{ op: 'tool', tool: TOOL_WORDS[m[1]] }];
  if ((m = l.match(/^(?:(?:use|pick|grab|give me|open|i need|switch to|select) (?:the |a )?)?(\w+) tool$/)) && TOOL_WORDS[m[1]]) return [{ op: 'tool', tool: TOOL_WORDS[m[1]] }];
  if (/^(measure|let me measure)$/.test(l)) return [{ op: 'tool', tool: 'measure' }];
  if (/^select (all|everything)( on this floor)?$/.test(l)) return [{ op: 'select', target: 'all' }];
  if (/^(deselect|clear (the )?selection|select nothing|unselect)( all| everything)?$/.test(l)) return [{ op: 'select', target: 'none' }];

  // Panels.
  if (/^(import|upload|bring in) (a |my |the )?(cad|dwg|dxf|floor ?plan|plan|drawing|file|svg|image)/.test(l)) return [{ op: 'open', panel: 'import' }];
  if (/^(add|create|make) (a |an |another )?(new |more |extra )?(floor|flor|foor|floo|level|storey|story)s?( above| below)?$/.test(l)) return [{ op: 'open', panel: 'add_floor' }];
  if (/^((show|give) me (a |the )?tour|take the tour|how do i use (this|the editor)|help me get started|show me around)$/.test(l)) return [{ op: 'open', panel: 'tour' }];
  if (/^((keyboard )?shortcuts|show (the )?(keyboard )?shortcuts)$/.test(l)) return [{ op: 'open', panel: 'shortcuts' }];
  if (/^((place|put|position|locate|pin|line up) (it|this|the venue|the building|my venue|the plan|the map)? ?(on|onto) (the )?(world|real|outdoor|street|satellite) ?map|set (the )?(venue'?s? )?location|place on (the )?world map|where is (the venue|it) on the (world )?map)$/.test(l)) return [{ op: 'open', panel: 'world_map' }];

  // Rooms with a size: "add a 6 by 4 m meeting room called Board Room next to reception".
  if ((m = l.match(new RegExp(`^(?:add|create|draw|make|put|insert) (?:a |an |another )?${SIZE} (.+?)(?: (?:called|named) (.+?))?(?: (here|there)| (?:next to|near|beside|by) (.+))?$`)))) {
    const [, w, dd, what, name, here, near] = m;
    const nameOrig = name ? titleCase(t.slice(l.lastIndexOf(name), l.lastIndexOf(name) + name.length)) : null;
    return [{ op: 'add_room', width: num(w), depth: num(dd), kind: roomKind(what), name: nameOrig ?? titleCase(what.replace(/\s+room$/, ' room')), near: here ? HERE : near ? R(near) : null, side: null }];
  }
  if ((m = l.match(/^(?:add|create|draw|make) (?:a |an |another )?(?:new )?room(?: (?:called|named) (.+?))?(?: (here|there)| (?:next to|near|beside|by) (.+))?$/))) {
    const name = m[1] ? titleCase(t.slice(l.indexOf(m[1]), l.indexOf(m[1]) + m[1].length)) : null;
    return [{ op: 'add_room', name, kind: name ? roomKind(name) : null, width: null, depth: null, near: m[2] ? HERE : m[3] ? R(m[3]) : null, side: null }];
  }

  // 3D details.
  if ((m = l.match(/^(?:make|set) (?:all )?(?:of )?(?:the |these |this )?(walls?|wall heights?)(?: on this floor)? (?:to )?(\d+(?:[.,]\d+)?) ?(?:m|meters?|metres?)?(?: (?:high|tall))?$/))) return [{ op: 'set_3d', target: /this|these/.test(l) ? THIS : 'walls', field: 'height', value: m[2] }];
  if ((m = l.match(/^(?:the )?walls? height (?:to |of |= ?|is )?(\d+(?:[.,]\d+)?) ?(?:m|meters?|metres?)?$/)) || (m = l.match(/^(?:the )?walls? (?:should be )?(\d+(?:[.,]\d+)?) ?(?:m|meters?|metres?) (?:high|tall)$/))) return [{ op: 'set_3d', target: 'walls', field: 'height', value: m[1] }];
  if ((m = l.match(/^(?:make|set) (?:all )?(?:the |these |this )?walls? (?:to )?(?:be )?(plaster|brick|concrete|glass|wood(?:en)?|stone)$/))) return [{ op: 'set_3d', target: /this|these/.test(l) ? THIS : 'walls', field: 'material', value: m[1].replace('wooden', 'wood') }];
  if ((m = l.match(/^(?:make|set) (?:the )?(?:wall )?thickness(?: of (?:the )?walls?)? (?:to )?(\d+(?:[.,]\d+)?) ?(?:m|cm)?$/)) || (m = l.match(/^(?:make|set) (?:all )?(?:the |these |this )?walls? (\d+(?:[.,]\d+)?) ?(?:m|meters?|metres?) thick$/))) return [{ op: 'set_3d', target: /this|these/.test(l) ? THIS : 'walls', field: 'thickness', value: m[1] }];
  if ((m = l.match(/^(?:make|set) (?:the )?ceiling(?: height)?(?: of this floor)? (?:to )?(\d+(?:[.,]\d+)?) ?(?:m|meters?|metres?)?(?: (?:high|tall))?$/))) return [{ op: 'set_3d', target: 'floor', field: 'ceiling', value: m[1] }];
  if ((m = l.match(/^(?:give|make) (.+?) (?:a )?(tile|wood(?:en)?|carpet(?:ed)?|concrete|stone|marble|grass) floor(?:ing)?$/)) || (m = l.match(/^(?:make|set) (?:the )?floor(?:ing)? (?:of|in) (.+?) (?:to )?(tile|wood|carpet|concrete|stone|marble|grass)$/))) {
    return [{ op: 'set_3d', target: R(m[1]), field: 'floor_material', value: m[2].replace(/en$|ed$/, '') }];
  }
  if ((m = l.match(/^(?:the )?amharic name (?:of|for) (.+?) is (.+)$/)) || (m = l.match(/^(?:call|name) (.+?) (.+?) in amharic$/))) return [{ op: 'set_3d', target: R(m[1]), field: 'amharic', value: t.slice(l.lastIndexOf(m[2]), l.lastIndexOf(m[2]) + m[2].length).trim() }];

  // Size, rotation, copies.
  if ((m = l.match(new RegExp(`^(?:make|resize|set|change) (.+?) (?:to |into )?(?:be )?${SIZE}$`)))) return [{ op: 'resize', target: R(m[1]), width: num(m[2]), depth: num(m[3]) }];
  if ((m = l.match(/^(?:make|scale) (.+?) (bigger|larger|smaller|twice as (?:big|large)|half (?:the|its) size|(?:a (?:little|bit) )?(?:bigger|smaller))$/))) {
    const s = /twice/.test(m[2]) ? 2 : /half/.test(m[2]) ? 0.5 : /little|bit/.test(m[2]) ? (/smaller/.test(m[2]) ? 0.9 : 1.1) : /smaller/.test(m[2]) ? 0.8 : 1.25;
    return [{ op: 'resize', target: R(m[1]), scale: s }];
  }
  if ((m = l.match(/^(?:rotate|turn|spin) (.+?) (?:by )?(-?\d+(?:\.\d+)?) ?(?:°|deg(?:rees?)?)?( (?:counter-?|anti-?)clockwise| clockwise| left| right)?$/))) {
    const deg = Number(m[2]) * (/counter|anti|left/.test(m[3] ?? '') ? -1 : 1);
    return [{ op: 'rotate', target: R(m[1]), degrees: deg }];
  }
  if ((m = l.match(/^(?:rotate|turn) (.+?) (?:a )?(quarter|half)(?: turn)?$/))) return [{ op: 'rotate', target: R(m[1]), degrees: m[2] === 'half' ? 180 : 90 }];
  if ((m = l.match(/^(?:duplicate|copy|clone|make a copy of) (.+)$/))) return [{ op: 'duplicate', target: R(m[1]) }];

  // Kinds: "make room 3 a restroom", "this is the reception", "room 2 is a meeting room".
  if ((m = l.match(/^(?:make|set|mark|change|turn) (.+?) (?:as |to be |into |to )?(?:a |an |the )?(office|meeting room|meeting|conference room|entrance|stairs|staircase|elevator|lift|restroom|toilet|bathroom|reception|utility room|utility|storage)(?: room)?$/)) ||
      (m = l.match(/^(.+?) (?:is|should be|was supposed to be|is supposed to be) (?:actually |really |meant to be |in fact )?(?:a |an |the )?(office|meeting room|meeting|conference room|entrance|stairs|staircase|elevator|lift|restroom|toilet|bathroom|reception|utility room|utility|storage|store room)$/))) {
    return [{ op: 'set_type', target: R(m[1]), kind: roomKind(m[2]) ?? m[2] }];
  }

  // Questions about the map.
  if ((m = l.match(/^(?:how far(?: is it)?|what(?:'s| is) the distance|distance) (?:from|between) (.+?) (?:to|and) (.+?)\??$/))) return [{ op: 'measure', from: R(m[1]), to: R(m[2]) }];
  if ((m = l.match(/^how far (?:away )?is (.+?) from (.+?)\??$/))) return [{ op: 'measure', from: R(m[2]), to: R(m[1]) }];
  if ((m = l.match(/^(?:how many|count(?: the)?|list(?: all)?(?: the)?|which|show me all(?: the)?|what) (rooms?|places?|pois?|objects?|things|restrooms?|toilets?|entrances?|exits?|elevators?|lifts?|stairs|staircases?|doors?|walls?|paths?|floors?|offices?|meeting rooms?|trees?|benches?)(?: are there| do (?:i|we) have| are on this floor| on this floor| here)?\??$/))) return [{ op: 'list', what: m[1] }];
  // "where are the toilets" — all of them, not one place called "the toilets".
  if ((m = l.match(/^where are (?:the |all the |all )?(restrooms|toilets|bathrooms|entrances|exits|elevators|lifts|stairs|staircases|offices|meeting rooms|doors|benches|trees)\??$/))) return [{ op: 'list', what: m[1] }];
  if (/^(what('s| is) (on|in) (this|the) (floor|map|plan)|summar(y|ize|ise)( (the|this) (map|floor))?|overview|give me an overview)\??$/.test(l)) return [{ op: 'list', what: null }];
  if ((m = l.match(/^(?:tell me about|describe|info(?:rmation)? (?:on|about)|details (?:of|for|about)|what do you know about) (.+?)\??$/))) return [{ op: 'describe', target: R(m[1]) }];
  return null;
}

export const titleCase = (s: string) => s.replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase());

/** What kind of thing an "add" is: a place visitors go to, an entrance, a map object, or scenery. */
export type AddKind = { type: 'place'; name: string; placeType: string } | { type: 'entrance'; name: string } | { type: 'feature'; feature: string; name: string };

const FEATURES: [RegExp, string][] = [
  [/^(elevator|lift)s?$/, 'elevator'], [/^(stairs|staircase|stairway|steps)$/, 'stairs'], [/^(tree|trees)$/, 'tree'], [/^palm( tree)?$/, 'palm'],
  [/^(bench|benches|seat|seating)$/, 'bench'], [/^(fountain)$/, 'fountain'], [/^(lamp|light|lamp post|street light)$/, 'lamp'],
  [/^(flowers?|flower bed|garden bed)$/, 'flowers'], [/^(lawn|grass)$/, 'grass'], [/^(pond|pool|water)$/, 'water'], [/^(rock|boulder)$/, 'rock'],
  [/^(shrub|bush|bushes)$/, 'shrub'], [/^(planter|plant pot)$/, 'planter'], [/^(door|doorway)$/, 'door'], [/^(window)$/, 'window'],
];
const PLACE_TYPES: [RegExp, string][] = [
  [/rest ?room|toilet|wc|bathroom|lavatory|washroom/, 'restroom'], [/reception|front desk|check[- ]?in/, 'reception'], [/info(rmation)?( desk| point)?/, 'reception'],
  [/cafe|café|coffee|restaurant|canteen|food|snack/, 'cafe'], [/shop|store|gift/, 'shop'], [/meeting|conference|board ?room/, 'meeting'],
  [/office/, 'office'], [/elevator|lift/, 'elevator'], [/stair/, 'stairs'], [/exhibit|gallery|museum/, 'exhibit'], [/prayer|mosque|chapel/, 'prayer'],
  [/parking/, 'parking'], [/first aid|clinic|medical/, 'first-aid'],
];

export function addKind(what: string, name?: string | null): AddKind {
  const w = what.toLowerCase().trim();
  if (/^(main )?(entrance|entry|exit|gate|way in)$/.test(w) || /entrance|gate$/.test(w)) return { type: 'entrance', name: name ?? titleCase(w.replace(/^entry$/, 'entrance')) };
  for (const [re, f] of FEATURES) if (re.test(w)) return { type: 'feature', feature: f, name: name ?? titleCase(w) };
  const t = PLACE_TYPES.find(([re]) => re.test(w))?.[1] ?? 'place';
  return { type: 'place', name: name ?? titleCase(w), placeType: t };
}

/**
 * A safety net for model answers (local, free or Claude): a request that says NOT to connect
 * ("don't link…", "X and Y shouldn't be connected", "no path between…") never gets a connect
 * action — the opposite of what was asked. Such an answer becomes one question back.
 */
export function guardModelActions(said: string, actions: MapAction[]): { actions: MapAction[]; reply: string | null } {
  const l = said.toLowerCase();
  const negated = /\b(?:don'?t|do not|never) (?:connect|link|join)\b/.test(l)
    || /\b(?:shouldn'?t|should not|must not|mustn'?t|not|never) (?:be )?(?:connected|linked|joined)\b/.test(l)
    || /\bno (?:walking |walkable )?(?:path|route|link|connection|way)s? (?:between|from)\b/.test(l);
  if (negated && actions.some(a => a.op === 'connect')) {
    return { actions: [], reply: 'Just to be sure — do you want those places disconnected (no path between them)? Say “disconnect A and B”.' };
  }
  return { actions, reply: null };
}
