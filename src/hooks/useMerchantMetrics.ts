/**
 * useMerchantMetrics — Module 4: Spatial Commerce
 *
 * Fetches aggregated promotion metrics (views, clicks, CTR) per POI
 * from Supabase's promotion_events table.
 * Designed for a lightweight merchant dashboard or admin panel.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface POIMetrics {
  poi_id: string;
  views: number;
  expands: number;
  clicks: number;
  dismissals: number;
  ctr: number;  // clicks / views, 0-1
}

export interface MerchantMetricsState {
  metrics: POIMetrics[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

export function useMerchantMetrics(poiIds: string[]): MerchantMetricsState {
  const [metrics, setMetrics] = useState<POIMetrics[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    if (poiIds.length === 0) {
      setMetrics([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: supaErr } = await supabase
        .from('promotion_events')
        .select('poi_id, event_type')
        .in('poi_id', poiIds);

      if (supaErr) throw supaErr;

      // Aggregate in JS — avoids needing a custom DB view for MVP
      const agg = new Map<string, { views: number; expands: number; clicks: number; dismissals: number }>();

      for (const id of poiIds) {
        agg.set(id, { views: 0, expands: 0, clicks: 0, dismissals: 0 });
      }

      for (const row of data ?? []) {
        const entry = agg.get(row.poi_id);
        if (!entry) continue;
        switch (row.event_type) {
          case 'promotion_view':            entry.views++;      break;
          case 'promotion_expand':          entry.expands++;    break;
          case 'promotion_click_navigate':  entry.clicks++;     break;
          case 'promotion_dismiss':         entry.dismissals++; break;
        }
      }

      const result: POIMetrics[] = [];
      for (const [poi_id, counts] of agg) {
        result.push({
          poi_id,
          ...counts,
          ctr: counts.views > 0 ? counts.clicks / counts.views : 0,
        });
      }

      setMetrics(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load metrics';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [poiIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  return { metrics, loading, error, refresh: fetchMetrics };
}

// ─── Utility: single-POI metrics query ──────────────────────────────────────────

export async function fetchSinglePOIMetrics(poiId: string): Promise<POIMetrics> {
  const { data, error } = await supabase
    .from('promotion_events')
    .select('event_type')
    .eq('poi_id', poiId);

  if (error || !data) {
    return { poi_id: poiId, views: 0, expands: 0, clicks: 0, dismissals: 0, ctr: 0 };
  }

  const counts = { views: 0, expands: 0, clicks: 0, dismissals: 0 };
  for (const row of data) {
    switch (row.event_type) {
      case 'promotion_view':            counts.views++;       break;
      case 'promotion_expand':          counts.expands++;     break;
      case 'promotion_click_navigate':  counts.clicks++;      break;
      case 'promotion_dismiss':         counts.dismissals++;  break;
    }
  }

  return {
    poi_id: poiId,
    ...counts,
    ctr: counts.views > 0 ? counts.clicks / counts.views : 0,
  };
}
