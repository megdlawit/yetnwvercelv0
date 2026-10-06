import { useCallback, useState } from 'react';
import {
  addSearchHistoryEntry,
  loadSearchHistory,
  type SearchHistoryEntry,
} from '@/lib/searchHistory';

export function useSearchHistory() {
  const [entries, setEntries] = useState<SearchHistoryEntry[]>(() => loadSearchHistory());

  const record = useCallback((entry: Omit<SearchHistoryEntry, 'timestamp'>) => {
    const updated = addSearchHistoryEntry(entry);
    setEntries(updated);
    return updated;
  }, []);

  const refresh = useCallback(() => {
    setEntries(loadSearchHistory());
  }, []);

  return { entries, record, refresh };
}
