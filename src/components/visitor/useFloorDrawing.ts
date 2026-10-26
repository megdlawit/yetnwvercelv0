// The architect's drawing of one floor (walls, doors, furniture… by kind), loaded when
// the floor is shown and kept for the visit. Visitors get the copy taken at the last
// "Publish"; the team's preview gets the latest import.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PlanDrawing } from '@/lib/cad/planDrawing';

const cache = new Map<string, Promise<PlanDrawing | null>>();

async function load(floorId: string, live: boolean): Promise<PlanDrawing | null> {
  const { data, error } = await supabase.from('floor_drawings').select(live ? 'drawing' : 'published').eq('floor_id', floorId).maybeSingle();
  // No drawing yet, or a database without migration 20261026090000: the plan is drawn from the walls.
  if (error || !data) return null;
  const d = (live ? (data as { drawing: unknown }).drawing : (data as { published: unknown }).published) as PlanDrawing | null;
  return d && d.v === 1 && d.layers ? d : null;
}

export function useFloorDrawing(floorId: string | null, live = false): PlanDrawing | null {
  const [drawing, setDrawing] = useState<PlanDrawing | null>(null);
  useEffect(() => {
    setDrawing(null);
    if (!floorId) return;
    const key = `${floorId}|${live}`;
    if (!cache.has(key)) cache.set(key, load(floorId, live).catch(() => { cache.delete(key); return null; }));
    let current = true;
    cache.get(key)!.then(d => { if (current) setDrawing(d); });
    return () => { current = false; };
  }, [floorId, live]);
  return drawing;
}
