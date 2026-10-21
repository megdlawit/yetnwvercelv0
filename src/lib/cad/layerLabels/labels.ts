// The 14 layer labels of the AI labeler (ml/yetnew_layers/labels.py — keep in
// step) and what each one becomes in the venue editor.
//
// The review gate itself (confirm every layer, always-confirm labels) comes
// from the labeling service with each result, so it has one source of truth;
// ALWAYS_CONFIRM here is only the fallback when a result doesn't carry it.

import type { Category } from '../types';

export const LAYER_LABELS = [
  'wall', 'door', 'window', 'stairs', 'elevator', 'restroom', 'room', 'walkable',
  'vegetation', 'furniture', 'text', 'dimension', 'ignore', 'unknown',
] as const;

export type LayerLabel = (typeof LAYER_LABELS)[number];

export const isLayerLabel = (v: unknown): v is LayerLabel =>
  typeof v === 'string' && (LAYER_LABELS as readonly string[]).includes(v);

export const LAYER_LABEL_NAMES: Record<LayerLabel, string> = {
  wall: 'Walls', door: 'Doors', window: 'Windows', stairs: 'Stairs', elevator: 'Elevators',
  restroom: 'Restrooms', room: 'Rooms', walkable: 'Walkable (hint)', vegetation: 'Trees & plants',
  furniture: 'Furniture', text: 'Labels (text)', dimension: 'Dimensions', ignore: 'Ignore', unknown: 'Unknown — choose one',
};

/** Labels that always need their own confirmation (never by group or bulk). */
export const ALWAYS_CONFIRM: readonly LayerLabel[] = ['ignore', 'walkable', 'unknown'];

/**
 * What a confirmed label does to the import. `unknown` has no category: it
 * blocks "Create venue" until changed. `walkable` is stored as a hint only —
 * walkable paths stay generated from the geometry, never from AI labels.
 */
export const LABEL_TO_CATEGORY: Record<Exclude<LayerLabel, 'unknown'>, Category> = {
  wall: 'walls', door: 'doors', window: 'windows', stairs: 'stairs', elevator: 'elevators',
  restroom: 'rooms', room: 'rooms', walkable: 'ignore', vegetation: 'trees', furniture: 'furniture',
  text: 'labels', dimension: 'ignore', ignore: 'ignore',
};

/** Room type given to rooms outlined on a layer with this label. */
export const LABEL_ROOM_TYPE: Partial<Record<LayerLabel, string>> = { restroom: 'restroom' };
