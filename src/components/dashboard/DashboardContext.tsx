// What every dashboard page gets: the workspace (person, institution,
// venue list) and the current venue's data, plus a way to refresh it.

import { createContext, useContext } from 'react';
import type { PlaceEntry } from '@/lib/venue/placeList';
import type { PoiRow, VenueData } from '@/components/venue/dashboard/useVenue';

export interface DashboardValue {
  data: VenueData;
  places: PlaceEntry<PoiRow>[];
  reload: () => Promise<void>;
  /** "Floor"/"Floors" for buildings, "Zone"/"Zones" for outdoor sites. */
  area: { one: string; many: string };
  editorUrl: (floorId?: string) => string | null;
  previewUrl: string;
  canManageTeam: boolean;
  openPublish: () => void;
}

export const DashboardContext = createContext<DashboardValue | null>(null);

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used inside the dashboard');
  return ctx;
}
