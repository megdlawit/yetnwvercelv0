import { describe, expect, it } from 'vitest';
import { fromPlan, type PlanRows } from './normalize';
import { autoScenery, groundBounds, sceneryRing } from './scenery';

const P = 40;
const rows = (features: PlanRows['map_features'] = []): PlanRows => ({
  building: { id: 'b', name: 'B' },
  floors: [{ id: 'g', name: 'G', level: 0 }, { id: 'u', name: '1', level: 1 }],
  walls: [
    { id: 'n', floor_id: 'g', x1: 0, y1: 0, x2: 10 * P, y2: 0 },
    { id: 's', floor_id: 'g', x1: 0, y1: 8 * P, x2: 10 * P, y2: 8 * P },
    { id: 'u1', floor_id: 'u', x1: 0, y1: 0, x2: 10 * P, y2: 0 },
  ],
  rooms: [], map_features: features, nodes: [], edges: [],
});

describe('scenery round the building', () => {
  it('rings the ground floor with trees until the venue places its own', () => {
    expect(autoScenery(fromPlan(rows()), 'g')).toBe(true);
    expect(autoScenery(fromPlan(rows()), 'u')).toBe(false);
    // A bench is furniture, not scenery: the trees stay.
    expect(autoScenery(fromPlan(rows([{ id: 'b1', floor_id: 'g', kind: 'bench', x: 40, y: 40 }])), 'g')).toBe(true);
    // A fountain is: the venue is in charge now.
    expect(autoScenery(fromPlan(rows([{ id: 'f1', floor_id: 'g', kind: 'fountain', x: 40, y: 40 }])), 'g')).toBe(false);
  });

  it('puts the trees in the same places every time, outside the building', () => {
    const b = groundBounds(fromPlan(rows()), 'g')!;
    const a = sceneryRing(b), again = sceneryRing(b);
    expect(a.length).toBeGreaterThan(10);
    expect(again).toEqual(a);
    for (const t of a) {
      const inside = t.at.x > b.minX && t.at.x < b.maxX && t.at.z > b.minZ && t.at.z < b.maxZ;
      expect(inside).toBe(false);
    }
  });

  it('reads every scenery kind from the plan', () => {
    const kinds = ['palm', 'shrub', 'flowers', 'grass', 'water', 'rock', 'lamp', 'fountain', 'planter'];
    const v = fromPlan(rows(kinds.map((kind, i) => ({ id: kind, floor_id: 'g', kind, x: i * 40, y: 400 }))));
    expect(v.props.map(p => p.kind).sort()).toEqual([...kinds].sort());
  });
});
