// Discover / Explore on the venue map's panels: what the map page hands the
// desktop sidebar and the phone sheet, and the tab state they share.

import { useEffect, useState } from 'react';
import type { Tables } from '@/integrations/supabase/types';
import type { Place } from './types';
import type { BrowseStart, BrowseTab } from './VenueBrowse';

export interface VenueBrowseProps {
  name: string;
  sub: string;
  accent?: { primary: string; route: string };
  places: Place[];
  content: Tables<'venue_content'>[];
  start?: BrowseStart | null;
  /** Show a place on the map (path point id). */
  onPlace: (nodeId: string) => void;
  /** Directions to a place (path point id). */
  onNavigate: (nodeId: string) => void;
}

/** The Discover | Explore tab, following a link's start. */
export function useBrowseTab(start?: BrowseStart | null): [BrowseTab, (t: BrowseTab) => void] {
  const [tab, setTab] = useState<BrowseTab>(start?.tab ?? 'discover');
  useEffect(() => { if (start?.tab) setTab(start.tab); }, [start?.tab, start?.nonce]);
  return [tab, setTab];
}
