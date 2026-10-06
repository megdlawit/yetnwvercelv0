// Getting to the venue from outside: a walking route along real streets
// (OSRM, through the /api/osrm proxy) from the visitor's GPS position to the
// venue's entrance. Falls back to a straight line if routing is unavailable.

import { useEffect, useState } from 'react';
import { fetchStreetRoute } from '@/lib/geo/StreetRouting';
import { haversineMeters } from '@/lib/geo/GeoMath';
import type { GeoCoord } from '@/lib/geo/GeoTypes';

type Pos = [number, number];
export interface StreetDirections { line: Pos[]; metres: number; minutes: number; approximate: boolean }

export function useStreetDirections(from: GeoCoord | null, to: GeoCoord | null, enabled: boolean) {
  const [result, setResult] = useState<StreetDirections | null>(null);
  const [loading, setLoading] = useState(false);
  // Re-route only when the start moves meaningfully (~25 m), not on every GPS tick.
  const key = from && to && enabled ? `${from.lat.toFixed(4)},${from.lng.toFixed(4)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}` : null;

  useEffect(() => {
    if (!key || !from || !to) { setResult(null); return; }
    let live = true;
    setLoading(true);
    fetchStreetRoute(from, to, 'walk').then(r => {
      if (!live) return;
      if (r) {
        // The street route ends on the nearest road; carry the line on to the entrance itself.
        setResult({ line: [...r.path.map(n => [n.lng, n.lat] as Pos), [to.lng, to.lat]], metres: r.distanceM, minutes: Math.max(1, Math.round(r.distanceM / 1.3 / 60)), approximate: false });
      } else {
        const m = haversineMeters(from, to);
        setResult({ line: [[from.lng, from.lat], [to.lng, to.lat]], metres: m, minutes: Math.max(1, Math.round((m * 1.3) / 1.2 / 60)), approximate: true });
      }
    }).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { directions: result, loading };
}

