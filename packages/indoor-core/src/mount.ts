// One call for the whole experience: the 3D building, a route with
// turn-by-turn guidance (HUD + voice in English or Amharic), and a position
// source — a simulated walk for demos, the phone's own steps (PDR), or
// positions you push in from your own system. Used by the SDK and embed.js.
//
//   const nav = mountNavigation(element, { venue, from: 'entrance', to: 'cafe', lang: 'am', position: 'simulate' });
//   nav.setLang('en'); nav.destroy();

import type { IndoorVenue, Lang } from './model';
import { IndoorViewer3D, type ViewerOptions } from './render/viewer';
import { GuidanceHUD } from './render/hud';
import { NavigationSession, type SessionState } from './nav/session';
import { PDRSource, SimulatedWalk, parseQrAnchor, type Fix, type PositionSource } from './nav/positioning';
import { Speaker } from './nav/voice';
import { pointAt } from './path3d';

export interface MountOptions extends Omit<ViewerOptions, 'venue'> {
  venue: IndoorVenue;
  /** Path points (node ids) to route between. Without them: just the explorable 3D building. */
  from?: string | null;
  to?: string | null;
  lang?: Lang;
  stepFree?: boolean;
  /** Where positions come from: a demo walk, the phone's steps, or your own (call pushFix). Default 'simulate'. */
  position?: 'simulate' | 'pdr' | 'external';
  /** Speak instructions (default true). */
  voice?: boolean;
  /** Walking speed for the simulation, m/s. */
  speed?: number;
  onState?: (state: SessionState) => void;
}

export interface MountedNavigation {
  viewer: IndoorViewer3D;
  session: NavigationSession | null;
  /** Feed a position (position: 'external', or a QR scan). */
  pushFix(fix: Fix): void;
  /** A scanned QR code: puts the visitor there (and re-plans from it). */
  scanQr(payload: string): boolean;
  setLang(lang: Lang): void;
  setStepFree(on: boolean): void;
  /** Pause / resume the simulated walk. */
  pause(): void;
  resume(): void;
  destroy(): void;
}

export function mountNavigation(element: HTMLElement, opts: MountOptions): MountedNavigation {
  const lang = opts.lang ?? 'en';
  const viewer = new IndoorViewer3D(element, { ...opts, lang, mode: opts.from && opts.to ? 'follow' : opts.mode });
  const speaker = new Speaker({ muted: opts.voice === false });
  let session: NavigationSession | null = null;
  let source: PositionSource | null = null;
  let walk: SimulatedWalk | null = null;

  const hud = new GuidanceHUD(viewer.root, {
    lang, voice: opts.voice !== false,
    onLanguage: l => api.setLang(l),
    onVoice: on => { speaker.muted = !on; if (!on) speaker.hush(); },
  });

  const onState = (s: SessionState) => {
    hud.update(s);
    if (s.path && s.path !== shownPath) { shownPath = s.path; viewer.setRoute(s.path); walk?.follow(s.path); }
    viewer.setProgress(s.progress);
    opts.onState?.(s);
  };
  let shownPath: SessionState['path'] = null;

  const pushFix = (fix: Fix) => {
    session?.update(fix);
    const s = session?.state;
    // Ride the route line when on it (smooth on stairs), the raw fix when off it.
    if (s?.path && s.offRoute < 4) {
      const q = pointAt(s.path, s.progress);
      viewer.setPosition({ floorId: q.floorId, at: { x: q.p.x, z: q.p.z }, y: q.p.y, heading: fix.heading ?? Math.atan2(q.dir.z, q.dir.x) });
    } else viewer.setPosition({ floorId: fix.floorId, at: fix.at, y: fix.y, heading: fix.heading ?? null });
  };

  if (opts.from && opts.to) {
    session = new NavigationSession(opts.venue, { lang, stepFree: opts.stepFree, speaker, onChange: onState });
    if (session.start(opts.from, opts.to)) {
      const mode = opts.position ?? 'simulate';
      if (mode === 'simulate') {
        walk = new SimulatedWalk(session.state.path!, { speed: opts.speed });
        source = walk;
      } else if (mode === 'pdr') {
        const start = opts.venue.nodes.find(n => n.id === opts.from)!;
        source = new PDRSource({ floorId: start.floorId, at: start.at, source: 'qr', t: performance.now() }, { planRotationDeg: opts.venue.geo?.rotationDeg ?? 0 });
      }
      source?.start(pushFix);
    }
  }

  const api: MountedNavigation = {
    viewer, session,
    pushFix,
    scanQr(payload) {
      const fix = parseQrAnchor(opts.venue, payload);
      if (!fix) return false;
      source?.calibrate?.(fix);
      pushFix(fix);
      return true;
    },
    setLang(l) { viewer.setLang(l); hud.setLang(l); session?.setLang(l); },
    setStepFree(on) { session?.setStepFree(on); },
    pause() { walk?.pause(); },
    resume() { walk?.resume(); },
    destroy() { source?.stop(); speaker.dispose(); hud.dispose(); viewer.dispose(); },
  };
  return api;
}
