// The assistants' own understanding of how people type — no outside service.
// Both the visitor's assistant and the floor editor's use it:
//
//   normalize  "Where's teh TOILET??"  → "where is teh toilet"   (chat spelling, contractions)
//   correct    "wher is teh toilt"     → "where is the toilet"    (typos, against a vocabulary)
//   matchName  "conferance rom 2"      → "Conference Room 2", sure or "did you mean"
//
// A word is only corrected towards a word the assistant knows (its phrases, the
// venue's place names) and only when it's close: ordinary English it doesn't know
// ("there", "lovely") is left alone, and numbers are never changed — "Room 12"
// is not "Room 1".

/** Lower case, accents off, contractions and chat spellings written out, punctuation gone. Amharic is kept. */
export function normalize(text: string): string {
  let s = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’‘`´]/g, "'");
  // "heyyy", "connnect", "pleeease": a letter held down is one letter too many.
  s = s.replace(/(\p{L})\1{2,}/gu, '$1$1');
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  s = s.replace(/[^\p{L}\p{N}'\s-]+/gu, ' ').replace(/(^|\s)'+|'+(?=\s|$)/g, ' ');
  // "room12" → "room 12", "2nd" stays: letters then digits are split only after a word of 3+ letters.
  s = s.replace(/\b([a-z]{3,})(\d+)\b/g, '$1 $2');
  // "wheel-chair", "check-in": a hyphen between letters is a space (then joined below if it's one word).
  s = s.replace(/(\p{L})-(?=\p{L})/gu, '$1 ');
  const words = s.split(/\s+/).filter(w => w && !FILLER_WORDS.has(w)).flatMap(w => (SPELLED_OUT[w] ?? w).split(' '));
  return joinCompounds(words).join(' ').replace(/\s+/g, ' ').trim();
}

/** "good bye" → "goodbye", "rest room" → "restroom": two words that are written as one. */
function joinCompounds(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const two = words[i] + (words[i + 1] ?? '');
    if (i + 1 < words.length && COMPOUNDS.has(two)) { out.push(two); i++; } else out.push(words[i]);
  }
  return out;
}

/** Chat noise that carries no meaning: "lol", "haha", "bruh" (and the word bank's). */
const FILLER_WORDS = new Set([...CHAT_FILLER.filter(w => !w.includes(' ')), 'lol', 'lmao', 'lmfao', 'rofl', 'haha', 'hahah', 'hahaha', 'hehe', 'xd', 'bruh', 'bro', 'dude', 'mate', 'fam',
  'buddy', 'yall', 'guys', 'pal', 'smh', 'tbh', 'imo', 'ngl', 'fr', 'ong', 'lowkey', 'highkey', 'literally', 'basically']);

/**
 * English slang for the editor's requests, said the way the assistant understands them:
 * "nuke the bench" → "remove the bench", "hook up the cafe and the lobby" → "connect…",
 * "nudge it left" → "move it a little left", "ship it" → "publish", "my bad" → "undo".
 * Works on normalized text (lower case, shorthands written out). The first that fits wins.
 */
const SLANG: [RegExp, string][] = [
  // undo / redo
  [/^(my bad|oops|whoops|oopsie|ctrl z|control z|cmd z|scratch that|take it back|reverse that|back it out|no undo( that)?|go back one|revert it|roll( it)? back)$/, 'undo'],
  [/^(ctrl y|control y|cmd shift z|ctrl shift z|redo it|do it again)$/, 'redo'],
  // check / fix
  [/^(are we good|we good|is it (all )?good|is (it|everything) (ok|okay|fine|alright)|anything broken|is anything broken|what is broken|sanity check|how is (my|the) map( looking)?|how does (it|the map) look|rate my map|is it legit|any (errors|bugs|issues|problems)|check (it|everything|stuff))$/, 'check the map'],
  [/^(sort it( all)? out|sort (it|everything|the map) out|clean (it|everything|the map) up|clean up( the map)?|tidy( it)? up|patch (it|everything)( up)?|make it work|just fix it|fix (it|stuff|things|the lot)|do your thing)$/, 'fix everything'],
  // publish / view
  [/^(ship it|push it live|send it live|launch( it)?|drop it live|go public|put it out there|make it public)$/, 'publish'],
  [/^(pan out|zoom way out|show (me )?the whole thing|show (me )?everything|birds? eye( view)?)$/, 'fit the map'],
  // remove
  [/^(?:nuke|yeet|trash|ditch|kill|scrap|bin|axe|toss|chuck out|chuck away|zap|dump|kick out|wipe) (.+)$/, 'remove $1'],
  // connect
  [/^(?:hook up|wire up|link up|tie up|bridge) (.+?) (?:and|with|to) (.+)$/, 'connect $1 and $2'],
  [/^(?:hook|wire|tie|patch|plug) (.+?) (?:up )?(?:to|with|into|and) (.+)$/, 'connect $1 and $2'],
  [/^(?:make a way|make a path|let (?:people|folks|visitors) walk|let me walk) (?:from|between) (.+?) (?:to|and) (.+)$/, 'connect $1 and $2'],
  // move
  [/^(?:nudge|scoot|budge|inch) (.+?) (?:over )?(?:to the )?(left|right|up|down)$/, 'move $1 a little $2'],
  [/^(?:shove|slide|bump|shift|drag|push|yank|pull) (?!(?:in |on |down )?(?:a|an|another|some|one more|a new) )(.+?) (?:over )?(?:to the )?(left|right|up|down)$/, 'move $1 $2'],
  [/^(?:shove|slide|shift|drag|push|plonk|stick|park) (?!(?:in |on |down )?(?:a|an|another|some|one more|a new) )(.+?) (?:over )?(?:next to|near|beside|by) (.+)$/, 'move $1 next to $2'],
  [/^(?:shove|slide|shift|drag|plonk|stick|park) (?!(?:in |on |down )?(?:a|an|another|some|one more|a new) )(.+?) (?:over )?(here|there)$/, 'move $1 here'],
  // add
  [/^(?:chuck|pop|slap|throw|stick|plonk|drop|whack|bung|toss) (a|an|another|some) (.+)$/, 'add $1 $2'],
  // resize / rotate
  [/^(?:beef up|bulk up|blow up|pump up|supersize) (.+)$/, 'make $1 bigger'],
  [/^make (.+?) (?:chunkier|fatter|thicc|thicker|huge|massive|way bigger)$/, 'make $1 bigger'],
  [/^make (.+?) (?:tinier|teeny|smol|skinnier|thinner|way smaller|tiny)$/, 'make $1 smaller'],
  [/^(?:shrink|squish|squash) (.+?)(?: down)?$/, 'make $1 smaller'],
  [/^(?:spin|twist|swivel|flip) (.+?) (?:by )?(\d+)(?: degrees| deg)?$/, 'rotate $1 $2 degrees'],
  [/^flip (?!to )(.+?)(?: around| over)?$/, 'rotate $1 180 degrees'],
  // rename
  [/^(?:call|label|tag) (it|this|that) (?!to |as )(.+)$/, 'rename $1 to $2'],
  [/^(?:label|tag) (.+?) as (.+)$/, 'rename $1 to $2'],
  // where
  [/^where (?:the|is the) (.+?) at$/, 'where is the $1'],
  [/^where is (.+?) at$/, 'where is $1'],
  [/^where did (.+?) go$/, 'where is $1'],
  [/^let me see (.+)$/, 'show $1'],
];

/** Verbs the phrase parser already understands as they are: never rewritten (no "I read that as" for them). */
const UNDERSTOOD = new Set(['delete', 'remove', 'erase', 'get rid of', 'take away', 'add', 'put', 'place', 'insert', 'move', 'connect', 'link',
  'join', 'join up', 'disconnect', 'unlink', 'rename', 'call', 'name', 'rotate', 'turn', 'spin', 'undo', 'revert', 'go back', 'never mind',
  'redo', 'check', 'review', 'fix', 'repair', 'publish', 'go live', 'show', 'find', 'where is', 'locate', 'select', 'make']);
const alt = (words: string[]) => words.filter(w => !UNDERSTOOD.has(w)).sort((a, b) => b.length - a.length).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const v = (k: keyof typeof VERBS) => alt(VERBS[k]);

/** The word bank's verbs as requests, each in the shape its action needs. */
const VERB_RULES: [RegExp, string][] = [
  [new RegExp(`^(?:${v('undo')})$`), 'undo'],
  [new RegExp(`^(?:${v('redo')})$`), 'redo'],
  [new RegExp(`^(?:${v('check')})(?: the| my)?(?: map| plan| floor| it| everything| stuff| things)?$`), 'check the map'],
  [new RegExp(`^(?:${v('fix')})(?: up)?(?: the| my)?(?: map| plan| floor| it| everything| stuff| things| it all| all)?$`), 'fix everything'],
  [new RegExp(`^(?:${v('publish')})(?: it| the map| my map| the venue| now)?$`), 'publish'],
  [new RegExp(`^(?:${v('remove')}) (.+)$`), 'remove $1'],
  [new RegExp(`^(?:${v('add')}) (a|an|another|some|one more|a new) (.+)$`), 'add $1 $2'],
  [new RegExp(`^(?:${v('move')}) (.+?) (?:over )?(?:to the )?(left|right|up|down|here|there)$`), 'move $1 $2'],
  [new RegExp(`^(?:${v('move')}) (.+?) (?:over )?(next to|near|beside|by|closer to) (.+)$`), 'move $1 $2 $3'],
  [new RegExp(`^(?:${v('connect')}) (.+?) (?:up )?(?:and|with|to|into) (.+)$`), 'connect $1 and $2'],
  [new RegExp(`^(?:${v('disconnect')}) (.+?) (?:and|from) (.+)$`), 'disconnect $1 and $2'],
  [new RegExp(`^(?:${v('rename')}) (.+?) (?:to|as) (.+)$`), 'rename $1 to $2'],
  [new RegExp(`^(?:${v('rotate')}) (.+?) (?:by )?(\\d+)(?: degrees| deg)?$`), 'rotate $1 $2 degrees'],
  [new RegExp(`^(?:${v('bigger')}) (.+)$`), 'make $1 bigger'],
  [new RegExp(`^(?:${v('smaller')}) (.+)$`), 'make $1 smaller'],
  [new RegExp(`^(?:${v('show')}) (.+)$`), 'show $1'],
];

/** The request with its slang said plainly ("nuke the bench" → "remove the bench"); `slang` when anything changed. */
export function plainSlang(normalized: string): { text: string; slang: boolean } {
  // "yo hook up…", "ok so just nuke it please": the request is what's between the hellos and the pleases.
  const core = normalized
    .replace(/^((yo|hey|hi|hello|hiya|ok|okay|alright|so|um|uh|well|please|can you|could you|would you|just|go ahead and|now)\s+)+/, '')
    .replace(/(\s+(please|thanks|thank you|now|for me|real quick|quickly))+$/, '');
  const hit = SLANG.find(([re]) => re.test(core)) ?? VERB_RULES.find(([re]) => re.test(core));
  const text = hit ? core.replace(hit[0], hit[1]) : normalized;
  return { text, slang: text !== normalized };
}

import { CHAT, COMPOUNDS, FILLER as CHAT_FILLER, MISSPELLINGS, OBJECT_WORDS, PLACE_WORDS, VERBS } from './lexicon';
import { COMMON_ENGLISH } from './lexiconMore';

const CONTRACTIONS: [RegExp, string][] = [
  [/\bwhere'?s\b/g, 'where is'], [/\bwhat'?s\b/g, 'what is'], [/\bwho'?s\b/g, 'who is'], [/\bhow'?s\b/g, 'how is'],
  [/\bthat'?s\b/g, 'that is'], [/\bthere'?s\b/g, 'there is'], [/\bit's\b/g, 'it is'], [/\blet's\b/g, 'let us'],
  [/\bi'?m\b/g, 'i am'], [/\bi'?ve\b/g, 'i have'], [/\bi'll\b/g, 'i will'], [/\bi'd\b/g, 'i would'],
  [/\byou'?re\b/g, 'you are'], [/\bcan'?t\b/g, 'can not'], [/\bwon'?t\b/g, 'will not'], [/\bdon'?t\b/g, 'do not'],
  [/\bdoesn'?t\b/g, 'does not'], [/\bisn'?t\b/g, 'is not'], [/\baren'?t\b/g, 'are not'], [/\bdidn'?t\b/g, 'did not'],
  [/\bwhere're\b/g, 'where are'], [/\bhow're\b/g, 'how are'], [/\bwanna\b/g, 'want to'], [/\bgonna\b/g, 'going to'], [/\bgotta\b/g, 'have to'],
];

/** How people shorten words in chat. */
const SHORTHANDS: Record<string, string> = {
  u: 'you', ya: 'you', yu: 'you', r: 'are', ur: 'your', urs: 'yours', pls: 'please', plz: 'please', plez: 'please', pleas: 'please',
  thx: 'thanks', thnx: 'thanks', thanx: 'thanks', ty: 'thanks', tnx: 'thanks', im: 'i am', ive: 'i have',
  wat: 'what', wht: 'what', wut: 'what', whats: 'what is', wheres: 'where is', hw: 'how', hows: 'how is', howz: 'how is',
  wr: 'where', whr: 'where', whre: 'where', wer: 'where', dnt: 'do not', dont: 'do not', cant: 'can not', wont: 'will not',
  doin: 'doing', goin: 'going', gud: 'good', gd: 'good', k: 'ok', kk: 'ok', okey: 'okay', okk: 'ok', btw: 'by the way',
  loo: 'toilet', wc: 'toilet', 'w.c': 'toilet', b4: 'before', '2day': 'today', tmrw: 'tomorrow', tmr: 'tomorrow',
  hii: 'hi', hiii: 'hi', helo: 'hello', hellow: 'hello', heloo: 'hello', hallo: 'hello', hai: 'hi', hy: 'hi', heyy: 'hey',
  gimme: 'give me', lemme: 'let me', dunno: 'do not know', kinda: 'kind of', sorta: 'sort of', cuz: 'because', coz: 'because',
  cos: 'because', bc: 'because', tho: 'though', thru: 'through', 'w/': 'with', 'w/o': 'without', 'b/w': 'between', bw: 'between',
  nvm: 'never mind', np: 'no problem', idk: 'i do not know', rn: 'right now', asap: 'now', tysm: 'thank you so much', tyvm: 'thank you very much',
  thnks: 'thanks', dat: 'that', dis: 'this', dem: 'them', da: 'the', teh: 'the', hte: 'the', tge: 'the', n: 'and',
  yea: 'yes', yeah: 'yes', ye: 'yes', yah: 'yes', yass: 'yes', yas: 'yes', yup: 'yes', yep: 'yes', nah: 'no', naw: 'no', nope: 'no',
  okie: 'ok', oki: 'ok', okies: 'ok', aight: 'alright', ight: 'alright', gr8: 'great', l8r: 'later', ppl: 'people', cya: 'bye', thanku: 'thanks',
  sumthin: 'something', smth: 'something', sth: 'something', somethin: 'something', nothin: 'nothing', everythin: 'everything',
  bout: 'about', abt: 'about', prolly: 'probably',
  pic: 'picture', nr: 'near', nxt: 'next', fl: 'floor', flr: 'floor', lvl: 'level', rm: 'room', rms: 'rooms', bldg: 'building',
};

/** Chat spellings written out (the word bank's, then the shorthands above). Misspellings are corrections: see fixWords. */
const SPELLED_OUT: Record<string, string> = { ...CHAT, ...SHORTHANDS };

/** Words never "corrected": everyday English that isn't in an assistant's vocabulary, and the word bank's verbs. */
const KEEP = new Set([...Object.values(VERBS).flat().flatMap(w => w.split(' ')), ...COMMON_ENGLISH.trim().split(/\s+/), ...('a an the is are am was were be been being i you he she it we they me him her us them my your his its our their mine yours ' +
  'to of in on at for and or but nor so yet if then than as by with from into onto about over under near far up down out off ' +
  'this that these those there here where when what who whom whose which why how all any some no not none each every both either ' +
  'do does did done doing have has had having can could will would shall should may might must need want like love hate ' +
  'get got go goes going gone went come came see saw seen look looking find found show tell told say said know knew think thought ' +
  'make made take took give gave let put keep kept try tried help please thanks thank yes yeah no nope ok okay sure fine good great ' +
  'nice bad well very much many more most less least just only also too again still already now today tonight tomorrow yesterday ' +
  'day night time hour hours minute minutes way thing things place places one two three four five six seven eight nine ten first ' +
  'second third last next other another same new old big small little long short left right back front top bottom inside outside open close ' +
  // slang verbs and words: they mean something (SLANG below), so they're never "corrected" into a command ("chuck" isn't "check")
  'nuke yeet trash ditch kill scrap bin axe toss chuck zap dump wipe hook wire tie patch plug bridge nudge scoot budge inch shove slide bump ' +
  'shift drag push yank pull plonk stick park pop slap throw drop whack bung beef bulk blow pump supersize chunkier fatter thicc smol tinier ' +
  'teeny skinnier shrink squish squash spin twist swivel flip label tag ship launch oops whoops oopsie sanity tidy sort legit public').split(' ')]);

/** Damerau–Levenshtein distance, giving up (returning max + 1) once it can't be within `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length, m = b.length;
  let prev2 = new Array<number>(m + 1).fill(0), prev = Array.from({ length: m + 1 }, (_, j) => j), cur = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[m];
}

/** How many typos a word of this length may carry and still be recognised. */
const allowed = (len: number) => (len <= 3 ? 0 : len <= 6 ? 1 : 2);

/** Names of rooms, amenities and objects from the word bank: spelling is corrected towards these too. */
export const PLACE_VOCABULARY: string[] = [...Object.values(PLACE_WORDS).flat(), ...OBJECT_WORDS];

/** A vocabulary to correct towards: the assistant's phrases plus names (each name's words). */
export function vocabulary(...lists: (Iterable<string> | string)[]): Set<string> {
  const v = new Set<string>();
  for (const l of lists) for (const item of typeof l === 'string' ? [l] : l) for (const w of normalize(item).split(' ')) if (w) v.add(w);
  return v;
}

/**
 * Each word that isn't known but is a typo away from exactly one best known word becomes that
 * word. `changed`: whether anything was corrected (so the assistant can say what it read).
 */
export function correct(text: string, vocab: Set<string>): { text: string; changed: boolean } {
  const fixed = fixWords(normalize(text).split(' ').filter(Boolean), vocab);
  // Slang is said plainly once the typos are fixed ("nuek the bench" → "nuke the bench" → "remove the bench").
  const plain = plainSlang(fixed.text);
  return { text: plain.text, changed: fixed.changed || plain.slang };
}

function fixWords(words: string[], vocab: Set<string>): { text: string; changed: boolean } {
  let changed = false;
  const isWord = (w: string) => vocab.has(w) || KEEP.has(w) || COMPOUNDS.has(w);
  const out = words.map(w => {
    // A known misspelling ("resturant", "elevater") is the word, whatever the vocabulary.
    const known = MISSPELLINGS[w];
    if (known && !vocab.has(w)) { changed = true; return known; }
    if (isWord(w) || /\d/.test(w) || !/^[a-z'-]+$/.test(w)) return w;
    // Words run together ("whereis", "groundfloor", "nearesttoilet"): split before any typo is guessed.
    const parts = splitGlued(w, isWord);
    if (parts) { changed = true; return parts.join(' '); }
    // A three-letter word may be a longer word missing a letter ("rom" for "room"), nothing else.
    const short = w.length === 3;
    const max = short ? 1 : allowed(w.length);
    if (!max) return w;
    let best: string | null = null, bd = max + 1, tie = false;
    for (const v of vocab) {
      if (Math.abs(v.length - w.length) > max || /\d/.test(v) || (short && (v.length !== 4 || v[0] !== w[0]))) continue;
      const dd = editDistance(w, v, max) + (v[0] === w[0] ? 0 : 0.5);   // first letters are rarely wrong
      if (dd < bd) { bd = dd; best = v; tie = false; } else if (dd === bd && v !== best) tie = true;
    }
    if (!best || tie || bd > max) return w;
    changed = true;
    return best;
  });
  return { text: out.join(' '), changed };
}

/**
 * A word that is two or three known words run together ("takemeto" → take me to), or null.
 * Every piece has two letters or more; of several ways, the one with the fewest, longest pieces.
 */
export function splitGlued(w: string, isWord: (x: string) => boolean, depth = 0): string[] | null {
  if (w.length < (depth ? 4 : 5) || depth > 1) return null;
  let best: string[] | null = null;
  for (let i = w.length - 2; i >= 2; i--) {
    const left = w.slice(0, i), right = w.slice(i);
    if (!isWord(left)) continue;
    const rest = isWord(right) && right.length >= 2 ? [right] : splitGlued(right, isWord, depth + 1);
    if (!rest) continue;
    const parts = [left, ...rest];
    if (!best || parts.length < best.length || (parts.length === best.length && Math.min(...parts.map(p => p.length)) > Math.min(...best.map(p => p.length)))) best = parts;
  }
  return best;
}

export interface NameMatch<T> { item: T; score: number }

/**
 * The names a phrase most likely means, best first, scored 0–100: the whole name (100),
 * every word of the phrase in the name, with a typo or two allowed in longer words (≈85),
 * the name's words all in the phrase (≈75), or a near spelling of the whole name (≈60).
 * Numbers must match exactly.
 */
export function matchNames<T>(phrase: string, items: T[], nameOf: (t: T) => string): NameMatch<T>[] {
  const q = normalize(phrase).replace(/^(the|a|an|my|our) /, '');
  if (!q) return [];
  const qt = q.split(' ').filter(w => !FILLER.has(w));
  if (!qt.length) return [];
  // One word of the phrase is the name's word: the same, a typo or two off ("rom" for "room"), its start, or its plural.
  const same = (a: string, b: string) => a === b || (!/\d/.test(a) && !/\d/.test(b) && Math.min(a.length, b.length) >= 3
      && editDistance(a, b, allowed(Math.max(a.length, b.length))) <= allowed(Math.max(a.length, b.length)))
    || (a.length >= 4 && b.startsWith(a)) || singular(a) === singular(b);
  const out: NameMatch<T>[] = [];
  for (const item of items) {
    const n = normalize(nameOf(item));
    if (!n) continue;
    const nt = n.split(' ').filter(w => !FILLER.has(w));
    // A number in the phrase must be in the name, and the other way round for short names ("Room 1").
    const qn = qt.filter(w => /^\d+$/.test(w)), nn = nt.filter(w => /^\d+$/.test(w));
    if (qn.some(x => !nn.includes(x)) || (qn.length && nn.some(x => !qn.includes(x)))) continue;
    let score = 0;
    if (n === q || nt.join(' ') === qt.join(' ')) score = 100;
    else if (qt.every(w => nt.some(x => same(w, x)))) score = 85 - Math.min(10, (nt.length - qt.length) * 3) - (qt.every(w => nt.includes(w)) ? 0 : 4);
    else if (nt.length && nt.every(x => qt.some(w => same(w, x)))) score = 75 - Math.min(10, (qt.length - nt.length) * 2);
    else {
      const d = editDistance(q, n, Math.ceil(Math.max(q.length, n.length) * 0.3));
      const sim = 1 - d / Math.max(q.length, n.length);
      if (sim >= 0.72) score = Math.round(60 * sim);
    }
    if (score) out.push({ item, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Of a ranked list: the one meant when it's clearly ahead, else the few to ask about. */
export function pick<T>(ranked: NameMatch<T>[]): { sure: T | null; maybe: T[] } {
  if (!ranked.length) return { sure: null, maybe: [] };
  const [a, b] = ranked;
  if (a.score >= 80 && (!b || a.score - b.score >= 8)) return { sure: a.item, maybe: [] };
  if (a.score === 100) return { sure: a.item, maybe: [] };
  return { sure: null, maybe: ranked.filter(r => r.score >= Math.max(55, a.score - 15)).slice(0, 3).map(r => r.item) };
}

const FILLER = new Set(['the', 'a', 'an', 'please', 'pls', 'of', 'to', 'at']);
const singular = (w: string) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** A choice that reads naturally but stays the same for the same message (no randomness in replies). */
export function vary<T>(seed: string, options: T[]): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return options[Math.abs(h) % options.length];
}
