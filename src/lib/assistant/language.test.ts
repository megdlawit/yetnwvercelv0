import { describe, expect, it } from 'vitest';
import { correct, editDistance, matchNames, normalize, pick, vocabulary } from './language';

describe('how people type', () => {
  it('writes out chat spelling and contractions', () => {
    expect(normalize("Where's the TOILET??")).toBe('where is the toilet');
    expect(normalize('how r u doin')).toBe('how are you doing');
    expect(normalize('take me to room12 pls')).toBe('take me to room 12 please');
    expect(normalize('ሽንት ቤት የት ነው?')).toBe('ሽንት ቤት የት ነው');
  });

  it('counts swapped letters as one typo', () => {
    expect(editDistance('toilet', 'toliet')).toBe(1);
    expect(editDistance('where', 'wher')).toBe(1);
    expect(editDistance('elevator', 'escalator', 2)).toBe(3);   // gave up past 2
  });

  it('corrects typos towards words it knows, and leaves other words and numbers alone', () => {
    const v = vocabulary('where is the toilet nearest elevator take me to directions', ['Conference Room 2', 'Cafeteria']);
    expect(correct('wher is the toilt', v)).toEqual({ text: 'where is the toilet', changed: true });
    expect(correct('nearst elevater', v).text).toBe('nearest elevator');
    expect(correct('take me to the cafetria', v).text).toBe('take me to the cafeteria');
    expect(correct('is there a lovely garden', v).text).toBe('is there a lovely garden');   // not "nearest"/"elevator"
    expect(correct('room 21', v).text).toBe('room 21');
  });
});

describe('finding the place meant', () => {
  const places = ['Room 1', 'Room 12', 'Conference Room 2', 'Main Cafeteria', 'Ladies Toilet', 'Gents Toilet'];
  const best = (q: string) => pick(matchNames(q, places, p => p));

  it('knows a name with typos, extra words or words left out', () => {
    expect(best('room 12').sure).toBe('Room 12');
    expect(best('conferance rom 2').sure).toBe('Conference Room 2');
    expect(best('the cafeteria').sure).toBe('Main Cafeteria');
  });

  it('never takes one number for another', () => {
    expect(best('room 1').sure).toBe('Room 1');
    expect(best('room 3').sure).toBeNull();
  });

  it('asks when two fit', () => {
    expect(best('toilet')).toEqual({ sure: null, maybe: ['Ladies Toilet', 'Gents Toilet'] });
  });
});

describe('the editor reads past typos', () => {
  it('understands a command typed in a hurry', async () => {
    const { parseIntent } = await import('./intent');
    const v = vocabulary('connect disconnect add remove rename move undo room rooms restroom here', ['Room 1', 'Room 2', 'Lobby']);
    const said = 'conect rom 1 and rom 2';
    const fixed = correct(said, v);
    expect(fixed.text).toBe('connect room 1 and room 2');
    expect(parseIntent(fixed.text)).toEqual([expect.objectContaining({ op: 'connect', from: expect.stringMatching(/room 1/i), to: expect.stringMatching(/room 2/i) })]);
  });
});

describe('English slang in the floor editor', () => {
  it('reads slang, chat speak and held-down keys as the request they mean', async () => {
    const { parseIntent } = await import('./intent');
    const v = vocabulary('connect remove move add undo redo publish check fix rename rotate make bigger smaller room bench lobby cafe entrance here',
      ['Room 1', 'Room 2', 'Lobby', 'Cafe', 'Main Entrance']);
    const op = (said: string) => parseIntent(correct(said, v).text)?.[0]?.op ?? null;
    const cases: [string, string][] = [
      ['nuke room 1', 'remove'], ['yeet the bench lol', 'remove'], ['ditch dat bench pls', 'remove'],
      ['hook up the cafe and the lobby', 'connect'], ['wire up room 1 n room 2', 'connect'], ['conect rom 1 & rom 2 bruh', 'connect'],
      ['nudge it left', 'move'], ['scoot the bench over to the right', 'move'], ['shove room 2 next to the lobby', 'move'],
      ['chuck a bench here', 'add'], ['pop a restroom next to the lobby', 'add'],
      ['beef up room 1', 'resize'], ['make room 2 smol', 'resize'], ['spin it 90', 'rotate'],
      ['call it Staff Room', 'rename'],
      ['my bad', 'undo'], ['ctrl z', 'undo'], ['oopsie', 'undo'], ['ctrl y', 'redo'],
      ['are we good', 'health'], ['anything broken?', 'health'], ['sort it all out', 'fix_all'], ['clean it up', 'fix_all'],
      ['ship it', 'publish'], ['pan out', 'fit'], ['where the lobby at', 'show'], ['heyyy connnect room 1 and room 2 pleeease', 'connect'],
    ];
    for (const [said, want] of cases) expect(op(said), said).toBe(want);
  });

  it('leaves plain requests alone', () => {
    const v = vocabulary('connect room', ['Room 1', 'Room 2']);
    expect(correct('connect room 1 and room 2', v)).toEqual({ text: 'connect room 1 and room 2', changed: false });
    expect(correct('flip to 3d', v).text).toBe('flip to 3d');
  });
});

describe('casual hellos', () => {
  it('knows them however they are typed', async () => {
    const { smallTalkKind } = await import('./smalltalk');
    const v = vocabulary('hello how are you doing');
    for (const [said, kind] of [['wassup', 'greeting'], ["what's up bro", 'greeting'], ['heyyy', 'greeting'], ['yo', 'greeting'],
      ['how u doin', 'howareyou'], ['hows it goin', 'howareyou'], ['u good?', 'howareyou'], ['thx m8', null]] as const) {
      const t = correct(said, v).text;
      expect(smallTalkKind(t) ?? smallTalkKind(said), said).toBe(kind ?? smallTalkKind(t));
    }
  });
});
