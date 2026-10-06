// src/hooks/useAdminLayers.ts
//
// Replaces the localStorage-only persistence in Adminlayersdashboard.tsx
// (ADMIN_LAYERS_STORAGE_KEY). Layers now live in the `custom_layers` table
// (see 20260930090000_foundation_institutions_rooms.sql) so they survive
// across browsers/devices instead of being stuck in one admin's browser.
//
// Drop-in swap in Adminlayersdashboard.tsx:
//
//   - const [layers, setLayers] = useState<Layer[]>(() => {
//   -   try {
//   -     const saved = localStorage.getItem(ADMIN_LAYERS_STORAGE_KEY);
//   -     if (saved) return JSON.parse(saved) as Layer[];
//   -   } catch { /* ignore */ }
//   -   return INITIAL_LAYERS;
//   - });
//   - useEffect(() => {
//   -   try { localStorage.setItem(ADMIN_LAYERS_STORAGE_KEY, JSON.stringify(layers)); }
//   -   catch { /* ignore */ }
//   - }, [layers]);
//   + const [layers, setLayers, layersLoading] = useAdminLayers(INITIAL_LAYERS);
//
// (add `import { useAdminLayers } from '@/hooks/useAdminLayers';` at the top,
// and optionally show a spinner while layersLoading is true — the dashboard
// already renders fine with INITIAL_LAYERS as a placeholder while it loads.)
//
// institutionId is optional for now — pass it once a venue has one (see the
// manual step at the bottom of the foundation migration); until then rows
// are stored with institution_id = NULL, matching today's single-admin setup.

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { CustomLayer } from '@/lib/customLayers';

type Layer = CustomLayer;

export function useAdminLayers(
  initial: Layer[],
  institutionId: string | null = null,
): [Layer[], (v: Layer[] | ((prev: Layer[]) => Layer[])) => void, boolean] {
  const [layers, setLayersState] = useState<Layer[]>(initial);
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedOnce = useRef(false);

  // Load once on mount (or when the institution changes).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let q = supabase.from('custom_layers').select('layer_key, data');
      q = institutionId ? q.eq('institution_id', institutionId) : q.is('institution_id', null);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        console.error('Load custom_layers error:', error);
        setLoading(false);
        return;
      }
      if (data && data.length > 0) {
        setLayersState(data.map(r => r.data as Layer));
      } else {
        setLayersState(initial); // first run for this institution — seed with defaults
      }
      loadedOnce.current = true;
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId]);

  // Debounced save — layers change on every drag/toggle, so avoid a network
  // round-trip per pixel. One upsert per layer_key via onConflict.
  const persist = useCallback((next: Layer[]) => {
    if (!loadedOnce.current) return; // don't overwrite server state with the pre-load default
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const rows = next.map(l => ({
        institution_id: institutionId,
        layer_key: l.id,
        data: l,
      }));
      const { error } = await supabase
        .from('custom_layers')
        .upsert(rows, { onConflict: 'institution_id,layer_key' });
      if (error) console.error('Save custom_layers error:', error);
    }, 500);
  }, [institutionId]);

  const setLayers = useCallback((v: Layer[] | ((prev: Layer[]) => Layer[])) => {
    setLayersState(prev => {
      const next = typeof v === 'function' ? (v as (p: Layer[]) => Layer[])(prev) : v;
      persist(next);
      return next;
    });
  }, [persist]);

  return [layers, setLayers, loading];
}