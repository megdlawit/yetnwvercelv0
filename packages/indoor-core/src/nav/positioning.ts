// Where the visitor is, from interchangeable sources:
//
//   SimulatedWalk – walks a route at walking pace (demos, previews, tests);
//                   can wander off the route to show rerouting.
//   PDRSource     – the phone's own steps and compass (pedestrian dead
//                   reckoning): each step moves the dot one stride the way
//                   the phone faces.
//   QR anchors    – a printed code at a known spot resets the position
//                   (parseQrAnchor + calibrate()).
//
// Every source emits the same Fix, so guidance doesn't care which is used.

import type { IndoorVenue, Vec2 } from '../model';
import { pointAt, type Path3D } from '../path3d';

export interface Fix {
  floorId: string;
  at: Vec2;
  /** Height when between floors (stairs). */
  y?: number;
  /** Facing, radians in the plan (0 = +x, clockwise on screen). */
  heading?: number | null;
  /** Rough uncertainty, metres. */
  accuracy?: number;
  source: 'simulated' | 'pdr' | 'qr' | 'external';
  /** ms timestamp. */
  t: number;
  /** Steps counted so far (PDR, simulated). */
  steps?: number;
}

export interface PositionSource {
  start(emit: (fix: Fix) => void): void;
  stop(): void;
  /** Put the visitor at a known spot (a QR code, or "I'm here" on the map). */
  calibrate?(fix: Fix): void;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ── Simulated walk ────────────────────────────────────────────────────────────

export interface SimulatedWalkOptions {
  /** Metres per second (default walking pace 1.3). */
  speed?: number;
  /** Start this far along the route. */
  startS?: number;
  /** Wander sideways for a stretch (to demonstrate off-route and rerouting). */
  detour?: { atS: number; metres: number; offset: number };
  /** Average stride, for the step count (m). */
  stride?: number;
  /** Ticks per second when running on its own (default 20). */
  hz?: number;
}

export class SimulatedWalk implements PositionSource {
  private s: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private emit: ((fix: Fix) => void) | null = null;
  private paused = false;
  private last = 0;
  private extra: Vec2 | null = null;
  private side: Vec2 | null = null;

  constructor(private path: Path3D, private opts: SimulatedWalkOptions = {}) {
    this.s = opts.startS ?? 0;
  }

  get progress() { return this.s; }
  get done() { return this.s >= this.path.length; }

  start(emit: (fix: Fix) => void) {
    this.emit = emit;
    this.last = now();
    this.send();
    const hz = this.opts.hz ?? 20;
    this.timer = setInterval(() => { const t = now(); this.advance((t - this.last) / 1000); this.last = t; }, 1000 / hz);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  pause() { this.paused = true; }
  resume() { this.paused = false; this.last = now(); }
  setSpeed(mps: number) { this.opts.speed = mps; }

  /** A new route to walk (after a reroute), from its start. */
  follow(path: Path3D) { this.path = path; this.s = 0; this.opts.detour = undefined; this.extra = null; this.side = null; }

  /** Move on by `seconds` (also used directly by tests). */
  advance(seconds: number) {
    if (this.paused || this.done) return;
    this.s = Math.min(this.path.length, this.s + (this.opts.speed ?? 1.3) * seconds);
    this.send();
    if (this.done) this.stop();
  }

  private send() {
    const q = pointAt(this.path, this.s);
    let at = { x: q.p.x, z: q.p.z };
    const d = this.opts.detour;
    if (d && this.s >= d.atS && this.s <= d.atS + d.metres) {
      // Drift out sideways (the way they were heading when they went wrong) and stay out.
      this.side ??= { x: -q.dir.z, z: q.dir.x };
      const k = Math.min(1, (this.s - d.atS) / 3);
      this.extra = { x: this.side.x * d.offset * k, z: this.side.z * d.offset * k };
    }
    if (this.extra) at = { x: at.x + this.extra.x, z: at.z + this.extra.z };
    this.emit?.({ floorId: q.floorId, at, y: q.p.y, heading: Math.atan2(q.dir.z, q.dir.x), source: 'simulated', t: now(), steps: Math.floor(this.s / (this.opts.stride ?? 0.7)), accuracy: 0.5 });
  }
}

// ── Pedestrian dead reckoning ─────────────────────────────────────────────────

export interface PDROptions {
  /** Stride length (m); default 0.7. */
  stride?: number;
  /** The plan's rotation from north (buildings.rotation_deg), to turn compass headings into plan headings. */
  planRotationDeg?: number;
  /** Keep the dot on walkable ground (e.g. snap to the path graph). */
  snap?: (fix: Fix) => Fix;
}

export class PDRSource implements PositionSource {
  private pos: Fix;
  private steps = 0;
  private heading: number | null = null;
  private filtered = 9.81;
  private above = false;
  private lastStep = 0;
  private emit: ((fix: Fix) => void) | null = null;
  private off: (() => void)[] = [];

  constructor(start: Fix, private opts: PDROptions = {}) {
    this.pos = { ...start, source: 'pdr' };
  }

  /** iOS asks for motion permission from a tap; call this from one. */
  static async requestPermission(): Promise<boolean> {
    const DME = (globalThis as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    if (DME?.requestPermission) { try { return (await DME.requestPermission()) === 'granted'; } catch { return false; } }
    return true;
  }

  start(emit: (fix: Fix) => void) {
    this.emit = emit;
    const motion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      this.onAccel(Math.hypot(a.x, a.y, a.z), now());
    };
    const orient = (e: DeviceOrientationEvent) => {
      const compass = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null);
      if (compass != null) this.onCompass(compass);
    };
    window.addEventListener('devicemotion', motion);
    window.addEventListener('deviceorientationabsolute', orient as EventListener);
    window.addEventListener('deviceorientation', orient);
    this.off.push(() => { window.removeEventListener('devicemotion', motion); window.removeEventListener('deviceorientationabsolute', orient as EventListener); window.removeEventListener('deviceorientation', orient); });
    emit({ ...this.pos, t: now(), steps: this.steps });
  }

  stop() { for (const f of this.off) f(); this.off = []; }

  calibrate(fix: Fix) {
    this.pos = { ...fix, source: 'qr' };
    this.emit?.({ ...this.pos, t: now(), steps: this.steps });
    this.pos.source = 'pdr';
  }

  /** Compass degrees (clockwise from north) → plan heading. */
  onCompass(deg: number) {
    this.heading = ((deg - 90 - (this.opts.planRotationDeg ?? 0)) * Math.PI) / 180;
  }

  /** One accelerometer reading (magnitude, m/s²): a peak above ~10.8 with a quarter second since the last is a step. */
  onAccel(magnitude: number, t: number) {
    this.filtered += (magnitude - this.filtered) * 0.25;
    const over = this.filtered > 10.8;
    if (over && !this.above && t - this.lastStep > 280) { this.lastStep = t; this.step(); }
    if (this.filtered < 10.2) this.above = false;
    if (over) this.above = true;
  }

  private step() {
    this.steps++;
    if (this.heading == null) return;
    const L = this.opts.stride ?? 0.7;
    let next: Fix = { ...this.pos, at: { x: this.pos.at.x + Math.cos(this.heading) * L, z: this.pos.at.z + Math.sin(this.heading) * L }, heading: this.heading, t: now(), steps: this.steps, source: 'pdr', accuracy: Math.min(15, (this.pos.accuracy ?? 1) + 0.08) };
    if (this.opts.snap) next = this.opts.snap(next);
    this.pos = next;
    this.emit?.(next);
  }
}

// ── QR anchors ────────────────────────────────────────────────────────────────

/**
 * A scanned code → where the visitor stands. Accepts the app's own links
 * (…?entry=<entrance-name-or-node>, …&node=<id>), "ethi:node/<id>", or a
 * bare node id / place name.
 */
export function parseQrAnchor(venue: IndoorVenue, payload: string): Fix | null {
  const raw = payload.trim();
  let key = raw;
  // "ethi:node/<id>" first: it is also a valid URL, with no query to read.
  const code = /^ethi:(?:\/\/)?node\/(.+)$/i.exec(raw);
  if (code) key = code[1];
  else {
    try {
      const u = new URL(raw);
      key = u.searchParams.get('node') ?? u.searchParams.get('entry') ?? u.searchParams.get('place') ?? '';
    } catch { /* not a link: a bare id or name */ }
  }
  if (!key) return null;
  const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const n = venue.nodes.find(x => x.id === key) ?? venue.nodes.find(x => x.name && (slug(x.name.en) === slug(key) || (x.name.am && slug(x.name.am) === slug(key))));
  return n ? { floorId: n.floorId, at: n.at, source: 'qr', t: now(), accuracy: 1 } : null;
}
