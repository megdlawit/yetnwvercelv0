// A visitor's own things — saved places, places visited and their activity
// (walks, visits, saves) — kept on the device first, so saving always works
// at once (guests, rooms without a POI row, offline), and synced to their
// profile in Supabase when it can be, so it follows them to another device
// once they've added an email.
//
// One store for the whole app (the map, the venue guide, the profile), so a
// place saved anywhere shows as saved everywhere.

import { useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { POI } from '@/data/poi';

/** What's kept about a place so it can be shown later, from any venue. */
export interface PlaceSnapshot {
  /** The place's id on the map (a POI id, or its path point). */
  id: string;
  name: string;
  detail: string;
  imageUrl: string | null;
  category: string;
  buildingId: string | null;
  /** The path point to open it at (?place=). */
  nodeId: string | null;
  venueName: string | null;
}
export interface SavedEntry extends PlaceSnapshot { savedAt: string }
export interface VisitEntry extends PlaceSnapshot { count: number; firstAt: string; lastAt: string; source: 'auto' | 'manual' }
export type ActivityKind = 'walk' | 'visit' | 'save';
export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  at: string;
  title: string;
  placeId: string | null;
  buildingId: string | null;
  venueName: string | null;
  steps?: number;
  meters?: number;
  seconds?: number;
}

export interface VisitorState {
  saved: SavedEntry[];
  visits: VisitEntry[];
  activity: ActivityEntry[];
  /** Steps a week the visitor aims for. */
  weeklyGoal: number;
  /** Steps counted on this device, by local day (YYYY-MM-DD). */
  steps: Record<string, number>;
}

const KEY = 'yetnew-visitor-v1';
export const DEFAULT_WEEKLY_GOAL = 20_000;
const MAX_ACTIVITY = 400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const empty = (): VisitorState => ({ saved: [], visits: [], activity: [], weeklyGoal: DEFAULT_WEEKLY_GOAL, steps: {} });

function load(): VisitorState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return empty();
    return {
      saved: Array.isArray(raw.saved) ? raw.saved : [],
      visits: Array.isArray(raw.visits) ? raw.visits : [],
      activity: Array.isArray(raw.activity) ? raw.activity : [],
      weeklyGoal: typeof raw.weeklyGoal === 'number' && raw.weeklyGoal > 0 ? raw.weeklyGoal : DEFAULT_WEEKLY_GOAL,
      steps: raw.steps && typeof raw.steps === 'object' && !Array.isArray(raw.steps) ? raw.steps : {},
    };
  } catch { return empty(); }
}

let state: VisitorState = typeof window === 'undefined' ? empty() : load();
const listeners = new Set<() => void>();

function set(next: VisitorState) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: still works for this visit */ }
  listeners.forEach(l => l());
}

// Another tab saved something: pick it up.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => { if (e.key === KEY) { state = load(); listeners.forEach(l => l()); } });
}

export const getVisitorState = () => state;
export function subscribeVisitor(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** The visitor's saved places, visits and activity, kept up to date. */
export function useVisitorStore(): VisitorState {
  return useSyncExternalStore(subscribeVisitor, getVisitorState, getVisitorState);
}

// ── what places look like (for snapshots) ────────────────────────────────────

const known = new Map<string, PlaceSnapshot>();
const venueNames = new Map<string, string>();

/** Venue names, so a saved place can say where it is. */
export function rememberVenueName(buildingId: string | null | undefined, name: string | null | undefined) {
  if (buildingId && name) venueNames.set(buildingId, name);
}

export function snapshotOfPoi(p: POI): PlaceSnapshot {
  return {
    id: p.id, name: p.name || 'Place', detail: p.subcategory || p.description?.slice(0, 60) || '',
    imageUrl: p.imageUrl?.trim() || null, category: p.category ?? 'attraction',
    buildingId: p.buildingId ?? null, nodeId: p.nodeId ?? null, venueName: (p.buildingId && venueNames.get(p.buildingId)) || null,
  };
}

/** The places on the map right now, so saving one by id can keep its name and photo. */
export function rememberPlaces(pois: POI[]) {
  for (const p of pois) known.set(p.id, snapshotOfPoi(p));
}

/** Best snapshot for an id: on the map now, saved or visited before, or just the id. */
export function snapshotFor(id: string): PlaceSnapshot {
  return known.get(id) ?? state.saved.find(e => e.id === id) ?? state.visits.find(e => e.id === id)
    ?? { id, name: 'Saved place', detail: '', imageUrl: null, category: 'attraction', buildingId: null, nodeId: null, venueName: null };
}

const matches = (e: PlaceSnapshot, id: string) => e.id === id || (!!e.nodeId && e.nodeId === id);
const pick = ({ id, name, detail, imageUrl, category, buildingId, nodeId, venueName }: PlaceSnapshot): PlaceSnapshot =>
  ({ id, name, detail, imageUrl, category, buildingId, nodeId, venueName });

// ── changes ──────────────────────────────────────────────────────────────────

let profileId: string | null = null;

export const isSavedPlace = (id: string) => state.saved.some(e => matches(e, id));

export function savePlace(place: PlaceSnapshot) {
  if (isSavedPlace(place.id)) return;
  const entry: SavedEntry = { ...pick(place), savedAt: new Date().toISOString() };
  set({ ...state, saved: [entry, ...state.saved] });
  logActivity({ kind: 'save', title: `Saved ${place.name}`, placeId: place.id, buildingId: place.buildingId, venueName: place.venueName });
  if (profileId) void cloud.pushSaved(profileId, entry);
}

export function unsavePlace(id: string) {
  const gone = state.saved.filter(e => matches(e, id));
  if (!gone.length) return;
  set({ ...state, saved: state.saved.filter(e => !matches(e, id)), activity: state.activity.filter(a => !(a.kind === 'save' && gone.some(g => g.id === a.placeId))) });
  if (profileId) for (const g of gone) void cloud.removeSaved(profileId, g.id);
}

/** Save or unsave; true when it's saved now. */
export function toggleSavedPlace(place: PlaceSnapshot): boolean {
  if (isSavedPlace(place.id) || (place.nodeId && isSavedPlace(place.nodeId))) { unsavePlace(place.id); if (place.nodeId) unsavePlace(place.nodeId); return false; }
  savePlace(place);
  return true;
}

export function recordVisit(place: PlaceSnapshot, source: 'auto' | 'manual' = 'auto', opts: { log?: boolean } = {}) {
  const now = new Date().toISOString();
  const old = state.visits.find(e => matches(e, place.id));
  const entry: VisitEntry = old
    ? { ...old, ...pick(place), name: place.name === 'Saved place' ? old.name : place.name, count: old.count + 1, lastAt: now, source }
    : { ...pick(place), count: 1, firstAt: now, lastAt: now, source };
  set({ ...state, visits: [entry, ...state.visits.filter(e => e !== old)] });
  if (opts.log !== false) logActivity({ kind: 'visit', title: `Visited ${place.name}`, placeId: place.id, buildingId: place.buildingId, venueName: place.venueName });
  if (profileId) void cloud.pushVisit(profileId, entry);
}

export function removeVisit(id: string) {
  const gone = state.visits.filter(e => matches(e, id));
  if (!gone.length) return;
  set({ ...state, visits: state.visits.filter(e => !matches(e, id)) });
  if (profileId) for (const g of gone) void cloud.removeVisit(profileId, g.id);
}

export function logActivity(a: Omit<ActivityEntry, 'id' | 'at'> & { at?: string }) {
  const entry: ActivityEntry = { id: crypto.randomUUID(), at: a.at ?? new Date().toISOString(), ...a };
  set({ ...state, activity: [entry, ...state.activity].slice(0, MAX_ACTIVITY) });
  if (profileId) void cloud.pushActivity(profileId, entry);
}

/** Steps just walked, added to today (kept for 120 days). */
export function addSteps(n: number) {
  if (!(n > 0)) return;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const steps = { ...state.steps, [today]: (state.steps[today] ?? 0) + Math.round(n) };
  const keys = Object.keys(steps).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 120))) delete steps[k];
  set({ ...state, steps });
}

/** All steps counted on this device. */
export const deviceSteps = (s: VisitorState) => Object.values(s.steps).reduce((a, b) => a + b, 0);

export function setWeeklyGoal(steps: number) {
  set({ ...state, weeklyGoal: Math.max(1000, Math.round(steps)) });
}

/** Signing out: this device forgets the visitor's things (their profile keeps what was synced). */
export function clearVisitorData() {
  profileId = null;
  synced.clear();
  set(empty());
}

// ── the cloud copy ───────────────────────────────────────────────────────────
// Best effort: a database without migration 20261008100000 keeps only what
// its older tables can hold (real POIs), and anything else stays on the device.

const synced = new Set<string>();
const isColumnError = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42703' || e.code === 'PGRST204' || /column/i.test(e.message ?? ''));

const cloud = {
  async pushSaved(pid: string, e: SavedEntry) {
    if (!UUID.test(e.id)) return;
    const full = { profile_id: pid, poi_id: e.id, created_at: e.savedAt, building_id: e.buildingId, node_id: e.nodeId, name: e.name, detail: e.detail, image_url: e.imageUrl, category: e.category, venue_name: e.venueName };
    let { error } = await supabase.from('saved_places').insert(full as never);
    if (isColumnError(error)) ({ error } = await supabase.from('saved_places').insert({ profile_id: pid, poi_id: e.id, created_at: e.savedAt }));
    if (error && error.code !== '23505') console.info('[visitor] saved place kept on this device only:', error.message);
  },
  async removeSaved(pid: string, id: string) {
    if (!UUID.test(id)) return;
    await supabase.from('saved_places').delete().eq('profile_id', pid).eq('poi_id', id);
  },
  async pushVisit(pid: string, e: VisitEntry) {
    if (!UUID.test(e.id)) return;
    const base = { profile_id: pid, poi_id: e.id, visit_count: e.count, source: e.source, first_visited_at: e.firstAt, last_visited_at: e.lastAt };
    const full = { ...base, building_id: e.buildingId, node_id: e.nodeId, name: e.name, detail: e.detail, image_url: e.imageUrl, category: e.category, venue_name: e.venueName };
    let { error } = await supabase.from('visited_places').upsert(full as never, { onConflict: 'profile_id,poi_id' });
    if (isColumnError(error)) ({ error } = await supabase.from('visited_places').upsert(base, { onConflict: 'profile_id,poi_id' }));
    if (error) console.info('[visitor] visit kept on this device only:', error.message);
  },
  async removeVisit(pid: string, id: string) {
    if (!UUID.test(id)) return;
    await supabase.from('visited_places').delete().eq('profile_id', pid).eq('poi_id', id);
  },
  async pushActivity(pid: string, a: ActivityEntry) {
    const { error } = await supabase.from('visitor_activities' as never).insert({
      id: a.id, profile_id: pid, kind: a.kind, title: a.title, place_id: a.placeId, building_id: a.buildingId && UUID.test(a.buildingId) ? a.buildingId : null,
      venue_name: a.venueName, steps: a.steps ?? null, meters: a.meters ?? null, seconds: a.seconds ?? null, created_at: a.at,
    } as never);
    if (error && error.code !== '23505') console.info('[visitor] activity kept on this device only:', error.message);
  },
};

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/**
 * Connect the store to a profile: bring down what the profile has (saved on
 * another device, say), then send up what only this device has. Once per
 * profile per visit unless forced.
 */
export async function syncVisitor(pid: string | null | undefined, force = false) {
  if (!pid) return;
  profileId = pid;
  if (synced.has(pid) && !force) return;
  synced.add(pid);
  try {
    const [savedRes, visitRes, actRes] = await Promise.all([
      supabase.from('saved_places').select('*').eq('profile_id', pid),
      supabase.from('visited_places').select('*').eq('profile_id', pid),
      supabase.from('visitor_activities' as never).select('*').eq('profile_id', pid).order('created_at', { ascending: false }).limit(200),
    ]);
    const savedRows = (savedRes.data ?? []) as Row[], visitRows = (visitRes.data ?? []) as Row[], actRows = (actRes.data ?? []) as Row[];

    // Names for rows saved before snapshots existed.
    const bare = [...savedRows, ...visitRows].filter(r => !str(r.name)).map(r => String(r.poi_id));
    const poiNames = new Map<string, Row>();
    if (bare.length) {
      const { data } = await supabase.from('pois').select('id, name, subcategory, image_url, category, building_id, node_id').in('id', bare);
      for (const p of (data ?? []) as Row[]) poiNames.set(String(p.id), p);
    }
    const snap = (r: Row): PlaceSnapshot => {
      const p = poiNames.get(String(r.poi_id));
      const known0 = known.get(String(r.poi_id));
      return {
        id: String(r.poi_id),
        name: str(r.name) ?? str(p?.name) ?? known0?.name ?? 'Saved place',
        detail: str(r.detail) ?? str(p?.subcategory) ?? known0?.detail ?? '',
        imageUrl: str(r.image_url) ?? str(p?.image_url) ?? known0?.imageUrl ?? null,
        category: str(r.category) ?? str(p?.category) ?? known0?.category ?? 'attraction',
        buildingId: str(r.building_id) ?? str(p?.building_id) ?? known0?.buildingId ?? null,
        nodeId: str(r.node_id) ?? str(p?.node_id) ?? known0?.nodeId ?? null,
        venueName: str(r.venue_name) ?? known0?.venueName ?? null,
      };
    };

    const s = state;
    const saved = [...s.saved];
    for (const r of savedRows) if (!saved.some(e => e.id === r.poi_id)) saved.push({ ...snap(r), savedAt: str(r.created_at) ?? new Date().toISOString() });
    const visits = [...s.visits];
    for (const r of visitRows) {
      const i = visits.findIndex(e => e.id === r.poi_id);
      const count = Number(r.visit_count) || 1, lastAt = str(r.last_visited_at) ?? new Date().toISOString();
      if (i < 0) visits.push({ ...snap(r), count, firstAt: str(r.first_visited_at) ?? lastAt, lastAt, source: r.source === 'manual' ? 'manual' : 'auto' });
      else if (count > visits[i].count) visits[i] = { ...visits[i], count, lastAt: lastAt > visits[i].lastAt ? lastAt : visits[i].lastAt };
    }
    const activity = [...s.activity];
    for (const r of actRows) {
      if (activity.some(a => a.id === r.id)) continue;
      const kind = r.kind === 'walk' || r.kind === 'visit' || r.kind === 'save' ? r.kind : 'visit';
      activity.push({
        id: String(r.id), kind, at: str(r.created_at) ?? new Date().toISOString(), title: str(r.title) ?? '', placeId: str(r.place_id),
        buildingId: str(r.building_id), venueName: str(r.venue_name),
        steps: typeof r.steps === 'number' ? r.steps : undefined, meters: typeof r.meters === 'number' ? r.meters : undefined, seconds: typeof r.seconds === 'number' ? r.seconds : undefined,
      });
    }
    saved.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    visits.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    activity.sort((a, b) => b.at.localeCompare(a.at));
    set({ ...state, saved, visits, activity: activity.slice(0, MAX_ACTIVITY) });

    // Send up what only this device has.
    for (const e of s.saved) if (!savedRows.some(r => r.poi_id === e.id)) void cloud.pushSaved(pid, e);
    for (const e of s.visits) { const r = visitRows.find(x => x.poi_id === e.id); if (!r || Number(r.visit_count) < e.count) void cloud.pushVisit(pid, e); }
    if (!actRes.error) for (const a of s.activity.slice(0, 100)) if (!actRows.some(r => r.id === a.id)) void cloud.pushActivity(pid, a);
  } catch (err) {
    console.info('[visitor] sync skipped:', err);
  }
}
