// The visitor's guide on many ways of asking (typos, slang, Amharic, half sentences): what it does on
// the map for each. QUESTIONS were written while improving the guide; MORE were written afterwards
// and first scored untouched (83%, then fixed), so both now guard what it understands.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { visitorReply, VISITOR_WORDS, type VisitorContext, type VisitorPlace } from './visitor';

const P = (id: string, name: string, floor: -1 | 0 | 1, x: number, extra: Partial<VisitorPlace> = {}): VisitorPlace => ({
  id, name, category: 'attractions', floorId: floor === 0 ? 'g' : floor === 1 ? 'f1' : 'b', floorName: floor === 0 ? 'Ground floor' : floor === 1 ? '1st floor' : 'Basement',
  floorLevel: floor, x, y: 0, navigable: true, ...extra,
});
const hours = { mon: [['08:00', '17:00']], tue: [['08:00', '17:00']], wed: [['08:00', '17:00']], thu: [['08:00', '17:00']], fri: [['08:00', '17:00']], sat: [['09:00', '13:00']], sun: [] } as never;
const ctx: VisitorContext = {
  venue: 'Unity Park',
  floors: [{ id: 'b', name: 'Basement', level: -1 }, { id: 'g', name: 'Ground floor', level: 0 }, { id: 'f1', name: '1st floor', level: 1 }],
  places: [
    P('ent', 'Main Entrance', 0, 0, { category: 'entrances' }), P('gate2', 'North Gate', 0, 2000, { category: 'entrances' }),
    P('wc-l', 'Ladies Toilet', 0, 300, { category: 'restrooms', roomType: 'restroom' }), P('wc-g', 'Gents Toilet', 1, 300, { category: 'restrooms', roomType: 'restroom' }),
    P('cafe', 'Lucy Café', 0, 900, { category: 'food', hours }), P('rest', 'Habesha Restaurant', 1, 1500, { category: 'food' }),
    P('shop', 'Gift Shop', 0, 600, { typeLabel: 'Shop' }), P('g1', 'Gallery 1', 1, 400, { description: 'Paintings of Ethiopian kings.' }),
    P('g2', 'Gallery 2', 1, 700), P('lift', 'Lift', 0, 500, { category: 'facilities', roomType: 'elevator' }),
    P('stairs', 'Main Stairs', 0, 520, { category: 'facilities', roomType: 'stairs' }), P('info', 'Information Desk', 0, 100, { category: 'facilities', typeLabel: 'Info desk' }),
    P('pray', 'Prayer Room', 1, 1200, { category: 'facilities' }), P('park', 'Car Park', -1, 100, { category: 'parking' }),
    P('atm', 'CBE ATM', 0, 150, { category: 'facilities' }), P('aid', 'First Aid Room', 0, 1800, { category: 'facilities' }),
    P('kids', 'Kids Corner', 0, 1300, { category: 'family' }), P('zoo', 'Animal Zoo', 0, 2400), P('garden', 'Rose Garden', 0, 2200, { category: 'gardens' }),
    P('r12', 'Room 12', 1, 1000), P('hall', 'Menelik Banquet Hall', 0, 1600, { description: 'The old palace banquet hall.' }),
    P('ticket', 'Ticket Office', 0, 50, { category: 'facilities' }), P('museum', 'Palace Museum', 1, 1900),
  ],
  content: [{ id: 'e1', title: 'Coffee ceremony', kind: 'event', starts_at: '2099-01-01T10:00:00Z' }, { id: 'e2', title: 'Night tour', kind: 'event', starts_at: '2099-01-02T19:00:00Z' }],
  floorId: 'g',
  here: { x: 1100, y: 0, floorId: 'g', floorLevel: 0 },
  now: new Date('2026-10-27T10:00:00'),
};

// expected: op:id (show/route/floor), 'content', 'talk' (an answer, nothing on the map), 'ask' (a question back)
const QUESTIONS: [string, string][] = [
  // where is
  ['where is the toilet', 'show:wc-l'], ['wheres the bathroom', 'show:wc-l'], ['toilet?', 'show:wc-l'], ['i need to pee', 'show:wc-l'],
  ['where can i find a restroom', 'show:wc-l'], ['washroom pls', 'show:wc-l'], ['is there a toilet here', 'show:wc-l'], ['wc', 'show:wc-l'],
  ['wher is the tiolet', 'show:wc-l'], ['nearest loo', 'show:wc-l'], ['ladies room', 'show:wc-l'], ['gents', 'show:wc-g'], ['men toilet', 'show:wc-g'],
  ['mens room', 'show:wc-g'], ['womens toilet', 'show:wc-l'], ['where do i wash my hands', 'show:wc-l'], ['any toilets around', 'show:wc-l'],
  ['where is the cafe', 'show:cafe'], ['coffee', 'show:cafe'], ['i want coffee', 'show:cafe'], ['where can i get a coffee', 'show:cafe'],
  ['i am hungry', 'show:cafe'], ['im starving', 'show:cafe'], ['somewhere to eat', 'show:cafe'], ['food court', 'show:cafe'], ['where can i grab a bite', 'show:cafe'],
  ['restaurant', 'show:rest'], ['habesha restaurant', 'show:rest'], ['where is lucy cafe', 'show:cafe'], ['lucy', 'show:cafe'],
  ['gift shop', 'show:shop'], ['where can i buy souvenirs', 'show:shop'], ['shop', 'show:shop'], ['where is the store', 'show:shop'],
  ['room 12', 'show:r12'], ['rm 12', 'show:r12'], ['where is room twelve', 'show:r12'], ['room12', 'show:r12'],
  ['gallery 1', 'show:g1'], ['gallery one', 'show:g1'], ['first gallery', 'show:g1'], ['galery 2', 'show:g2'],
  ['lift', 'show:lift'], ['elevator', 'show:lift'], ['where is the elevator', 'show:lift'], ['elevater', 'show:lift'],
  ['stairs', 'show:stairs'], ['staircase', 'show:stairs'], ['where are the stairs', 'show:stairs'],
  ['exit', 'show:gate2'], ['way out', 'show:gate2'], ['how do i get out', 'route:gate2'], ['emergency exit', 'show:gate2'], ['entrance', 'show:ent'],
  ['north gate', 'show:gate2'], ['main gate', 'show:gate2'],
  ['information', 'show:info'], ['info desk', 'show:info'], ['help desk', 'show:info'], ['reception', 'show:info'], ['where can i ask someone', 'show:info'],
  ['prayer room', 'show:pray'], ['where can i pray', 'show:pray'], ['mosque', 'show:pray'],
  ['parking', 'show:park'], ['where did i park', 'show:park'], ['car park', 'show:park'], ['where can i park my car', 'show:park'],
  ['atm', 'show:atm'], ['where is the atm', 'show:atm'], ['i need cash', 'show:atm'], ['cash machine', 'show:atm'], ['bank', 'show:atm'],
  ['first aid', 'show:aid'], ['i need a doctor', 'show:aid'], ['someone is hurt', 'show:aid'], ['clinic', 'show:aid'], ['medical help', 'show:aid'],
  ['kids', 'show:kids'], ['play area for children', 'show:kids'], ['where can my kids play', 'show:kids'], ['playground', 'show:kids'],
  ['zoo', 'show:zoo'], ['animals', 'show:zoo'], ['where are the lions', 'show:zoo'], ['garden', 'show:garden'], ['flowers', 'show:garden'], ['rose garden', 'show:garden'],
  ['banquet hall', 'show:hall'], ['menelik hall', 'show:hall'], ['tickets', 'show:ticket'], ['where do i buy tickets', 'show:ticket'], ['ticket office', 'show:ticket'],
  ['museum', 'show:museum'], ['palace museum', 'show:museum'], ['the palace', 'show:museum'],
  ['can u show me the gift shop', 'show:shop'], ['could you please tell me where the toilet is', 'show:wc-l'], ['do you know where the cafe is', 'show:cafe'],
  ['excuse me where is gallery 2', 'show:g2'], ['hey where r the toilets', 'show:wc-l'], ['looking for the zoo', 'show:zoo'], ['im looking for room 12', 'show:r12'],
  ['i cant find the toilet', 'show:wc-l'], ['which way to the cafe', 'route:cafe'], ['which way is the exit', 'route:gate2'],
  ['WHERE IS THE TOILET', 'show:wc-l'], ['toilet!!!', 'show:wc-l'], ['where is the toilet plz', 'show:wc-l'],
  // directions
  ['take me to the cafe', 'route:cafe'], ['how do i get to gallery 2', 'route:g2'], ['directions to the zoo', 'route:zoo'], ['navigate to room 12', 'route:r12'],
  ['guide me to the toilet', 'route:wc-l'], ['bring me to the exit', 'route:gate2'], ['i want to go to the garden', 'route:garden'], ['lets go to the museum', 'route:museum'],
  ['how can i reach the prayer room', 'route:pray'], ['show me the way to the lift', 'route:lift'], ['walk me to the gift shop', 'route:shop'],
  ['how to get to the parking', 'route:park'], ['way to the restaurant', 'route:rest'], ['route to gallery 1', 'route:g1'], ['go to kids corner', 'route:kids'],
  ['tak me to the cafe', 'route:cafe'], ['how do i go to the zoo', 'route:zoo'], ['can you take me to the toilet', 'route:wc-l'], ['get me to the exit fast', 'route:gate2'],
  ['from the entrance to gallery 2', 'route:g2'], ['how do i get from the cafe to the zoo', 'route:zoo'], ['i want to walk to the rose garden', 'route:garden'],
  ['help me get to room 12', 'route:r12'], ['how do i find my way to the museum', 'route:museum'], ['what is the fastest way to the exit', 'route:gate2'],
  ['how long to walk to the zoo', 'show:zoo'], ['how far is the zoo', 'show:zoo'], ['is the garden far', 'show:garden'], ['how many minutes to the cafe', 'show:cafe'],
  // hours
  ['is the cafe open', 'show:cafe'], ['when does lucy cafe close', 'show:cafe'], ['opening hours of the cafe', 'show:cafe'], ['what time does the cafe open', 'show:cafe'],
  ['is the cafe open now', 'show:cafe'], ['cafe hours', 'show:cafe'], ['what time does the museum close', 'show:museum'], ['is the museum open today', 'show:museum'],
  ['till what time is the cafe open', 'show:cafe'],
  // floors
  ['what is on the first floor', 'floor:f1'], ['whats upstairs', 'floor:f1'], ['show me the basement', 'floor:b'], ['go to the ground floor', 'floor:g'],
  ['what is on the 1st floor', 'floor:f1'], ['which floor is room 12 on', 'show:r12'], ['what floor is the gallery on', 'show:g2'], ['upstairs', 'floor:f1'],
  ['what is in the basement', 'floor:b'], ['take me upstairs', 'floor:f1'], ['floor 1', 'floor:f1'], ['level 1', 'floor:f1'],
  // about
  ['tell me about gallery 1', 'show:g1'], ['what is gallery 1', 'show:g1'], ['what is the banquet hall', 'show:hall'], ['describe the museum', 'show:museum'],
  ['what can i see in gallery 1', 'show:g1'], ['info about the zoo', 'show:zoo'], ['whats in gallery 1', 'show:g1'],
  // events & overview
  ['what events are on', 'content'], ['anything happening today', 'content'], ['whats on today', 'content'], ['any shows tonight', 'content'], ['events', 'content'],
  ['what can i do here', 'talk'], ['what is there to see', 'talk'], ['recommend something', 'talk'], ['what should i visit', 'talk'], ['what is fun here', 'talk'],
  ['give me a tour', 'talk'], ['show me around', 'talk'], ['best things to see', 'talk'], ['top attractions', 'talk'],
  // small talk & help
  ['hi', 'talk'], ['hello there', 'talk'], ['good morning', 'talk'], ['selam', 'talk'], ['how are you', 'talk'], ['thank you', 'talk'], ['thanks a lot', 'talk'],
  ['bye', 'talk'], ['who are you', 'talk'], ['what can you do', 'talk'], ['help', 'talk'], ['i am lost', 'talk'], ['im lost', 'talk'], ['where am i', 'talk'],
  ['are you a robot', 'talk'], ['you are great', 'talk'], ['this is useless', 'talk'], ['ok', 'talk'], ['cool', 'talk'], ['nice', 'talk'],
  ['is it wheelchair accessible', 'talk'], ['can i use a wheelchair', 'talk'], ['does the map work offline', 'talk'], ['how do i scan the qr code', 'talk'],
  ['can i speak amharic', 'talk'], ['what is the wifi password', 'talk'], ['what time is it', 'talk'], ['how much is the ticket', 'show:ticket'],
  ['when does the park close', 'talk'], ['when does unity park open', 'talk'], ['is the park open', 'talk'],
  // Amharic
  ['ሽንት ቤት የት ነው', 'show:wc-l'], ['ቡና የት ነው', 'show:cafe'], ['መውጫ የት ነው', 'show:gate2'], ['ሊፍት የት ነው', 'show:lift'], ['ሰላም', 'talk'],
];

const MORE: [string, string][] = [
  ['yo wheres the nearest bathroom at', 'show:wc-l'], ['bathroom where', 'show:wc-l'], ['need the loo badly', 'show:wc-l'], ['is there a ladies room on this floor', 'show:wc-l'],
  ['where is the gents toilet', 'show:wc-g'], ['toilets for men?', 'show:wc-g'], ['restroom near me', 'show:wc-l'], ['wherez the toliet', 'show:wc-l'],
  ['somewhere i can get tea', 'show:cafe'], ['is there food here', 'show:cafe'], ['can i get something to drink', 'show:cafe'], ['where to eat', 'show:cafe'],
  ['what time does lucy cafe open tomorrow', 'show:cafe'], ['is lucy cafe still open', 'show:cafe'], ['cafe open?', 'show:cafe'],
  ['i would like to see the paintings', 'show:g1'], ['where are the paintings', 'show:g1'], ['show me gallery two', 'show:g2'], ['second gallery', 'show:g2'],
  ['is there an elevator', 'show:lift'], ['wheelchair lift', 'show:lift'], ['where is the lift please', 'show:lift'],
  ['how do i get to the zoo from here', 'route:zoo'], ['walk me to the zoo', 'route:zoo'], ['directions to room 12 please', 'route:r12'], ['route me to the gift shop', 'route:shop'],
  ['i wanna go to the garden', 'route:garden'], ['take me to the toilets asap', 'route:wc-l'], ['can you show me how to get to the cafe', 'route:cafe'],
  ['which floor is the restaurant', 'show:rest'], ['is the prayer room upstairs', 'show:pray'], ['what level is the museum', 'show:museum'],
  ['how far away is the rose garden', 'show:garden'], ['is the zoo close', 'show:zoo'], ['distance to the exit', 'show:gate2'],
  ['where can i buy a gift', 'show:shop'], ['souvenir shop', 'show:shop'], ['shopping', 'show:shop'],
  ['where do i get tickets', 'show:ticket'], ['box office', 'show:ticket'], ['i need help', 'talk'], ['help me', 'talk'], ['who works here', 'show:info'],
  ['where can i leave my car', 'show:park'], ['parking lot', 'show:park'], ['is there parking', 'show:park'],
  ['i feel sick', 'show:aid'], ['my child is hurt', 'show:aid'], ['where is the nurse', 'show:aid'],
  ['place for kids', 'show:kids'], ['my kids are bored', 'show:kids'], ['baby changing', 'show:kids'],
  ['any events this weekend', 'content'], ['what is happening tonight', 'content'], ['concerts', 'content'],
  ['what is upstairs', 'floor:f1'], ['go down one floor', 'floor:b'], ['show me level 1', 'floor:f1'], ['basement', 'floor:b'],
  ['tell me something about the banquet hall', 'show:hall'], ['what is the palace museum about', 'show:museum'], ['whats special about gallery 1', 'show:g1'],
  ['thanks!', 'talk'], ['ty', 'talk'], ['you are amazing', 'talk'], ['good evening', 'talk'], ['how is it going', 'talk'], ['what is your name', 'talk'],
  ['ቡና ቤት የት አለ', 'show:cafe'], ['ሽንት ቤት', 'show:wc-l'],
];

const outcome = (said: string) => {
  const r = visitorReply(said, ctx, {});
  const a = r.actions[0];
  return a ? (a.op === 'content' ? 'content' : `${a.op}:${'placeId' in a ? a.placeId : 'floorId' in a ? a.floorId : ''}`) : r.memory.offer ? 'ask' : 'talk';
};

describe('the guide understands many ways of asking', () => {
  it.each(QUESTIONS)('%s → %s', (said, want) => expect(outcome(said)).toBe(want));
  it.each(MORE)('%s → %s', (said, want) => expect(outcome(said)).toBe(want));

  it('knows every word its phrases use (so their typos are fixed, and they are never "corrected" away)', () => {
    const src = readFileSync('src/lib/assistant/visitor.ts', 'utf8').replace(/export const VISITOR_WORDS = `[^`]*`;/, '');
    const own = new Set(src.match(/const OWN_WORDS = `([^`]*)`/)![1].split(/\s+/));
    const known = new Set(VISITOR_WORDS.split(/\s+/));
    const literals = [...src.matchAll(/\/\^[^\n]*?\/[gimsuy]*(?=[.)\s,;]|$)/g), ...src.matchAll(/\/\\b\([^\n]*?\)\\b\/[gimsuy]*/g)];
    const used = literals.flatMap(m => m[0].replace(/\\[a-z]/g, ' ').match(/[a-z]{3,}/g) ?? []);
    expect([...new Set(used)].filter(w => !own.has(w) && !known.has(w) && w !== 'rmation')).toEqual([]);
  });
});
