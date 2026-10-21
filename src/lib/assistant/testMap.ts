// Shared test map for the assistant's chat tests: two rooms on Floor 1, Floor 2 empty.
import type { PlanRows } from '@ethi/indoor-core';
import type { MapState } from './engine';

export const P = 40;
// Two rooms with doors onto a corridor; Room 1 is on the paths, Room 2 isn't yet.
export function rows(): PlanRows {
  return {
    building: { id: 'b', name: 'B' },
    floors: [{ id: 'f', name: 'Floor 1', level: 0 }, { id: 'g', name: 'Floor 2', level: 1 }],
    walls: [
      { id: 'n1', floor_id: 'f', x1: 0, y1: 0, x2: 8 * P, y2: 0 }, { id: 'w1', floor_id: 'f', x1: 0, y1: 0, x2: 0, y2: 6 * P },
      { id: 's1', floor_id: 'f', x1: 0, y1: 6 * P, x2: 8 * P, y2: 6 * P }, { id: 'mid', floor_id: 'f', x1: 8 * P, y1: 0, x2: 8 * P, y2: 6 * P },
      { id: 'n2', floor_id: 'f', x1: 8 * P, y1: 0, x2: 16 * P, y2: 0 }, { id: 'e2', floor_id: 'f', x1: 16 * P, y1: 0, x2: 16 * P, y2: 6 * P },
      { id: 's2', floor_id: 'f', x1: 8 * P, y1: 6 * P, x2: 16 * P, y2: 6 * P },
    ],
    rooms: [
      { id: 'r1', floor_id: 'f', name: 'Room 1', x: 0, y: 0, width: 8 * P, height: 6 * P, type: 'office', node_id: 'p1' },
      { id: 'r2', floor_id: 'f', name: 'Room 2', x: 8 * P, y: 0, width: 8 * P, height: 6 * P, type: 'office', node_id: 'p2' },
    ],
    map_features: [
      { id: 'd1', floor_id: 'f', kind: 'door', x: 4 * P, y: 6 * P, rotation_deg: 0, width: 0.9 * P },
      { id: 'd2', floor_id: 'f', kind: 'door', x: 12 * P, y: 6 * P, rotation_deg: 0, width: 0.9 * P },
    ],
    nodes: [
      { id: 'p1', floor_id: 'f', name: 'Room 1', x: 4 * P, y: 3 * P }, { id: 'p2', floor_id: 'f', name: 'Room 2', x: 12 * P, y: 3 * P },
      { id: 'h1', floor_id: 'f', name: '', x: 4 * P, y: 7.5 * P, is_hallway: true }, { id: 'h2', floor_id: 'f', name: '', x: 12 * P, y: 7.5 * P, is_hallway: true },
    ],
    edges: [{ id: 'e1', from_node: 'p1', to_node: 'h1' }, { id: 'e2', from_node: 'h1', to_node: 'h2' }],
  };
}
export const mapState = (extra: Partial<MapState> = {}, r: PlanRows = rows()): MapState => ({
  floorId: 'f', rows: r, selection: { nodes: [], rooms: [], features: [] }, click: null, view: { x: 8 * P, y: 4 * P }, last: null, lastChange: null, ...extra,
});
