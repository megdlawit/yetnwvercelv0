import { describe, expect, it } from 'vitest';
import { correct, normalize, vocabulary, PLACE_VOCABULARY } from './language';
import { smallTalk, smallTalkKind } from './smalltalk';
import { visitorReply, type VisitorContext } from './visitor';
import { parseIntent } from './intent';

const ctx: VisitorContext = {
  venue: 'Unity Museum',
  floors: [{ id: 'g', name: 'Ground floor', level: 0 }, { id: 'f1', name: '1st floor', level: 1 }],
  places: [
    { id: 'r12', name: 'Room 12', category: 'attractions', floorId: 'f1', floorName: '1st floor', floorLevel: 1, x: 0, y: 0, navigable: true },
    { id: 'wc', name: 'Rest Room', category: 'restrooms', floorId: 'g', floorName: 'Ground floor', floorLevel: 0, x: 0, y: 0, navigable: true },
    { id: 'cafe', name: 'Main Cafe', category: 'food', floorId: 'g', floorName: 'Ground floor', floorLevel: 0, x: 0, y: 0, navigable: true },
  ],
  content: [], floorId: 'g', here: null,
};

describe('spacing does not change the answer', () => {
  it('"good bye" and "goodbye" (and friends) are the same message', () => {
    const groups = [
      ['goodbye', 'good bye', 'Good-bye!', 'GOOD BYE'],
      ['thank you', 'thankyou', 'thank-you'],
      ['how are you', 'howareyou', 'how areyou'],
      ['where is room 12', 'whereis room 12', 'where is room12', 'whereisroom 12'],
      ['nearest restroom', 'nearest rest room', 'nearest rest-room', 'nearestrestroom'],
    ];
    for (const g of groups) {
      const visitor = new Set(g.map(s => visitorReply(s, ctx).text));
      expect(visitor.size, g.join(' / ')).toBe(1);
    }
  });

  it('the editor gives one answer to them too', () => {
    const v = vocabulary('hello goodbye thanks how are you');
    for (const g of [['goodbye', 'good bye', 'good-bye'], ['thank you', 'thankyou']]) {
      const kinds = new Set(g.map(s => smallTalkKind(s) ?? smallTalkKind(correct(s, v).text)));
      expect(kinds.size, g.join(' / ')).toBe(1);
      const replies = new Set(g.map(s => (smallTalk(s, null) ?? smallTalk(correct(s, v).text, null))?.reply));
      expect(replies.size, g.join(' / ')).toBe(1);
    }
  });

  it('splits words run together and joins words split apart', () => {
    const v = vocabulary('where is take me to the nearest toilet ground floor show connect room and', PLACE_VOCABULARY);
    expect(correct('takemeto the toilet', v).text).toBe('take me to the toilet');
    expect(correct('show the groundfloor', v).text).toBe('show the ground floor');
    expect(correct('nearesttoilet', v).text).toBe('nearest toilet');
    expect(normalize('the wheel chair ramp')).toBe('the wheelchair ramp');
    expect(normalize('the stair case')).toBe('the staircase');
    expect(normalize('up stairs')).toBe('upstairs');
    expect(parseIntent(correct('connectroom 1 and room 2', v).text)?.[0]?.op).toBe('connect');
  });

  it('leaves real two-word phrases alone', () => {
    expect(normalize('zoom in to the cafe')).toBe('zoom in to the cafe');
    expect(normalize('it may be here')).toBe('it may be here');
    expect(normalize('set up a desk')).toBe('set up a desk');
    expect(normalize('take away the bench')).toBe('take away the bench');
  });
});
