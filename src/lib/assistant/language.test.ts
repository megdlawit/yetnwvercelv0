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
