/**
 * useBuildings — fetches the `buildings` table from Supabase.
 *
 * Returns { buildings, loading, error } so every consumer can show
 * a skeleton, an error state, or the real data seamlessly.
 *
 * Falls back to an empty array on error so the UI never crashes.
 */
import { useState, useEffect } from 'react';
import { supabase, type BuildingRow } from '@/lib/supabase';

// Fallback data shown while the real data loads or if the table is empty.
// Remove these once your Supabase `buildings` table is populated.
const FALLBACK_BUILDINGS: BuildingRow[] = [
  { id: 1, name: 'National Museum',   floors: 4, rooms: 22, emoji: '🏛', bg: '#e8f4e8', available: true,  type: 'Museum' },
  { id: 2, name: 'Cultural Center',   floors: 2, rooms: 14, emoji: '🏢', bg: '#eaf0fa', available: true,  type: 'Cultural Venue' },
  { id: 3, name: 'Gardens Pavilion',  floors: 1, rooms: 8,  emoji: '🌿', bg: '#f0f8e8', available: true,  type: 'Pavilion' },
  { id: 4, name: 'Heritage Library',  floors: 3, rooms: 18, emoji: '📚', bg: '#fef8e8', available: true,  type: 'Library' },
  { id: 5, name: 'Exhibition Hall B', floors: 2, rooms: 10, emoji: '🏗', bg: '#f5f5f5', available: false, type: 'Exhibition Hall' },
];

interface UseBuildingsResult {
  buildings: BuildingRow[];
  loading: boolean;
  error: string | null;
}

export function useBuildings(): UseBuildingsResult {
  const [buildings, setBuildings] = useState<BuildingRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error,   setError]       = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchBuildings() {
      setLoading(true);
      setError(null);

      const { data, error: sbError } = await supabase
        .from('buildings')
        .select('id, name, floors, rooms, emoji, bg, available, type')
        .order('id', { ascending: true });

      if (cancelled) return;

      if (sbError) {
        console.error('[useBuildings] Supabase error:', sbError.message);
        setError(sbError.message);
        // Use fallback so the UI stays functional
        setBuildings(FALLBACK_BUILDINGS);
      } else if (!data || data.length === 0) {
        // Table exists but is empty — use fallback
        setBuildings(FALLBACK_BUILDINGS);
      } else {
        setBuildings(data as BuildingRow[]);
      }

      setLoading(false);
    }

    fetchBuildings();
    return () => { cancelled = true; };
  }, []);

  return { buildings, loading, error };
}
