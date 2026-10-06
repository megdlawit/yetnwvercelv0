// Places a visitor saved, kept on their phone (no sign-in needed).

import { useCallback, useState } from 'react';

const key = (venueId: string) => `yetnew-saved-${venueId}`;
const read = (venueId: string | undefined): string[] => {
  if (!venueId) return [];
  try { return JSON.parse(localStorage.getItem(key(venueId)) || '[]'); } catch { return []; }
};

export function useSavedPlaces(venueId: string | undefined) {
  const [ids, setIds] = useState<string[]>(() => read(venueId));
  const [forVenue, setForVenue] = useState(venueId);
  if (forVenue !== venueId) { setForVenue(venueId); setIds(read(venueId)); }
  const toggle = useCallback((placeId: string) => {
    if (!venueId) return false;
    let nowSaved = false;
    setIds(prev => {
      nowSaved = !prev.includes(placeId);
      const next = nowSaved ? [...prev, placeId] : prev.filter(x => x !== placeId);
      try { localStorage.setItem(key(venueId), JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
    return nowSaved;
  }, [venueId]);
  return { ids, has: (id: string) => ids.includes(id), toggle };
}
