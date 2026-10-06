/**
 * floorTemplates — starter map layouts an admin can pick from when adding a
 * new floor, instead of always beginning from a blank canvas.
 *
 * Each template describes a small set of nodes (in the same 800×500 canvas
 * FloorEditor opens with) and the edges connecting them. Node `key`s are
 * local to the template only — when a template is applied, real Supabase
 * rows are created and the keys are mapped to the returned row ids.
 */

export interface FloorTemplateNode {
  key: string;
  name: string;
  x: number;
  y: number;
  isHallway: boolean;
  type: string;
}

export interface FloorTemplateEdge {
  from: string;
  to: string;
}

export interface FloorTemplate {
  id: string;
  name: string;
  description: string;
  nodes: FloorTemplateNode[];
  edges: FloorTemplateEdge[];
}

const hallway = (key: string, name: string, x: number, y: number): FloorTemplateNode => ({
  key, name, x, y, isHallway: true, type: 'normal',
});
const room = (key: string, name: string, x: number, y: number, type = 'normal'): FloorTemplateNode => ({
  key, name, x, y, isHallway: false, type,
});

export const FLOOR_TEMPLATES: FloorTemplate[] = [
  {
    id: 'blank',
    name: 'Blank canvas',
    description: 'Start empty and place nodes yourself.',
    nodes: [],
    edges: [],
  },
  {
    id: 'straight-corridor',
    name: 'Straight corridor',
    description: 'One hallway down the middle with rooms off each side.',
    nodes: [
      room('entrance', 'Entrance', 90, 250, 'entrance'),
      hallway('h1', 'Hallway 1', 220, 250),
      hallway('h2', 'Hallway 2', 380, 250),
      hallway('h3', 'Hallway 3', 540, 250),
      hallway('h4', 'Hallway 4', 700, 250),
      room('room-a', 'Room A', 220, 130),
      room('room-b', 'Room B', 380, 370),
      room('room-c', 'Room C', 540, 130),
      room('room-d', 'Room D', 700, 370),
    ],
    edges: [
      { from: 'entrance', to: 'h1' },
      { from: 'h1', to: 'h2' },
      { from: 'h2', to: 'h3' },
      { from: 'h3', to: 'h4' },
      { from: 'h1', to: 'room-a' },
      { from: 'h2', to: 'room-b' },
      { from: 'h3', to: 'room-c' },
      { from: 'h4', to: 'room-d' },
    ],
  },
  {
    id: 'l-shaped-corridor',
    name: 'L-shaped corridor',
    description: 'A hallway that turns a corner, good for wings or annexes.',
    nodes: [
      room('entrance', 'Entrance', 90, 420, 'entrance'),
      hallway('h1', 'Hallway 1', 230, 420),
      hallway('h2', 'Hallway 2', 230, 280),
      hallway('h3', 'Hallway 3', 230, 140),
      hallway('h4', 'Hallway 4', 420, 140),
      hallway('h5', 'Hallway 5', 610, 140),
      room('room-a', 'Room A', 90, 280),
      room('room-b', 'Room B', 90, 140),
      room('room-c', 'Room C', 420, 260),
      room('room-d', 'Room D', 610, 260),
      room('stairs', 'Stairs', 700, 140, 'stairs'),
    ],
    edges: [
      { from: 'entrance', to: 'h1' },
      { from: 'h1', to: 'h2' },
      { from: 'h2', to: 'h3' },
      { from: 'h3', to: 'h4' },
      { from: 'h4', to: 'h5' },
      { from: 'h2', to: 'room-a' },
      { from: 'h3', to: 'room-b' },
      { from: 'h4', to: 'room-c' },
      { from: 'h5', to: 'room-d' },
      { from: 'h5', to: 'stairs' },
    ],
  },
  {
    id: 'grid-office',
    name: 'Grid / office layout',
    description: 'A looped double corridor with rooms on both sides — good for offices or malls.',
    nodes: [
      room('entrance', 'Entrance', 400, 450, 'entrance'),
      hallway('h1', 'Hallway 1', 250, 350),
      hallway('h2', 'Hallway 2', 550, 350),
      hallway('h3', 'Hallway 3', 250, 220),
      hallway('h4', 'Hallway 4', 550, 220),
      hallway('h5', 'Hallway 5', 250, 100),
      hallway('h6', 'Hallway 6', 550, 100),
      room('room-a', 'Room A', 100, 350),
      room('room-b', 'Room B', 700, 350),
      room('room-c', 'Room C', 100, 220),
      room('room-d', 'Room D', 700, 220),
      room('room-e', 'Room E', 100, 100),
      room('room-f', 'Room F', 700, 100),
    ],
    edges: [
      { from: 'entrance', to: 'h1' },
      { from: 'entrance', to: 'h2' },
      { from: 'h1', to: 'h2' },
      { from: 'h1', to: 'h3' },
      { from: 'h2', to: 'h4' },
      { from: 'h3', to: 'h4' },
      { from: 'h3', to: 'h5' },
      { from: 'h4', to: 'h6' },
      { from: 'h5', to: 'h6' },
      { from: 'h1', to: 'room-a' },
      { from: 'h2', to: 'room-b' },
      { from: 'h3', to: 'room-c' },
      { from: 'h4', to: 'room-d' },
      { from: 'h5', to: 'room-e' },
      { from: 'h6', to: 'room-f' },
    ],
  },
  {
    id: 'open-hall',
    name: 'Open hall / atrium',
    description: 'A central hub with paths radiating out — good for lobbies or atriums.',
    nodes: [
      room('entrance', 'Entrance', 400, 450, 'entrance'),
      hallway('hub', 'Atrium Hub', 400, 280),
      hallway('n1', 'North Junction', 400, 130),
      hallway('w1', 'West Junction', 190, 280),
      hallway('e1', 'East Junction', 610, 280),
      room('room-a', 'Room A', 400, 60),
      room('room-b', 'Room B', 100, 200),
      room('room-c', 'Room C', 100, 370),
      room('room-d', 'Room D', 700, 200),
      room('room-e', 'Room E', 700, 370),
    ],
    edges: [
      { from: 'entrance', to: 'hub' },
      { from: 'hub', to: 'n1' },
      { from: 'hub', to: 'w1' },
      { from: 'hub', to: 'e1' },
      { from: 'n1', to: 'room-a' },
      { from: 'w1', to: 'room-b' },
      { from: 'w1', to: 'room-c' },
      { from: 'e1', to: 'room-d' },
      { from: 'e1', to: 'room-e' },
    ],
  },
];

export function getFloorTemplate(id: string): FloorTemplate | undefined {
  return FLOOR_TEMPLATES.find(t => t.id === id);
}
