import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readEditorRequest } from './editorRead';
import { PARSER_WORDS } from './intent';
import type { MapState } from './engine';

const map = (...names: string[]) => ({ rows: { rooms: names.map(name => ({ name })), nodes: [], floors: [] } }) as unknown as MapState;
const actions = (said: string, s: MapState | null = map('Main Hall', 'Room 1', 'Kiosk', 'Main Gate', 'X-Ray')) => {
  const r = readEditorRequest(said, s);
  return r.kind === 'actions' ? r.actions : r.kind;
};

describe('reading a request typed in a hurry', () => {
  it('fixes typos towards every word the phrases know', () => {
    expect(actions('turn on the grdi')).toEqual([{ op: 'setting', setting: 'grid', on: true }]);
    expect(actions('make it liev for visitors')).toEqual([{ op: 'publish' }]);
    expect(actions('tell me aobut Main Hall')).toEqual([{ op: 'describe', target: 'Main Hall' }]);
    expect(actions('the stairs ges between the floors')).toEqual([{ op: 'connect_floors', via: 'stairs', floor: null }]);
    expect(actions('distacne between Main Hall and Room 1')).toEqual([{ op: 'measure', from: 'Main Hall', to: 'Room 1' }]);
    expect(actions('Main Hall and Room 1 shouldnt be connectde')).toEqual([{ op: 'disconnect', a: 'Main Hall', b: 'Room 1' }]);
  });

  it('writes shorthand out, and drops misspelt filler words', () => {
    expect(actions('fix wat u can')).toEqual([{ op: 'fix_all' }]);
    expect(actions('Kiosk is actally a meeting')).toEqual([{ op: 'set_type', target: 'Kiosk', kind: 'meeting' }]);
    expect(actions('tll me about Kiosk')).toEqual([{ op: 'describe', target: 'Kiosk' }]);
  });

  it('keeps numbers, and what was understood as typed', () => {
    expect(actions('wall hight 2.5')).toEqual([{ op: 'set_3d', target: 'walls', field: 'height', value: '2.5' }]);
    expect(actions('zoom to fit')).toEqual([{ op: 'fit' }]);
    expect(actions('zom to fit')).toEqual([{ op: 'fit' }]);
  });

  it('keeps names as they were typed after a correction', () => {
    expect(actions('conect X-Ray to Main Hall')).toEqual([{ op: 'connect', from: 'X-Ray', to: 'Main Hall', accessible: false }]);
    expect(actions('add a cafe called Staff Room nera Kiosk')).toMatchObject([{ op: 'add', what: 'cafe', name: 'Staff Room', near: 'Kiosk' }]);
  });

  it('uses the map’s names to tell where a name ends', () => {
    expect(actions('call Main Gate Book Shop instead')).toEqual([{ op: 'rename', target: 'Main Gate', name: 'Book Shop' }]);
    expect(actions('call Main Gate Book Shop instaed')).toEqual([{ op: 'rename', target: 'Main Gate', name: 'Book Shop' }]);
  });

  it('understands more ways to ask for views and tools', () => {
    expect(actions('back to 2d')).toEqual([{ op: 'view', mode: '2d' }]);
    expect(actions('bak to 2d')).toEqual([{ op: 'view', mode: '2d' }]);
    expect(actions('path tool')).toEqual([{ op: 'tool', tool: 'add-edge' }]);
    expect(actions('give me the wall tool')).toEqual([{ op: 'tool', tool: 'wall' }]);
  });

  it('knows every word its phrases use (so their typos are fixed)', () => {
    const src = readFileSync('src/lib/assistant/intent.ts', 'utf8').replace(/export const PARSER_WORDS = `[^`]*`;/, '');
    const known = new Set(PARSER_WORDS.split(/\s+/));
    const typos = new Set(['abck', 'backk', 'bak', 'bakc', 'bcak', 'bck', 'floo', 'flor', 'foor', 'ing', 'ise', 'ize', 'rmation', 'rees', 'ping', 'shouldn', 'mustn', 'don', 'summar', 'anti', 'deg', 'pois', 'hii', 'heya']);
    const used = [...src.matchAll(/\/\^[^\n]*?\/[gimsuy]*/g)].flatMap(m => m[0].replace(/\[a-z]/g, ' ').match(/[a-z]{3,}/g) ?? []);
    expect([...new Set(used)].filter(w => !known.has(w) && !typos.has(w))).toEqual([]);
  });
});
