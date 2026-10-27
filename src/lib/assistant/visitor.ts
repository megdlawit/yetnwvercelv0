// The visitor's assistant: a conversation about the venue — "where is room 12?",
// "how do I get to the café?", "nearest toilet", "is the museum open?", "what's on
// the 2nd floor?", "how are you?" — answered from the venue's own map, right here in
// the browser. No outside service: typos are corrected against the venue's names and
// the assistant's own words (language.ts), and when it's unsure it asks
// "did you mean…?" instead of guessing.
//
// Pure: it reads a snapshot of the venue and returns a reply, what to do on the map
// (show a place, start directions, change floor, open an event) and what to remember
// for follow-ups ("take me there", "is it open?", "yes, that one").

import { categoryFromQuery, metresBetween, walkMinutes, VISITOR_CATEGORIES, type Spot, type VisitorCategory } from '@/lib/venue/discover';
import { openStatus, type OpeningHours } from '@/lib/venue/places';
import { PLACE_VOCABULARY, correct, matchNames, normalize, pick, vary, vocabulary } from './language';
import { smallTalkKind } from './smalltalk';

export interface VisitorPlace extends Spot {
  id: string;
  name: string;
  category: VisitorCategory;
  floorName: string;
  floorLevel: number;
  description?: string | null;
  typeLabel?: string;
  hours?: OpeningHours | null;
  navigable?: boolean;
  /** The room's kind when it's a room (stairs, elevator, restroom…). */
  roomType?: string | null;
}
export interface VisitorContent { id: string; title: string; kind: string; summary?: string | null; starts_at?: string | null; ends_at?: string | null }

export interface VisitorContext {
  venue: string;
  floors: { id: string; name: string; level: number }[];
  places: VisitorPlace[];
  content: VisitorContent[];
  /** The floor on screen. */
  floorId: string | null;
  /** Where the visitor is, when known (QR code, GPS, steps). */
  here: Spot | null;
  now?: Date;
}

/** What the conversation remembers between messages. */
export interface VisitorMemory {
  lastPlaceId?: string | null;
  /** A question asked back ("Did you mean A or B?") and what to do with the answer. */
  offer?: { placeIds: string[]; then: 'show' | 'route' } | null;
}

export type VisitorAction =
  | { op: 'show'; placeId: string }
  | { op: 'route'; placeId: string; fromId?: string | null }
  | { op: 'floor'; floorId: string }
  | { op: 'content'; contentId: string };

export interface VisitorReply {
  text: string;
  actions: VisitorAction[];
  /** Taps that say something for them. */
  chips: string[];
  memory: VisitorMemory;
  /** The message as understood, when typos were corrected ("where is the toilet"). */
  readAs?: string;
}

// ── Kinds of place people ask for by what they are ──────────────────────────

interface Kind { id: string; label: string; words: RegExp; test: (p: VisitorPlace) => boolean }
/** Amharic words for kinds of place, read as their English (\b doesn't work with Amharic letters). */
const AMHARIC: [RegExp, string][] = [
  [/ሽንት ቤት|ሽንትቤት|መጸዳጃ(?: ቤት)?|ሽንት/g, 'toilet'], [/ሊፍት|አሳንሰር/g, 'elevator'], [/ደረጃ/g, 'stairs'], [/መውጫ/g, 'exit'], [/መግቢያ|በር/g, 'entrance'],
  [/ቡና ቤት|ቡና/g, 'coffee'], [/ምግብ ቤት|ምግብ|ሬስቶራንት/g, 'food'], [/ካፌ/g, 'cafe'], [/ማቆሚያ|ፓርኪንግ/g, 'parking'], [/መጠበቂያ/g, 'lobby'],
];
const has = (re: RegExp) => (p: VisitorPlace) => re.test(p.name) || re.test(p.typeLabel ?? '');
const KINDS: Kind[] = [
  { id: 'restroom', label: 'restroom', words: /\b(toilets?|restrooms?|bathrooms?|washrooms?|lavatory|lavatories|ladies|gents|wc|pee|poop|ሽንት|መጸዳጃ)\b/,
    test: p => p.category === 'restrooms' || p.roomType === 'restroom' || /toilet|\bwc\b|restroom|bath|lavator|ሽንት|መጸዳጃ/i.test(p.name) },
  { id: 'elevator', label: 'elevator', words: /\b(elevators?|lifts?|ሊፍት)\b/, test: p => p.roomType === 'elevator' || has(/\blift|elevat|ሊፍት/i)(p) },
  { id: 'stairs', label: 'stairs', words: /\b(stairs?|staircase|stairway|steps|ደረጃ)\b/, test: p => p.roomType === 'stairs' || has(/stair|ደረጃ/i)(p) },
  { id: 'exit', label: 'exit', words: /\b(exits?|way out|emergency exit|መውጫ)\b/, test: p => p.category === 'entrances' || has(/exit|entr|gate|መውጫ|መግቢያ/i)(p) },
  { id: 'entrance', label: 'entrance', words: /\b(entrances?|entry|way in|main door|gates?|reception|lobby|መግቢያ)\b/, test: p => p.category === 'entrances' || has(/entr|gate|lobby|reception|መግቢያ/i)(p) },
  { id: 'food', label: 'place to eat or drink', words: /\b(food|eat|eating|hungry|thirsty|drink|drinks|coffee|cafe|cafes|cafeteria|restaurants?|snacks?|lunch|breakfast|dinner|juice|tea|ቡና|ምግብ|ካፌ)\b/,
    test: p => p.category === 'food' || has(/caf|coffee|restaurant|food|kitchen|canteen|bar\b|juice|ቡና|ምግብ/i)(p) },
  { id: 'parking', label: 'parking', words: /\b(parking|park my car|car park|garage|ማቆሚያ|ፓርኪንግ)\b/, test: p => p.category === 'parking' || has(/park/i)(p) },
  { id: 'info', label: 'help desk', words: /\b(information|info desk|help desk|reception|front desk|tickets?|ticket office)\b/, test: has(/info|reception|desk|ticket/i) },
  { id: 'prayer', label: 'prayer room', words: /\b(pray|prayer|prayer room|mosque|chapel|masjid)\b/, test: has(/pray|chapel|mosque|masjid/i) },
  { id: 'atm', label: 'ATM', words: /\b(atm|cash|bank|money)\b/, test: has(/\batm\b|bank|cash/i) },
  { id: 'firstaid', label: 'first aid', words: /\b(first aid|clinic|nurse|doctor|medical|pharmacy|hurt|injured)\b/, test: has(/first aid|clinic|nurse|medical|pharmac|health/i) },
  { id: 'kids', label: 'place for children', words: /\b(kids?|children|child|playground|play area|baby|nursery)\b/, test: p => p.category === 'family' || has(/kid|child|play|baby|nursery/i)(p) },
  { id: 'garden', label: 'garden', words: /\b(gardens?|park|nature|flowers?|outside|outdoors)\b/, test: p => p.category === 'gardens' || has(/garden|park/i)(p) },
];

/** The assistant's own words: typos are corrected towards these and the venue's names. */
const OWN_WORDS = `where is are find show me take bring guide lead walk get go reach directions direction route way navigate nearest closest near
  nearby how far which what floor level ground basement upstairs downstairs up down open opening close closing hours time today tonight
  events event happening program exhibition concert tour tours tell about information there here this that it room rooms place places
  toilet toilets restroom restrooms bathroom washroom elevator lift stairs staircase exit entrance gate reception lobby parking cafe
  cafeteria restaurant coffee food drink hungry thirsty prayer atm first aid clinic kids children playground garden help thanks thank you
  hello hi hey good morning afternoon evening bye goodbye please sorry nice great welcome doing going looking need want would like
  could can should start again yes no okay cancel list everything recommend visit see something interesting close closest`;

// ── The conversation ─────────────────────────────────────────────────────────

export function visitorReply(said: string, ctx: VisitorContext, memory: VisitorMemory = {}): VisitorReply {
  const raw = said.trim();
  const am = /[ሀ-፿]/.test(raw);
  const base = normalize(raw);
  if (!base) return reply(ctx, memory, 'Ask me anything about this place — like “where is the toilet?”', [], examples(ctx));
  const vocab = vocabulary(OWN_WORDS, PLACE_VOCABULARY, ctx.places.map(p => p.name), ctx.floors.map(f => f.name), ctx.content.map(c => c.title));
  const fixed = correct(base, vocab);
  const t = stripPolite(fixed.text);
  const readAs = fixed.changed ? fixed.text : undefined;
  const out = understand(t, raw, am, ctx, memory);
  return readAs && out.text ? { ...out, readAs } : out;
}

/** "hi, where is…", "excuse me, …", "… please", "… thanks": the request without the politeness around it. */
function stripPolite(t: string) {
  let s = t;
  for (let i = 0; i < 3; i++) {
    s = s.replace(/^(hi|hello|hey|selam|salam|excuse me|sorry|please|ok|okay|so|um|uh|well|hey there|good (morning|afternoon|evening)|can you tell me|could you tell me|do you know|i want to know|i wonder)\b\s*/, '');
  }
  return s.replace(/\s*\b(please|thanks|thank you|thx)$/, '').trim() || t;
}

function understand(t: string, raw: string, am: boolean, ctx: VisitorContext, mem: VisitorMemory): VisitorReply {
  // An answer to "did you mean A or B?"
  if (mem.offer?.placeIds.length) {
    const offered = mem.offer.placeIds.map(id => byId(ctx, id)).filter((p): p is VisitorPlace => !!p);
    const kind = smallTalkKind(t);
    const chosen = kind === 'yes' || /^(yes|yeah|yep|that one|the first( one)?|first)\b/.test(t) ? offered[0]
      : /^(the )?second( one)?$/.test(t) ? offered[1]
        : pick(matchNames(t, offered, p => p.name)).sure;
    if (chosen) return mem.offer.then === 'route' ? routeTo(chosen, ctx, { ...mem, offer: null }, am) : showPlace(chosen, ctx, { ...mem, offer: null }, am);
    if (kind === 'no' || /^(no|nope|none|neither|not that|wrong)\b/.test(t)) {
      return reply(ctx, { ...mem, offer: null }, 'No problem — what’s the name of the place you’re looking for?', [], examples(ctx));
    }
  }

  // Small talk: "how are you doing", "thanks", "who are you"…
  const talk = smallTalkKind(t) ?? smallTalkKind(raw);
  if (talk && !/\b(where|take|find|toilet|room)\b/.test(t)) return chat(talk, t, am, ctx, mem);

  let m: RegExpMatchArray | null;
  // "from the entrance to room 12"
  if ((m = t.match(/^(?:(?:how (?:do|can) i (?:get|go) )|(?:directions? |route |way |take me |go ))?from (.+?) to (.+)$/))) {
    const from = findPlace(m[1], ctx, mem), to = findPlace(m[2], ctx, mem);
    if (to.place && from.place) return routeTo(to.place, ctx, mem, am, from.place);
    return unsure(to.place ? m[1] : m[2], to.place ? from : to, ctx, mem, 'route');
  }
  // Directions: "how do I get to…", "take me to…", "directions to…", "I want to go to…"
  if ((m = t.match(/^(?:how (?:do|can|would|should|will) (?:i|we) (?:get|go|walk|reach|find my way|make my way) (?:to )?|how to (?:get|go|walk) (?:to )?|(?:can|could|would) you (?:please )?(?:take|bring|guide|lead|walk|show|direct|get) (?:me|us) (?:the way )?to |(?:take|bring|guide|lead|walk|direct|get) (?:me|us) (?:the way )?to |show (?:me|us) the way to |(?:give me )?directions? (?:to|for) |(?:the )?(?:best )?(?:way|route|path) to |navigate (?:me )?to |(?:i|we) (?:want|need|would like|wish) to (?:go|get|walk) to |let us go to |(?:go|head|walk) to |get me to )(.+)$/))) {
    return toPlace(m[1], ctx, mem, 'route', am);
  }
  // "take me there", "directions", "go", "let's go", "navigate"
  if (/^(take me there|bring me there|go there|lead the way|let us go|lets go|go|navigate|start|start directions|directions|show me the way|how do i get there|how do i get to it|guide me|take me)$/.test(t)) {
    const last = mem.lastPlaceId ? byId(ctx, mem.lastPlaceId) : null;
    if (last) return routeTo(last, ctx, mem, am);
    return reply(ctx, mem, 'Where would you like to go? Tell me the place — like “take me to the café”.', [], examples(ctx));
  }
  // Which floor: "which floor is room 12 on?"
  if ((m = t.match(/^(?:which|what) (?:floor|level) (?:is|are) (.+?)(?: on| in| at)?$|^is (.+?) (?:upstairs|downstairs|on this floor|on the ground floor)$/))) {
    const r = findPlace(m[1] ?? m[2], ctx, mem);
    if (!r.place) return unsure(m[1] ?? m[2], r, ctx, mem, 'show');
    return withPlace(r.place, ctx, mem, `${r.place.name} is on the ${floorLabel(r.place.floorName)}.${sameFloor(r.place, ctx) ? ' That’s the floor you’re looking at.' : ''}`, [{ op: 'show', placeId: r.place.id }], ['Take me there']);
  }
  if (/^(which|what) (floor|level)( is it| is that)?( on)?$/.test(t)) {
    const last = mem.lastPlaceId ? byId(ctx, mem.lastPlaceId) : null;
    if (last) return withPlace(last, ctx, mem, `${last.name} is on the ${floorLabel(last.floorName)}.`, [{ op: 'show', placeId: last.id }], ['Take me there']);
    const f = ctx.floors.find(x => x.id === ctx.floorId);
    return reply(ctx, mem, f ? `You’re looking at the ${floorLabel(f.name)}.` : 'Which place do you mean?', [], []);
  }
  // Opening hours: "is the café open?", "when does the museum close?"
  if ((m = t.match(/^(?:is|are) (.+?) open(?: now| today| right now| yet)?$|^when (?:does|do|is|will) (.+?) (?:open|close|closing|opening|shut)$|^(?:what are |what is )?(?:the )?(?:opening )?(?:hours|times|opening times) (?:of|for|at) (.+)$|^(?:is|are) (.+?) closed$/))) {
    const phrase = m[1] ?? m[2] ?? m[3] ?? m[4];
    const r = /^(it|this|that|there|they)$/.test(phrase) && mem.lastPlaceId ? { place: byId(ctx, mem.lastPlaceId), maybe: [] } : findPlace(phrase, ctx, mem);
    if (!r.place) return unsure(phrase, r as Found, ctx, mem, 'show');
    return hoursOf(r.place, ctx, mem);
  }
  if (/^(is it|are they) (open|closed)( now| today)?$|^(opening )?hours$|^when does it (open|close)$/.test(t) && mem.lastPlaceId) {
    const last = byId(ctx, mem.lastPlaceId);
    if (last) return hoursOf(last, ctx, mem);
  }
  // How far: "how far is the café?", "is it far?"
  if ((m = t.match(/^how far (?:is|to|away is|away are|are) (.+?)(?: from here| from me)?$|^is (.+?) far(?: from here)?$/))) {
    const phrase = m[1] ?? m[2];
    const r = /^(it|this|that|there)$/.test(phrase) && mem.lastPlaceId ? { place: byId(ctx, mem.lastPlaceId), maybe: [] } : findPlace(phrase, ctx, mem);
    if (!r.place) return unsure(phrase, r as Found, ctx, mem, 'show');
    return howFar(r.place, ctx, mem);
  }
  if (/^(how far( is it| away is it)?|is it far)$/.test(t) && mem.lastPlaceId) {
    const last = byId(ctx, mem.lastPlaceId);
    if (last) return howFar(last, ctx, mem);
  }
  // Floors: "what's on the 2nd floor?", "go to the ground floor", "upstairs"
  if ((m = t.match(/^(?:what is|what are|what can i (?:see|find|do)|show me what is|what do you have|whats) (?:on|at|in) (?:the )?(.+)$/))) {
    const f = floorFrom(m[1], ctx);
    if (f) return floorTour(f, ctx, mem);
  }
  if ((m = t.match(/^(?:go|switch|change|take me|move|show(?: me)?|open) (?:up |down )?(?:to )?(?:the )?(.+)$/)) && floorFrom(m[1], ctx)) {
    const f = floorFrom(m[1], ctx)!;
    return reply(ctx, mem, `Here’s the ${floorLabel(f.name)}.`, [{ op: 'floor', floorId: f.id }], placesOn(f.id, ctx).slice(0, 3).map(p => `Where is ${p.name}?`));
  }
  if (/^(go )?(upstairs|up|one floor up|next floor|floor up)$/.test(t) || /^(go )?(downstairs|down|one floor down|floor down)$/.test(t)) {
    const cur = ctx.floors.find(f => f.id === ctx.floorId);
    const sorted = [...ctx.floors].sort((a, b) => a.level - b.level);
    const i = sorted.findIndex(f => f.id === cur?.id);
    const f = /down/.test(t) ? sorted[i - 1] : sorted[i + 1];
    if (!f) return reply(ctx, mem, /down/.test(t) ? 'This is the lowest floor.' : 'This is the top floor.', [], []);
    return reply(ctx, mem, `Here’s the ${floorLabel(f.name)}.`, [{ op: 'floor', floorId: f.id }], []);
  }
  // What's here: "what can I see?", "recommend something"
  if (/^(what is (here|there|around|nearby|near me|in this (place|building|venue))|what can (i|we) (see|do|visit)( here)?|what (should|can) i (see|visit|do)|recommend( something| me something)?|any (suggestions|recommendations)|what do you have|list (all )?(the )?(places|rooms)|show (me )?(everything|all places|all the places)|what places are (here|there))$/.test(t)) {
    return overview(ctx, mem);
  }
  // Events: "what's on today?", "any events?"
  if (/\b(events?|happening|program|programme|concerts?|exhibitions?|shows?|activities|what is on|whats on)\b/.test(t) && !/\bfloor\b/.test(t)) {
    return events(ctx, mem);
  }
  // About a place: "what is the gallery?", "tell me about room 12"
  if ((m = t.match(/^(?:what is|what are|tell me (?:more )?about|info(?:rmation)? (?:on|about)|more about|about|describe|what can i (?:do|see) (?:at|in)) (?:the )?(.+)$/))) {
    const r = findPlace(m[1], ctx, mem);
    if (r.place) return describe(r.place, ctx, mem);
  }
  // Needs: "I need the toilet", "I'm hungry", "where can I eat?"
  if ((m = t.match(/^(?:i|we) (?:need|want|am looking for|are looking for|would like|have to go to|need to go to|must go to|need to use) (?:a |an |the |some )?(.+)$|^(?:i am|we are|i feel|im) (hungry|thirsty|lost|tired)$|^where can (?:i|we) (eat|drink|park|pray|sit|rest|get food|get coffee|get cash|buy (?:a )?tickets?|wash my hands|pee|go to the toilet)$/))) {
    const phrase = m[1] ?? m[2] ?? m[3];
    if (phrase === 'lost') return lost(ctx, mem);
    if (phrase === 'tired') return toKind(KINDS.find(k => k.id === 'food')!, ctx, mem, 'show', am);
    return toPlace(phrase, ctx, mem, 'show', am);
  }
  // Where: "where is…", "find…", "is there a…", "I'm looking for…", Amharic "… የት ነው"
  if ((m = t.match(/^(?:where (?:is|are|can i find|can we find|do i find|would i find|could i find)|where|find(?: me)?|show(?: me)?(?: where)?(?: is| are)?|locate|search(?: for)?|i am looking for|we are looking for|looking for|is there(?: a| an| any)?|are there(?: any)?|do you have(?: a| an| any)?|have you got(?: a| an| any)?|any|can you find(?: me)?|help me find) (.+)$/))
    || (m = t.match(/^(.+?) (?:የት ነው|የት አለ|የት ናቸው|የት ይገኛል)$/))) {
    return toPlace(m[1], ctx, mem, 'show', am);
  }
  // Help with the map itself: "how do I change floor?", "what is the blue dot?"
  const how = appHelp(t);
  if (how) return reply(ctx, mem, how.text, [], how.chips);

  // Just a name or a kind: "room 12", "toilet", "café?"
  const direct = findPlace(t, ctx, mem);
  if (direct.place) return showPlace(direct.place, ctx, mem, am);
  if (direct.maybe.length) return unsure(t, direct, ctx, mem, 'show');
  return notUnderstood(t, ctx, mem);
}

// ── Finding what's meant ─────────────────────────────────────────────────────

interface Found { place: VisitorPlace | null; maybe: VisitorPlace[]; kind?: Kind }

function findPlace(phrase: string, ctx: VisitorContext, mem: VisitorMemory): Found {
  const q = AMHARIC.reduce((s, [re, en]) => s.replace(re, en), phrase).replace(/^(the|a|an|some|any|my|our|your|nearest|closest|nearby|near) /, '').replace(/ (please|now|here|nearby|near me|around here|close by|closest|nearest)$/, '').trim();
  if (/^(it|this|that|there|that place|this place)$/.test(q) && mem.lastPlaceId) return { place: byId(ctx, mem.lastPlaceId), maybe: [] };
  const names = pick(matchNames(q, ctx.places, p => p.name));
  // A name said exactly beats a kind ("Café" the place, not any café).
  if (names.sure) return { place: names.sure, maybe: [] };
  const kind = KINDS.find(k => k.words.test(q)) ?? kindOfCategory(q);
  if (kind) {
    const of = ctx.places.filter(kind.test);
    if (of.length) return { place: nearest(of, ctx), maybe: [], kind };
    return { place: null, maybe: [], kind };
  }
  return { place: null, maybe: names.maybe };
}

function kindOfCategory(q: string): Kind | undefined {
  const c = categoryFromQuery(q);
  return c ? { id: c, label: VISITOR_CATEGORIES[c].label.toLowerCase(), words: /$^/, test: p => p.category === c } : undefined;
}

function toPlace(phrase: string, ctx: VisitorContext, mem: VisitorMemory, then: 'show' | 'route', am: boolean): VisitorReply {
  const r = findPlace(phrase, ctx, mem);
  if (r.place) return then === 'route' ? routeTo(r.place, ctx, mem, am, undefined, r.kind) : showPlace(r.place, ctx, mem, am, r.kind);
  return unsure(phrase, r, ctx, mem, then);
}

function toKind(kind: Kind, ctx: VisitorContext, mem: VisitorMemory, then: 'show' | 'route', am: boolean): VisitorReply {
  const of = ctx.places.filter(kind.test);
  if (!of.length) return reply(ctx, mem, `I couldn’t find a ${kind.label} on this map.`, [], examples(ctx));
  const p = nearest(of, ctx);
  return then === 'route' ? routeTo(p, ctx, mem, am, undefined, kind) : showPlace(p, ctx, mem, am, kind);
}

/** The nearest of several: to where the visitor is, else on the floor in view, else the lowest floor. */
function nearest(of: VisitorPlace[], ctx: VisitorContext): VisitorPlace {
  if (ctx.here) return [...of].sort((a, b) => metresBetween(ctx.here!, a, 40) - metresBetween(ctx.here!, b, 40))[0];
  const here = of.filter(p => p.floorId === ctx.floorId);
  return (here.length ? here : [...of].sort((a, b) => Math.abs(a.floorLevel) - Math.abs(b.floorLevel)))[0];
}

const byId = (ctx: VisitorContext, id: string) => ctx.places.find(p => p.id === id) ?? null;
const sameFloor = (p: VisitorPlace, ctx: VisitorContext) => p.floorId === ctx.floorId;
const floorLabel = (name: string) => (/floor|level|basement|storey|ground/i.test(name) ? name.toLowerCase().replace(/^(\d)/, '$1') : `${name} floor`);

function floorFrom(phrase: string, ctx: VisitorContext) {
  const q = normalize(phrase).replace(/^the /, '');
  const ordinal: Record<string, number> = { ground: 0, g: 0, first: 1, '1st': 1, one: 1, second: 2, '2nd': 2, two: 2, third: 3, '3rd': 3, three: 3, fourth: 4, '4th': 4, four: 4, fifth: 5, '5th': 5, five: 5, basement: -1, top: 99 };
  const named = pick(matchNames(q, ctx.floors, f => f.name)).sure;
  if (named) return named;
  const m = q.match(/^(?:floor|level) (-?\d+)$|^(\w+) (?:floor|level)$|^(ground|basement|top)$/);
  if (!m) return null;
  const lv = m[1] != null ? Number(m[1]) : ordinal[m[2] ?? m[3]];
  if (lv == null) return null;
  if (lv === 99) return [...ctx.floors].sort((a, b) => b.level - a.level)[0] ?? null;
  return ctx.floors.find(f => f.level === lv) ?? null;
}
const placesOn = (floorId: string, ctx: VisitorContext) => ctx.places.filter(p => p.floorId === floorId);

// ── Answers ──────────────────────────────────────────────────────────────────

function reply(ctx: VisitorContext, memory: VisitorMemory, text: string, actions: VisitorAction[], chips: string[]): VisitorReply {
  return { text, actions, chips, memory };
}
function withPlace(p: VisitorPlace, ctx: VisitorContext, mem: VisitorMemory, text: string, actions: VisitorAction[], chips: string[]): VisitorReply {
  return { text, actions, chips, memory: { ...mem, lastPlaceId: p.id, offer: null } };
}

function distanceText(p: VisitorPlace, ctx: VisitorContext): string {
  if (!ctx.here) return '';
  const m = metresBetween(ctx.here, p, 40);
  if (m < 8) return ' — you’re right there';
  return ` — about ${m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10} m away, ${walkMinutes(m)} min on foot`;
}

function showPlace(p: VisitorPlace, ctx: VisitorContext, mem: VisitorMemory, am: boolean, kind?: Kind): VisitorReply {
  const where = sameFloor(p, ctx) ? 'on this floor' : `on the ${floorLabel(p.floorName)}`;
  const lead = kind ? vary(p.id, [`The nearest ${kind.label} is ${p.name}`, `Closest ${kind.label}: ${p.name}`]) : p.name;
  const status = openStatus(p.hours ?? null, ctx.now ?? new Date());
  const text = am
    ? `${p.name} ${amFloor(p)} ላይ ነው። በካርታው ላይ አሳይቼዎታለሁ።`
    : `${lead}, ${where}${distanceText(p, ctx)}.${status ? ` It’s ${status.open ? 'open' : 'closed'} now (${status.text}).` : ''} I’ve marked it on the map.`;
  const chips = [p.navigable !== false ? 'Take me there' : null, status ? null : p.description ? `Tell me about ${p.name}` : null, kind ? `Another ${kind.label}` : null]
    .filter((c): c is string => !!c);
  return withPlace(p, ctx, mem, text, [{ op: 'show', placeId: p.id }], chips);
}

function routeTo(p: VisitorPlace, ctx: VisitorContext, mem: VisitorMemory, am: boolean, from?: VisitorPlace, kind?: Kind): VisitorReply {
  if (p.navigable === false) {
    return withPlace(p, ctx, mem, `${p.name} is ${sameFloor(p, ctx) ? 'on this floor' : `on the ${floorLabel(p.floorName)}`}, but there’s no walking route to it on the map yet — I’ve marked it for you.`, [{ op: 'show', placeId: p.id }], []);
  }
  const lead = kind ? `The nearest ${kind.label} is ${p.name}. ` : '';
  const other = !sameFloor(p, ctx) ? ` It’s on the ${floorLabel(p.floorName)}, so the route takes the stairs or lift.` : '';
  const text = am
    ? `ወደ ${p.name} መንገዱን እያሳየሁዎት ነው።`
    : `${lead}${vary(p.id, ['Here’s the way to', 'Directions to', 'Let’s go to'])} ${p.name}${from ? ` from ${from.name}` : ''}${distanceText(p, ctx)}.${other} Follow the line on the map${ctx.here || from ? '' : ' — tap “Start” and choose where you are'}.`;
  return withPlace(p, ctx, mem, text, [{ op: 'route', placeId: p.id, fromId: from?.id ?? null }], ['Is it open?', 'How far is it?']);
}

function hoursOf(p: VisitorPlace, ctx: VisitorContext, mem: VisitorMemory): VisitorReply {
  const s = openStatus(p.hours ?? null, ctx.now ?? new Date());
  const text = s ? `${p.name} is ${s.open ? 'open' : 'closed'} right now — ${s.text}.` : `I don’t have opening hours for ${p.name}. If it’s inside ${ctx.venue}, it’s open when the venue is.`;
  return withPlace(p, ctx, mem, text, [{ op: 'show', placeId: p.id }], ['Take me there']);
}

function howFar(p: VisitorPlace, ctx: VisitorContext, mem: VisitorMemory): VisitorReply {
  if (!ctx.here) {
    return withPlace(p, ctx, mem, `I don’t know where you are yet. Scan a QR code nearby or tap “Use my location”, and I’ll tell you how far ${p.name} is. It’s on the ${floorLabel(p.floorName)}.`, [{ op: 'show', placeId: p.id }], ['Take me there']);
  }
  const m = metresBetween(ctx.here, p, 40);
  return withPlace(p, ctx, mem, m < 8 ? `You’re right at ${p.name}!` : `${p.name} is about ${Math.round(m / 5) * 5} m away — around ${walkMinutes(m)} min on foot${sameFloor(p, ctx) ? '' : `, on the ${floorLabel(p.floorName)}`}.`, [{ op: 'show', placeId: p.id }], ['Take me there']);
}

function describe(p: VisitorPlace, ctx: VisitorContext, mem: VisitorMemory): VisitorReply {
  const about = p.description?.trim() ? p.description.trim() : `It’s ${p.typeLabel ? `a ${p.typeLabel.toLowerCase()}` : `one of the ${VISITOR_CATEGORIES[p.category].label.toLowerCase()}`} here.`;
  return withPlace(p, ctx, mem, `${p.name} — ${about} You’ll find it on the ${floorLabel(p.floorName)}.`, [{ op: 'show', placeId: p.id }], ['Take me there', 'Is it open?']);
}

function floorTour(f: { id: string; name: string }, ctx: VisitorContext, mem: VisitorMemory): VisitorReply {
  const on = placesOn(f.id, ctx).filter(p => !/^(small room|room) \d+$/i.test(p.name));
  if (!on.length) return reply(ctx, mem, `There’s nothing named on the ${floorLabel(f.name)} yet.`, [{ op: 'floor', floorId: f.id }], []);
  const shown = on.slice(0, 8).map(p => p.name);
  return reply(ctx, mem, `On the ${floorLabel(f.name)}: ${shown.join(', ')}${on.length > shown.length ? `, and ${on.length - shown.length} more` : ''}.`, [{ op: 'floor', floorId: f.id }], shown.slice(0, 3).map(n => `Where is ${n}?`));
}

function overview(ctx: VisitorContext, mem: VisitorMemory): VisitorReply {
  const named = ctx.places.filter(p => !/^(small room|room) \d+$/i.test(p.name));
  const top = named.filter(p => !['restrooms', 'parking', 'entrances', 'facilities'].includes(p.category)).slice(0, 6);
  const list = (top.length ? top : named.slice(0, 6)).map(p => p.name);
  if (!list.length) return reply(ctx, mem, `${ctx.venue}’s map doesn’t have named places yet.`, [], []);
  return reply(ctx, mem, `Here are some places in ${ctx.venue}: ${list.join(', ')}. ${ctx.floors.length > 1 ? `There are ${ctx.floors.length} floors. ` : ''}Ask me about any of them, or where something is.`, [], list.slice(0, 3).map(n => `Take me to ${n}`));
}

function events(ctx: VisitorContext, mem: VisitorMemory): VisitorReply {
  const now = ctx.now ?? new Date();
  const ev = ctx.content.filter(c => c.kind === 'event' && (!c.ends_at || new Date(c.ends_at) >= now))
    .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''));
  if (!ev.length) {
    const any = ctx.content.slice(0, 3);
    return reply(ctx, mem, any.length ? `No events are listed right now. You might like: ${any.map(c => c.title).join(', ')}.` : 'No events are listed right now.', any[0] ? [{ op: 'content', contentId: any[0].id }] : [], []);
  }
  const when = (c: VisitorContent) => (c.starts_at ? new Date(c.starts_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ongoing');
  return reply(ctx, mem, `Coming up: ${ev.slice(0, 4).map(c => `${c.title} (${when(c)})`).join('; ')}.`, [{ op: 'content', contentId: ev[0].id }], []);
}

function lost(ctx: VisitorContext, mem: VisitorMemory): VisitorReply {
  const desk = ctx.places.find(KINDS.find(k => k.id === 'info')!.test) ?? ctx.places.find(KINDS.find(k => k.id === 'entrance')!.test);
  return reply(ctx, mem, `Don’t worry — I’ll help. Scan the nearest QR code (or tap “Use my location”) so I can see where you are, then tell me where you want to go.${desk ? ` You can also ask at ${desk.name}.` : ''}`,
    desk ? [{ op: 'show', placeId: desk.id }] : [], ['Where is the exit?', 'Nearest toilet']);
}

function unsure(phrase: string, r: Found, ctx: VisitorContext, mem: VisitorMemory, then: 'show' | 'route'): VisitorReply {
  if (r.kind) return reply(ctx, mem, `I couldn’t find a ${r.kind.label} on ${ctx.venue}’s map, sorry.`, [], examples(ctx));
  if (r.maybe.length) {
    const names = r.maybe.map(p => p.name);
    const text = names.length === 1 ? `Did you mean ${names[0]}?` : `Did you mean ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}?`;
    return { text, actions: [], chips: names.length === 1 ? ['Yes', 'No'] : names, memory: { ...mem, offer: { placeIds: r.maybe.map(p => p.id), then } } };
  }
  return notUnderstood(phrase, ctx, mem);
}

function notUnderstood(t: string, ctx: VisitorContext, mem: VisitorMemory): VisitorReply {
  // The closest names anyway, loosely: better a question than nothing.
  const loose = matchNames(t, ctx.places, p => p.name).filter(x => x.score >= 45).slice(0, 3).map(x => x.item);
  if (loose.length) {
    return { text: `I’m not sure what you mean by “${t}”. Did you mean ${loose.map(p => p.name).join(' or ')}?`, actions: [], chips: loose.map(p => p.name), memory: { ...mem, offer: { placeIds: loose.map(p => p.id), then: 'show' } } };
  }
  return reply(ctx, mem, vary(t, [
    `I didn’t catch that. I can find any place in ${ctx.venue} and walk you there — try “where is the toilet?” or “take me to the café”.`,
    `Hmm, I’m not sure what you mean. Ask me where something is, how to get there, or what’s on a floor.`,
  ]), [], examples(ctx));
}

function examples(ctx: VisitorContext): string[] {
  const named = ctx.places.filter(p => !/^(small room|room) \d+$/i.test(p.name) && !['restrooms', 'parking', 'entrances'].includes(p.category));
  return [ctx.places.some(KINDS[0].test) ? 'Nearest toilet' : null, named[0] ? `Where is ${named[0].name}?` : null, 'What can I see here?'].filter((x): x is string => !!x);
}

function amFloor(p: VisitorPlace) {
  return p.floorLevel === 0 ? 'ምድር ቤት' : p.floorLevel < 0 ? 'ምድር ቤት ስር' : `${p.floorLevel}ኛ ፎቅ`;
}

// ── Small talk, in a guide's voice ───────────────────────────────────────────

function chat(kind: NonNullable<ReturnType<typeof smallTalkKind>>, t: string, am: boolean, ctx: VisitorContext, mem: VisitorMemory): VisitorReply {
  const ex = examples(ctx);
  const v = ctx.venue;
  switch (kind) {
    case 'greeting':
      return reply(ctx, mem, am ? `ሰላም! እንኳን ወደ ${v} በደህና መጡ። የትኛውን ቦታ ልፈልግልዎ?` : vary(t, [`Hi! 👋 Welcome to ${v}. I can find any place here and walk you there. What are you looking for?`, `Hello! I’m ${v}’s guide. Where would you like to go?`]), [], ex);
    case 'howareyou':
      return reply(ctx, mem, am ? 'ደህና ነኝ፣ አመሰግናለሁ! እርስዎስ? ምን ልርዳዎት?' : vary(t, ['I’m doing great, thanks for asking! 😊 How about you — where are you heading?', 'All good here, thank you! What can I help you find?']), [], ex);
    case 'thanks':
      return reply(ctx, mem, am ? 'ምንም አይደለም! መልካም ጉብኝት።' : vary(t, ['You’re welcome! Enjoy your visit.', 'Happy to help! Anything else?', 'Any time! Enjoy.']), [], []);
    case 'bye':
      return reply(ctx, mem, am ? 'ቻው! መልካም ቀን።' : `Goodbye — enjoy ${v}!`, [], []);
    case 'who':
      return reply(ctx, mem, `I’m ${v}’s guide, built into this map. I know every place here, which floor it’s on, when it’s open and how to walk there. Just ask the way you’d ask a person.`, [], ex);
    case 'maker':
      return reply(ctx, mem, 'The Yet New team made me for this map. I work right here on your phone — nothing you ask is sent anywhere.', [], ex);
    case 'help': case 'confused':
      return reply(ctx, mem, `I can help you get around ${v}. Ask me things like:\n• “Where is the toilet?”\n• “Take me to the café”\n• “Which floor is room 12 on?”\n• “Is the gallery open?”\n• “What’s on the 2nd floor?”`, [], ex);
    case 'compliment':
      return reply(ctx, mem, 'Thank you, that’s kind! 😊 Where to next?', [], ex);
    case 'complaint':
      return reply(ctx, mem, 'Sorry about that! Tell me the name of the place again — even roughly, I’ll work out what you mean.', [], ex);
    case 'yes': case 'ack':
      return reply(ctx, mem, 'Great! What would you like to find?', [], ex);
    case 'no':
      return reply(ctx, mem, 'Okay! Let me know if you need anything.', [], []);
  }
}

// ── Questions about the map itself ───────────────────────────────────────────

function appHelp(t: string): { text: string; chips: string[] } | null {
  const rules: [RegExp, string][] = [
    [/\b(change|switch|another|other|different) floors?\b|\bhow do i go (up|down)\b/, 'Tap the floor buttons on the right of the map, or say “show the 2nd floor”. Directions change floors for you when you need to.'],
    [/\b(blue dot|where am i|my location|find me|locate me|my position)\b/, 'The blue dot is you. Scan a QR code on a wall nearby to set exactly where you are, or tap “Use my location”. While walking, I follow your steps.'],
    [/\bqr\b|\bscan\b/, 'QR codes on the walls tell the map exactly where you’re standing. Scan one with your phone camera and I’ll start from there.'],
    [/\b3d\b|\b2d\b|\bview\b/, 'Switch between 2D, 3D and the outdoor map with the buttons at the top right.'],
    [/\b(share|send) (this|a|the)? ?(place|location|link)\b/, 'Open a place and tap Share to send its link — it opens right at that spot.'],
    [/\b(wheelchair|step free|accessible|disabled|disability|stroller|pram)\b/, 'When you ask for directions, choose “Step-free” and the route avoids stairs, using lifts and ramps instead.'],
    [/\b(voice|speak|read aloud|talk to me|audio)\b/, 'During directions, the speaker button reads each step aloud.'],
    [/\b(language|amharic|english|አማርኛ)\b/, 'You can talk to me in English, and simple Amharic works too — like “ሽንት ቤት የት ነው?”'],
  ];
  const hit = /^(how|can|what|where|is there|do you)/.test(t) ? rules.find(([re]) => re.test(t)) : null;
  return hit ? { text: hit[1], chips: [] } : null;
}
