// How the floor editor's assistant reads one message, before anything is done to the map:
// small talk, then questions about Yet New, then map requests — as typed, or with typos fixed
// and shorthand written out (language.ts). MapAssistant and the scoring harness both use this,
// so what is measured is what the editor does.

import { PARSER_WORDS, parseIntent, type MapAction } from './intent';
import { PLACE_VOCABULARY, correct, plainWords, vocabulary } from './language';
import { smallTalk } from './smalltalk';
import { knowledge, type Knowledge } from './knowledge';
import type { MapState } from './engine';

/** What the editor understands, as words: typos are corrected towards these, the parser's words and the map's names. */
export const EDITOR_WORDS = `connect disconnect join link unlink block unblock walkable walk path paths add put place create make draw move shift drag rename call
  name remove delete erase undo redo show hide find where fix everything check health problems accessible wheelchair step free rotate turn resize
  bigger smaller wider narrower longer shorter duplicate copy select all none floor floors upstairs downstairs room rooms restroom toilet elevator
  lift stairs entrance exit door doors window windows wall walls corridor hallway cafe kitchen office meeting reception lobby height high tall
  metres meters degrees left right up down near next beside between behind publish open save view zoom fit type kind called named here this it`;

export type EditorReading =
  | { kind: 'talk'; reply: { reply: string; chips: Knowledge['chips'] } }
  | { kind: 'actions'; actions: MapAction[]; readAs: string | null }
  | { kind: 'unknown'; text: string };

/** The names on the map: rooms, places and floors. */
export const mapNames = (s: MapState | null): string[] =>
  s ? [...s.rows.rooms.map(r => r.name), ...s.rows.nodes.map(n => n.name), ...s.rows.floors.map(f => f.name)].filter((x): x is string => !!x) : [];

export function readEditorRequest(said: string, s: MapState | null, extraWords: readonly string[] = []): EditorReading {
  const names = mapNames(s);
  const fixed = correct(said, vocabulary(EDITOR_WORDS, PARSER_WORDS, extraWords, PLACE_VOCABULARY, names));
  // The words written out ("fix wat u can" → "fix what you can") are another reading even when nothing was misspelled.
  const alt = fixed.changed || fixed.text !== plainWords(said) ? fixed.text : null;
  // Greetings, thanks, "what can you do?", "what's a room?": answered right away.
  const talk = smallTalk(said, s) ?? (alt ? smallTalk(alt, s) : null) ?? knowledge(said) ?? (alt ? knowledge(alt) : null);
  if (talk) return { kind: 'talk', reply: talk };
  // With typos fixed, the corrected reading first: corrections only move unknown words to the map's
  // names and the assistant's own words, and "conect rom 1…" parses as typed but names no place.
  // Otherwise as typed first: "zoom to fit" is understood as it is, before slang is said plainly.
  const asTyped = fixed.typos ? null : parseIntent(said, names);
  const fromAlt = asTyped || !alt ? null : parseIntent(alt, names);
  const actions = asTyped ?? fromAlt ?? (fixed.typos ? parseIntent(said, names) : null);
  if (!actions) return { kind: 'unknown', text: alt ?? said };
  return { kind: 'actions', actions: fromAlt ? actions.map(a => asTypedNames(a, said)) : actions, readAs: fromAlt && fixed.changed ? alt : null };
}

const NAME_FIELDS = ['name', 'target', 'near', 'from', 'to', 'a', 'b', 'what'] as const;
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Names as they were typed: the corrected reading writes "Staff Room" as "staffroom" and "X-Ray"
 * as "x ray". A name whose letters are all in the message, in a row, keeps the typed spelling.
 */
function asTypedNames(action: MapAction, said: string): MapAction {
  const words = said.split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
  const out: Record<string, unknown> = { ...action };
  for (const f of NAME_FIELDS) {
    const v = out[f];
    if (typeof v !== 'string' || !v || ['this', 'it', 'here'].includes(v)) continue;
    const want = key(v);
    for (let i = 0; i < words.length && out[f] === v; i++) {
      let k = '';
      for (let j = i; j < words.length && k.length < want.length; j++) {
        k += key(words[j]);
        if (k === want) { out[f] = words.slice(i, j + 1).join(' '); break; }
      }
    }
  }
  return out as MapAction;
}
