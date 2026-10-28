// Suggestions while someone types a place or address — for finding a venue's
// site on the world map. Photon (OpenStreetMap data, built for search-as-you-
// type) answers first; Nominatim is the fallback if Photon is down (only
// after a pause in typing, as its usage policy asks). Results lean toward
// where the map is looking. Coordinates typed as "9.01, 38.76" go straight
// through.

import { useEffect, useRef, useState } from 'react';

export interface PlaceSuggestion {
  id: string;
  name: string;
  /** Street, city, country — whatever is known. */
  detail: string;
  /** OpenStreetMap category, e.g. "tourism", "amenity", "leisure", "place", "highway", "building". */
  kind: string;
  /** The finer type, e.g. "park", "museum", "city". */
  type: string;
  lat: number;
  lng: number;
  /** [west, south, east, north] when the place has an area. */
  extent?: [number, number, number, number];
}

const PHOTON = 'https://photon.komoot.io/api/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const DEBOUNCE_MS = 220;
/** Ask Nominatim too when Photon hasn't answered by then. */
const SLOW_MS = 1100;
const cache = new Map<string, PlaceSuggestion[]>();

/** "9.0108, 38.7613" (or with a space) → a point. */
export function parseCoordinates(q: string): { lat: number; lng: number } | null {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** One coordinate as typed: "9.0108", "-1.5", "9.0108° N", "38.76 E" (S and W are negative). */
function readDegrees(s: string, pos: string, neg: string): number | null {
  const m = s.trim().toUpperCase().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/);
  if (!m || (m[2] && m[2] !== pos && m[2] !== neg)) return null;
  return m[2] === neg ? -Math.abs(Number(m[1])) : Number(m[1]);
}

/**
 * The Latitude and Longitude boxes → a point, or why not. A whole "lat, lng" pair pasted
 * into either box counts too.
 */
export function readLatLng(latText: string, lngText: string): { lat: number; lng: number } | { error: string } {
  const pair = parseCoordinates(latText) ?? parseCoordinates(lngText);
  if (pair) return pair;
  const lat = readDegrees(latText, 'N', 'S'), lng = readDegrees(lngText, 'E', 'W');
  if (lat === null || lng === null) return { error: 'Type numbers, like 9.0108 and 38.7613.' };
  if (Math.abs(lat) > 90) return { error: 'Latitude goes from −90 to 90.' };
  if (Math.abs(lng) > 180) return { error: 'Longitude goes from −180 to 180.' };
  return { lat, lng };
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number; osm_type?: string; osm_key?: string; osm_value?: string; type?: string; name?: string;
    housenumber?: string; street?: string; district?: string; city?: string; county?: string; state?: string; country?: string;
    extent?: [number, number, number, number];
  };
}

function fromPhoton(f: PhotonFeature): PlaceSuggestion | null {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const name = p.name || street || p.city || p.state;
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const detail = [p.name ? street : '', p.district, p.city !== name ? p.city : '', p.state !== name ? p.state : '', p.country]
    .filter((x, i, a) => x && a.indexOf(x) === i).join(', ');
  // Photon's extent is [west, north, east, south].
  const e = p.extent;
  return {
    id: `${p.osm_type ?? 'x'}${p.osm_id ?? `${lat},${lng}`}`, name, detail, kind: p.osm_key ?? 'place', type: p.osm_value ?? p.type ?? '',
    lat, lng, extent: e ? [e[0], e[3], e[2], e[1]] : undefined,
  };
}

async function photon(q: string, near: { lat: number; lng: number } | null, signal: AbortSignal) {
  const params = new URLSearchParams({ q, limit: '7', lang: 'en' });
  if (near) { params.set('lat', near.lat.toFixed(4)); params.set('lon', near.lng.toFixed(4)); }
  const res = await fetch(`${PHOTON}?${params}`, { signal });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const json = await res.json() as { features?: PhotonFeature[] };
  return (json.features ?? []).map(fromPhoton).filter((x): x is PlaceSuggestion => !!x);
}

/** Nominatim matches whole words only: if the half-typed last word finds nothing, try without it. Nearby places first. */
async function nominatim(q: string, near: { lat: number; lng: number } | null, signal: AbortSignal) {
  let list = await nominatimOnce(q, near, signal);
  const words = q.split(/\s+/);
  if (!list.length && words.length >= 2) list = await nominatimOnce(words.slice(0, -1).join(' '), near, signal);
  return nearFirst(list, near);
}

/** Places within a few hundred km of where the map looks come first (in the order found). */
function nearFirst(list: PlaceSuggestion[], near: { lat: number; lng: number } | null) {
  if (!near) return list;
  const far = (p: PlaceSuggestion) => (Math.hypot(p.lat - near.lat, (p.lng - near.lng) * Math.cos((near.lat * Math.PI) / 180)) > 3 ? 1 : 0);
  return list.map((p, i) => ({ p, i, k: far(p) })).sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.p);
}

async function nominatimOnce(q: string, near: { lat: number; lng: number } | null, signal: AbortSignal) {
  const params = new URLSearchParams({ format: 'jsonv2', q, limit: '8', addressdetails: '0' });
  // Prefer (not limit to) the area the map shows.
  if (near) params.set('viewbox', [near.lng - 1.5, near.lat + 1.5, near.lng + 1.5, near.lat - 1.5].map(x => x.toFixed(3)).join(','));
  const res = await fetch(`${NOMINATIM}?${params}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows = await res.json() as { place_id: number; name?: string; display_name: string; category?: string; type?: string; lat: string; lon: string; boundingbox?: string[] }[];
  return rows.map<PlaceSuggestion>(r => {
    const parts = r.display_name.split(', ');
    const bb = r.boundingbox?.map(Number);
    return {
      id: `n${r.place_id}`, name: r.name || parts[0], detail: parts.slice(1).join(', '), kind: r.category ?? 'place', type: r.type ?? '',
      lat: Number(r.lat), lng: Number(r.lon), extent: bb && bb.length === 4 ? [bb[2], bb[0], bb[3], bb[1]] : undefined,
    };
  });
}

/** Suggestions for `query`, biased toward `near`. */
export function usePlaceSuggestions(query: string, near: { lat: number; lng: number } | null) {
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const nearRef = useRef(near);
  nearRef.current = near;

  useEffect(() => {
    const q = query.trim();
    abort.current?.abort();
    if (q.length < 2) { setResults([]); setLoading(false); setFailed(false); return; }
    const point = parseCoordinates(q);
    if (point) {
      setResults([{ id: 'coords', name: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`, detail: 'Go to these coordinates', kind: 'coordinates', type: '', ...point }]);
      setLoading(false); setFailed(false);
      return;
    }
    const n = nearRef.current;
    const key = `${q.toLowerCase()}|${n ? `${n.lat.toFixed(1)},${n.lng.toFixed(1)}` : ''}`;
    const hit = cache.get(key);
    if (hit) { setResults(hit); setLoading(false); setFailed(false); return; }
    setLoading(true);
    const ctl = new AbortController();
    abort.current = ctl;
    const timer = setTimeout(async () => {
      try {
        // Photon first; if it's slow (the public server sometimes is) or down,
        // Nominatim too — by then typing has paused, as its policy asks. First answer wins.
        const list = await new Promise<PlaceSuggestion[]>((resolve, reject) => {
          let settled = false, asked = false, pending = 1;
          const win = (l: PlaceSuggestion[]) => { if (!settled) { settled = true; clearTimeout(backup); resolve(l); } };
          const fail = (e: unknown) => {
            pending--;
            if ((e as Error).name === 'AbortError') reject(e);
            else if (!asked) ask();
            else if (pending === 0 && !settled) reject(e);
          };
          const ask = () => {
            if (asked || settled || ctl.signal.aborted) return;
            asked = true; pending++;
            nominatim(q, n, ctl.signal).then(l => { pending--; if (l.length || pending === 0) win(l); }, fail);
          };
          photon(q, n, ctl.signal).then(l0 => {
            const l = nearFirst(l0, n); pending--; if (l.length) win(l); else if (!asked) ask(); else if (pending === 0) win(l); }, fail);
          const backup = setTimeout(ask, SLOW_MS);
        });
        cache.set(key, list);
        setResults(list); setFailed(false);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setResults([]); setFailed(true);
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [query]);

  return { results, loading, failed };
}
