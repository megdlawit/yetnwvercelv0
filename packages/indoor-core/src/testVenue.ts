// A small two-floor venue in the database's own row shape, for tests and
// demos: a ground-floor corridor with a café behind a door, stairs up at the
// east end (drawn, climbing east), a gallery upstairs, and a lift whose shaft
// nobody drew (so its connector is worked out from the path graph).
//
//   ground (y = 0..200 px, 40 px = 1 m)
//   ┌──────────────┬───────────────────────────┐
//   │  Café        │                           │
//   │   •c         d                           │
//   ├──────────────┘   corridor  •h1 ─── •h2  [stairs →]  •s0
//   │ •e (entrance)   •lift0
//   └────────────────────────────────────────────────────┘

import type { PlanRows } from './normalize';

const B = 'b1', G = 'f0', U = 'f1';

export function testVenueRows(): PlanRows {
  return {
    building: { id: B, name: 'Test Hall', name_am: 'የሙከራ አዳራሽ', origin_lat: 9.03, origin_lng: 38.76, rotation_deg: 0, meters_per_pixel: 0.025 },
    floors: [
      { id: U, name: 'First', level: 1, name_am: 'አንደኛ ፎቅ' },
      { id: G, name: 'Ground', level: 0, name_am: 'ምድር ቤት' },
    ],
    walls: [
      // Café box: north, west, south (with the door gap drawn as a door feature), east.
      { id: 'w-n', floor_id: G, x1: 0, y1: 0, x2: 800, y2: 0 },
      { id: 'w-w', floor_id: G, x1: 0, y1: 0, x2: 0, y2: 400 },
      { id: 'w-cafe-e', floor_id: G, x1: 240, y1: 0, x2: 240, y2: 260 },
      { id: 'w-s', floor_id: G, x1: 0, y1: 400, x2: 800, y2: 400 },
      { id: 'w-up', floor_id: U, x1: 0, y1: 0, x2: 800, y2: 0, material: 'glass', thickness_m: 0.1 },
    ],
    rooms: [
      { id: 'r-cafe', floor_id: G, name: 'Café', name_am: 'ካፌ', x: 0, y: 0, width: 240, height: 280, type: 'office', node_id: 'c', floor_material: 'wood' },
      { id: 'r-gal', floor_id: U, name: 'Gallery', x: 400, y: 0, width: 400, height: 200, type: 'office', node_id: 'g' },
    ],
    map_features: [
      // Door on the café's east wall, 0.3 m off it (older data: not anchored).
      { id: 'door', floor_id: G, kind: 'door', x: 252, y: 240, rotation_deg: 90 },
      { id: 'win', floor_id: G, kind: 'window', x: 400, y: 0, wall_id: 'w-n', offset_m: 10 },
      // Stairs east of the corridor, 3 m deep, climbing east (rotation -90: depth axis → +x).
      { id: 'stairs', floor_id: G, kind: 'stairs', x: 640, y: 240, rotation_deg: -90, width: 60, depth: 120 },
    ],
    nodes: [
      { id: 'e', floor_id: G, name: 'Entrance', x: 40, y: 360 },
      { id: 'c', floor_id: G, name: 'Café', x: 120, y: 240 },
      { id: 'h1', floor_id: G, x: 320, y: 240, is_hallway: true },
      { id: 'h2', floor_id: G, x: 560, y: 240, is_hallway: true },
      { id: 's0', floor_id: G, x: 600, y: 240, is_hallway: true },
      { id: 's1', floor_id: U, x: 700, y: 240, is_hallway: true },
      { id: 'g', floor_id: U, name: 'Gallery', x: 600, y: 100 },
      { id: 'lift0', floor_id: G, x: 200, y: 330, is_hallway: true },
      { id: 'lift1', floor_id: U, x: 200, y: 330, is_hallway: true },
      { id: 'u1', floor_id: U, x: 400, y: 240, is_hallway: true },
    ],
    edges: [
      { id: 'e-e-h1', from_node: 'e', to_node: 'h1' },
      { id: 'e-c-h1', from_node: 'c', to_node: 'h1' },
      { id: 'e-h1-h2', from_node: 'h1', to_node: 'h2' },
      { id: 'e-h2-s0', from_node: 'h2', to_node: 's0' },
      { id: 'e-stairs', from_node: 's0', to_node: 's1', connection: 'stairs' },
      { id: 'e-s1-g', from_node: 's1', to_node: 'g' },
      { id: 'e-e-lift', from_node: 'e', to_node: 'lift0' },
      { id: 'e-lift', from_node: 'lift0', to_node: 'lift1', connection: 'elevator' },
      { id: 'e-lift-u1', from_node: 'lift1', to_node: 'u1' },
      { id: 'e-u1-g', from_node: 'u1', to_node: 'g' },
    ],
    pois: [
      { id: 'p-cafe', node_id: 'c', name: 'Café', name_am: 'ካፌ', description: 'Coffee and cake', category: 'food' },
      { id: 'p-gal', node_id: 'g', name: 'Gallery', description: 'Paintings', category: 'attraction', images: ['a.jpg'] },
      { id: 'p-hidden', node_id: 'g', name: 'Hidden', is_visible: false },
    ],
  };
}
