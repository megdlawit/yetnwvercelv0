// Map features (doors, stairs, trees, …): one description shared by the 2D
// editor, the 3D world and the visitor map, so a kind looks and sizes the
// same everywhere.

import type { Room } from '@/data/types';

export type FeatureKind =
  | 'door' | 'arch' | 'window' | 'stairs' | 'elevator' | 'entrance' | 'tree' | 'bench' | 'furniture' | 'landmark' | 'label'
  // Scenery (also 'tree' and 'bench'):
  | 'palm' | 'shrub' | 'flowers' | 'grass' | 'water' | 'rock' | 'lamp' | 'fountain' | 'planter';

export interface MapFeature {
  id: string;
  kind: FeatureKind;
  x: number;           // editor px
  y: number;
  rotationDeg: number;
  width: number | null; // px; null = the kind's default
  depth: number | null;
  label: string | null;
}

export const FEATURE_KINDS: Record<FeatureKind, { label: string; w: number; d: number; color: string; placeable: boolean }> = {
  door:      { label: 'Door',      w: 0.9, d: 0.15, color: '#d97706', placeable: true },
  arch:      { label: 'Arch / opening', w: 1.4, d: 0.15, color: '#c2410c', placeable: true },
  window:    { label: 'Window',    w: 1.2, d: 0.15, color: '#38bdf8', placeable: true },
  stairs:    { label: 'Stairs',    w: 1.5, d: 3,    color: '#e05a47', placeable: true },
  elevator:  { label: 'Elevator',  w: 2,   d: 2,    color: '#3b6fe0', placeable: true },
  entrance:  { label: 'Entrance',  w: 1.5, d: 1.5,  color: '#16a34a', placeable: true },
  tree:      { label: 'Tree',      w: 3,   d: 3,    color: '#22a35a', placeable: true },
  bench:     { label: 'Bench',     w: 1.6, d: 0.5,  color: '#8a6a4c', placeable: true },
  furniture: { label: 'Furniture', w: 1,   d: 1,    color: '#a1887f', placeable: true },
  landmark:  { label: 'Landmark',  w: 1.5, d: 1.5,  color: '#9333ea', placeable: true },
  label:     { label: 'Text',      w: 0,   d: 0,    color: '#64748b', placeable: false },
  palm:      { label: 'Palm tree', w: 2.5, d: 2.5,  color: '#15803d', placeable: true },
  shrub:     { label: 'Shrub',     w: 1.2, d: 1.2,  color: '#4d7c0f', placeable: true },
  flowers:   { label: 'Flower bed', w: 2,  d: 1,    color: '#db2777', placeable: true },
  grass:     { label: 'Lawn',      w: 6,   d: 4,    color: '#65a30d', placeable: true },
  water:     { label: 'Pond / pool', w: 5, d: 3,    color: '#0ea5e9', placeable: true },
  rock:      { label: 'Rock',      w: 1,   d: 0.8,  color: '#78716c', placeable: true },
  lamp:      { label: 'Lamp post', w: 0.4, d: 0.4,  color: '#f59e0b', placeable: true },
  fountain:  { label: 'Fountain',  w: 3,   d: 3,    color: '#0284c7', placeable: true },
  planter:   { label: 'Planter',   w: 1,   d: 1,    color: '#b45309', placeable: true },
};

/** The scenery a venue can place outside (and inside): the Scenery tool's palette, in order. */
export const SCENERY_KINDS: FeatureKind[] = ['tree', 'palm', 'shrub', 'flowers', 'grass', 'water', 'fountain', 'rock', 'planter', 'lamp', 'bench'];
/** Scenery that replaces the automatic ring of trees once a venue places any. */
export const GREENERY_KINDS: FeatureKind[] = ['tree', 'palm', 'shrub', 'flowers', 'grass', 'water', 'fountain', 'rock', 'planter', 'lamp'];

/** Size in px, falling back to the kind's default (metres × pxPerMeter). */
export const featureSize = (f: Pick<MapFeature, 'kind' | 'width' | 'depth'>, pxPerMeter: number) => ({
  w: f.width ?? (FEATURE_KINDS[f.kind]?.w ?? 1) * pxPerMeter,
  d: f.depth ?? (FEATURE_KINDS[f.kind]?.d ?? 1) * pxPerMeter,
});

/** A room's outline: its polygon, or the rectangle. */
export const roomOutline = (r: Pick<Room, 'x' | 'y' | 'width' | 'height' | 'polygon'>) =>
  r.polygon && r.polygon.length >= 3 ? r.polygon
    : [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];

/** Parse a rooms.polygon jsonb value ([[x,y],...]) defensively. */
export function parsePolygon(v: unknown): { x: number; y: number }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const pts = v.filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number').map(([x, y]) => ({ x, y }));
  return pts.length >= 3 ? pts : undefined;
}
