// A visitor's progress, worked out from their steps, visits, saves and walks:
// streaks, level, achievements, this week, records and the monthly
// challenge. Pure functions — the profile page draws them.

import type { ActivityEntry, SavedEntry, VisitEntry } from './visitorStore';

/** One stride, in metres (to turn steps into distance). */
export const STRIDE_M = 0.75;

/** Local YYYY-MM-DD (a day ends at the visitor's midnight, not UTC's). */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export interface DayStat { date: string; steps: number; places: number; active: boolean }

/** Every day from `days` ago to today, with steps (from the step log) and places (from activity). */
export function dailyStats(stepsByDay: Map<string, number>, activity: ActivityEntry[], days: number, today = new Date()): DayStat[] {
  const places = new Map<string, number>();
  for (const a of activity) {
    if (a.kind === 'save') continue;
    const k = dayKey(new Date(a.at));
    places.set(k, (places.get(k) ?? 0) + 1);
  }
  const out: DayStat[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(addDays(today, -i));
    const steps = stepsByDay.get(k) ?? 0, p = places.get(k) ?? 0;
    out.push({ date: k, steps, places: p, active: steps > 0 || p > 0 });
  }
  return out;
}

/**
 * The current streak (active days in a row up to today — or up to yesterday,
 * so it isn't lost before the visitor has had a chance today) and the best.
 */
export function streaks(days: DayStat[]): { current: number; best: number; activeToday: boolean } {
  let best = 0, run = 0;
  for (const d of days) { run = d.active ? run + 1 : 0; best = Math.max(best, run); }
  const last = days.length - 1;
  const activeToday = last >= 0 && days[last].active;
  let current = 0;
  for (let i = activeToday ? last : last - 1; i >= 0 && days[i].active; i--) current++;
  return { current, best, activeToday };
}

// ── level ────────────────────────────────────────────────────────────────────

export const LEVEL_TITLES = ['Newcomer', 'Wanderer', 'Explorer', 'Pathfinder', 'Navigator', 'Trailblazer', 'Voyager', 'Legend'];

export interface Totals {
  steps: number;
  /** Different places visited. */
  places: number;
  /** All visits, counting repeats. */
  visits: number;
  saved: number;
  walks: number;
  /** Different venues explored. */
  venues: number;
  bestStreak: number;
  bestDaySteps: number;
  earlyWalk: boolean;
  lateWalk: boolean;
  longestWalkM: number;
}

export function totalsOf(input: { stepsWalked: number; saved: SavedEntry[]; visits: VisitEntry[]; activity: ActivityEntry[]; days: DayStat[] }): Totals {
  const walks = input.activity.filter(a => a.kind === 'walk');
  const venues = new Set([...input.visits.map(v => v.buildingId), ...walks.map(w => w.buildingId)].filter(Boolean));
  const hours = walks.map(w => new Date(w.at).getHours());
  return {
    steps: input.stepsWalked,
    places: input.visits.length,
    visits: input.visits.reduce((n, v) => n + v.count, 0),
    saved: input.saved.length,
    walks: walks.length,
    venues: venues.size,
    bestStreak: streaks(input.days).best,
    bestDaySteps: Math.max(0, ...input.days.map(d => d.steps)),
    earlyWalk: hours.some(h => h >= 5 && h < 8),
    lateWalk: hours.some(h => h >= 19 || h < 2),
    longestWalkM: Math.max(0, ...walks.map(w => w.meters ?? (w.steps ?? 0) * STRIDE_M)),
  };
}

/** Experience: every step, place, save and walk counts. */
export function xpOf(t: Totals, badges: number): number {
  return Math.round(t.steps / 20 + t.places * 60 + t.visits * 10 + t.saved * 15 + t.walks * 40 + t.venues * 120 + badges * 100);
}

/** Level from experience: each level needs a little more than the last. */
export function levelOf(xp: number): { level: number; title: string; into: number; need: number; progress: number } {
  let level = 1, need = 250, left = xp;
  while (left >= need) { left -= need; level++; need = Math.round(need * 1.45); }
  return { level, title: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)], into: left, need, progress: left / need };
}

// ── achievements ─────────────────────────────────────────────────────────────

export type BadgeIcon = 'pin' | 'compass' | 'map' | 'footprints' | 'trophy' | 'medal' | 'bookmark' | 'library' | 'flame' | 'zap' | 'building' | 'sunrise' | 'moon' | 'mountain' | 'route';

export interface BadgeDef { id: string; label: string; hint: string; icon: BadgeIcon; color: string; value: (t: Totals) => number; target: number }

export const BADGES: BadgeDef[] = [
  { id: 'first-steps', label: 'First Steps', hint: 'Visit your first place', icon: 'pin', color: '#16a34a', value: t => t.places, target: 1 },
  { id: 'explorer', label: 'Explorer', hint: 'Visit 5 different places', icon: 'compass', color: '#0d9488', value: t => t.places, target: 5 },
  { id: 'pathfinder', label: 'Pathfinder', hint: 'Visit 15 different places', icon: 'map', color: '#0284c7', value: t => t.places, target: 15 },
  { id: 'on-the-move', label: 'On the Move', hint: 'Walk 1,000 steps', icon: 'footprints', color: '#65a30d', value: t => t.steps, target: 1000 },
  { id: 'marathoner', label: 'Marathoner', hint: 'Walk 5,000 steps', icon: 'trophy', color: '#d97706', value: t => t.steps, target: 5000 },
  { id: 'distance', label: 'Marathon Walker', hint: 'Walk 42 km in all (56,000 steps)', icon: 'medal', color: '#b45309', value: t => t.steps, target: 56_000 },
  { id: 'big-day', label: 'Big Day', hint: 'Walk 10,000 steps in one day', icon: 'mountain', color: '#7c3aed', value: t => t.bestDaySteps, target: 10_000 },
  { id: 'collector', label: 'Collector', hint: 'Save 5 places', icon: 'bookmark', color: '#db2777', value: t => t.saved, target: 5 },
  { id: 'curator', label: 'Curator', hint: 'Save 15 places', icon: 'library', color: '#be185d', value: t => t.saved, target: 15 },
  { id: 'streak-3', label: 'Warming Up', hint: 'Be active 3 days in a row', icon: 'flame', color: '#ea580c', value: t => t.bestStreak, target: 3 },
  { id: 'streak-7', label: 'On Fire', hint: 'Be active 7 days in a row', icon: 'zap', color: '#dc2626', value: t => t.bestStreak, target: 7 },
  { id: 'venue-hopper', label: 'Venue Hopper', hint: 'Explore 3 different venues', icon: 'building', color: '#4f46e5', value: t => t.venues, target: 3 },
  { id: 'navigator', label: 'Navigator', hint: 'Finish 10 guided walks', icon: 'route', color: '#0891b2', value: t => t.walks, target: 10 },
  { id: 'early-bird', label: 'Early Bird', hint: 'Finish a walk before 8 am', icon: 'sunrise', color: '#f59e0b', value: t => (t.earlyWalk ? 1 : 0), target: 1 },
  { id: 'night-owl', label: 'Night Owl', hint: 'Finish a walk after 7 pm', icon: 'moon', color: '#6366f1', value: t => (t.lateWalk ? 1 : 0), target: 1 },
];

export interface BadgeState { def: BadgeDef; current: number; unlocked: boolean; progress: number }
export function badgesOf(t: Totals): BadgeState[] {
  return BADGES.map(def => {
    const current = def.value(t);
    return { def, current, unlocked: current >= def.target, progress: Math.min(1, current / def.target) };
  });
}

// ── this week, this month ────────────────────────────────────────────────────

/** Monday-to-Sunday of the current week. */
export function thisWeek(days: DayStat[], today = new Date()) {
  const dow = (today.getDay() + 6) % 7; // Monday = 0
  const monday = addDays(today, -dow);
  const keys = Array.from({ length: 7 }, (_, i) => dayKey(addDays(monday, i)));
  const byKey = new Map(days.map(d => [d.date, d]));
  const week = keys.map((k, i) => ({ date: k, label: ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i], steps: byKey.get(k)?.steps ?? 0, active: !!byKey.get(k)?.active, today: i === dow, future: i > dow }));
  const steps = week.reduce((n, d) => n + d.steps, 0);
  return { week, steps, meters: steps * STRIDE_M, activeDays: week.filter(d => d.active).length };
}

/** The monthly challenge: visit a handful of different places this month. */
export function monthlyChallenge(visits: VisitEntry[], activity: ActivityEntry[], today = new Date()) {
  const month = today.getMonth(), year = today.getFullYear();
  const inMonth = (iso: string) => { const d = new Date(iso); return d.getMonth() === month && d.getFullYear() === year; };
  const places = new Set([
    ...visits.filter(v => inMonth(v.lastAt)).map(v => v.id),
    ...activity.filter(a => a.kind !== 'save' && a.placeId && inMonth(a.at)).map(a => a.placeId as string),
  ]);
  const target = 5;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    title: `${today.toLocaleString('en', { month: 'long' })} Explorer`,
    goal: `Visit ${target} different places this month`,
    current: Math.min(places.size, target), target, done: places.size >= target,
    daysLeft: lastDay - today.getDate(),
  };
}

/** Personal records. */
export function recordsOf(t: Totals, days: DayStat[]) {
  const mostPlaces = Math.max(0, ...days.map(d => d.places));
  return { bestDaySteps: t.bestDaySteps, bestStreak: t.bestStreak, mostPlacesInDay: mostPlaces, longestWalkM: t.longestWalkM };
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`;
}
export function formatSteps(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString('en');
}
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172_800) return 'Yesterday';
  if (s < 604_800) return `${Math.floor(s / 86_400)} days ago`;
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}
