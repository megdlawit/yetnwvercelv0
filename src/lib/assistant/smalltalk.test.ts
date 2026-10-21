import { describe, expect, it } from 'vitest';
import { plan, suggestions, type MapState } from './engine';
import { parseIntent, stripSocial } from './intent';
import { smallTalk, smallTalkKind } from './smalltalk';
import { mapState, P } from './testMap';

const emptyFloor = () => mapState({ floorId: 'g' });
/** The engine's replies when a request points at nothing (engine.ts notFound). */
const NOT_FOUND = /couldn't find|Select something on the map first/;

describe('small talk', () => {
  it('recognises greetings, thanks, help, who, bye — whole messages only', () => {
    for (const t of ['hi', 'Hey!', 'hello there', 'good morning', 'hiii', 'ሰላም', 'selam']) expect(smallTalkKind(t), t).toBe('greeting');
    for (const t of ['thanks', 'thank you so much!', 'thx', 'አመሰግናለሁ']) expect(smallTalkKind(t), t).toBe('thanks');
    for (const t of ['help', 'what can you do?', 'how does this work', 'what should I say']) expect(smallTalkKind(t), t).toBe('help');
    expect(smallTalkKind('who are you?')).toBe('who');
    expect(smallTalkKind('bye')).toBe('bye');
    // A greeting in front of a request is NOT small talk: the request is done.
    for (const t of ['hi, connect Room 1 and Room 2', 'hey add a bench here', 'thanks, now fix everything']) expect(smallTalkKind(t), t).toBeNull();
  });

  it('answers to fit the map: empty floor, problems, or all good', () => {
    expect(smallTalk('hi', emptyFloor())!.reply).toMatch(/^Hi! .*This floor is empty/);
    expect(smallTalk('hey', mapState())!.reply).toMatch(/need.* attention/);       // Room 2 isn't on the paths
    expect(smallTalk('ሰላም', mapState())!.reply).toMatch(/^ሰላም!/);
    expect(smallTalk('thanks', mapState())!.reply).toMatch(/^You're welcome!/);
    expect(smallTalk('what can you do?', mapState())!.reply).toMatch(/Connect places with walking paths[\s\S]*Every change can be undone/);
    expect(smallTalk('hi', mapState())!.chips.length).toBeGreaterThan(0);
    expect(smallTalk('connect Room 1 and Room 2', mapState())).toBeNull();
  });

  it('leaves "yes" / "no" to the chat while a change waits for Apply', () => {
    expect(smallTalk('yes', mapState(), { pending: true })).toBeNull();
    expect(smallTalk('yes', mapState())!.reply).toMatch(/nothing waiting/);
  });
});

describe('greetings around requests', () => {
  it('are stripped so the request is understood instantly', () => {
    const plain = parseIntent('connect Room 1 and Room 2');
    for (const t of ['hi, connect Room 1 and Room 2', 'hey can you connect Room 1 and Room 2 please', 'Hello! connect Room 1 and Room 2, thanks',
      'good morning, connect Room 1 and Room 2', 'ሰላም connect Room 1 and Room 2', 'pls connect Room 1 and Room 2']) {
      expect(parseIntent(t), t).toEqual(plain);
    }
    expect(parseIntent('hey undo')).toEqual([{ op: 'undo' }]);
    expect(parseIntent('hi fix everything thanks')).toEqual([{ op: 'fix_all' }]);
    expect(stripSocial('hi')).toBe('hi');                        // a lone greeting is left for small talk
  });

  it('understands everyday phrasings the local AI got wrong', () => {
    const cases: [string, unknown][] = [
      ['pls bring that back', [{ op: 'redo' }]],
      ['where are the toilets', [{ op: 'list', what: 'toilets' }]],
      ['pls check the map for me', [{ op: 'health' }]],
      ['pls fix what u can', [{ op: 'fix_all' }]],
      ['hey wall height 4', [{ op: 'set_3d', target: 'walls', field: 'height', value: '4' }]],
      ['the stairs goes between the floors', [{ op: 'connect_floors', via: 'stairs', floor: null }]],
      ['Pharmacy is actually a restroom', [{ op: 'set_type', target: 'Pharmacy', kind: 'restroom' }]],
      ['Canteen and Lab 101 shouldnt be connected', [{ op: 'disconnect', a: 'Canteen', b: 'Lab 101' }]],
      ['put Canteen on the walking routes', [{ op: 'walkable', target: 'Canteen' }]],     // was misread as "add a place"
    ];
    for (const [t, want] of cases) expect(parseIntent(t), t).toEqual(want);
    expect(parseIntent('take that back')).toEqual([{ op: 'undo' }]);                       // still undo, not redo
  });

  it('never acts on a misreading (these used to do the wrong thing instantly)', () => {
    expect(parseIntent('make it live for visitors')).toEqual([{ op: 'publish' }]);                 // was: add a place "it live for visitors"
    expect(parseIntent('make it nicer')).toBeNull();                                                // unclear → the AI asks
    expect(parseIntent('make a bench near the Cafe')).toEqual([{ op: 'add', what: 'bench', name: null, near: 'Cafe', side: null }]);
    expect(parseIntent('remove Gift Shop from the map')).toEqual([{ op: 'remove', target: 'Gift Shop' }]);
    expect(parseIntent('connect Kitchen to Lobby and Waiting Area to Room 1')).toEqual([
      { op: 'connect', from: 'Kitchen', to: 'Lobby', accessible: false }, { op: 'connect', from: 'Waiting Area', to: 'Room 1', accessible: false }]);
    expect(parseIntent('connect them')).toBeNull();                                                 // nothing named → ask
    expect(parseIntent('can you add a new floor')).toEqual([{ op: 'open', panel: 'add_floor' }]);
    expect(parseIntent('hi, add a new foor')).toEqual([{ op: 'open', panel: 'add_floor' }]);
    expect(parseIntent('ok put a window rihgt here')).toEqual([{ op: 'add', what: 'window', name: null, near: 'here', side: null }]);
  });

  it('names floors the way the engine finds them', () => {
    expect(parseIntent('go to the ground floor')).toEqual([{ op: 'go_floor', floor: 'ground' }]);   // was "ground floor": no match
    expect(parseIntent('show me the Level 0 floor')).toEqual([{ op: 'go_floor', floor: '0' }]);
    expect(parseIntent('go to floor 2')).toEqual([{ op: 'go_floor', floor: '2' }]);
    for (const t of ['go to the ground floor', 'go to floor 2']) expect(plan(parseIntent(t)![0], mapState()).reply, t).not.toMatch(/Which floor/);
  });

  it('forgives typos in the command word, never in names', () => {
    expect(parseIntent('moev it next to X-Ray')).toEqual([{ op: 'move', target: 'it', near: 'X-Ray' }]);
    expect(parseIntent('pls move it nxet to Library')).toEqual([{ op: 'move', target: 'it', near: 'Library' }]);
    expect(parseIntent('chcek the map for me')).toEqual([{ op: 'health' }]);
    expect(parseIntent('go bakc')).toEqual([{ op: 'undo' }]);
    expect(parseIntent('hey whre are the toilets')).toEqual([{ op: 'list', what: 'toilets' }]);
    expect(parseIntent('conect Room 1 and Room 2')).toEqual(parseIntent('connect Room 1 and Room 2'));
    expect(parseIntent('rmeove the bench')).toEqual([{ op: 'remove', target: 'bench' }]);
    // Real words are left alone: only tried when the text as typed isn't understood.
    expect(parseIntent('lift is on both floors')).toEqual([{ op: 'connect_floors', via: 'lift', floor: null }]);
    expect(parseIntent('connect Room 1 and Nest')).toEqual([{ op: 'connect', from: 'Room 1', to: 'Nest', accessible: false }]);
    expect(parseIntent('blah blah')).toBeNull();
  });

  it('understands the health check\'s own floor suggestion', () => {
    expect(parseIntent('Connect the floors via the elevator')).toEqual([{ op: 'connect_floors', via: 'elevator', floor: null }]);
    expect(parseIntent('link floors with the stairs')).toEqual([{ op: 'connect_floors', via: 'stairs', floor: null }]);
  });
});

describe('suggestion chips', () => {
  const situations: [string, MapState][] = [
    ['problems on the map', mapState()],
    ['something selected', mapState({ selection: { nodes: [], rooms: ['r1'], features: [] } })],
    ['after a click', mapState({ click: { x: 4 * P, y: 7 * P } })],
    ['an empty floor', emptyFloor()],
  ];

  for (const [name, s] of situations) {
    it(`work when tapped — ${name}`, () => {
      const chips = suggestions(s);
      expect(chips.length).toBeGreaterThan(1);
      expect(chips.length).toBeLessThanOrEqual(4);
      for (const c of chips) {
        if (c.say.endsWith(' ')) continue;                       // a sentence to finish ("Rename Room 1 to ")
        const actions = parseIntent(c.say);
        expect(actions, `"${c.say}" must be understood instantly`).not.toBeNull();
        for (const a of actions!) {
          const p = plan(a, s);
          expect(p.reply, `"${c.say}"`).not.toMatch(NOT_FOUND);
        }
      }
    });
  }

  it('would catch a chip that points at nothing', () => {
    const [a] = parseIntent('Connect Room 1 and the Cinema')!;
    expect(plan(a, mapState()).reply).toMatch(NOT_FOUND);
    expect(plan({ op: 'show', target: 'this' }, mapState()).reply).toMatch(NOT_FOUND);   // "this" with nothing selected
  });

  it('fit the situation', () => {
    expect(suggestions(emptyFloor()).map(c => c.label)).toContain('Import my floor plan');
    expect(suggestions(mapState()).map(c => c.label)).toContain('Fix everything');
    expect(suggestions(mapState({ selection: { nodes: [], rooms: ['r1'], features: [] } })).map(c => c.say)).toContain('Rename Room 1 to ');
    expect(suggestions(mapState({ click: { x: 4 * P, y: 7 * P } })).map(c => c.say)).toContain('Add a restroom here');
    expect(suggestions(mapState()).map(c => c.say)).not.toContain('Add a restroom here');     // no click → no "here"
  });
});
