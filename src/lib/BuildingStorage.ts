/**
 * BuildingStorage — localStorage persistence layer for buildings.
 * Phase 1: local JSON. Phase 2: upgrade to backend.
 */

import { Building, Floor, Room, NavNode, NavEdge } from '@/data/types';

const STORAGE_KEY = 'indoor-nav-buildings';

export function loadBuildings(): Building[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveBuildings(buildings: Building[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buildings));
}

export function getBuilding(id: string): Building | undefined {
  return loadBuildings().find(b => b.id === id);
}

export function saveBuilding(building: Building): void {
  const all = loadBuildings();
  const idx = all.findIndex(b => b.id === building.id);
  if (idx >= 0) all[idx] = building;
  else all.push(building);
  saveBuildings(all);
}

export function deleteBuilding(id: string): void {
  saveBuildings(loadBuildings().filter(b => b.id !== id));
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createEmptyFloor(buildingId: string, level: number, name: string): Floor {
  return {
    id: generateId('floor'),
    buildingId,
    level,
    name,
    width: 800,
    height: 500,
    rooms: [],
    nodes: [],
    edges: [],
    walls: [],
  };
}

export function createEmptyBuilding(name: string, address: string, city: string): Building {
  const id = generateId('bldg');
  return {
    id,
    name,
    address,
    city,
    floors: [createEmptyFloor(id, 1, 'Ground Floor')],
  };
}

/** Validate a building graph for issues */
export interface ValidationIssue {
  type: 'error' | 'warning';
  message: string;
  floorId?: string;
  nodeId?: string;
}

export function validateBuilding(building: Building): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allNodeIds = new Set<string>();
  const connectedNodes = new Set<string>();

  for (const floor of building.floors) {
    for (const node of floor.nodes) {
      if (allNodeIds.has(node.id)) {
        issues.push({ type: 'error', message: `Duplicate node ID: ${node.id}`, floorId: floor.id, nodeId: node.id });
      }
      allNodeIds.add(node.id);
    }

    for (const edge of floor.edges) {
      const fromExists = floor.nodes.some(n => n.id === edge.fromNodeId);
      const toExists = floor.nodes.some(n => n.id === edge.toNodeId);
      if (!fromExists) issues.push({ type: 'error', message: `Edge ${edge.id} references missing node ${edge.fromNodeId}`, floorId: floor.id });
      if (!toExists) issues.push({ type: 'error', message: `Edge ${edge.id} references missing node ${edge.toNodeId}`, floorId: floor.id });
      connectedNodes.add(edge.fromNodeId);
      connectedNodes.add(edge.toNodeId);
    }

    // Isolated nodes
    for (const node of floor.nodes) {
      if (!connectedNodes.has(node.id) && floor.nodes.length > 1) {
        issues.push({ type: 'warning', message: `Isolated node: ${node.name || node.id}`, floorId: floor.id, nodeId: node.id });
      }
    }
  }

  // Cross-floor connector validation
  const stairsFloors = building.floors.filter(f => f.rooms.some(r => r.type === 'stairs'));
  const elevatorFloors = building.floors.filter(f => f.rooms.some(r => r.type === 'elevator'));

  if (building.floors.length > 1) {
    if (stairsFloors.length === 0 && elevatorFloors.length === 0) {
      issues.push({ type: 'error', message: 'Multi-floor building has no stairs or elevator connectors' });
    }
    // Check if connectors exist on adjacent floors
    for (let i = 0; i < building.floors.length - 1; i++) {
      const lower = building.floors[i];
      const upper = building.floors[i + 1];
      const lowerHasConnector = lower.rooms.some(r => r.type === 'stairs' || r.type === 'elevator');
      const upperHasConnector = upper.rooms.some(r => r.type === 'stairs' || r.type === 'elevator');
      if (!lowerHasConnector || !upperHasConnector) {
        issues.push({ type: 'warning', message: `Floors ${lower.name} and ${upper.name} may lack matching connectors` });
      }
    }
  }

  return issues;
}

/** Export building as downloadable JSON */
export function exportBuildingJSON(building: Building): void {
  const json = JSON.stringify(building, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${building.name.replace(/\s+/g, '-').toLowerCase()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Import building from JSON string */
export function importBuildingJSON(jsonStr: string): Building | null {
  try {
    const data = JSON.parse(jsonStr);
    if (data.id && data.name && Array.isArray(data.floors)) {
      return data as Building;
    }
    return null;
  } catch {
    return null;
  }
}
