import { describe, expect, it } from 'vitest';
import { pathsThroughWalls, type PlanRows } from '@ethi/indoor-core';
import { MapView, brief, healthOf, importSummary, plan, resolve, withChange, type MapState } from './engine';
import { parseIntent } from './intent';

const P = 40;
// Two 8 × 6 m rooms side by side, each with a door in its south wall onto a
// corridor below. Room 1 is joined to the corridor; Room 2 isn't yet.
function rows(opts: { door2?: boolean } = {}): PlanRows {
  const { door2 = true } = opts;
  return {
    building: { id: 'b', name: 'B' },
    floors: [{ id: 'f', name: 'Floor 1', level: 0 }],
    walls: [
      { id: 'n1', floor_id: 'f', x1: 0, y1: 0, x2: 8 * P, y2: 0 },
      { id: 'w1', floor_id: 'f', x1: 0, y1: 0, x2: 0, y2: 6 * P },
      { id: 's1', floor_id: 'f', x1: 0, y1: 6 * P, x2: 8 * P, y2: 6 * P },
      { id: 'mid', floor_id: 'f', x1: 8 * P, y1: 0, x2: 8 * P, y2: 6 * P },
      { id: 'n2', floor_id: 'f', x1: 8 * P, y1: 0, x2: 16 * P, y2: 0 },
      { id: 'e2', floor_id: 'f', x1: 16 * P, y1: 0, x2: 16 * P, y2: 6 * P },
      { id: 's2', floor_id: 'f', x1: 8 * P, y1: 6 * P, x2: 16 * P, y2: 6 * P },
    ],
    rooms: [
      { id: 'r1', floor_id: 'f', name: 'Room 1', x: 0, y: 0, width: 8 * P, height: 6 * P, type: 'office', node_id: 'p1' },
      { id: 'r2', floor_id: 'f', name: 'Room 2', x: 8 * P, y: 0, width: 8 * P, height: 6 * P, type: 'office', node_id: 'p2' },
      { id: 'r12', floor_id: 'f', name: 'Room 12', x: 20 * P, y: 0, width: 4 * P, height: 4 * P, type: 'office', node_id: null },
    ],
    map_features: [
      { id: 'd1', floor_id: 'f', kind: 'door', x: 4 * P, y: 6 * P, rotation_deg: 0, width: 0.9 * P },
      ...(door2 ? [{ id: 'd2', floor_id: 'f', kind: 'door', x: 12 * P, y: 6 * P, rotation_deg: 0, width: 0.9 * P }] : []),
    ],
    nodes: [
      { id: 'p1', floor_id: 'f', name: 'Room 1', x: 4 * P, y: 3 * P },
      { id: 'p2', floor_id: 'f', name: 'Room 2', x: 12 * P, y: 3 * P },
      { id: 'h1', floor_id: 'f', name: '', x: 4 * P, y: 7.5 * P, is_hallway: true },
      { id: 'h2', floor_id: 'f', name: '', x: 12 * P, y: 7.5 * P, is_hallway: true },
    ],
    edges: [{ id: 'e1', from_node: 'p1', to_node: 'h1' }, { id: 'e2', from_node: 'h1', to_node: 'h2' }],
  };
}

const state = (r = rows(), extra: Partial<MapState> = {}): MapState => ({
  floorId: 'f', rows: r, selection: { nodes: [], rooms: [], features: [] }, click: null, view: { x: 8 * P, y: 4 * P }, last: null, lastChange: null, ...extra,
});
const say = (text: string, s: MapState) => plan(parseIntent(text)![0], s);

describe('the map assistant', () => {
  it('finds things by name without mixing up Room 1 and Room 12', () => {
    const s = state();
    expect(resolve('Room 1', s)?.id).toBe('r1');
    expect(resolve('room 12', s)?.id).toBe('r12');
    expect(resolve('this', state(rows(), { selection: { nodes: [], rooms: ['r2'], features: [] } }))?.name).toBe('Room 2');
  });

  it('connects two rooms with a real walking route through the doorway', () => {
    const s = state();
    const p = say('Connect Room 1 and Room 2', s);
    expect(p.confirm).toBe(true);
    expect(p.done).toBe('Done — Room 1 is now connected to Room 2.');
    expect(p.change!.edges.length).toBeGreaterThan(0);
    const after = withChange(s.rows, p.change!);
    expect(pathsThroughWalls(after)).toEqual([]);
    expect(new MapView(after, 'f').route('p1', 'p2')).not.toBeNull();
    expect(p.highlight!.route.length).toBeGreaterThanOrEqual(3);
    // Asking again: already connected, nothing to change.
    const again = say('Connect Room 1 and Room 2', state(after));
    expect(again.change).toBeUndefined();
    expect(again.reply).toMatch(/already connected/);
  });

  it('refuses to walk through walls, and says what would help', () => {
    const p = say('Connect Room 1 and Room 2', state(rows({ door2: false })));
    expect(p.change).toBeUndefined();
    expect(p.reply).toMatch(/door/);
  });

  it('adds a place where they clicked and makes it walkable', () => {
    const p = say('Add a restroom here', state(rows(), { click: { x: 8 * P, y: 8.5 * P } }));
    expect(p.confirm).toBeFalsy();
    const place = p.change!.nodes.find(n => n.name === 'Restroom')!;
    expect(place).toMatchObject({ x: 8 * P, y: 8.5 * P, hallway: false });
    const after = withChange(rows(), p.change!);
    expect(new MapView(after, 'f').route(place.id, 'p1')).not.toBeNull();
    expect(p.reply).toMatch(/Added Restroom\. Visitors can walk to it/);
  });

  it('keeps walking paths out of a room on request', () => {
    const r = rows();
    r.nodes.push({ id: 'a', floor_id: 'f', name: '', x: 1 * P, y: 3 * P, is_hallway: true }, { id: 'b', floor_id: 'f', name: '', x: 7 * P, y: 3 * P, is_hallway: true });
    r.edges.push({ id: 'thru', from_node: 'a', to_node: 'b' });
    const p = say('There should be no walking path through Room 1', state(r));
    expect(p.confirm).toBe(true);
    expect(p.change!.removeEdges).toEqual(['thru']);
  });

  it('removes the selected place’s paths, with a warning about who gets cut off', () => {
    const p = say('Remove this path', state(rows(), { selection: { nodes: [], rooms: ['r1'], features: [] } }));
    expect(p.change!.removeEdges).toEqual(['e1']);
    expect(p.highlight!.removed.length).toBe(1);
  });

  it('knows what needs attention, and fixes what is safe to fix', () => {
    const s = state();
    const items = healthOf(s).map(i => i.text);
    expect(items).toContain("Room 2 doesn't have a walkable connection");
    expect(items).toContain('Room 12 has no place visitors can navigate to');
    const p = say('Fix everything', s);
    const after = withChange(s.rows, p.change!);
    expect(new MapView(after, 'f').route('p1', 'p2')).not.toBeNull();
    expect(after.rooms.find(r => r.id === 'r12')!.node_id).toBeTruthy();
    expect(pathsThroughWalls(after)).toEqual([]);
  });

  it('connects floors through the elevator on both', () => {
    const r = rows();
    r.floors.push({ id: 'g', name: 'Floor 2', level: 1 });
    r.nodes.push({ id: 'l1', floor_id: 'f', name: 'Elevator', x: 2 * P, y: 8 * P }, { id: 'l2', floor_id: 'g', name: 'Elevator', x: 2 * P, y: 8 * P });
    const p = say('Connect Floor 1 to Floor 2 using the elevator', state(r));
    expect(p.change!.edges).toEqual([expect.objectContaining({ from_node: 'l1', to_node: 'l2', connection: 'elevator', accessible: true })]);
    expect(p.done).toMatch(/Floor 1 and Floor 2 are now connected by the elevator/);
    expect(healthOf(state(r)).some(i => /Elevator isn't connected between floors/.test(i.text))).toBe(true);
  });

  it('greets a fresh import with what it found', () => {
    const g = importSummary(state());
    expect(g.reply).toMatch(/^Your floor plan is ready\. I found 3 rooms/);
    expect(g.chips.map(c => c.label)).toContain('Fix everything');
  });
});

describe('the rest of the editor', () => {
  it('understands views, floors, tools, settings and panels', () => {
    expect(parseIntent('Show it in 3D')).toEqual([{ op: 'view', mode: '3d' }]);
    expect(parseIntent('switch to split view')).toEqual([{ op: 'view', mode: 'split' }]);
    expect(parseIntent('show me the whole plan')).toEqual([{ op: 'fit' }]);
    expect(parseIntent('go upstairs')).toEqual([{ op: 'go_floor', floor: 'up' }]);
    expect(parseIntent('turn off the grid')).toEqual([{ op: 'setting', setting: 'grid', on: false }]);
    expect(parseIntent('I want to draw walls')).toEqual([{ op: 'tool', tool: 'wall' }]);
    expect(parseIntent('import a DWG file')).toEqual([{ op: 'open', panel: 'import' }]);
    expect(parseIntent('add another floor')).toEqual([{ op: 'open', panel: 'add_floor' }]);
    expect(parseIntent('publish the map')).toEqual([{ op: 'publish' }]);
    expect(parseIntent('redo')).toEqual([{ op: 'redo' }]);
  });

  it('understands sizes, rotation, kinds and 3D details', () => {
    expect(parseIntent('Add a 6 by 4 m meeting room called Board Room next to Room 1')).toEqual([{ op: 'add_room', width: 6, depth: 4, kind: 'meeting', name: 'Board Room', near: 'Room 1', side: null }]);
    expect(parseIntent('make Room 2 10 x 5 m')).toEqual([{ op: 'resize', target: 'Room 2', width: 10, depth: 5 }]);
    expect(parseIntent('make room 2 bigger')).toEqual([{ op: 'resize', target: 'room 2', scale: 1.25 }]);
    expect(parseIntent('rotate this 90 degrees')).toEqual([{ op: 'rotate', target: 'this', degrees: 90 }]);
    expect(parseIntent('make Room 2 a restroom')).toEqual([{ op: 'set_type', target: 'Room 2', kind: 'restroom' }]);
    expect(parseIntent('make the walls 3.2 m high')).toEqual([{ op: 'set_3d', target: 'walls', field: 'height', value: '3.2' }]);
    expect(parseIntent('make all walls glass')).toEqual([{ op: 'set_3d', target: 'walls', field: 'material', value: 'glass' }]);
    expect(parseIntent('how far is Room 1 from Room 2')).toEqual([{ op: 'measure', from: 'Room 2', to: 'Room 1' }]);
    expect(parseIntent('how far from Room 1 to Room 2')).toEqual([{ op: 'measure', from: 'Room 1', to: 'Room 2' }]);
    expect(parseIntent('how many rooms are there')).toEqual([{ op: 'list', what: 'rooms' }]);
    // The older phrases still win.
    expect(parseIntent('make Room 2 walkable')).toEqual([{ op: 'walkable', target: 'Room 2' }]);
  });

  it('adds a sized room that visitors can walk to', () => {
    const s = state(rows(), { click: { x: 4 * P, y: 10 * P } });
    const p = say('Add a 6 by 4 m office called Archive here', s);
    expect(p.change!.rooms).toHaveLength(1);
    const r = p.change!.rooms![0];
    expect([r.name, r.type, r.width, r.height]).toEqual(['Archive', 'office', 6 * P, 4 * P]);
    expect(p.change!.nodes.find(n => n.id === r.node_id)?.name).toBe('Archive');
    expect(p.reply).toMatch(/6\.0 × 4\.0 m/);
  });

  it('resizes, retypes and rotates through editor edits', () => {
    const s = state();
    const big = say('make Room 2 10 x 5 m', s);
    expect(big.edit).toMatchObject({ op: 'resize', rect: { width: 10 * P, height: 5 * P } });
    expect(say('make Room 2 a restroom', s).edit).toMatchObject({ op: 'set_type', kind: 'restroom' });
    expect(say('rotate Room 1 by 45', s).edit).toMatchObject({ op: 'rotate', deg: 45 });
  });

  it('sets 3D details on every wall in one go', () => {
    const p = say('make the walls 3.2 m high', state());
    expect(p.edit).toMatchObject({ op: 'set_3d', table: 'walls', patch: { height_m: 3.2 } });
    expect((p.edit as { ids: string[] }).ids).toHaveLength(7);
  });

  it('answers questions about the map', () => {
    const s = state();
    expect(say('how many rooms are there', s).reply).toMatch(/^3 rooms on Floor 1: Room 1, Room 2, Room 12/);
    expect(say('how far from Room 1 to Room 2', s).reply).toMatch(/Room 1 → Room 2: 8\.0 m in a straight line/);
    expect(say("what's on this floor", s).reply).toMatch(/Floor 1: 3 rooms/);
    expect(say('tell me about Room 1', s).reply).toMatch(/Room 1 is an office on Floor 1, about 8\.0 × 6\.0 m/);
  });

  it('gives the AI a detailed brief of the map', () => {
    const b = brief(state());
    expect(b).toMatch(/Rooms on this floor \(3\)/);
    expect(b).toMatch(/- Room 1 \| office \| 8\.0×6\.0 \| 4\.0,3\.0 \| yes/);
    expect(b).toMatch(/Walls: 7/);
    expect(b).toMatch(/Health: /);
  });
});
