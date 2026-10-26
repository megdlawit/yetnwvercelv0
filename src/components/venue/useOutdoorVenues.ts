// What the outdoor map shows: the venue being viewed (full detail, its
// ground level) and the other placed venues of the same institution (as
// footprints you can step into).

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Room, Wall } from '@/data/types';
import { anchorOf, footprint, planBounds, venueGeoJSON } from '@/lib/venue/geoVenue';
import type { OutdoorVenue } from './OutdoorView';
import type { PlanDrawing } from '@/lib/cad/planDrawing';

interface BuildingLike {
  id: string; name: string; institution_id?: string | null; layout?: string | null;
  origin_lat?: number | null; origin_lng?: number | null; rotation_deg?: number | null; meters_per_pixel?: number | null;
}
interface Ground {
  walls: Pick<Wall, 'x1' | 'y1' | 'x2' | 'y2'>[]; rooms: Room[];
  places: { id: string; name: string; x: number; y: number }[];
  paths: { a: { x: number; y: number }; b: { x: number; y: number } }[];
  drawing?: PlanDrawing | null;
}

/** The venue being viewed, placed on the map — or null if it hasn't been placed yet. */
export function useCurrentOutdoorVenue(building: BuildingLike | null, ground: Ground | null, floors: number): OutdoorVenue | null {
  return useMemo(() => {
    const anchor = building && anchorOf(building);
    if (!building || !anchor || !ground) return null;
    const bounds = planBounds(ground.walls, ground.rooms, ground.places);
    if (!bounds) return null;
    return {
      id: building.id, name: building.name, current: true, layout: building.layout ?? 'building', floors,
      ring: footprint(anchor, bounds, 4), rotationDeg: anchor.rotationDeg,
      geo: venueGeoJSON(anchor, ground, { venue: building.id }),
    };
  }, [building, ground, floors]);
}

/** The institution's other published, placed venues, as footprints. */
export function useSiblingVenues(building: BuildingLike | null): OutdoorVenue[] {
  const [list, setList] = useState<OutdoorVenue[]>([]);
  const inst = building?.institution_id, self = building?.id;
  useEffect(() => {
    if (!inst || !self) { setList([]); return; }
    let live = true;
    (async () => {
      const { data: rows } = await supabase.from('buildings').select('*').eq('institution_id', inst).neq('id', self);
      const placed = (rows ?? []).filter(r => anchorOf(r));
      if (!placed.length) { if (live) setList([]); return; }
      const { data: snaps } = await supabase.from('venue_snapshots').select('building_id, data').in('building_id', placed.map(r => r.id));
      const out: OutdoorVenue[] = [];
      for (const r of placed) {
        const d = snaps?.find(s => s.building_id === r.id)?.data as { floors?: { id: string; level: number }[]; walls?: (Pick<Wall, 'x1' | 'y1' | 'x2' | 'y2'> & { floor_id: string })[]; rooms?: { floor_id: string; x: number; y: number; width: number; height: number }[] } | undefined;
        if (!d) continue;
        const lowest = [...(d.floors ?? [])].sort((a, b) => a.level - b.level)[0]?.id;
        const walls = (d.walls ?? []).filter(w => !lowest || w.floor_id === lowest);
        const rooms = (d.rooms ?? []).filter(x => !lowest || x.floor_id === lowest);
        const bounds = planBounds(walls, rooms);
        const anchor = anchorOf(r)!;
        if (bounds) out.push({ id: r.id, name: r.name, current: false, layout: r.layout ?? 'building', floors: d.floors?.length ?? 1, ring: footprint(anchor, bounds), rotationDeg: anchor.rotationDeg });
      }
      if (live) setList(out);
    })().catch(err => console.warn('Could not load nearby venues:', err));
    return () => { live = false; };
  }, [inst, self]);
  return list;
}
