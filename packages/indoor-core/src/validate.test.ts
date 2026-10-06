import { describe, expect, it } from 'vitest';
import { fromPlan } from './normalize';
import { testVenueRows } from './testVenue';
import { issueText, validate } from './validate';

describe('validate', () => {
  it('finds nothing serious in the sample venue', () => {
    const rows = testVenueRows();
    const issues = validate(fromPlan(rows), rows);
    expect(issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('flags a broken plan: open room, door in the open, a stray path, stairs to nowhere', () => {
    const rows = testVenueRows();
    rows.rooms.push({ id: 'bow', floor_id: 'f0', name: 'Bow-tie', x: 0, y: 0, width: 0, height: 0, polygon: [[400, 300], [480, 380], [480, 300], [400, 380]] });
    rows.map_features.push({ id: 'lost-door', floor_id: 'f0', kind: 'door', x: 400, y: 330 });
    rows.map_features.push({ id: 'roof-stairs', floor_id: 'f1', kind: 'stairs', x: 100, y: 100 });
    rows.nodes.push({ id: 'island', floor_id: 'f0', name: 'Kiosk', x: 700, y: 360 }, { id: 'island2', floor_id: 'f0', x: 740, y: 360 }, { id: 'island3', floor_id: 'f0', x: 760, y: 360 });
    rows.edges.push({ id: 'i1', from_node: 'island', to_node: 'island2' }, { id: 'i2', from_node: 'island2', to_node: 'island3' });
    const kinds = validate(fromPlan(rows), rows).map(i => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['room-unclosed', 'door-off-wall', 'graph-disconnected', 'stairs-no-floor']));
  });

  it('flags a path that walks through a wall, but not one through a door', () => {
    const rows = testVenueRows();
    // Lobby side to inside the café straight through its east wall (the door is further down).
    rows.nodes.push({ id: 'x1', floor_id: 'f0', x: 320, y: 60, is_hallway: true });
    rows.edges.push({ id: 'thru', from_node: 'x1', to_node: 'c' });
    const found = validate(fromPlan(rows), rows).filter(i => i.kind === 'path-through-wall');
    expect(found.map(i => i.ids.sort().join('+'))).toEqual(['c+x1']);
  });

  it('words issues in both languages', () => {
    const issue = { kind: 'door-off-wall' as const, severity: 'error' as const, floorId: 'f0', at: { x: 0, z: 0 }, ids: ['d'], detail: { kind: 'door' } };
    expect(issueText(issue, 'en')).toMatch(/isn’t on a wall/);
    expect(issueText(issue, 'am')).toMatch(/ግድግዳ/);
  });
});
