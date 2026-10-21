import { describe, expect, it } from 'vitest';
import { plan, withChange, type MapState } from './engine';
import { HERE, THIS } from './intent';
import { mapState, rows, P } from './testMap';

const walledIn = () => { const r = rows(); r.map_features = r.map_features.filter(f => f.id !== 'd2'); return r; };   // Room 2 lost its door
const onAWall = (x: number, y: number) => rows().walls.some(w => {
  const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1), t = ((x - w.x1) * (w.x2 - w.x1) + (y - w.y1) * (w.y2 - w.y1)) / (L * L);
  return t >= 0 && t <= 1 && Math.hypot(x - (w.x1 + t * (w.x2 - w.x1)), y - (w.y1 + t * (w.y2 - w.y1))) < 1;
});

describe('doors go on walls', () => {
  it('a door added to a selected room is on its wall facing the paths — never in the middle or outside', () => {
    const s: MapState = mapState({ selection: { nodes: [], rooms: ['r2'], features: [] } }, walledIn());
    const p = plan({ op: 'add', what: 'door', near: THIS } as never, s);
    const door = p.change!.features[0];
    expect(onAWall(door.x, door.y)).toBe(true);
    expect(door.y).toBe(6 * P);                                   // the south wall, towards the corridor
    expect(door.x).toBeGreaterThan(8 * P); expect(door.x).toBeLessThan(16 * P);
    expect(Math.abs(Math.sin(((door.rotation_deg ?? 90) * Math.PI) / 180))).toBeLessThan(0.01);   // along the (east–west) wall
    expect(p.reply).toMatch(/now connected/);                    // and Room 2 is reachable through it
  });

  it('a click near a wall puts the door on that wall', () => {
    const s = mapState({ click: { x: 10 * P, y: 5.6 * P } }, walledIn());
    const door = plan({ op: 'add', what: 'door', near: HERE } as never, s).change!.features[0];
    expect([door.x, door.y]).toEqual([10 * P, 6 * P]);
  });

  it('"Fix everything" gives a walled-in room a door and connects it', () => {
    const s = mapState({}, walledIn());
    const p = plan({ op: 'fix_all' } as never, s);
    expect(p.change!.features).toHaveLength(1);
    const door = p.change!.features[0];
    expect(onAWall(door.x, door.y)).toBe(true);
    expect(p.reply).toMatch(/got a door/);
    // After the fix, Room 2's place is on the walking network.
    const after = withChange(s.rows, p.change!);
    expect(after.edges.some(e => e.from_node === 'p2' || e.to_node === 'p2')).toBe(true);
  });
});
