/**
 * Persists recent map search selections in localStorage so the search panel
 * can show places the user actually picked (not hardcoded demo strings).
 */

export type SearchHistoryEntry =
  | {
      type: 'building';
      id: string;
      name: string;
      timestamp: number;
    }
  | {
      type: 'poi';
      id: string;
      name: string;
      buildingId: string;
      isOutdoor: boolean;
      timestamp: number;
    }
  | {
      type: 'outdoor_place';
      id: string;
      name: string;
      displayName: string;
      lat: number;
      lng: number;
      timestamp: number;
    };

const STORAGE_KEY = 'ethi_search_history';
const MAX_ENTRIES = 8;

export function loadSearchHistory(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SearchHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSearchHistory(entries: SearchHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* ignore quota errors */
  }
}

function sameEntry(a: SearchHistoryEntry, b: SearchHistoryEntry): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'building' && b.type === 'building') return a.id === b.id;
  if (a.type === 'poi' && b.type === 'poi') return a.id === b.id;
  if (a.type === 'outdoor_place' && b.type === 'outdoor_place') return a.id === b.id;
  return false;
}

export function addSearchHistoryEntry(entry: Omit<SearchHistoryEntry, 'timestamp'>): SearchHistoryEntry[] {
  const next: SearchHistoryEntry = { ...entry, timestamp: Date.now() } as SearchHistoryEntry;
  const deduped = loadSearchHistory().filter(e => !sameEntry(e, next));
  const updated = [next, ...deduped].slice(0, MAX_ENTRIES);
  saveSearchHistory(updated);
  return updated;
}
