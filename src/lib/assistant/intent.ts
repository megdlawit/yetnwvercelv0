// What someone wants done to their map, in plain words → a small list of map
// changes. The same vocabulary is used by the local phrase parser (instant,
// offline) and by Claude (api/map-assistant) for anything the parser doesn't
// recognise. References stay words here ("Room 1", "this", "it", "the
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
  | { op: 'show'; target: string };

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
export function parseIntent(input: string): MapAction[] | null {
  const text = clean(input.replace(/\s+/g, ' '));
  if (!text) return null;
  // Several requests in one: "add a reception near the entrance and connect it to room 1".
  const parts = text.split(/\s*(?:,?\s+and then\s+|;\s*|\.\s+|,?\s+then\s+|\s+and\s+(?=(?:connect|add|move|rename|remove|delete|make|link|put)\b))/i).filter(Boolean);
  if (parts.length > 1) {
    const all = parts.map(one);
    return all.every(Boolean) ? all.flat() as MapAction[] : null;
  }
  return one(text);
}

function one(raw: string): MapAction[] | null {
  const t = clean(raw).replace(/^((please|can you|could you|i want to|i'd like to|let's|lets|now|ok|okay|also|and|then|great|thanks),?\s+)+/i, '').replace(/\s+please$/i, '');
  const l = t.toLowerCase();
  // Names keep the capitals they were typed with ("Room 1"), matching runs on lower case.
  const R = (s: string) => { const i = l.indexOf(s); return ref(i >= 0 ? t.slice(i, i + s.length) : s); };
  let m: RegExpMatchArray | null;

  // Undo.
  if (/^(undo( that| it| the last( change| one)?)?|go back|revert( that)?|take (that|it) back|never ?mind|actually,? (undo|remove|delete) (that|it|the (connection|path|change) (we|you|i) just (made|created|added)))$/i.test(l)) return [{ op: 'undo' }];
  // Fix / health.
  if (/^(fix (everything|it all|all( of it| issues| problems)?|the map|what you can|all the (issues|problems))|auto ?fix|repair (the )?map)$/.test(l)) return [{ op: 'fix_all' }];
  if (/^(what('s| is) wrong|(check|review) (the |my )?map|map health|(are there )?any (problems|issues)|is (the|my) map (ok|okay|ready|good))\??$/.test(l)) return [{ op: 'health' }];

  // Floors: "connect floor 1 to floor 2 using the elevator", "add the stairs between these floors", "the elevator is here on both floors".
  if ((m = l.match(/^(?:connect|link|join) (?:floor|level) ?(\w+) (?:and|to|with) (?:floor|level) ?(\w+)(?: (?:using|via|with|through|by) (?:the )?(.+))?$/))) {
    return [{ op: 'connect_floors', floor: m[2], via: m[3] ? R(m[3]) : null }];
  }
  if ((m = l.match(/^(?:add|put|connect) (?:the |a )?(elevator|lift|stairs|staircase|ramp|escalator) (?:between|across|to) (?:these|the|both) floors$/))) return [{ op: 'connect_floors', via: m[1], floor: null }];
  if ((m = l.match(/^(?:the )?(elevator|lift|stairs|staircase|ramp) (?:is|are) (?:here )?on (?:both|all|every) floors?$/))) return [{ op: 'connect_floors', via: m[1], floor: null }];
  if ((m = l.match(/^connect (?:this|it|the (elevator|lift|stairs)) to (?:the )?(?:floor|level) ?(\w+)$/))) return [{ op: 'connect_floors', via: m[1] ?? THIS, floor: m[2] }];

  // Accessibility.
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

  // Paths: connect.
  if ((m = l.match(/^(?:there should be a (?:connection|path|route|way) between|(?:create|make|add|draw) (?:a |the )?(?:path|route|connection|walkway|link) (?:between|from)|connect|link|join|join up|route) (.+?) (?:and|to|with|&) (.+?)( (?:accessibly|step[- ]free|for wheelchairs))?$/))) {
    return [{ op: 'connect', from: R(m[1]), to: R(m[2]), accessible: !!m[3] }];
  }
  if ((m = l.match(/^(?:connect|link) (.+)$/))) return [{ op: 'connect', from: THIS, to: R(m[1]) }];
  if ((m = l.match(/^(?:make|mark) (.+?) walkable$/)) || (m = l.match(/^(.+?) should be walkable$/)) || (m = l.match(/^the (?:hallway|corridor|path) should continue (here|there)$/))) {
    return [{ op: 'walkable', target: R(m[1]) }];
  }

  // Rename.
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
  if ((m = l.match(/^(?:remove|delete|get rid of|take away|erase) (.+)$/))) return [{ op: 'remove', target: R(m[1]) }];

  // Show.
  if ((m = l.match(/^(?:show(?: me)?|where is|where's|find|zoom (?:in )?to|go to|select) (.+?)\??$/))) return [{ op: 'show', target: R(m[1]) }];

  // Add: "add a restroom next to room 3", "put a reception here", "add another entrance here".
  if ((m = l.match(/^(?:add|put|place|create|make|insert|i need|we need|there should be) (?:a |an |another |one more |the |some )?(.+?)(?: (?:called|named) (.+?))?(?: (here|there)| (?:next to|near|beside|by|close to|at|in|inside) (.+?)| (?:to the |on the )?(left|right) of (.+?)| (above|below|behind|in front of) (.+?))?$/))) {
    const what = m[1].trim();
    if (!what || /^(path|connection|route)$/.test(what)) return null;
    const near = m[3] ? HERE : m[4] ? R(m[4]) : m[6] ? R(m[6]) : m[8] ? R(m[8]) : null;
    const side = (m[5] ? DIR[m[5]] : m[7] ? ({ above: 'up', below: 'down', behind: 'up', 'in front of': 'down' } as Record<string, Direction>)[m[7]] : null) ?? null;
    return [{ op: 'add', what, name: m[2] ? titleCase(m[2]) : null, near, side }];
  }
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
