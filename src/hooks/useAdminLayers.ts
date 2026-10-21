// Map layers live in the `custom_layers` table (one row per layer), so what
// the platform team draws in the control center reaches every visitor's
// outdoor map — not just the browser it was drawn in.
//
//   useAdminLayers   — the admin editor: load, edit, autosave (debounced),
//                      deletes included; adopts an old browser-only copy once.
//   usePublishedLayers — visitors: the platform's layers, cached for offline
//                      and refreshed when the app comes back into view.
//
// Platform layers have institution_id = NULL (only the Yet New team may
// write them — see 20261009090000_platform_layers_admin_only.sql).

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ADMIN_LAYERS_STORAGE_KEY, type CustomLayer } from '@/lib/customLayers';
import type { Json } from '@/integrations/supabase/types';

type Layer = CustomLayer;
export type LayerSaveState = 'loading' | 'saved' | 'saving' | 'error';

const CACHE_KEY = 'yn_published_layers_v1';
const asLayers = (rows: { data: Json }[] | null): Layer[] =>
  (rows ?? []).map(r => r.data as unknown as Layer).filter(l => l && typeof l.id === 'string' && Array.isArray(l.features));

/** Reads the layers of one institution (null = the platform's). */
async function fetchLayers(institutionId: string | null): Promise<Layer[]> {
  let q = supabase.from('custom_layers').select('layer_key, data, updated_at').order('created_at', { ascending: true });
  q = institutionId ? q.eq('institution_id', institutionId) : q.is('institution_id', null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return asLayers(data);
}

export function useAdminLayers(
  initial: Layer[],
  institutionId: string | null = null,
): { layers: Layer[]; setLayers: (v: Layer[] | ((prev: Layer[]) => Layer[])) => void; state: LayerSaveState; error: string | null; savedAt: Date | null; reload: () => void } {
  const [layers, setLayersState] = useState<Layer[]>([]);
  const [state, setState] = useState<LayerSaveState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);
  const savedKeys = useRef<Set<string>>(new Set());
  const pending = useRef<Layer[] | null>(null);
  const [nonce, setNonce] = useState(0);

  const save = useCallback(async (next: Layer[]) => {
    setState('saving');
    try {
      const keys = new Set(next.map(l => l.id));
      const gone = [...savedKeys.current].filter(k => !keys.has(k));
      if (next.length) {
        const rows = next.map(l => ({ institution_id: institutionId, layer_key: l.id, data: l as unknown as Json }));
        const { error: e } = await supabase.from('custom_layers').upsert(rows, { onConflict: 'institution_id,layer_key' });
        if (e) throw new Error(e.message);
      }
      if (gone.length) {
        let d = supabase.from('custom_layers').delete().in('layer_key', gone);
        d = institutionId ? d.eq('institution_id', institutionId) : d.is('institution_id', null);
        const { error: e } = await d;
        if (e) throw new Error(e.message);
      }
      savedKeys.current = keys;
      setState('saved'); setError(null); setSavedAt(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState('error');
      setError(/relation .*custom_layers|does not exist|schema cache/i.test(msg)
        ? 'The layers table is missing — run migration 20260930090000_foundation_institutions_rooms.sql.'
        : /row-level security|permission|policy/i.test(msg)
          ? 'Only the Yet New team can change platform layers.'
          : msg);
    }
  }, [institutionId]);

  // Load (or reload).
  useEffect(() => {
    let cancelled = false;
    loaded.current = false;
    setState('loading');
    (async () => {
      try {
        const rows = await fetchLayers(institutionId);
        if (cancelled) return;
        savedKeys.current = new Set(rows.map(l => l.id));
        if (rows.length) { setLayersState(rows); loaded.current = true; setState('saved'); return; }
        // Nothing saved yet: adopt what an earlier version kept in this browser, else start from the samples.
        let local: Layer[] | null = null;
        try { const s = localStorage.getItem(ADMIN_LAYERS_STORAGE_KEY); if (s) local = JSON.parse(s) as Layer[]; } catch { /* ignore */ }
        const start = local?.length ? local : initial;
        setLayersState(start);
        loaded.current = true;
        await save(start);
        if (local?.length) try { localStorage.removeItem(ADMIN_LAYERS_STORAGE_KEY); } catch { /* ignore */ }
      } catch (err) {
        if (cancelled) return;
        setLayersState(initial);
        setState('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId, nonce]);

  // Debounced autosave: edits come in per keystroke and per drag.
  const setLayers = useCallback((v: Layer[] | ((prev: Layer[]) => Layer[])) => {
    setLayersState(prev => {
      const next = typeof v === 'function' ? (v as (p: Layer[]) => Layer[])(prev) : v;
      if (loaded.current) {
        pending.current = next;
        setState('saving');
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => { const n = pending.current; pending.current = null; if (n) void save(n); }, 600);
      }
      return next;
    });
  }, [save]);

  // Don't lose the last edit when leaving the page.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (pending.current) void save(pending.current);
  }, [save]);

  return { layers, setLayers, state, error, savedAt, reload: () => setNonce(n => n + 1) };
}

/**
 * The platform's map layers for the visitor map: the cached copy at once,
 * then the latest from the server (again whenever the app is reopened).
 * null until anything is known.
 */
export function usePublishedLayers(): Layer[] | null {
  const [layers, setLayers] = useState<Layer[] | null>(() => {
    try { const c = localStorage.getItem(CACHE_KEY); return c ? (JSON.parse(c) as Layer[]) : null; } catch { return null; }
  });
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const rows = await fetchLayers(null);
        if (!live) return;
        setLayers(rows);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch { /* full or blocked */ }
      } catch { /* offline: keep the cached copy */ }
    };
    void load();
    const onShow = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { live = false; document.removeEventListener('visibilitychange', onShow); };
  }, []);
  return layers;
}
