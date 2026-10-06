import { describe, expect, it } from 'vitest';
import type { Building } from '@/data/types';
import { BuildingGraph } from './BuildingGraph';
import { NavigationController, type NavSnapshot } from './NavigationController';
import { pxPerMeterOf, sanitizeMetersPerPixel } from './navScale';

// An L-shaped corridor drawn at the editor's 40 px per metre:
// A → B is 10 m east, then B → C is 5 m south (a right turn).
const PX = 40;
const building: Building = {
  id: 'b', name: 'Test', address: '', city: '', metersPerPixel: 1 / PX,
  floors: [{
    id: 'f', buildingId: 'b', level: 0, name: 'Ground', width: 800, height: 500, rooms: [], walls: [],
    nodes: [
      { id: 'A', floorId: 'f', name: 'Gate', x: 0, y: 0, isHallway: false },
      { id: 'B', floorId: 'f', name: '', x: 10 * PX, y: 0, isHallway: true },
      { id: 'C', floorId: 'f', name: 'Café', x: 10 * PX, y: 5 * PX, isHallway: false },
    ],
    edges: [
      { id: 'ab', fromNodeId: 'A', toNodeId: 'B', weight: 10 * PX },
      { id: 'bc', fromNodeId: 'B', toNodeId: 'C', weight: 5 * PX },
    ],
  }],
};

function navigate() {
  let snap: NavSnapshot | null = null;
  const ctrl = new NavigationController(BuildingGraph.fromBuilding(building), { onStateChange: s => { snap = s; } }, { pxPerMeter: pxPerMeterOf(building) });
  ctrl.voiceEngine.setEnabled(false);
  ctrl.startNavigation('A', 'C');
  return { ctrl, snap: () => snap! };
}

describe('NavigationController in real metres', () => {
  it('describes the route in metres, not plan pixels', () => {
    const { snap } = navigate();
    expect(snap().distanceRemaining).toBe(15);
    expect(snap().instructions[0]).toMatchObject({ type: 'RIGHT', distance: 10, text: 'Turn right in 10m' });
  });

  it('counts down with every step, from where the person is', () => {
    const { ctrl, snap } = navigate();
    ctrl.updatePosition(4 * PX, 0);          // walked 4 m
    expect(snap().distanceRemaining).toBe(11);
    expect(snap().distanceToNextTurn).toBe(6);
  });

  it('arrives within 2 m of the place, not before', () => {
    const { ctrl, snap } = navigate();
    ctrl.updatePosition(10 * PX, 2 * PX);    // 3 m short
    expect(snap().state).toBe('NAVIGATING');
    ctrl.updatePosition(10 * PX, 3.5 * PX);  // 1.5 m short
    expect(snap().state).toBe('ARRIVED');
  });

  it('keeps the walking-time estimate in metres', () => {
    const route = BuildingGraph.fromBuilding(building).findPath('A', 'C')!;
    expect(route.estimatedSeconds).toBeLessThan(30);   // 15 m, not 600 "m"
  });
});

describe('navScale', () => {
  it('treats the database default of 1 m/px as "not set"', () => {
    expect(sanitizeMetersPerPixel(1)).toBe(1 / 40);
    expect(sanitizeMetersPerPixel(null)).toBe(1 / 40);
    expect(sanitizeMetersPerPixel(0.05)).toBe(0.05);
  });
  it('keeps the original units for buildings without a scale', () => {
    expect(pxPerMeterOf({})).toBe(1);
    expect(pxPerMeterOf({ metersPerPixel: 0.025 })).toBe(40);
  });
});
