/**
 * useOutdoorPlaceSearch — searches OUTDOOR places live from OpenStreetMap
 * (Nominatim search API), biased around a center point (e.g. Unity Park).
 *
 * This is the outdoor counterpart to useBuildings (which reads INDOOR
 * buildings from our own Supabase database). Indoor results = our DB.
 * Outdoor results = OpenStreetMap.
 *
 * Debounced + abortable so fast typing doesn't spam Nominatim or race
 * stale responses into the UI.
 */
import { useEffect, useRef, useState } from 'react';
import type { GeoCoord } from '@/lib/geo/GeoTypes';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DEBOUNCE_MS = 450;
const MIN_QUERY_LEN = 2;

/** Half-width of the search bounding box, in degrees (~6km). */
const BBOX_DEG = 0.06;

export interface OutdoorPlaceResult {
  id: string;
  /** Short label, e.g. "Meskel Square" */
  name: string;
  /** Full OSM display name, e.g. "Meskel Square, Kirkos, Addis Ababa" */
  displayName: string;
  /** OSM place/category type, e.g. "square", "cafe", "road" */
  type: string;
  lat: number;
  lng: number;
}

interface UseOutdoorPlaceSearchResult {
  results: OutdoorPlaceResult[];
  loading: boolean;
  error: string | null;
}

export function useOutdoorPlaceSearch(
  query: string,
  center: GeoCoord,
): UseOutdoorPlaceSearchResult {
  const [results, setResults] = useState<OutdoorPlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LEN) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);

      const viewbox = [
        center.lng - BBOX_DEG, // left
        center.lat + BBOX_DEG, // top
        center.lng + BBOX_DEG, // right
        center.lat - BBOX_DEG, // bottom
      ].join(',');

      const params = new URLSearchParams({
        format: 'jsonv2',
        q: trimmed,
        viewbox,
        bounded: '1',
        limit: '8',
        addressdetails: '1',
      });

      try {
        const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`Nominatim ${res.status}`);
        const json = (await res.json()) as Array<{
          place_id: number;
          display_name: string;
          name?: string;
          type?: string;
          lat: string;
          lon: string;
          address?: Record<string, string>;
        }>;

        const mapped: OutdoorPlaceResult[] = json.map(r => ({
          id: 'osm-' + r.place_id,
          name: r.name || r.address?.road || r.display_name.split(',')[0],
          displayName: r.display_name,
          type: r.type || 'place',
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
        }));

        setResults(mapped);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        console.warn('[useOutdoorPlaceSearch] Nominatim search failed', e);
        setError((e as Error).message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, center.lat, center.lng]);

  return { results, loading, error };
}
