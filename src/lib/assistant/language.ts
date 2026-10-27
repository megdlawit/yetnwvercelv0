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
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  s = s.replace(/[^\p{L}\p{N}'\s-]+/gu, ' ').replace(/(^|\s)'+|'+(?=\s|$)/g, ' ');
  // "room12" → "room 12", "2nd" stays: letters then digits are split only after a word of 3+ letters.
  s = s.replace(/\b([a-z]{3,})(\d+)\b/g, '$1 $2');
  return s.split(/\s+/).filter(Boolean).map(w => SHORTHANDS[w] ?? w).join(' ').replace(/\s+/g, ' ').trim();
}

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
  pic: 'picture', nr: 'near', nxt: 'next', fl: 'floor', flr: 'floor', lvl: 'level', rm: 'room', rms: 'rooms', bldg: 'building',
};

/** Words never "corrected": everyday English that isn't in an assistant's vocabulary. */
const KEEP = new Set(('a an the is are am was were be been being i you he she it we they me him her us them my your his its our their mine yours ' +
  'to of in on at for and or but nor so yet if then than as by with from into onto about over under near far up down out off ' +
  'this that these those there here where when what who whom whose which why how all any some no not none each every both either ' +
  'do does did done doing have has had having can could will would shall should may might must need want like love hate ' +
  'get got go goes going gone went come came see saw seen look looking find found show tell told say said know knew think thought ' +
  'make made take took give gave let put keep kept try tried help please thanks thank yes yeah no nope ok okay sure fine good great ' +
  'nice bad well very much many more most less least just only also too again still already now today tonight tomorrow yesterday ' +
  'day night time hour hours minute minutes way thing things place places one two three four five six seven eight nine ten first ' +
  'second third last next other another same new old big small little long short left right back front top bottom inside outside open close').split(' '));

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
  const words = normalize(text).split(' ').filter(Boolean);
  let changed = false;
  const out = words.map(w => {
    if (vocab.has(w) || KEEP.has(w) || /\d/.test(w) || !/^[a-z'-]+$/.test(w)) return w;
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
