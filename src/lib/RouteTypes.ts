/**
 * RouteTypes — Shared route result types for indoor navigation.
 * Used by BuildingGraph, useIndoorRouting, and navigation UI.
 */

import { NavNode } from '@/data/types';
import { RouteVisualization } from '@/lib/RouteRenderer';

/** Average indoor walking speed in pixels per second (calibrated for typical floor maps). */
export const WALKING_SPEED_PX_PER_SEC = 50;

/** Extra seconds added per floor transition (stairs). */
export const STAIRS_TIME_PENALTY = 15;

/** Extra seconds added per floor transition (elevator, includes wait). */
export const ELEVATOR_TIME_PENALTY = 25;

export interface FloorTransition {
  index: number;
  fromFloorId: string;
  toFloorId: string;
  viaNodeId: string;
  arrivalNodeId: string;
  type: 'stairs' | 'elevator';
  direction: 'up' | 'down';
}

export interface FullRoute {
  /** Ordered node IDs along the path */
  nodeIds: string[];
  /** Resolved NavNode objects (when available) */
  nodes: NavNode[];
  /** Total graph distance (sum of edge weights) */
  distance: number;
  /** Metres on foot (floor changes excluded), for plans with a real scale */
  walkMeters?: number;
  /** Estimated walking time in seconds */
  estimatedSeconds: number;
  /** Human-readable walking time string */
  estimatedTimeLabel: string;
  /** Floor IDs traversed, in order */
  floors: string[];
  /** Points where the route transitions between floors */
  floorTransitions: FloorTransition[];
  /** SVG visualization data (optional, populated by UI layer) */
  visualization?: RouteVisualization;
}

/** Estimate walking time from distance + floor transitions. */
export function estimateWalkingTime(
  distance: number,
  transitions: FloorTransition[] = [],
): number {
  let seconds = distance / WALKING_SPEED_PX_PER_SEC;

  for (const t of transitions) {
    seconds += t.type === 'elevator' ? ELEVATOR_TIME_PENALTY : STAIRS_TIME_PENALTY;
  }

  return Math.round(seconds);
}

/** Format seconds into a human-readable label. */
export function formatWalkingTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}
