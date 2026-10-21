// Questions about Yet New itself — "what's a room?", "how do I publish?" —
// answered instantly and locally, from what the product really does (the
// docs pages), never guessed by the AI. Only questions: "add a room" is a
// request and goes to the editor; "what is Room 1?" is about a place on the
// map and goes to the engine (describe).

import type { Chip } from './engine';

export interface Knowledge { topic: string; reply: string; chips: Chip[] }

interface Topic {
  id: string;
  /** The thing asked about, as people name it ("room", "rooms", "walkable path"…). */
  nouns: string;
  /** How-to questions after "how do I / how can I / how to / where do I / can I". */
  how?: string;
  reply: string;
  chips?: Chip[];
}

const chip = (label: string, say = label): Chip => ({ label, say });

const TOPICS: Topic[] = [
  {
    id: 'yetnew', nouns: 'yet ?new|this app|this (?:website|site|platform|tool)',
    reply: 'Yet New makes indoor and outdoor maps that walk people to the door. You build your venue’s map here — floors, rooms, places and the paths between them — and visitors open it from a QR code or link to search for a place and get turn-by-turn directions.',
    chips: [chip('What can you do?'), chip('Show me around')],
  },
  {
    id: 'room', nouns: 'rooms?', how: '(?:add|make|create|draw) (?:a |an |new )?rooms?',
    reply: 'A room is an enclosed space on a floor — an office, a shop, a restroom, a hall. Visitors search for rooms by name and get directions to them. Rooms come from your imported floor plan, or you add them: say “Add a 6 by 4 m meeting room near the lobby”.',
    chips: [chip('Add a 6 by 4 m room'), chip('List all rooms')],
  },
  {
    id: 'place', nouns: 'places?|points? of interest|pois?',
    how: '(?:add|make|create) (?:a |an |new )?(?:place|point of interest|poi)',
    reply: 'A place is anything visitors can find that isn’t a whole room — an entrance, info desk, ATM, exhibit or bench. Places and rooms both show in search, and every place needs to be on the walking paths so visitors can get directions to it.',
    chips: [chip('Add a restroom here')],
  },
  {
    id: 'paths', nouns: '(?:walkable |walking )?paths?|walkable (?:area|routes?)|walking routes?|routes?|walkways?|navigation (?:paths?|graph)|the graph',
    how: '(?:add|make|draw|connect|create) (?:a |the )?(?:walkable |walking )?paths?|connect (?:places|rooms)',
    reply: 'Walkable paths are the lines visitors’ directions follow — along corridors and through doors. The import builds them from your walls and doors. Every room and place must be connected to them, or visitors can’t be guided there; “Fix everything” connects the ones that aren’t.',
    chips: [chip('Fix everything'), chip("What's wrong?")],
  },
  {
    id: 'door', nouns: 'doors?|doorways?|openings?',
    how: '(?:add|put|place|make) (?:a |an )?(?:door|doorway|opening)',
    reply: 'Doors are where paths go through walls — a room without a door or opening can’t be reached. Add one with the Door tool, or click the wall and say “add a door here”.',
    chips: [chip('Add a door here')],
  },
  {
    id: 'floor', nouns: 'floors?|levels?|storeys?|stories|stor(?:e)?ys?',
    how: '(?:add|make|create) (?:a |an |another |new )?(?:floor|level|storey|story)|(?:switch|change|go to) (?:the )?(?:floor|level)',
    reply: 'Each storey of the building is a floor. Switch floors with the floor buttons, or say “go to the first floor”; add one with “Add a new floor”. Importing a drawing that holds several floor plans creates all the floors at once. Stairs and elevators link the floors: “Connect the floors via the elevator”.',
    chips: [chip('Add a new floor'), chip('Connect the floors via the elevator')],
  },
  {
    id: 'layer', nouns: '(?:cad |drawing )?layers?|layer labels?',
    how: '(?:label|review|confirm) (?:the )?layers?',
    reply: 'CAD drawings keep different things on different layers — walls, doors, furniture, text. When you import a drawing, Yet New suggests what each layer is. Check that the preview looks like your building, then click “Looks right — confirm all”; you can change any layer’s label first.',
    chips: [chip('Import my floor plan')],
  },
  {
    id: 'import', nouns: '(?:the )?import|importing|cad import',
    how: '(?:import|upload|add|bring in|use|load) (?:my |a |the |our )?(?:floor ?plans?|plans?|drawings?|dwg|dxf|cad(?: files?| drawings?)?|files?|pdf|ifc)',
    reply: 'Open Import CAD and drop in your file — DWG, DXF, PDF, IFC or a 3D model. Walls, rooms, doors, stairs and lifts are recognised; a sheet with several floor plans becomes several floors. Check the preview, confirm the layers, and the map is built with its walking paths.',
    chips: [chip('Import my floor plan')],
  },
  {
    id: 'publish', nouns: 'publish(?:ing)?|going live',
    how: '(?:publish|go live|make (?:it|the map|my map) (?:live|public)|share (?:it|the map) with visitors)',
    reply: 'Publishing puts your map live for visitors — say “publish” or use the Publish button. A new institution’s first publish is checked by the Yet New team; you can keep editing meanwhile, and the version you publish last is the one that goes live.',
    chips: [chip('Publish the map', 'Publish it')],
  },
  {
    id: 'health', nouns: 'health|(?:the )?health badge|fix everything|problems?|issues?|warnings?',
    how: '(?:fix|repair|solve) (?:the )?(?:problems?|issues?|map|errors?|warnings?)',
    reply: 'The health badge lists what would stop visitors from being guided: places not on the walking paths, paths through walls, rooms with no door. Say “What’s wrong?” to see them, and “Fix everything” to repair what can be repaired automatically — I’ll tell you what’s left for you.',
    chips: [chip("What's wrong?"), chip('Fix everything')],
  },
  {
    id: 'undo', nouns: 'undo|redo',
    how: '(?:undo|go back|take (?:it|that) back|revert|redo)',
    reply: 'Every change can be undone: say “undo” (or press Ctrl+Z). “Redo” brings it back.',
    chips: [chip('Undo')],
  },
  {
    id: '3d', nouns: '3d(?: view| mode)?|three d',
    how: '(?:see|view|show|look at) (?:it |the map |my map )?(?:in )?3d|(?:switch|go) (?:to )?3d',
    reply: '3D shows your floors as a model you can turn and tilt — say “Show it in 3D”, and “back to 2D” for the flat plan. Visitors can switch views too.',
    chips: [chip('Show it in 3D')],
  },
  {
    id: 'access', nouns: 'step ?free(?: routes?)?|wheelchair access(?:ibility)?|accessibility|accessible routes?',
    how: '(?:make|check) (?:it |the map )?(?:step ?free|accessible|wheelchair (?:friendly|accessible))',
    reply: 'Step-free routes avoid stairs, for wheelchairs and prams. Add an elevator or ramp on each floor, say “Connect the floors via the elevator”, then “Check wheelchair access” confirms every floor can be reached without steps.',
    chips: [chip('Check wheelchair access')],
  },
  {
    id: 'qr', nouns: 'qr(?: codes?)?',
    how: '(?:get|print|make|use) (?:a |the )?qr(?: codes?)?',
    reply: 'QR codes go at gates, entrances and exhibits. Scanning one opens your map with “You are here” already set to that spot. Print them from your dashboard once the map is published.',
  },
  {
    id: 'visitors', nouns: 'visitors?|(?:the )?visitor (?:app|map|view)',
    how: '(?:do )?visitors (?:use|find|open|see|get to) (?:it|the map|my map|places|a place)',
    reply: 'Visitors open your map from a QR code or a link, search for a place (or tap it), and get turn-by-turn directions with distance and walking time. Directions change floors for them on stairs or elevators, and can be read aloud.',
  },
  {
    id: 'world', nouns: 'world map|(?:the )?city map',
    how: '(?:put|place|add) (?:my |the )?(?:venue|building|map) on the (?:world|city) map',
    reply: 'The world map is the outdoor map around your venue. Place and turn your building on it, so visitors get outdoor directions to the right door before the indoor ones take over.',
    chips: [chip('Place it on the world map', 'Place the venue on the world map')],
  },
  {
    id: 'pathtool', nouns: '(?:the )?path tool',
    how: 'draw (?:a )?paths? (?:by hand|myself)',
    reply: 'The Path tool draws walking paths by hand: click to add points, from one place to the next. Most of the time you don’t need it — the import and “Fix everything” draw the paths for you.',
    chips: [chip('Path tool', 'path tool')],
  },
];

/** "hey, can you tell me what a room is?" → "what a room is" */
function normalise(text: string): string {
  let t = text.toLowerCase().replace(/[’']/g, "'").replace(/[?!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  const filler = /^(?:hey|hi|hello|ok|okay|so|pls|please|um+|quick question|question|sorry|excuse me|can you|could you|would you|tell me|i want to know|i'd like to know|i wonder|do you know|i don't know|help me understand)\s+/;
  for (let i = 0; i < 4 && filler.test(t); i++) t = t.replace(filler, '');
  return t;
}

const WHAT = String.raw`(?:what(?:'s| is| are|s)?|wat(?:'s| is)?|whats|about|define|definition of|meaning of|explain|what do you mean by)`;
const HOW = String.raw`(?:how (?:do|can|should) (?:i|we|you)|how to|how does one|where (?:do|can) (?:i|we)|can (?:i|we)|is it possible to|i want to know how to)`;

/** The answer to a question about Yet New, or null when it isn't one. */
export function knowledge(text: string): Knowledge | null {
  const t = normalise(text);
  if (!t || t.length > 120) return null;
  for (const k of TOPICS) {
    const what = new RegExp(String.raw`^${WHAT}\s+(?:a |an |the )?(?:${k.nouns})(?:\s+(?:is|are|mean|means|for|do|does|in yet new|here))*$`);
    // "what a room is" (after "tell me")
    const whatIs = new RegExp(String.raw`^what\s+(?:a |an |the )?(?:${k.nouns})\s+(?:is|are|means|does)$`);
    // "what does publish mean", "what do walking paths do"
    const whatDoes = new RegExp(String.raw`^what (?:does|do) (?:a |an |the )?(?:${k.nouns}) (?:mean|do)$`);
    const how = k.how ? new RegExp(String.raw`^${HOW}\s+(?:${k.how})(?:\s+(?:here|in yet new|on the map|for visitors))?$`) : null;
    // "how do visitors use the map": the how-phrase names who does it.
    const howWho = k.id === 'visitors' && k.how ? new RegExp(String.raw`^how (?:do|does|can|will) (?:${k.how})$`) : null;
    if (what.test(t) || whatIs.test(t) || whatDoes.test(t) || (how && how.test(t)) || (howWho && howWho.test(t))) return { topic: k.id, reply: k.reply, chips: k.chips ?? [] };
  }
  return null;
}

/** The topics, for the help reply and tests. */
export const KNOWLEDGE_TOPICS = TOPICS.map(t => t.id);
