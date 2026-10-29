// What the visitor map adds to a venue's published places, read live (not from the published
// snapshot): business profiles — a business's own contact, prices and amenities — and the
// rating of each place from visitor reviews (migration 20261103090000).

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { businessInfo, type BusinessInfo, type ReviewSummary } from '@/lib/venue/business';
import { getPackage } from '@/lib/offline/venuePackage';

export interface VenueExtras {
  business: Map<string, BusinessInfo>;
  ratings: Map<string, ReviewSummary>;
  /** False before the migration has run (nothing to show, nothing to write). */
  available: boolean;
  reload: () => void;
}

const EMPTY: VenueExtras = { business: new Map(), ratings: new Map(), available: false, reload: () => {} };

export function useVenueExtras(venueId: string | undefined): VenueExtras {
  const [state, setState] = useState<Omit<VenueExtras, 'reload'>>(EMPTY);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let live = true;
    if (venueId) {
      void (async () => {
        const [bp, rs] = await Promise.all([
          supabase.from('business_profiles').select('*').eq('building_id', venueId),
          supabase.rpc('place_review_summary', { b: venueId }),
        ]);
        // No connection: what was saved with the venue for offline use.
        const offline = bp.error && /fetch|network|load failed/i.test(bp.error.message) ? await getPackage(venueId) : null;
        if (live) {
          const rows = offline ? offline.business : bp.data ?? [];
          const summary = offline ? offline.ratings : rs.data ?? [];
          const business = new Map<string, BusinessInfo>();
          for (const row of rows) {
            const info = businessInfo(row);
            if (info) business.set(row.poi_id, info);
          }
          const ratings = new Map<string, ReviewSummary>(summary.map(r => [r.poi_id, { rating: Number(r.rating), reviews: Number(r.reviews) }] as const));
          setState({ business, ratings, available: !!offline || (!bp.error && !rs.error) });
        }
      })();
    } else {
      setState(EMPTY);
    }
    return () => { live = false; };
  }, [venueId, tick]);

  return { ...state, reload };
}

/** Lets list rows and cards show a place's rating without passing it through every view. */
export const VenueExtrasContext = createContext<VenueExtras>(EMPTY);
export const useExtras = () => useContext(VenueExtrasContext);
