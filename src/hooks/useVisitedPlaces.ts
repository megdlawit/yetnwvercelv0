import { useCallback, useEffect, useMemo } from 'react';
import { POI, POICategory } from '@/data/poi';
import {
  useVisitorStore, rememberPlaces, snapshotFor, recordVisit as storeVisit, removeVisit as storeRemove, getVisitorState, syncVisitor,
} from '@/lib/visitor/visitorStore';

export type VisitSource = 'auto' | 'manual';

export interface VisitedPlace {
  id: string;
  profile_id: string;
  poi_id: string;
  visit_count: number;
  source: VisitSource;
  first_visited_at: string;
  last_visited_at: string;
}

// What's kept about each visited place, so the history shows its name and
// photo even when that venue isn't the one open now.
export interface VisitedPOISnapshot {
  id: string;
  name: string;
  description: string;
  subcategory: string;
  imageUrl: string | null;
  category: POICategory;
  buildingId?: string | null;
  nodeId?: string | null;
  venueName?: string | null;
}

/**
 * The visitor's visit history — places they've actually been to, as opposed
 * to the saved list. Recorded automatically (navigation arrival, QR) or by
 * hand ("Mark as visited"); a repeat visit bumps the count. Kept on the
 * device and synced to the profile (see lib/visitor/visitorStore).
 */
export function useVisitedPlaces(profileId: string | null | undefined, pois?: POI[]) {
  const store = useVisitorStore();
  useEffect(() => { if (pois?.length) rememberPlaces(pois); }, [pois]);
  useEffect(() => { void syncVisitor(profileId); }, [profileId]);

  const visitedPlaces = useMemo<VisitedPlace[]>(() => store.visits.map(e => ({
    id: e.id, profile_id: profileId ?? '', poi_id: e.id, visit_count: e.count, source: e.source, first_visited_at: e.firstAt, last_visited_at: e.lastAt,
  })), [store.visits, profileId]);
  const visitedPOIs = useMemo(() => new Map<string, VisitedPOISnapshot>(store.visits.map(e => [e.id, {
    id: e.id, name: e.name, description: e.detail, subcategory: e.detail, imageUrl: e.imageUrl,
    category: e.category as POICategory, buildingId: e.buildingId, nodeId: e.nodeId, venueName: e.venueName,
  }])), [store.visits]);

  const isVisited = useCallback((poiId: string) => visitedPlaces.some(vp => vp.poi_id === poiId), [visitedPlaces]);
  const getVisit = useCallback((poiId: string) => visitedPlaces.find(vp => vp.poi_id === poiId) ?? null, [visitedPlaces]);

  /** Records a visit — the first one adds the place, later ones bump the count. `log: false` when the caller logs its own activity (a walk). */
  const recordVisit = useCallback(async (poiId: string, source: VisitSource = 'auto', opts?: { log?: boolean }) => {
    storeVisit(snapshotFor(poiId), source, opts);
    return true;
  }, []);
  const removeVisit = useCallback(async (poiId: string) => {
    if (!getVisitorState().visits.some(v => v.id === poiId)) return false;
    storeRemove(poiId);
    return true;
  }, []);
  const refresh = useCallback(() => syncVisitor(profileId, true), [profileId]);

  return { visitedPlaces, visitedPOIs, loading: false, error: null as string | null, isVisited, getVisit, recordVisit, removeVisit, refresh };
}

/** Formats a last-visited timestamp as a short relative label, e.g. "Today", "3d ago". */
export function formatVisitedWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffDays = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
