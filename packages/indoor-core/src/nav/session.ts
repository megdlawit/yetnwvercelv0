// A navigation session: route, progress along it, the step ahead and the
// one after, distance and time left, which floor you're on, off-route
// detection with rerouting, spoken instructions, and the arrival.
//
//   const nav = new NavigationSession(venue, { lang: 'am', onChange: render });
//   nav.start(fromNodeId, toNodeId);
//   source.start(fix => nav.update(fix));

import type { IndoorVenue, Lang, Text2 } from '../model';
import { t2 } from '../model';
import { locateOnPath, pathFromNodes, pointAt, type Path3D } from '../path3d';
import { findRoute, nearestNode, type Route } from './router';
import { buildSteps, type Step } from './steps';
import { floorName, formatDistance, formatDuration, stepAhead, stepText, t } from './i18n';
import type { Speaker } from './voice';
import type { Fix } from './positioning';

export type SessionStatus = 'idle' | 'navigating' | 'rerouting' | 'arrived' | 'no-route';

export interface SessionState {
  status: SessionStatus;
  lang: Lang;
  route: Route | null;
  path: Path3D | null;
  steps: Step[];
  /** Metres walked along the route. */
  progress: number;
  /** How far the visitor is from the route line (m). */
  offRoute: number;
  /** The next thing to do, and the one after. */
  current: Step | null;
  next: Step | null;
  distanceToStep: number;
  remaining: number;
  seconds: number;
  floorId: string | null;
  /** On stairs / in a lift right now. */
  climbing: boolean;
  /** No more turns: the destination is straight ahead. */
  destinationAhead: boolean;
  /** Words for the HUD, in the visitor's language. */
  text: { instruction: string; then: string; distance: string; remaining: string; eta: string; floor: string };
  destination: Text2 | null;
  stepFree: boolean;
}

export interface SessionOptions {
  lang?: Lang;
  stepFree?: boolean;
  speaker?: Speaker | null;
  onChange?: (state: SessionState) => void;
  /** Off the line by this much (m) for `offRouteSeconds` → reroute. Default 4 m / 3 s; twice as far reroutes at once. */
  offRouteMetres?: number;
  offRouteSeconds?: number;
  /** Within this of the end counts as arrived (m). */
  arriveMetres?: number;
}

/** Announce a turn this far ahead (m); and a "continue" when the next turn is further than CONTINUE_OVER. */
const ANNOUNCE_AT = 12;
const CONTINUE_OVER = 40;
const AHEAD_WITHIN = 15;

export class NavigationSession {
  private s: SessionState;
  private to: string | null = null;
  private offSince: number | null = null;
  private said = new Set<string>();
  private lastFloor: string | null = null;

  constructor(private venue: IndoorVenue, private opts: SessionOptions = {}) {
    this.s = emptyState(opts.lang ?? 'en', !!opts.stepFree);
  }

  get state(): SessionState { return this.s; }

  /** Plan a route and begin. False when there is no (step-free) route. */
  start(from: string, to: string): boolean {
    this.to = to;
    this.said.clear();
    this.offSince = null;
    const ok = this.plan(from);
    if (ok) this.speak('start', t(this.s.lang, 'nav.start', { place: t2(this.s.destination, this.s.lang) }));
    return ok;
  }

  stop() { this.opts.speaker?.hush(); this.s = emptyState(this.s.lang, this.s.stepFree); this.emit(); }

  setLang(lang: Lang) { this.s.lang = lang; this.reword(); this.emit(); }

  /** Switch the step-free preference and re-plan from where the visitor is. */
  setStepFree(on: boolean) {
    this.opts.stepFree = on;
    this.s.stepFree = on;
    if (!this.to || !this.s.route) return;
    const here = this.s.path ? pointAt(this.s.path, this.s.progress) : null;
    const from = here ? nearestNode(this.venue, here.floorId, { x: here.p.x, z: here.p.z })?.id : this.s.route.nodeIds[0];
    if (from) this.plan(from);
  }

  /** A new position: move along, notice wrong turns, speak, arrive. */
  update(fix: Fix) {
    const s = this.s;
    if (!s.path || !s.route || s.status === 'arrived' || s.status === 'no-route') return;
    const back = 5, ahead = 30;
    // Stay near where we were along the line, so a parallel corridor further on can't jump us ahead.
    let loc = locateOnPath(s.path, fix.at, fix.floorId, [s.progress - back, s.progress + ahead]);
    if (!Number.isFinite(loc.off)) loc = locateOnPath(s.path, fix.at, fix.floorId);
    s.offRoute = loc.off;

    const limit = this.opts.offRouteMetres ?? 4;
    if (loc.off > limit) {
      this.offSince ??= fix.t;
      if (loc.off > limit * 2 || fix.t - this.offSince >= (this.opts.offRouteSeconds ?? 3) * 1000) { this.reroute(fix); return; }
    } else {
      this.offSince = null;
      s.progress = Math.max(s.progress, Math.min(s.path.length, loc.s));
    }
    this.advance();
    this.emit();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private plan(from: string): boolean {
    const s = this.s;
    const route = this.to ? findRoute(this.venue, from, this.to, { stepFree: !!this.opts.stepFree }) : null;
    const dest = this.venue.nodes.find(n => n.id === this.to);
    s.destination = this.venue.pois.find(p => p.nodeId === this.to)?.name ?? dest?.name ?? null;
    if (!route) {
      s.status = 'no-route';
      s.route = null; s.path = null; s.steps = [];
      s.text.instruction = t(s.lang, this.opts.stepFree ? 'nav.no-step-free' : 'nav.no-route', { place: t2(s.destination, s.lang) });
      this.emit();
      return false;
    }
    s.route = route;
    s.path = pathFromNodes(this.venue, route.nodeIds);
    s.steps = buildSteps(this.venue, route, s.path);
    if (s.destination) { const last = s.steps[s.steps.length - 1]; last.place ??= s.destination; }
    s.progress = 0;
    s.status = 'navigating';
    this.lastFloor = route.floors[0];
    this.advance();
    this.emit();
    return true;
  }

  private reroute(fix: Fix) {
    const s = this.s;
    s.status = 'rerouting';
    this.emit();
    this.speak('off-route', t(s.lang, 'nav.off-route'));
    const from = nearestNode(this.venue, fix.floorId, fix.at);
    this.offSince = null;
    if (from && this.plan(from.id)) {
      this.said.clear();
      this.speak('rerouted', t(s.lang, 'nav.rerouted'));
    }
  }

  /** Recompute the step ahead, distances, floor, and what to say. */
  private advance() {
    const s = this.s;
    if (!s.path) return;
    const at = pointAt(s.path, s.progress);
    s.floorId = at.floorId;
    s.climbing = at.kind !== 'walk' && at.kind !== 'door';
    s.remaining = Math.max(0, s.path.length - s.progress);
    const total = s.route!.seconds, len = Math.max(1e-6, s.path.length);
    s.seconds = total * (s.remaining / len);
    const idx = s.steps.findIndex(st => st.s > s.progress + 0.5 && st.kind !== 'start');
    s.current = idx >= 0 ? s.steps[idx] : s.steps[s.steps.length - 1] ?? null;
    s.next = idx >= 0 ? s.steps[idx + 1] ?? null : null;
    s.distanceToStep = s.current ? Math.max(0, s.current.s - s.progress) : 0;
    s.destinationAhead = !!s.current && s.current.kind === 'arrive' && s.remaining <= AHEAD_WITHIN;

    // Arrived?
    if (s.remaining <= (this.opts.arriveMetres ?? 2.5)) {
      s.status = 'arrived';
      s.progress = s.path.length;
      s.remaining = 0; s.seconds = 0; s.distanceToStep = 0;
      this.reword();
      this.speak('arrive', stepText(s.steps[s.steps.length - 1], s.lang, this.venue.floors));
      return;
    }

    // Floor change finished.
    if (s.floorId && s.floorId !== this.lastFloor && !s.climbing) {
      this.lastFloor = s.floorId;
      this.speak(`floor:${s.floorId}:${s.progress.toFixed(0)}`, t(s.lang, 'nav.floor-now', { floor: floorName(this.venue.floors.find(f => f.id === s.floorId), s.lang) }));
    }

    // Say the next step once as it comes up ("In 10 m, turn left"), or "continue" on long stretches.
    const cur = s.current;
    if (cur) {
      const key = `${cur.kind}@${cur.s.toFixed(1)}`;
      const near = cur.kind.includes('-up') || cur.kind.includes('-down') ? 6 : ANNOUNCE_AT;
      if (s.destinationAhead) this.speak(`ahead:${key}`, t(s.lang, 'step.destination-ahead', { place: t2(s.destination, s.lang) || t(s.lang, 'step.arrive.plain') }));
      else if (s.distanceToStep <= near) this.speak(key, s.distanceToStep < 3 ? stepText(cur, s.lang, this.venue.floors) : stepAhead(cur, s.distanceToStep, s.lang, this.venue.floors));
      else if (s.distanceToStep > CONTINUE_OVER) this.speak(`continue:${key}`, t(s.lang, 'step.continue', { distance: formatDistance(s.distanceToStep, s.lang) }));
    }
    this.reword();
  }

  /** The HUD words, in the current language. */
  private reword() {
    const s = this.s, L = s.lang, floors = this.venue.floors;
    const cur = s.current;
    const far = cur && cur.kind !== 'arrive' && s.distanceToStep > CONTINUE_OVER;
    s.text = {
      instruction: s.status === 'arrived' ? t(L, 'nav.arrived.title')
        : s.status === 'rerouting' ? t(L, 'nav.off-route')
        : s.destinationAhead ? t(L, 'step.destination-ahead', { place: t2(s.destination, L) || t(L, 'step.arrive.plain') })
        : !cur ? '' : far ? t(L, 'step.continue', { distance: formatDistance(s.distanceToStep, L) }) : stepText(cur, L, floors),
      then: s.status === 'arrived' ? t2(s.destination, L)
        : far && cur ? t(L, 'step.then', { instruction: lower(stepText(cur, L, floors), L) })
        : s.next ? t(L, 'step.then', { instruction: lower(stepText(s.next, L, floors), L) }) : '',
      distance: s.status === 'arrived' ? '' : s.distanceToStep < 3 ? t(L, 'now') : formatDistance(s.distanceToStep, L),
      remaining: t(L, 'hud.left', { distance: formatDistance(s.remaining, L) }),
      eta: formatDuration(s.seconds, L),
      floor: floorName(floors.find(f => f.id === s.floorId), L),
    };
  }

  private speak(key: string, text: string) {
    if (this.said.has(key)) return;
    this.said.add(key);
    this.opts.speaker?.say(text, this.s.lang);
  }

  private emit() { this.opts.onChange?.({ ...this.s, text: { ...this.s.text } }); }
}

const lower = (s: string, lang: Lang) => (lang === 'en' ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function emptyState(lang: Lang, stepFree: boolean): SessionState {
  return {
    status: 'idle', lang, route: null, path: null, steps: [], progress: 0, offRoute: 0, current: null, next: null,
    distanceToStep: 0, remaining: 0, seconds: 0, floorId: null, climbing: false, destinationAhead: false,
    text: { instruction: '', then: '', distance: '', remaining: '', eta: '', floor: '' }, destination: null, stepFree,
  };
}
