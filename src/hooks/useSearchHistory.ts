import { useCallback, useState } from 'react';
import {
  addSearchHistoryEntry,
  loadSearchHistory,
  type SearchHistoryEntry,
  type SearchHistoryInput,
} from '@/lib/searchHistory';

export function useSearchHistory() {
  const [entries, setEntries] = useState<SearchHistoryEntry[]>(() => loadSearchHistory());

  const record = useCallback((entry: SearchHistoryInput) => {
    const updated = addSearchHistoryEntry(entry);
    setEntries(updated);
    return updated;
  }, []);

  const refresh = useCallback(() => {
    setEntries(loadSearchHistory());
  }, []);

  return { entries, record, refresh };
}
