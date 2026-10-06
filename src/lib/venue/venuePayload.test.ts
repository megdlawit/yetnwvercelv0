import { describe, expect, it } from 'vitest';
import { buildVenuePayload, routingGraph, PX_PER_METER, type VenueRows } from '../../../supabase/functions/_shared/venuePayload';
import { findRoute, directions } from '../../../supabase/functions/_shared/routing';

// A two-floor test building: lobby and café downstairs, gallery upstairs,
// joined by a staircase and a lift (roadmap step 1.4's "done when").
const P = PX_PER_METER;
const node = (id: string, floor: string, x: number, y: number, name = '', hall = !name) =>
  ({ id, floor_id: floor, name, x: x * P, y: y * P, is_hallway: hall });
const edge = (a: string, b: string, extra: { connection?: string; accessible?: boolean } = {}) =>
  ({ id: `${a}-${b}`, from_node: a, to_node: b, weight: 100, connection: null, accessible: true, ...extra });

const rows: VenueRows = {
  floors: [{ id: 'f1', level: 1, name: 'First floor' }, { id: 'f0', level: 0, name: 'Ground floor' }],
  nodes: [
    node('lobby', 'f0', 0, 0, 'Lobby'), node('h0', 'f0', 10, 0), node('cafe', 'f0', 10, 8, 'Café'),
    node('st0', 'f0', 12, 0), node('lift0', 'f0', 0, 6),
    node('st1', 'f1', 12, 0), node('lift1', 'f1', 0, 6), node('h1', 'f1', 6, 3), node('gallery', 'f1', 20, 0, 'Gallery'),
  ],
  edges: [
    edge('lobby', 'h0'), edge('h0', 'cafe'), edge('h0', 'st0'), edge('lobby', 'lift0'),
    edge('st0', 'st1', { connection: 'stairs', accessible: false }),
    edge('lift0', 'lift1', { connection: 'elevator', accessible: true }),
    edge('st1', 'gallery'), edge('lift1', 'h1'), edge('h1', 'gallery'),
  ],
  rooms: [{ id: 'r1', floor_id: 'f1', name: 'Main Gallery', type: 'office', node_id: 'gallery', x: 760, y: -40, width: 80, height: 80, polygon: [[760, -40], [840, -40], [840, 40], [760, 40]] }],
  walls: [{ floor_id: 'f0', x1: -40, y1: -40, x2: 600, y2: -40 }],
  features: [{ id: 'd1', floor_id: 'f0', kind: 'door', x: 0, y: -40, rotation_deg: 0, width: null, depth: null, label: null }],
};

describe('partner API venue payload', () => {
  const v = buildVenuePayload(rows);

  it('lists every floor in level order with its own content and real bounds', () => {
    expect(v.floors.map(f => f.level)).toEqual([0, 1]);
    expect(v.floors[0].nodes.map(n => n.id)).toContain('cafe');
    expect(v.floors[1].rooms[0]).toMatchObject({ name: 'Main Gallery', nodeId: 'gallery' });
    expect(v.floors[1].rooms[0].outline).toHaveLength(4);
    expect(v.floors[0].bounds.minX).toBe(-40);
    expect(v.floors[0].features[0].kind).toBe('door');
  });

  it('keeps same-floor paths per floor and reports floor connections separately', () => {
    expect(v.floors[0].edges.some(e => e.id === 'st0-st1')).toBe(false);
    expect(v.connections).toEqual([
      { id: 'st0-st1', fromNodeId: 'st0', toNodeId: 'st1', fromLevel: 0, toLevel: 1, kind: 'stairs', accessible: false },
      { id: 'lift0-lift1', fromNodeId: 'lift0', toNodeId: 'lift1', fromLevel: 0, toLevel: 1, kind: 'elevator', accessible: true },
    ]);
  });
});

describe('two-floor routing (roadmap 1.4)', () => {
  const { nodes, edges } = routingGraph(rows);

  it('routes from the ground floor to the first floor', () => {
    const path = findRoute(nodes, edges, 'cafe', 'gallery', { pxPerMeter: P })!;
    expect(path.map(n => n.id)).toEqual(['cafe', 'h0', 'st0', 'st1', 'gallery']);
    const d = directions(path, P, 'Main Gallery', edges);
    expect(d.steps.map(s => s.text)).toContain('Take the stairs up to First floor');
    expect(d.steps.at(-1)!.text).toBe('Arrive at Main Gallery');
  });

  it('takes the lift when the route must be step-free', () => {
    const path = findRoute(nodes, edges, 'cafe', 'gallery', { pxPerMeter: P, stepFree: true })!;
    expect(path.map(n => n.id)).toContain('lift1');
    expect(path.map(n => n.id)).not.toContain('st1');
    expect(directions(path, P, 'Main Gallery', edges).steps.map(s => s.text)).toContain('Take the elevator up to First floor');
  });

  it('names destinations by their room', () => {
    expect(nodes.find(n => n.id === 'gallery')!.name).toBe('Main Gallery');
  });
});
