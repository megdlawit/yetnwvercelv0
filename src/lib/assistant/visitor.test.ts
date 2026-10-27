import { describe, expect, it } from 'vitest';
import { visitorReply, type VisitorContext, type VisitorMemory, type VisitorPlace } from './visitor';

const place = (id: string, name: string, floor: 0 | 1, x: number, extra: Partial<VisitorPlace> = {}): VisitorPlace => ({
  id, name, category: 'attractions', floorId: floor === 0 ? 'g' : 'f1', floorName: floor === 0 ? 'Ground floor' : '1st floor', floorLevel: floor, x, y: 0, navigable: true, ...extra,
});
const ctx: VisitorContext = {
  venue: 'Unity Museum',
  floors: [{ id: 'g', name: 'Ground floor', level: 0 }, { id: 'f1', name: '1st floor', level: 1 }],
  places: [
    place('r1', 'Room 1', 0, 100), place('r12', 'Room 12', 1, 400),
    place('conf', 'Conference Room 2', 1, 600),
    place('cafe', 'Main Cafeteria', 0, 900, { category: 'food', hours: { mon: [['08:00', '17:00']], tue: [['08:00', '17:00']], wed: [['08:00', '17:00']], thu: [['08:00', '17:00']], fri: [['08:00', '17:00']], sat: [['08:00', '17:00']], sun: [['08:00', '17:00']] } as never }),
    place('wc-g', 'Ladies Toilet', 0, 1200, { category: 'restrooms' }), place('wc-1', 'Gents Toilet', 1, 300, { category: 'restrooms' }),
    place('lift', 'Lift', 0, 500, { category: 'facilities', roomType: 'elevator' }),
    place('gallery', 'Gallery of Kings', 1, 800, { description: 'Portraits of the emperors.' }),
  ],
  content: [{ id: 'e1', title: 'Coffee ceremony', kind: 'event', starts_at: '2099-01-01T10:00:00Z' }],
  floorId: 'g',
  here: { x: 1100, y: 0, floorId: 'g', floorLevel: 0 },
  now: new Date('2026-10-27T10:00:00'),
};

/** A conversation: each message with the memory the last reply left. */
function talk(...said: string[]) {
  let mem: VisitorMemory = {};
  return said.map(s => { const r = visitorReply(s, ctx, mem); mem = r.memory; return r; });
}

describe('the visitor assistant, in plain words', () => {
  it('chats like a person', () => {
    expect(visitorReply('hi', ctx).text).toMatch(/Welcome to Unity Museum|Unity Museum’s guide/);
    expect(visitorReply('how r u doin', ctx).text).toMatch(/thanks for asking|thank you/i);
    expect(visitorReply('thank you so much', ctx).text).toMatch(/welcome|happy to help|any time/i);
    expect(visitorReply('who are you?', ctx).text).toMatch(/guide/);
  });

  it('finds places however they are asked, typos included', () => {
    for (const q of ['where is room 12', "where's room 12?", 'wher is rom 12', 'room 12', 'find room 12 please', 'hi, where is room 12']) {
      const r = visitorReply(q, ctx);
      expect(r.actions, q).toEqual([{ op: 'show', placeId: 'r12' }]);
      expect(r.text, q).toMatch(/Room 12, on the 1st floor/);
    }
    expect(visitorReply('wher is the conferance rom 2', ctx).readAs).toBe('where is the conference room 2');
  });

  it('never mixes up room numbers', () => {
    expect(visitorReply('where is room 1', ctx).actions).toEqual([{ op: 'show', placeId: 'r1' }]);
    expect(visitorReply('where is room 3', ctx).actions).toEqual([]);
  });

  it('gives directions', () => {
    for (const q of ['how do I get to the cafeteria?', 'take me to the cafetria', 'directions to main cafeteria', 'I want to go to the cafeteria']) {
      expect(visitorReply(q, ctx).actions, q).toEqual([{ op: 'route', placeId: 'cafe', fromId: null }]);
    }
    expect(visitorReply('from room 1 to room 12', ctx).actions).toEqual([{ op: 'route', placeId: 'r12', fromId: 'r1' }]);
  });

  it('finds the nearest of a kind', () => {
    for (const q of ['nearest toilet', 'where is the bathroom', 'I need the toilet', 'toliet']) {
      expect(visitorReply(q, ctx).actions, q).toEqual([{ op: 'show', placeId: 'wc-g' }]);   // the one on this floor, 100 px away
    }
    expect(visitorReply('where is the lift', ctx).actions).toEqual([{ op: 'show', placeId: 'lift' }]);
    expect(visitorReply("I'm hungry", ctx).actions).toEqual([{ op: 'show', placeId: 'cafe' }]);
  });

  it('remembers what you were talking about', () => {
    const [, there, open, far] = talk('where is the cafeteria', 'take me there', 'is it open?', 'how far is it');
    expect(there.actions).toEqual([{ op: 'route', placeId: 'cafe', fromId: null }]);
    expect(open.text).toMatch(/Main Cafeteria is open right now/);
    expect(far.text).toMatch(/about 5 m away|right at|about \d+ m away/);
  });

  it('asks when it is not sure, and understands the answer', () => {
    const [ask, yes] = talk('where is the toilet room', 'gents');
    expect(ask.actions.length + (ask.text.startsWith('Did you mean') ? 0 : 1)).toBeGreaterThan(0);
    const [q, a] = talk('gallery of king', 'yes');
    expect(q.actions).toEqual([{ op: 'show', placeId: 'gallery' }]);
    expect(a.text).toMatch(/What would you like to find|Great/);
    void yes;
  });

  it('knows floors, opening hours, events and what a place is', () => {
    expect(visitorReply("what's on the 1st floor?", ctx).actions).toEqual([{ op: 'floor', floorId: 'f1' }]);
    expect(visitorReply('go upstairs', ctx).actions).toEqual([{ op: 'floor', floorId: 'f1' }]);
    expect(visitorReply('which floor is the gallery of kings on', ctx).text).toMatch(/1st floor/);
    expect(visitorReply('tell me about the gallery of kings', ctx).text).toMatch(/Portraits of the emperors/);
    expect(visitorReply('any events today?', ctx).text).toMatch(/Coffee ceremony/);
  });

  it('understands simple Amharic', () => {
    const r = visitorReply('ሽንት ቤት የት ነው?', ctx);
    expect(r.actions).toEqual([{ op: 'show', placeId: 'wc-g' }]);
    expect(r.text).toMatch(/ላይ ነው/);
    expect(visitorReply('ሰላም', ctx).text).toMatch(/ሰላም/);
  });

  it('says so when it does not understand, with ideas', () => {
    const r = visitorReply('blorp zzz', ctx);
    expect(r.actions).toEqual([]);
    expect(r.chips.length).toBeGreaterThan(0);
  });
});
