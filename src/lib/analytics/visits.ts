// What visitors do on a venue's map, counted anonymously for the venue's Insights and the
// pilot's KPI report (supabase/migrations/20261029090000_visit_insights.sql).
//
// Anonymous: a visit is a random id kept in this tab's sessionStorage and gone when it
// closes — no account, no location. A browser that asks not to be tracked (Do Not Track,
// Global Privacy Control) sends nothing. Events wait a few seconds and go together, so the
// map never waits on them; the rest go when the page is hidden.

import { supabase } from '@/integrations/supabase/client';

export type VisitEventKind = 'visit' | 'place' | 'search' | 'route' | 'guide' | 'qr' | 'ask' | 'share';
export type VisitSource = 'direct' | 'qr' | 'link' | 'embed' | 'home';
export interface VisitEvent {
  kind: VisitEventKind;
  /** The map place (node id) and its name. */
  place?: string | null;
  name?: string | null;
  /** search only: what was typed. */
  query?: string | null;
  /** search: anything found; ask: understood. */
  ok?: boolean | null;
}

/** A browser that asked not to be tracked. */
export function doNotTrack(nav: Partial<Navigator> & { globalPrivacyControl?: boolean } = typeof navigator === 'undefined' ? {} : navigator): boolean {
  const w = typeof window === 'undefined' ? undefined : (window as unknown as { doNotTrack?: string });
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || nav.doNotTrack === 'yes' || w?.doNotTrack === '1';
}

/** A search as it's kept: trimmed, lower case, 60 characters; nothing that looks like an email or phone number. */
export function cleanQuery(q: string): string | null {
  const s = q.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
  if (s.length < 2 || /@|\d[\d ().-]{6,}/.test(s)) return null;
  return s;
}

export function deviceKind(width = typeof window === 'undefined' ? 1280 : window.innerWidth, touch = typeof window !== 'undefined' && 'ontouchstart' in window): 'phone' | 'tablet' | 'desktop' {
  if (width < 640) return 'phone';
  if (touch && width < 1100) return 'tablet';
  return 'desktop';
}

/** This visit's id: the same while the tab is open, new after. */
function visitId(): string {
  const make = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
  try {
    let id = sessionStorage.getItem('yetnew-visit');
    if (!id) { id = make(); sessionStorage.setItem('yetnew-visit', id); }
    return id;
  } catch { return (memoryId ??= make()); }   // private mode: one id for this page
}
let memoryId: string | undefined;

type Send = (buildingId: string, visit: string, device: string, source: VisitSource, events: VisitEvent[]) => Promise<unknown>;
const sendRpc: Send = (b, visit, device, source, events) =>
  Promise.resolve(supabase.rpc('record_visit_events', { b, visit, device, source, events: events as never })).catch(() => undefined);

/**
 * One venue visit's recorder. `track` queues an event; they go every few seconds, and
 * right away when the page is hidden. Disabled (previews, Do Not Track) it does nothing.
 */
export function createVisitRecorder(opts: { buildingId: string; source: VisitSource; enabled: boolean; send?: Send; delayMs?: number }) {
  const send = opts.send ?? sendRpc;
  const queue: VisitEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const visit = visitId();
  const device = deviceKind();

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    while (queue.length) void send(opts.buildingId, visit, device, opts.source, queue.splice(0, 40));
  };
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  if (opts.enabled && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
  }

  return {
    track(e: VisitEvent) {
      if (!opts.enabled) return;
      const ev: VisitEvent = { ...e };
      if (e.kind === 'search') ev.query = e.query ? cleanQuery(e.query) : null;
      else delete ev.query;   // only searches keep their words; what's said to Ask is never sent
      if (e.kind === 'search' && !ev.query) return;
      queue.push(ev);
      if (queue.length >= 40) flush();
      else if (!timer) timer = setTimeout(flush, opts.delayMs ?? 4000);
    },
    flush,
    dispose() {
      flush();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', flush);
      }
    },
  };
}
export type VisitRecorder = ReturnType<typeof createVisitRecorder>;
