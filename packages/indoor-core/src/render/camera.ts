// The camera director.
//
//   overview – orbit around the floor (drag, pinch, scroll)
//   top      – straight down, like a plan
//   follow   – the cinematic follow camera: a little behind and above the
//              visitor at walking height, looking a few metres ahead along
//              the route, so it eases round corners before you turn and
//              tilts up or down the stairs as you climb. It never sits
//              behind a wall (it slides in front of it).
//   walk     – first person at eye height: glide along the paths to a place
//              (or wherever you tap), drag to look, W A S D on a keyboard.
//
// Every change of view is a smooth flight, unless the visitor asked for
// reduced motion — then views cut and the follow camera holds steady.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ViewMode = 'overview' | 'top' | 'follow' | 'walk';

export interface Subject {
  /** Where the visitor is (their feet). */
  p: THREE.Vector3;
  /** The way they are heading (unit). */
  dir: THREE.Vector3;
  /** A point a few metres further along the route, if there is one. */
  ahead?: THREE.Vector3 | null;
  /** A point a few metres back along the route: the camera trails there, so it stays in walkable space. */
  behind?: THREE.Vector3 | null;
  /** Climbing or descending stairs right now. */
  onStairs?: boolean;
  /** A wall stands between the visitor and the way ahead: rise to see over it. */
  blocked?: boolean;
}

function segDist(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

/** Eye height in walk mode (m). */
const EYE = 1.62;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

export class CameraDirector {
  readonly controls: OrbitControls;
  mode: ViewMode = 'overview';
  private tween: { p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; time: number; dur: number } | null = null;
  private subject: Subject | null = null;
  private look = new THREE.Vector3();
  private followDist = 3.4;
  private lift = 0;
  private yawNudge = 0;
  private walk = { yaw: 0, pitch: -0.08, keys: new Set<string>(), floorY: 0 };
  private blockers: { a: { x: number; z: number }; b: { x: number; z: number } }[] = [];
  /** A guided walk along the paths: where it goes, how far along, and what to face at the end. */
  private guide: { sample: (s: number) => { p: THREE.Vector3; floorId?: string }; s: number; length: number; face: THREE.Vector3 | null; onStep?: (floorId?: string) => void; onDone?: (arrived: boolean) => void } | null = null;
  private ray = new THREE.Raycaster();
  private dragging: { x: number; y: number } | null = null;
  private lastFrame = { center: new THREE.Vector3(), radius: 10 };
  private off: (() => void)[] = [];
  /** Called when the visitor keeps zooming out past the farthest view (to leave for the outdoor map). */
  onZoomOutLimit: (() => void) | null = null;
  private pushes = 0;
  private pushAt = 0;
  private firedAt = 0;

  constructor(readonly camera: THREE.PerspectiveCamera, private dom: HTMLElement, public reducedMotion = false) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = !reducedMotion;
    this.controls.dampingFactor = 0.09;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 2.5;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('start', () => { this.tween = null; });

    const key = (down: boolean) => (e: KeyboardEvent) => {
      if (this.mode !== 'walk') return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) { e.preventDefault(); if (down) this.walk.keys.add(k); else this.walk.keys.delete(k); }
    };
    const kd = key(true), ku = key(false);
    const pd = (e: PointerEvent) => { if (this.mode === 'walk' || this.mode === 'follow') this.dragging = { x: e.clientX, y: e.clientY }; };
    const pm = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragging.x, dy = e.clientY - this.dragging.y;
      this.dragging = { x: e.clientX, y: e.clientY };
      if (this.mode === 'walk') { this.walk.yaw -= dx * 0.005; this.walk.pitch = THREE.MathUtils.clamp(this.walk.pitch - dy * 0.004, -1.1, 1.1); }
      else if (this.mode === 'follow') this.yawNudge = THREE.MathUtils.clamp(this.yawNudge - dx * 0.006, -1.4, 1.4);
    };
    const pu = () => { this.dragging = null; };
    // Zooming out past the limit: the wheel, a pinch, or (in zoom()) the − button, a few times in a row.
    const wheel = (e: WheelEvent) => { if (e.deltaY > 0) this.pushOut(1); };
    const touches = new Map<number, { x: number; y: number }>();
    let pinch0 = 0, pinchDone = false;
    const td = (e: PointerEvent) => { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); pinchDone = false; } };
    const tm = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size !== 2 || pinchDone) return;
      const [a, b] = [...touches.values()];
      if (pinch0 - Math.hypot(a.x - b.x, a.y - b.y) > 70 && this.atLimit()) { pinchDone = true; this.pushOut(3); }
    };
    const tu = (e: PointerEvent) => { touches.delete(e.pointerId); };
    dom.addEventListener('wheel', wheel, { passive: true });
    dom.addEventListener('pointerdown', td); window.addEventListener('pointermove', tm); window.addEventListener('pointerup', tu); window.addEventListener('pointercancel', tu);
    this.off.push(() => { dom.removeEventListener('wheel', wheel); dom.removeEventListener('pointerdown', td); window.removeEventListener('pointermove', tm); window.removeEventListener('pointerup', tu); window.removeEventListener('pointercancel', tu); });
    dom.addEventListener('keydown', kd); dom.addEventListener('keyup', ku);
    dom.addEventListener('pointerdown', pd); window.addEventListener('pointermove', pm); window.addEventListener('pointerup', pu);
    this.off.push(() => { dom.removeEventListener('keydown', kd); dom.removeEventListener('keyup', ku); dom.removeEventListener('pointerdown', pd); window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu); });
  }

  /** Fit a floor in view: `center` of the floor, `radius` its half-size (m). */
  frame(center: THREE.Vector3, radius: number, animate = true) {
    this.lastFrame = { center: center.clone(), radius };
    const r = Math.max(radius, 4);
    this.controls.maxDistance = r * 6;
    const top = this.mode === 'top';
    const polar = top ? 0.0001 : 0.95, az = top ? 0 : -0.6;
    const dist = r * (top ? 2.3 : 2.0);
    const p = new THREE.Vector3(center.x + dist * Math.sin(polar) * Math.sin(az), center.y + dist * Math.cos(polar), center.z + dist * Math.sin(polar) * Math.cos(az));
    this.flyTo(p, center, animate ? 1.1 : 0);
  }

  /** Glide to a camera position looking at target. */
  flyTo(p: THREE.Vector3, target: THREE.Vector3, seconds = 1) {
    const dur = this.reducedMotion ? 0 : seconds;
    if (dur <= 0) { this.camera.position.copy(p); this.controls.target.copy(target); this.camera.lookAt(target); this.tween = null; this.controls.update(); return; }
    this.tween = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: p.clone(), t1: target.clone(), time: 0, dur };
  }

  /** Look at one spot from a pleasant angle (a selected place). */
  focus(at: THREE.Vector3, distance = 9) {
    if (this.mode === 'follow' || this.mode === 'walk') this.setMode('overview');
    const dir = this.camera.position.clone().sub(this.controls.target).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const p = at.clone().addScaledVector(dir, distance * 0.75).setY(at.y + distance * 0.75);
    this.flyTo(p, at, 0.9);
  }

  setMode(mode: ViewMode) {
    if (mode === this.mode) return;
    const was = this.mode;
    this.mode = mode;
    this.guide = null;
    // A wider view at eye level, so a room reads as a room and not a wall.
    this.camera.fov = mode === 'walk' ? 64 : 48;
    this.camera.near = mode === 'walk' ? 0.05 : 0.1;
    this.camera.updateProjectionMatrix();
    this.controls.enabled = mode === 'overview' || mode === 'top';
    this.controls.enableRotate = mode === 'overview';
    this.yawNudge = 0;
    if (mode === 'overview' || mode === 'top') {
      // Pull out from wherever the camera is.
      this.frame(this.lastFrame.center, this.lastFrame.radius, true);
    } else if (mode === 'walk') {
      // Where to stand is the viewer's call (startWalk / walkAlong); until then stay put at eye level.
      const s = this.subject;
      if (s) {
        this.walk.floorY = s.p.y;
        const eye = s.p.clone().setY(s.p.y + EYE);
        this.walk.yaw = Math.atan2(-s.dir.x, -s.dir.z);
        this.flyTo(eye, eye.clone().add(s.dir.clone().setY(0).normalize()), was === 'follow' ? 0.4 : 1.2);
      }
    } else if (mode === 'follow') this.tween = null;
  }

  /** Stand at `feet` (on the floor) looking toward `toward`, at eye height. */
  startWalk(feet: THREE.Vector3, toward: THREE.Vector3, seconds = 1.2) {
    if (this.mode !== 'walk') this.setMode('walk');
    this.guide = null;
    this.walk.floorY = feet.y;
    const d = toward.clone().sub(feet).setY(0);
    if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
    d.normalize();
    this.walk.yaw = Math.atan2(-d.x, -d.z);
    this.walk.pitch = -0.06;
    const eye = feet.clone().setY(feet.y + EYE);
    this.flyTo(eye, eye.clone().add(d).setY(eye.y - 0.06), seconds);
  }

  /**
   * Glide along a line on the floor (a route over the paths), at walking
   * pace, turning ahead of corners and tilting on stairs; at the end, turn to
   * face `face`. Any key or drag hands control back to the visitor.
   */
  walkAlong(sample: (s: number) => { p: THREE.Vector3; floorId?: string }, length: number, face: THREE.Vector3 | null, hooks: { onStep?: (floorId?: string) => void; onDone?: (arrived: boolean) => void } = {}) {
    if (this.mode !== 'walk') this.setMode('walk');
    // A glide to the starting spot (startWalk) finishes first; then the walk sets off from there.
    this.endGuide(false);
    this.guide = { sample, s: 0, length, face, ...hooks };
  }

  /** Stop a guided walk where it is (the visitor pressed Stop, or took over). */
  stopGuide() { this.endGuide(false); }

  private endGuide(arrived: boolean) {
    const g = this.guide;
    this.guide = null;
    g?.onDone?.(arrived);
  }

  /** Is the camera gliding along a path right now? */
  get guiding() { return !!this.guide; }

  setSubject(s: Subject | null) {
    this.subject = s;
    if (s && this.mode === 'walk') this.walk.floorY = s.p.y;
  }

  /** Walk mode: the wall lines the walker can't pass (doorways left open). */
  setObstacles(segs: { a: { x: number; z: number }; b: { x: number; z: number } }[]) { this.blockers = segs; }

  /** Walk mode: which floor height the walker stands on. */
  setWalkFloor(y: number) { this.walk.floorY = y; }

  /** Already as far out as the camera goes (overview or top view). */
  private atLimit() {
    return (this.mode === 'overview' || this.mode === 'top') && !this.tween
      && this.camera.position.distanceTo(this.controls.target) >= this.controls.maxDistance * 0.96;
  }

  /** One more "zoom out" at the limit; a few in a row (or one pinch) leave. */
  private pushOut(amount: number) {
    if (!this.onZoomOutLimit || !this.atLimit()) { this.pushes = 0; return; }
    const now = performance.now();
    if (now - this.pushAt > 1400) this.pushes = 0;
    this.pushAt = now;
    this.pushes += amount;
    if (this.pushes >= 3 && now - this.firedAt > 2500) { this.firedAt = now; this.pushes = 0; this.onZoomOutLimit(); }
  }

  zoom(factor: number) {
    if (this.mode === 'follow') { this.followDist = THREE.MathUtils.clamp(this.followDist * factor, 1.6, 9); return; }
    if (this.mode === 'walk') return;
    if (factor > 1 && this.atLimit()) { this.pushOut(1.5); return; }
    const t = this.controls.target;
    const off = this.camera.position.clone().sub(t).multiplyScalar(factor);
    off.setLength(THREE.MathUtils.clamp(off.length(), this.controls.minDistance, this.controls.maxDistance));
    this.flyTo(t.clone().add(off), t, 0.35);
  }

  recenter() { this.frame(this.lastFrame.center, this.lastFrame.radius, true); }

  /** Advance one frame. `solids` are the walls the follow camera keeps clear of. Returns true while moving. */
  update(dt: number, solids: THREE.Object3D[]): boolean {
    let moving = false;
    if (this.tween) {
      const tw = this.tween;
      tw.time += dt;
      const k = ease(Math.min(1, tw.time / tw.dur));
      this.camera.position.lerpVectors(tw.p0, tw.p1, k);
      this.controls.target.lerpVectors(tw.t0, tw.t1, k);
      this.camera.lookAt(this.controls.target);
      if (tw.time >= tw.dur) this.tween = null;
      moving = true;
      if (this.mode === 'overview' || this.mode === 'top') return true;
      if (this.mode === 'walk') return true;
    }
    if (this.mode === 'overview' || this.mode === 'top') return this.controls.update() || moving;
    if (this.mode === 'walk') return this.updateWalk(dt) || moving;
    return this.updateFollow(dt, solids) || moving;
  }

  private updateFollow(dt: number, solids: THREE.Object3D[]): boolean {
    const s = this.subject;
    if (!s) return false;
    const flat = s.dir.clone().setY(0);
    if (flat.lengthSq() < 1e-6) flat.set(1, 0, 0);
    flat.normalize();
    if (!this.dragging) this.yawNudge *= 1 - damp(0.8, dt); // the visitor's own look-around eases back
    flat.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yawNudge);
    const head = s.p.clone().setY(s.p.y + 1.55);
    const stairs = s.onStairs ? 0.5 : 0;
    // Trail along the route itself when there is one (never outside a wall); else behind the heading.
    const zoom = this.followDist / 3.4;
    const want = s.behind && Math.abs(this.yawNudge) < 0.05
      ? s.p.clone().lerp(s.behind, Math.min(1.6, zoom)).setY(Math.max(s.behind.y, s.p.y) + 2.25 * Math.max(0.8, zoom) + stairs * 0.4)
      : head.clone().addScaledVector(flat, -(this.followDist + stairs)).setY(s.p.y + 2.25 + stairs * 0.6);

    // Rise over a wall that hides the way ahead; settle back once it's clear.
    this.lift += ((s.blocked ? 4.5 : 0) - this.lift) * (this.reducedMotion ? 1 : damp(2, dt));
    want.y += this.lift;
    want.addScaledVector(flat, -this.lift * 0.35);

    // Keep the camera on the visitor's side of any wall.
    const toCam = want.clone().sub(head);
    const len = toCam.length();
    this.ray.set(head, toCam.normalize());
    this.ray.far = len;
    const hit = solids.length ? this.ray.intersectObjects(solids, false)[0] : undefined;
    if (hit && this.lift < 0.5) want.copy(head).addScaledVector(toCam, Math.max(0.6, hit.distance - 0.3));

    // Look a little ahead along the route (turns early on corners, tilts on stairs).
    const target = (s.ahead ? s.ahead.clone().setY(s.ahead.y + 1.15) : s.p.clone().addScaledVector(flat, 3.4).setY(s.p.y + 1.15));
    // The prototype's feel: position eases at ~3/s, the look a touch quicker.
    const k = this.reducedMotion ? damp(10, dt) : damp(3.0, dt);
    const kl = this.reducedMotion ? damp(10, dt) : damp(3.35, dt);
    const before = this.camera.position.clone();
    this.camera.position.lerp(want, k);
    this.look.lerp(target, kl);
    if (this.look.lengthSq() === 0) this.look.copy(target);
    this.camera.lookAt(this.look);
    this.controls.target.copy(this.look);
    return before.distanceToSquared(this.camera.position) > 1e-8;
  }

  private updateWalk(dt: number): boolean {
    const k = this.walk.keys;
    // The visitor takes over the moment they press a key or drag.
    if (this.guide && (k.size || this.dragging)) this.endGuide(false);
    if (this.guide) return this.updateGuide(dt);
    const speed = (k.has('shift') ? 3.2 : 1.6) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.walk.yaw), 0, -Math.cos(this.walk.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3();
    if (k.has('w') || k.has('arrowup')) move.add(fwd);
    if (k.has('s') || k.has('arrowdown')) move.sub(fwd);
    if (k.has('d')) move.add(right);
    if (k.has('a')) move.sub(right);
    if (k.has('arrowleft')) this.walk.yaw += dt * 1.6;
    if (k.has('arrowright')) this.walk.yaw -= dt * 1.6;
    if (move.lengthSq()) {
      move.normalize().multiplyScalar(speed);
      // Slide along walls: try the whole step, then each axis on its own.
      const p = this.camera.position;
      const free = (x: number, z: number) => this.blockers.every(s => segDist(x, z, s.a, s.b) > 0.28);
      if (free(p.x + move.x, p.z + move.z)) { p.x += move.x; p.z += move.z; }
      else if (free(p.x + move.x, p.z)) p.x += move.x;
      else if (free(p.x, p.z + move.z)) p.z += move.z;
    }
    this.camera.position.y += (this.walk.floorY + EYE - this.camera.position.y) * damp(8, dt);
    const look = new THREE.Vector3(-Math.sin(this.walk.yaw) * Math.cos(this.walk.pitch), Math.sin(this.walk.pitch), -Math.cos(this.walk.yaw) * Math.cos(this.walk.pitch));
    this.camera.lookAt(this.camera.position.clone().add(look));
    this.controls.target.copy(this.camera.position).add(look);
    return k.size > 0 || !!this.dragging;
  }

  private updateGuide(dt: number): boolean {
    const g = this.guide!;
    // Brisk, and quicker over long distances: any walk is done in about 6–8 s.
    const pace = Math.max(1.8, Math.min(3.6, g.length / 6)) * (this.reducedMotion ? 1.3 : 1);
    // Ease off over the last couple of metres.
    const left = g.length - g.s;
    g.s = Math.min(g.length, g.s + pace * dt * Math.min(1, 0.35 + left / 2.5));
    const here = g.sample(g.s), ahead = g.sample(Math.min(g.length, g.s + 2.6));
    g.onStep?.(here.floorId);
    const eye = here.p.clone().setY(here.p.y + EYE);
    this.walk.floorY = here.p.y;
    this.camera.position.lerp(eye, this.reducedMotion ? 1 : damp(7, dt));
    // Face the way ahead; near the end, turn toward the place itself.
    let d = ahead.p.clone().sub(here.p);
    const flat = Math.hypot(d.x, d.z);
    if (g.face && (left < 2.2 || flat < 0.2)) d = g.face.clone().sub(here.p);
    if (Math.hypot(d.x, d.z) > 1e-4) {
      const want = Math.atan2(-d.x, -d.z);
      let dy = want - this.walk.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.walk.yaw += dy * (this.reducedMotion ? 1 : damp(4, dt));
    }
    // Look up or down the stairs a little, otherwise just below the horizon.
    const slope = flat > 0.2 ? Math.atan2(ahead.p.y - here.p.y, flat) * 0.6 : 0;
    this.walk.pitch += (slope - 0.06 - this.walk.pitch) * damp(4, dt);
    const look = new THREE.Vector3(-Math.sin(this.walk.yaw) * Math.cos(this.walk.pitch), Math.sin(this.walk.pitch), -Math.cos(this.walk.yaw) * Math.cos(this.walk.pitch));
    this.camera.lookAt(this.camera.position.clone().add(look));
    this.controls.target.copy(this.camera.position).add(look);
    if (g.s >= g.length && this.camera.position.distanceTo(eye) < 0.02) this.endGuide(true);
    return true;
  }

  dispose() { this.controls.dispose(); for (const f of this.off) f(); }
}
