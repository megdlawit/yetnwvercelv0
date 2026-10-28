import { describe, expect, it } from 'vitest';
import { CHAT, FILLER, MISSPELLINGS, OBJECT_WORDS, PLACE_WORDS, SMALL_TALK, VERBS, lexiconSize } from './lexicon';
import { PLACE_VOCABULARY, correct, normalize, vocabulary } from './language';
import { parseIntent, roomKind } from './intent';
import { smallTalkKind } from './smalltalk';

describe('the word bank', () => {
  it('holds well over a thousand words and phrases', () => {
    expect(lexiconSize()).toBeGreaterThan(1500);
  });

  it('never "corrects" a word it knows: no misspelling is itself a place, object or verb', () => {
    const known = new Set([...PLACE_VOCABULARY, ...OBJECT_WORDS, ...Object.values(VERBS).flat()]);
    const clash = Object.keys(MISSPELLINGS).filter(w => known.has(w) && MISSPELLINGS[w] !== w);
    expect(clash).toEqual([]);
  });

  it('keeps every entry tidy: lower case, no stray quotes', () => {
    const all = [...Object.keys(MISSPELLINGS), ...Object.keys(CHAT), ...FILLER, ...Object.values(VERBS).flat(), ...PLACE_VOCABULARY,
      ...Object.values(SMALL_TALK).flat()];
    expect(all.filter(w => w !== w.toLowerCase() || /['"`]{2}|^'|'$/.test(w))).toEqual([]);
  });
});

describe('words from the bank, understood', () => {
  const v = vocabulary('connect remove move add rename rotate make bigger smaller undo redo check fix publish show room bench lobby cafe here',
    PLACE_VOCABULARY, ['Room 1', 'Room 2', 'Lobby', 'Cafe', 'Library']);
  const op = (said: string) => parseIntent(correct(said, v).text)?.[0]?.op ?? null;

  it('common misspellings', () => {
    expect(correct('wher is the resturant', v).text).toBe('where is the restaurant');
    expect(correct('the elevater is beside the libary', v).text).toBe('the elevator is beside the library');
    expect(correct('definately seperate', v)).toEqual({ text: 'definitely separate', changed: true, typos: true });
  });

  it('chat spellings and noise', () => {
    expect(normalize('ngl idk wat 2 do tbh')).toBe('i do not know what 2 do');
    expect(normalize('thx m8 cya l8r')).toBe('thanks mate bye later');
    expect(normalize('bcuz u r gr8')).toBe('because you are great');
  });

  it('every way of saying an action', () => {
    const cases: [string, string][] = [
      ['demolish room 1', 'remove'], ['obliterate the bench', 'remove'], ['tear down the bench', 'remove'], ['scrub the bench', 'remove'],
      ['plop a bench next to the lobby', 'add'], ['stick in a bench here', 'add'],
      ['relocate room 1 next to the lobby', 'move'], ['reposition the bench to the left', 'move'],
      ['attach room 1 to room 2', 'connect'], ['patch the cafe into the lobby', 'connect'],
      ['detach room 1 from room 2', 'disconnect'], ['sever room 1 and room 2', 'disconnect'],
      ['relabel room 1 as Staff Room', 'rename'], ['retitle room 2 to Store', 'rename'],
      ['swivel the bench 45', 'rotate'], ['pivot room 1 by 90 degrees', 'rotate'],
      ['enlarge room 1', 'resize'], ['widen the cafe', 'resize'], ['downsize room 2', 'resize'], ['compress the lobby', 'resize'],
      ['rollback', 'undo'], ['forget that', 'undo'], ['cmd z', 'undo'],
      ['audit the map', 'health'], ['diagnose it', 'health'], ['patch it up', 'fix_all'], ['mend everything', 'fix_all'],
      ['deploy', 'publish'], ['release it', 'publish'], ['highlight the cafe', 'show'], ['spot the library', 'show'],
    ];
    for (const [said, want] of cases) expect(op(said), said).toBe(want);
  });

  it('room kinds from their everyday names', () => {
    expect(roomKind('loo')).toBe('restroom');
    expect(roomKind('guard house')).toBe('utility');
    expect(roomKind('boiler room')).toBe('utility');
    expect(roomKind('boardroom')).toBe('meeting');
    expect(roomKind('Conference Room')).toBe('meeting');   // the patterns still win when they're specific
    expect(roomKind('Gallery')).toBe('office');
  });

  it('small talk in many forms', () => {
    for (const [said, kind] of [['salutations', 'greeting'], ["g'day mate", 'greeting'], ['long time no see', 'greeting'],
      ['how goes it', 'howareyou'], ['hope you are well', 'howareyou'], ['cheers mate', 'thanks'], ['you are a lifesaver', 'thanks'],
      ['catch you later', 'bye'], ['peace out', 'bye'], ['nailed it', 'compliment'], ['top notch', 'compliment']] as const) {
      expect(smallTalkKind(said) ?? smallTalkKind(normalize(said)), said).toBe(kind);
    }
  });
});
