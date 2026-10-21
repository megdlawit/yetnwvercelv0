// IndoorViewer3D — any venue's floor plan as an explorable 3D building.
//
//   const viewer = new IndoorViewer3D(element, { venue });
//   viewer.setRoute(pathFromNodes(venue, route.nodeIds));
//   viewer.setPosition({ floorId, at, heading });
//   viewer.setMode('follow');
//   …
//   viewer.dispose();
//
// Framework-free and self-contained: everything it creates lives inside the
// element it is given (canvas, labels, scoped styles), and dispose() removes
// it all. The React wrapper (react.tsx) and the SDK are thin layers on this.

import * as THREE from 'three';
import type { IndoorVenue, Lang, Vec2 } from '../model';
import { t2 } from '../model';
import { centroid } from '../geometry';
import { locateOnPath, pathFromNodes, pointAt, type Path3D, type Point3 } from '../path3d';
import { findRoute, nearestNode } from '../nav/router';
import { formatDuration, t } from '../nav/i18n';
import { walkway } from '../nav/walkway';
import type { IndoorNode } from '../model';
import { buildFloor, DEFAULT_LAYERS, obstacles, pickRoom, type BuiltFloor, type Layers } from './buildFloor';
import { CameraDirector, type ViewMode } from './camera';
import { LABEL_CSS, LabelLayer, type LabelSpec } from './labels';
import { DestinationMarker, YouMarker } from './markers';
import { RouteRibbon } from './route';
import { INDOOR_THEME, MaterialLibrary, TextureSet, type ViewerTheme } from './theme';

export type { ViewMode } from './camera';

/** A place to tag on the map (defaults to the venue's places). */
export interface PlaceTag {
  /** What onSelect reports (the app uses path node ids). */
  id: string;
  floorId: string;
  at: Vec2;
  name: string;
  sub?: string | null;
  color?: string | null;
  priority?: number;
  /** A photo for the place's badge. */
  image?: string | null;
  /** Or an icon for it (SVG markup), on its colour. */
  icon?: string | null;
}

export interface Selection { id: string | null; poiId: string | null; nodeId: string | null; roomId: string | null }

export interface Pose {
  floorId: string;
  at: Vec2;
  /** Height in the building, when between floors (on stairs). */
  y?: number;
  /** Facing, radians in the plan (0 = +x, clockwise on screen). */
  heading?: number | null;
}

export interface ViewerOptions {
  venue: IndoorVenue;
  theme?: Partial<ViewerTheme>;
  lang?: Lang;
  layers?: Partial<Layers>;
  floorId?: string;
  mode?: ViewMode;
  /** Defaults to the visitor's system setting. */
  reducedMotion?: boolean;
  /** Soft shadows (default: on, except on small touch screens). */
  shadows?: boolean;
  /** Tags to show instead of the venue's own places. */
  places?: PlaceTag[] | null;
  /** Show room names too. */
  roomLabels?: boolean;
  /**
   * A 3D landmark for a place (about any size — it's scaled to fit), drawn
   * floating over a pulsing ring in its colour, with its name above — the
   * control center's look. Null keeps the round badge for that place.
   */
  placeModel?: (tag: PlaceTag) => THREE.Object3D | null;
  /** Home-page style entrance: a slow glide in, then a gentle turn until touched. */
  cinematic?: boolean;
  onSelect?: (sel: Selection | null) => void;
  onFloorChange?: (floorId: string) => void;
  onModeChange?: (mode: ViewMode) => void;
  /** The visitor zoomed out past the farthest view (e.g. go to the outdoor map). */
  onZoomOutLimit?: () => void;
}

interface FloorState { built: BuiltFloor | null; opacity: number; target: number }

/** The follow camera looks this far ahead along the route and trails this far behind (the prototype's 3.4 / 4.2 m). */
const LOOK_AHEAD = 3.4;
const TRAIL = 4.2;
/** Places' 3D landmarks: how high they float over the floor, and how big they are (metres). */
const LM_BASE = 2.2;
const LM_SIZE = 1.25;

export class IndoorViewer3D {
  readonly root: HTMLDivElement;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 2000);
  private renderer: THREE.WebGLRenderer | null = null;
  private director: CameraDirector | null = null;
  private labels: LabelLayer;
  private ribbon: RouteRibbon;
  private you: YouMarker;
  private dest: DestinationMarker;
  private stems: THREE.InstancedMesh | null = null;
  /** Places' 3D landmarks on the floor in view. */
  private marks: { group: THREE.Group; items: { id: string; float: THREE.Group; halo: THREE.Mesh; i: number; k: number }[]; pickables: THREE.Object3D[] } | null = null;
  private modelCache = new Map<string, THREE.Object3D | null>();
  private highlight: THREE.Mesh | null = null;
  /** The see-through window's current radius (eases open and shut). */
  private xrayR = 0;
  /** Walk mode: choosing where to go, on the way, or arrived — and where. */
  private walkInfo: { state: 'off' | 'choose' | 'walking' | 'arrived'; target: string | null; from: string | null } = { state: 'off', target: null, from: null };
  private walkBar: HTMLDivElement | null = null;
  private lastWalk: { x: number; y: number; z: number; floorId: string }[] = [];
  /** The line the last walk followed (for tests and overlays). */
  get walkLine() { return this.lastWalk; }
  private textures = new TextureSet();
  private floors = new Map<string, FloorState>();
  private theme: ViewerTheme;
  private layers: Layers;
  private lang: Lang;
  private venue: IndoorVenue;
  private floorId: string;
  private path: Path3D | null = null;
  private pose: Pose | null = null;
  private progress = -1;
  /** While climbing: the floor the stairs lead to, shown alongside this one. */
  private transit: string | null = null;
  private places: PlaceTag[] | null;
  private roomLabels: boolean;
  private selected: string | null = null;
  private reduced: boolean;
  private sun = new THREE.DirectionalLight('#fff1d6', 1.55);
  private hemi = new THREE.HemisphereLight('#fff7ea', '#d9cbb3', 1.15);
  private clip = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)];
  private raf = 0;
  private clock = new THREE.Clock();
  private time = 0;
  private dirty = true;
  private visible = true;
  private resizeObs: ResizeObserver | null = null;
  private interObs: IntersectionObserver | null = null;
  private size = { w: 1, h: 1 };
  private down: { x: number; y: number; t: number } | null = null;
  private spin = false;
  private cleanups: (() => void)[] = [];

  constructor(container: HTMLElement, private opts: ViewerOptions) {
    this.venue = opts.venue;
    this.theme = { ...INDOOR_THEME, ...opts.theme };
    this.layers = { ...DEFAULT_LAYERS, ...opts.layers };
    this.lang = opts.lang ?? 'en';
    this.places = opts.places ?? null;
    this.roomLabels = opts.roomLabels ?? false;
    this.reduced = opts.reducedMotion ?? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.floorId = opts.floorId && this.venue.floors.some(f => f.id === opts.floorId) ? opts.floorId : this.venue.floors[0]?.id ?? '';

    this.root = document.createElement('div');
    this.root.className = 'ivw-root';
    this.root.style.cssText = 'position:relative;width:100%;height:100%;';
    const style = document.createElement('style');
    style.textContent = LABEL_CSS;
    this.root.appendChild(style);
    container.appendChild(this.root);

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      const msg = document.createElement('div');
      msg.textContent = 'This device cannot show the 3D map.';
      msg.style.cssText = 'display:grid;place-items:center;height:100%;color:#6b7168;font-size:14px;';
      this.root.appendChild(msg);
    }
    const r = this.renderer;
    if (r) {
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.02;
      const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
      r.shadowMap.enabled = opts.shadows ?? !coarse;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      r.localClippingEnabled = true;
      r.domElement.tabIndex = 0;
      r.domElement.setAttribute('aria-label', '3D map');
      this.root.appendChild(r.domElement);
      this.director = new CameraDirector(this.camera, r.domElement, this.reduced);
      this.director.onZoomOutLimit = () => this.opts.onZoomOutLimit?.();
      this.director.controls.addEventListener('change', () => { this.dirty = true; });
      this.director.controls.addEventListener('start', () => { if (this.spin) { this.spin = false; this.director!.controls.autoRotate = false; } });
      this.bindPointer(r.domElement);
    }

    this.scene.background = new THREE.Color(this.theme.sky);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.ribbon = new RouteRibbon(this.theme);
    this.you = new YouMarker(this.theme);
    this.dest = new DestinationMarker(this.theme);
    this.scene.add(this.ribbon.mesh, this.you.group, this.dest.group);
    this.labels = new LabelLayer(this.root, id => this.pick(id));

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.root);
    this.interObs = new IntersectionObserver(es => { this.visible = es.some(e => e.isIntersecting); if (this.visible) this.loop(); });
    this.interObs.observe(this.root);
    const vis = () => { if (!document.hidden) { this.clock.getDelta(); this.loop(); } };
    document.addEventListener('visibilitychange', vis);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', vis));

    this.resize();
    this.syncFloors(true);
    this.refreshLabels();
    this.fitLights();
    this.frameFloor(false);
    if (opts.mode && opts.mode !== 'overview') this.setMode(opts.mode);
    if (opts.cinematic) this.intro();
    this.loop();
  }

  // ── public API ─────────────────────────────────────────────────────────────

  /** Swap the venue (rebuilds everything). */
  setVenue(venue: IndoorVenue) {
    this.venue = venue;
    this.wallCache = null;
    for (const s of this.floors.values()) this.dropFloor(s);
    this.floors.clear();
    if (!venue.floors.some(f => f.id === this.floorId)) this.floorId = venue.floors[0]?.id ?? '';
    this.syncFloors(true);
    this.refreshLabels();
    this.fitLights();
    this.frameFloor(false);
  }

  setTheme(theme: Partial<ViewerTheme>) {
    this.theme = { ...INDOOR_THEME, ...theme };
    (this.scene.background as THREE.Color).set(this.theme.sky);
    this.ribbon.setTheme(this.theme);
    for (const s of this.floors.values()) this.dropFloor(s);
    this.floors.clear();
    this.syncFloors(true);
  }

  setLayers(layers: Partial<Layers>) {
    this.layers = { ...DEFAULT_LAYERS, ...layers };
    for (const s of this.floors.values()) if (s.built) this.applyLayers(s.built);
    this.syncFloors();
    this.refreshLabels();
  }

  setLang(lang: Lang) { this.lang = lang; this.refreshLabels(); this.renderWalkBar(); }

  setPlaces(places: PlaceTag[] | null) { this.places = places; this.clearMarks(); this.dropModels(); this.refreshLabels(); }

  setRoomLabels(on: boolean) { this.roomLabels = on; this.refreshLabels(); }

  get currentFloor() { return this.floorId; }
  get mode(): ViewMode { return this.director?.mode ?? 'overview'; }

  /** Show a floor (others fade or stack per layers and camera mode). */
  setFloor(floorId: string, opts: { frame?: boolean } = {}) {
    if (!this.venue.floors.some(f => f.id === floorId) || floorId === this.floorId) return;
    this.floorId = floorId;
    this.syncFloors();
    this.fitLights();
    this.buildStems();
    if (opts.frame !== false && (this.mode === 'overview' || this.mode === 'top')) this.frameFloor(true);
    this.opts.onFloorChange?.(floorId);
  }

  setMode(mode: ViewMode) {
    if (!this.director || mode === this.director.mode) return;
    if (this.director.mode === 'walk' && !this.path) this.dest.set(null);
    if (mode !== 'walk') { this.walkInfo = { state: 'off', target: null, from: null }; this.renderWalkBar(); }
    this.director.setMode(mode);
    this.syncFloors();
    if (mode === 'walk') this.beginWalk();
    this.dirty = true;
    this.opts.onModeChange?.(mode);
  }

  // ── walking through the building ───────────────────────────────────────────

  /**
   * Walk mode starts at the way in — the visitor's entry point, else the main
   * entrance — standing on the paths and facing into the building. With a
   * place picked it walks there; otherwise it asks "Where do you want to go?"
   * and walks to whatever the visitor chooses (from the list, a room, or a
   * place's name), along the paths, through doors and up stairs.
   */
  private beginWalk() {
    const d = this.director;
    if (!d) return;
    const start = this.walkStartNode();
    this.walkInfo = { state: 'choose', target: null, from: start?.id ?? null };
    if (start) {
      if (start.floorId !== this.floorId) this.setFloor(start.floorId, { frame: false });
      d.startWalk(this.elev(start.floorId, start.at), this.lookInto(start.floorId, start.at, start), 1.1);
      const target = this.selected ? this.tags().find(x => x.id === this.selected && x.id !== start.id) : undefined;
      if (target) this.walkToPlace(target.id, start);
    }
    this.renderWalkBar();
  }

  /**
   * Walk from one path point to another. The route picks the floors and the
   * stairs or lift; on each floor the walk goes the way a person would —
   * round walls and in through the doorways (walkway.ts), never through a
   * wall, even where a path line was drawn through one. `fromHere` starts
   * from where the walker stands now.
   */
  private walkRoute(fromId: string, toId: string, face: THREE.Vector3 | null, extra?: THREE.Vector3, stopShort = 0, onDone?: (arrived: boolean) => void, fromHere = false): boolean {
    const route = fromId === toId ? null : findRoute(this.venue, fromId, toId);
    const startNode = this.venue.nodes.find(n => n.id === fromId);
    const node = this.venue.nodes.find(n => n.id === toId);
    if (!startNode || !node || (!route && !(fromId === toId && extra))) return false;
    const path = route ? pathFromNodes(this.venue, route.nodeIds) : null;
    const pts: WalkPoint[] = [];
    if (fromHere) {
      const c = this.camera.position;
      this.walkFloor(pts, this.floorId, { x: c.x, z: c.z }, startNode.floorId === this.floorId ? startNode.at : { x: c.x, z: c.z });
    }
    if (path) {
      path.pieces.forEach((piece, i) => {
        const a = piece.points[0], b = piece.points[piece.points.length - 1];
        if (piece.kind === 'walk' || piece.kind === 'door') this.walkFloor(pts, piece.floorId, { x: a.x, z: a.z }, { x: b.x, z: b.z });
        else {
          // Up (or down) the stairs / lift as drawn; the top belongs to the floor you arrive on.
          const upper = path.pieces[i + 1]?.floorId ?? piece.floorId;
          piece.points.forEach((q, k) => pushPoint(pts, v3(q), k === piece.points.length - 1 ? upper : piece.floorId));
        }
      });
    } else this.walkFloor(pts, node.floorId, startNode.at, startNode.at);
    if (extra) {
      const last = pts[pts.length - 1];
      this.walkFloor(pts, last?.floorId ?? node.floorId, last ? { x: last.p.x, z: last.p.z } : node.at, { x: extra.x, z: extra.z });
    }
    return this.walkPolyline(pts, face, stopShort, onDone);
  }

  /** One floor's stretch, through the doorways (straight if the walls allow no way: the plan needs a door). */
  private walkFloor(pts: WalkPoint[], floorId: string, a: Vec2, b: Vec2) {
    const y = this.venue.floors.find(f => f.id === floorId)?.elevation ?? 0;
    const way = walkway(this.venue, floorId, a, b) ?? [a, b];
    for (const q of way) pushPoint(pts, new THREE.Vector3(q.x, y, q.z), floorId);
  }

  /** Glide along a line of points (stopping `stopShort` before its end), switching floors on the way. */
  private walkPolyline(pts: WalkPoint[], face: THREE.Vector3 | null, stopShort = 0, onDone?: (arrived: boolean) => void): boolean {
    const d = this.director;
    if (!d || !pts.length) return false;
    this.lastWalk = pts.map(q => ({ x: q.p.x, y: q.p.y, z: q.p.z, floorId: q.floorId }));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].p.distanceTo(pts[i - 1].p));
    const L = cum[cum.length - 1];
    const sample = (s: number) => {
      if (pts.length === 1 || s <= 0) return { p: pts[0].p.clone(), floorId: pts[0].floorId };
      let i = 1;
      while (i < pts.length - 1 && cum[i] < s) i++;
      const a = pts[i - 1], b = pts[i];
      const k = Math.min(1, Math.max(0, (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])));
      return { p: a.p.clone().lerp(b.p, k), floorId: k > 0.5 ? b.floorId : a.floorId };
    };
    // Where the walk ends: if a wall stands between there and what we'd face, turn to the open view that way instead.
    const endAt = sample(Math.max(0, L - stopShort));
    const aim = face;
    if (aim && endAt.floorId && this.obstaclesOn(endAt.floorId).some(w => crosses(endAt.p.x, endAt.p.z, aim.x, aim.z, w.a, w.b))) {
      face = this.lookInto(endAt.floorId, { x: endAt.p.x, z: endAt.p.z }, null, Math.atan2(aim.z - endAt.p.z, aim.x - endAt.p.x));
    }
    d.walkAlong(sample, Math.max(0, L - stopShort), face, {
      onStep: floorId => { if (floorId && floorId !== this.floorId) this.setFloor(floorId, { frame: false }); },
      onDone,
    });
    this.dirty = true;
    return true;
  }

  /** Walk to a picked place (from its tag, or setSelected while walking). */
  private walkToPlace(id: string, from?: IndoorNode | null) {
    const tag = this.tags().find(x => x.id === id);
    const here = from ?? this.walkerNode();
    if (!tag || !here || !this.director) return;
    if (this.walkInfo.state === 'walking' && this.walkInfo.target === id) return; // already on the way
    this.selected = id;
    this.labels.select(id);
    this.updateHighlight();
    const goal = this.venue.nodes.find(n => n.id === tag.id) ?? nearestNode(this.venue, tag.floorId, tag.at);
    // Once you've set off you're no longer at the entrance: times count from where you are.
    const done = (arrived: boolean) => { this.walkInfo = { ...this.walkInfo, state: arrived ? 'arrived' : 'choose', from: null }; this.renderWalkBar(); };
    if (goal && goal.id === here.id) {
      // Already there: just turn to it.
      this.director.startWalk(this.elev(here.floorId, here.at), this.placeView(tag), 0.6);
      this.walkInfo = { ...this.walkInfo, state: 'arrived', target: id };
    } else {
      const ok = !!goal && this.walkRoute(here.id, goal.id, this.placeView(tag), undefined, ARRIVE_SHORT, done, !from);
      this.walkInfo = { ...this.walkInfo, state: ok ? 'walking' : 'choose', target: ok ? id : null };
    }
    this.renderWalkBar();
    this.dirty = true;
  }

  /** The "Where do you want to go?" bar (choose), "Walking to …  Stop" (walking), "You're at … — where next?" (arrived). */
  private renderWalkBar() {
    const st = this.walkInfo.state;
    if (st === 'off' || this.mode !== 'walk') { if (this.walkBar) this.walkBar.hidden = true; return; }
    if (!this.walkBar) {
      const bar = document.createElement('div');
      bar.className = 'ivw-walkbar';
      bar.setAttribute('role', 'region');
      bar.addEventListener('click', e => {
        const el = (e.target as HTMLElement).closest('button');
        if (!el) return;
        if (el.dataset.stop != null) this.director?.stopGuide();
        else if (el.dataset.go) this.walkToPlace(el.dataset.go);
      });
      this.root.appendChild(bar);
      this.walkBar = bar;
    }
    const bar = this.walkBar;
    bar.hidden = false;
    const L = this.lang;
    const tags = this.tags();
    const nameOf = (id: string | null) => (id ? tags.find(x => x.id === id)?.name ?? '' : '');
    bar.setAttribute('aria-label', t(L, 'walk.where'));
    bar.replaceChildren();
    const head = document.createElement('div');
    head.className = 'ivw-walkhead';
    const dot = document.createElement('span');
    dot.className = 'ivw-dot';
    const title = document.createElement('b');
    title.textContent = st === 'walking' ? (this.walkInfo.target ? t(L, 'walk.to', { place: nameOf(this.walkInfo.target) }) : t(L, 'walk.walking'))
      : st === 'arrived' ? t(L, 'walk.arrived', { place: nameOf(this.walkInfo.target) })
      : t(L, 'walk.where');
    head.append(dot, title);
    if (st === 'choose' && this.walkInfo.from) {
      const from = document.createElement('small');
      const node = this.venue.nodes.find(n => n.id === this.walkInfo.from);
      const nodeName = node?.name ? (L === 'am' && node.name.am ? node.name.am : node.name.en) : '';
      from.textContent = t(L, 'walk.from', { place: nameOf(this.walkInfo.from) || nodeName || t(L, 'walk.entrance') });
      head.appendChild(from);
    }
    if (st === 'walking') {
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.dataset.stop = '';
      stop.className = 'ivw-stop';
      stop.textContent = t(L, 'walk.stop');
      head.appendChild(stop);
    }
    bar.appendChild(head);
    if (st === 'walking') return;
    // The places, nearest first by walking time, with how long each takes.
    const here = st === 'choose' && this.walkInfo.from ? this.venue.nodes.find(n => n.id === this.walkInfo.from) ?? this.walkerNode() : this.walkerNode();
    const list = tags.filter(x => x.id !== here?.id && x.id !== (st === 'arrived' ? this.walkInfo.target : null)).slice(0, 40).map(x => {
      const node = this.venue.nodes.find(n => n.id === x.id);
      const r = here && node ? findRoute(this.venue, here.id, node.id) : null;
      return { x, secs: r ? r.seconds : Infinity };
    }).sort((a, b) => a.secs - b.secs);
    const chips = document.createElement('div');
    chips.className = 'ivw-chips';
    for (const { x, secs } of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.go = x.id;
      b.disabled = !Number.isFinite(secs);
      const i = document.createElement('i');
      i.style.background = x.color ?? this.theme.ink;
      const n = document.createElement('span');
      n.textContent = x.name;
      b.append(i, n);
      if (Number.isFinite(secs)) { const m = document.createElement('small'); m.textContent = formatDuration(secs, L); b.appendChild(m); }
      chips.appendChild(b);
    }
    bar.appendChild(chips);
  }

  /** What to look at when arriving at a place: toward its room's middle (so the room is in view) and the place. */
  private placeView(tag: PlaceTag): THREE.Vector3 {
    const poi = this.venue.pois.find(p => (p.nodeId ?? p.id) === tag.id);
    const room = this.venue.rooms.find(r => (poi?.roomId && r.id === poi.roomId) || (r.nodeId && r.nodeId === tag.id));
    // Between the room's middle and the place itself: the room fills the view and its name is in it.
    const c = room ? centroid(room.polygon) : tag.at;
    return this.elev(tag.floorId, { x: (c.x + tag.at.x) / 2, z: (c.z + tag.at.z) / 2 });
  }

  /** Walk to a spot on the floor that was tapped: round walls, through doorways. */
  private walkToPoint(p: THREE.Vector3) {
    if (!this.director) return;
    const c = this.camera.position;
    const back = () => { this.walkInfo = { ...this.walkInfo, state: 'choose', target: null, from: null }; this.renderWalkBar(); };
    const pts: WalkPoint[] = [];
    this.walkFloor(pts, this.floorId, { x: c.x, z: c.z }, { x: p.x, z: p.z });
    // Stop a metre short, then turn to the most open view, keeping roughly the way you walked.
    const last = pts[pts.length - 1].p, prev = pts[Math.max(0, pts.length - 2)].p;
    const heading = Math.atan2(last.z - prev.z, last.x - prev.x);
    const face = this.lookInto(this.floorId, { x: last.x, z: last.z }, null, Number.isFinite(heading) ? heading : undefined);
    if (this.walkPolyline(pts, face, 1, back)) {
      this.walkInfo = { ...this.walkInfo, state: 'walking', target: null };
      this.renderWalkBar();
    }
  }

  /** The path point the walker is nearest (or the visitor, or the entrance). */
  private walkerNode(): IndoorNode | null {
    const c = this.camera.position;
    return nearestNode(this.venue, this.floorId, { x: c.x, z: c.z }) ?? this.walkStartNode();
  }

  /** Where a walk starts: the visitor, else the entrance, else the front of the building. */
  private walkStartNode(): IndoorNode | null {
    if (this.pose) return nearestNode(this.venue, this.pose.floorId, this.pose.at);
    // The main entrance: on the lowest floor that has paths.
    const floorId = this.venue.floors.find(f => this.venue.nodes.some(n => n.floorId === f.id))?.id ?? this.floorId;
    const nodes = this.venue.nodes.filter(n => n.floorId === floorId && this.venue.edges.some(e => e.from === n.id || e.to === n.id));
    if (!nodes.length) return null;
    const door = this.venue.props.find(p => p.floorId === floorId && p.kind === 'entrance');
    if (door) return nearestNode(this.venue, floorId, door.at);
    const named = nodes.find(n => /entr|gate|main door|lobby|reception|መግቢያ/i.test(n.name?.en ?? '') || /መግቢያ/.test(n.name?.am ?? ''));
    if (named) return named;
    // The front of the plan (its lowest edge on screen) is where people usually come in.
    return nodes.reduce((a, b) => (b.at.z > a.at.z ? b : a));
  }

  /**
   * Walking or following: when walls hide the place you're heading for, open
   * a soft window through them (and keep its pin up), so you always see it.
   */
  private updateSeeThrough(dt: number): boolean {
    const x = this.textures.xray;
    let want = 0;
    const mode = this.mode;
    let goal: THREE.Vector3 | null = null;
    if (mode === 'walk' || mode === 'follow') {
      const tag = this.selected ? this.tags().find(t => t.id === this.selected) : undefined;
      const end = this.path?.samples[this.path.samples.length - 1]?.p;
      if (mode === 'follow' && end) goal = v3(end);
      else if (tag) goal = this.elev(tag.floorId, tag.at);
    }
    if (goal && Math.abs(goal.y - (this.venue.floors.find(f => f.id === this.floorId)?.elevation ?? 0)) < 0.5) {
      const eye = this.camera.position;
      const hidden = this.wallLines().some(w => crosses(eye.x, eye.z, goal!.x, goal!.z, w.a, w.b));
      if (hidden) want = 1.35;
      x.uXrayA.value.copy(eye);
      x.uXrayB.value.set(goal.x, goal.y + 1.3, goal.z);
    }
    const before = this.xrayR;
    this.xrayR += (want - this.xrayR) * (this.reduced ? 1 : 1 - Math.exp(-dt * 5));
    if (Math.abs(this.xrayR - want) < 0.01) this.xrayR = want;
    x.uXrayR.value = this.xrayR;
    // The place's pin, while walking to it (the route's own pin covers following).
    // (hidden once you are close: the lit room and its name say 'here' without a pin in your face).
    if (mode === 'walk' && !this.path) this.dest.set(goal && goal.distanceTo(this.camera.position.clone().setY(goal.y)) > 4 ? goal : null);
    return this.xrayR !== before || want > 0;
  }

  /**
   * Which way to face from a spot: the longest open view (tested in 16
   * directions against the walls), leaning toward the building's middle —
   * never straight into a nearby wall.
   */
  private lookInto(floorId: string, at: Vec2, _node: IndoorNode | null, prefer?: number): THREE.Vector3 {
    const { center } = this.floorFrame(floorId);
    const y = this.elev(floorId, at).y;
    const walls = this.wallLines();
    const toCentre = prefer ?? Math.atan2(center.z - at.z, center.x - at.x);
    let best = { score: -Infinity, a: toCentre };
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      let free = 25;
      for (const w of walls) { const t = rayHit(at.x, at.z, dx, dz, w.a, w.b); if (t !== null && t < free) free = t; }
      const score = Math.min(free, 15) + 3 * Math.cos(a - toCentre);
      if (score > best.score) best = { score, a };
    }
    return new THREE.Vector3(at.x + Math.cos(best.a), y, at.z + Math.sin(best.a));
  }

  private elev(floorId: string, at: Vec2) {
    return new THREE.Vector3(at.x, this.venue.floors.find(f => f.id === floorId)?.elevation ?? 0, at.z);
  }

  /** The route to draw (null clears it). The destination pin goes on its last point. */
  setRoute(path: Path3D | null) {
    this.path = path && path.samples.length > 1 ? path : null;
    this.ribbon.set(this.path);
    this.ribbon.setProgress(this.progress);
    const end = this.path?.samples[this.path.samples.length - 1]?.p ?? null;
    this.dest.set(end);
    this.dirty = true;
  }

  /** A destination pin without a route (e.g. a place picked but not yet set off for). */
  setDestination(p: Pose | null) {
    if (this.path) return;
    const y = p ? (p.y ?? this.venue.floors.find(f => f.id === p.floorId)?.elevation ?? 0) : 0;
    this.dest.set(p ? { x: p.at.x, y, z: p.at.z } : null);
    this.dirty = true;
  }

  /** Metres of the route already walked (greyed out). */
  setProgress(s: number) { this.progress = s; this.ribbon.setProgress(s); }

  /** Where the visitor is. In follow mode the camera rides along, and the floor switches with them. */
  setPosition(pose: Pose | null) {
    this.pose = pose;
    if (!pose) { this.you.set(null, null); this.director?.setSubject(null); return; }
    const f = this.venue.floors.find(x => x.id === pose.floorId);
    const y = pose.y ?? f?.elevation ?? 0;
    this.you.set({ x: pose.at.x, y, z: pose.at.z }, pose.heading ?? null);
    if (pose.floorId !== this.floorId && f) this.setFloor(pose.floorId, { frame: false });
    this.updateSubject();
    this.dirty = true;
  }

  setSelected(id: string | null, opts: { focus?: boolean } = {}) {
    this.selected = id;
    this.labels.select(id);
    this.updateHighlight();
    if (id && opts.focus && this.mode === 'walk') { this.walkToPlace(id); this.dirty = true; return; }
    if (id && opts.focus) {
      const tag = this.tags().find(t => t.id === id);
      if (tag) {
        if (tag.floorId !== this.floorId) this.setFloor(tag.floorId, { frame: false });
        const y = this.venue.floors.find(f => f.id === tag.floorId)?.elevation ?? 0;
        this.director?.focus(new THREE.Vector3(tag.at.x, y, tag.at.z));
      }
    }
    this.dirty = true;
  }

  zoomIn() { this.director?.zoom(0.72); this.dirty = true; }
  zoomOut() { this.director?.zoom(1.38); this.dirty = true; }
  recenter() { if (this.mode === 'follow' || this.mode === 'walk') this.setMode('overview'); else this.frameFloor(true); }

  /** The home-page entrance: glide in from afar, then turn slowly until touched. */
  intro() {
    const d = this.director;
    if (!d || this.reduced) return;
    const { center, radius } = this.floorFrame();
    this.camera.position.set(center.x - radius * 4, center.y + radius * 3.2, center.z + radius * 4.5);
    d.controls.target.copy(center);
    d.frame(center, radius, true);
    window.setTimeout(() => { if (d.mode === 'overview') { this.spin = true; d.controls.autoRotate = true; d.controls.autoRotateSpeed = 0.45; } }, 1300);
  }

  /** Update callbacks without rebuilding (React re-renders). */
  setCallbacks(cb: Pick<ViewerOptions, 'onSelect' | 'onFloorChange' | 'onModeChange' | 'onZoomOutLimit'>) { Object.assign(this.opts, cb); }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.raf = -1;
    this.resizeObs?.disconnect();
    this.interObs?.disconnect();
    for (const f of this.cleanups) f();
    for (const s of this.floors.values()) this.dropFloor(s);
    this.floors.clear();
    this.ribbon.dispose(); this.you.dispose(); this.dest.dispose();
    if (this.stems) { this.stems.geometry.dispose(); (this.stems.material as THREE.Material).dispose(); }
    this.clearMarks();
    this.dropModels();
    if (this.highlight) { this.highlight.geometry.dispose(); (this.highlight.material as THREE.Material).dispose(); }
    this.walkBar?.remove();
    this.textures.dispose();
    this.labels.dispose();
    this.director?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.root.remove();
  }

  // ── floors ─────────────────────────────────────────────────────────────────

  private order(id: string) { return this.venue.floors.find(f => f.id === id)?.order ?? 0; }

  /** Which floors show and how solid: this one solid; below it solid (stacked); above it faint in the overview only. */
  private targetOpacity(id: string): number {
    if (id === this.floorId) return 1;
    const mode = this.mode;
    if (id === this.transit && (mode === 'follow' || mode === 'walk')) return 1;
    if (!this.layers.otherFloors || mode === 'top') return 0;
    const below = this.order(id) < this.order(this.floorId);
    if (mode === 'follow' || mode === 'walk') return below && this.order(this.floorId) - this.order(id) === 1 ? 1 : 0;
    return below ? 1 : 0.12;
  }

  private syncFloors(instant = false) {
    for (const f of this.venue.floors) {
      let s = this.floors.get(f.id);
      if (!s) { s = { built: null, opacity: 0, target: 0 }; this.floors.set(f.id, s); }
      s.target = this.targetOpacity(f.id);
      // Built lazily, the first time a floor needs to show.
      if (s.target > 0 && !s.built) {
        s.built = buildFloor(this.venue, f, new MaterialLibrary(this.theme, this.textures));
        this.applyLayers(s.built);
        this.scene.add(s.built.group);
      }
      if (instant) s.opacity = s.target;
      if (s.built) this.applyOpacity(s);
    }
    // Plan-like section in the top view: walls cut at 1.3 m.
    const cur = this.floors.get(this.floorId)?.built;
    const el = this.venue.floors.find(f => f.id === this.floorId)?.elevation ?? 0;
    this.clip[0].constant = el + 1.3;
    for (const s of this.floors.values()) s.built?.mats.setClip(s.built === cur && this.mode === 'top' ? this.clip : null);
    this.director?.setWalkFloor(el);
    // Follow / walk: the ribbon stops at this floor's ceiling (or the next floor's while climbing to it).
    const inside = this.mode === 'follow' || this.mode === 'walk';
    const top = this.venue.floors.find(f => f.id === (this.transit ?? this.floorId));
    const curF = this.venue.floors.find(f => f.id === this.floorId);
    const maxY = Math.max((top?.elevation ?? 0) + (top?.ceilingHeight ?? 3), (curF?.elevation ?? 0) + (curF?.ceilingHeight ?? 3));
    this.ribbon.setMaxY(inside ? maxY : Infinity);
    this.director?.setObstacles(this.layers.walls ? obstacles(this.venue, this.floorId) : []);
    this.updateHighlight();
    this.dirty = true;
  }

  private applyOpacity(s: FloorState) {
    const b = s.built!;
    b.group.visible = s.opacity > 0.01;
    b.mats.setOpacity(Math.max(0, Math.min(1, s.opacity)));
    // Upper floors faint: no shadows from them onto the floor below.
    b.group.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.userData.baseCast ??= m.castShadow; m.castShadow = s.opacity > 0.9 && m.userData.baseCast; });
  }

  private applyLayers(b: BuiltFloor) {
    const L = this.layers;
    const vis = (list: THREE.Object3D[], on: boolean) => { for (const o of list) o.visible = on; };
    vis(b.parts.walls, L.walls);
    vis(b.parts.rooms, L.rooms);
    vis(b.parts.objects, L.objects);
    vis(b.parts.paths, L.paths);
    vis(b.parts.scenery, L.scenery);
    for (const o of b.parts.ceilings) o.visible = L.walls;
  }

  private dropFloor(s: FloorState) {
    if (!s.built) return;
    this.scene.remove(s.built.group);
    s.built.dispose();
    s.built = null;
  }

  private floorFrame(id = this.floorId) {
    const f = this.venue.floors.find(x => x.id === id);
    const y = f?.elevation ?? 0;
    const pts: Vec2[] = [
      ...this.venue.walls.filter(w => w.floorId === id).flatMap(w => [w.a, w.b]),
      ...this.venue.rooms.filter(r => r.floorId === id).flatMap(r => r.polygon),
      ...this.venue.nodes.filter(n => n.floorId === id).map(n => n.at),
    ];
    if (!pts.length) {
      const b = this.venue.bounds;
      return { center: new THREE.Vector3((b.min.x + b.max.x) / 2, y, (b.min.z + b.max.z) / 2), radius: Math.max(8, Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z) / 2) };
    }
    const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    return { center: new THREE.Vector3((minX + maxX) / 2, y, (minZ + maxZ) / 2), radius: Math.max(4, Math.hypot(maxX - minX, maxZ - minZ) / 2) };
  }

  private frameFloor(animate: boolean) {
    const { center, radius } = this.floorFrame();
    this.director?.frame(center, radius, animate);
    this.camera.far = Math.max(500, radius * 30);
    this.camera.updateProjectionMatrix();
    this.scene.fog = new THREE.Fog(this.theme.sky, radius * 5, radius * 14);
  }

  private fitLights() {
    const { center, radius } = this.floorFrame();
    const r = radius + 6;
    this.sun.position.set(center.x - r * 0.8, center.y + r * 1.6, center.z + r * 0.6);
    this.sun.target.position.copy(center);
    const cam = this.sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 0.5; cam.far = r * 5;
    cam.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
  }

  // ── labels and picking ─────────────────────────────────────────────────────

  private tags(): PlaceTag[] {
    if (this.places) return this.places;
    return this.venue.pois.map(p => ({ id: p.nodeId ?? p.id, floorId: p.floorId, at: p.at, name: t2(p.name, this.lang), priority: 1 }));
  }

  private refreshLabels() {
    const specs: LabelSpec[] = [];
    const elev = new Map(this.venue.floors.map(f => [f.id, f.elevation]));
    // Places always get their badge; the Names layer adds names (and room names).
    const tags = this.tags();
    const names = !!this.layers.labels;
    for (const t of tags) {
      // A place with a 3D landmark gets its name pill over the model; the others keep their badge.
      const lm = !!this.modelFor(t);
      specs.push({ id: t.id, text: t.name, sub: t.sub, color: t.color, kind: 'place', floorId: t.floorId, at: new THREE.Vector3(t.at.x, (elev.get(t.floorId) ?? 0) + (lm ? LM_BASE + LM_SIZE * 0.75 : 2.1), t.at.z), priority: t.priority ?? 1, image: t.image, icon: t.icon, showName: names || lm, pill: lm });
    }
    if (this.layers.labels && this.roomLabels) {
      const tagged = new Set(tags.map(t => t.id));
      for (const r of this.venue.rooms) {
        if (r.nodeId && tagged.has(r.nodeId)) continue;
        const name = t2(r.name, this.lang);
        if (!name) continue;
        const c = centroid(r.polygon);
        specs.push({ id: `room:${r.id}`, text: name, kind: 'room', floorId: r.floorId, at: new THREE.Vector3(c.x, (elev.get(r.floorId) ?? 0) + 0.2, c.z), priority: 0 });
      }
      for (const p of this.venue.props) if (p.kind === 'label' && p.label) specs.push({ id: `note:${p.id}`, text: t2(p.label, this.lang), kind: 'note', floorId: p.floorId, at: new THREE.Vector3(p.at.x, (elev.get(p.floorId) ?? 0) + 0.1, p.at.z), priority: -1 });
    }
    this.labels.set(specs);
    this.labels.select(this.selected);
    this.buildStems();
    this.dirty = true;
  }

  /** A thin stem in each place's colour from the floor up to its tag, and a dot where it stands. */
  private buildStems() {
    if (this.stems) { this.scene.remove(this.stems); this.stems.geometry.dispose(); (this.stems.material as THREE.Material).dispose(); this.stems = null; }
    this.clearMarks();
    const all = this.tags().filter(t => t.floorId === this.floorId);
    this.buildMarks(all.filter(t => this.modelFor(t)));
    const tags = all.filter(t => !this.modelFor(t));
    if (!tags.length) return;
    const geo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6).translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), tags.length);
    const elev = new Map(this.venue.floors.map(f => [f.id, f.elevation]));
    const m = new THREE.Matrix4(), c = new THREE.Color();
    tags.forEach((t, i) => {
      m.compose(new THREE.Vector3(t.at.x, elev.get(t.floorId) ?? 0, t.at.z), new THREE.Quaternion(), new THREE.Vector3(1, 1.85, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(t.color ?? this.theme.ink));
    });
    mesh.castShadow = true;
    this.stems = mesh;
    this.scene.add(mesh);
  }

  /** The app's 3D landmark for a place (asked once per place). */
  private modelFor(t: PlaceTag): THREE.Object3D | null {
    if (!this.opts.placeModel) return null;
    if (!this.modelCache.has(t.id)) {
      let m: THREE.Object3D | null = null;
      try { m = this.opts.placeModel(t); } catch { m = null; }
      this.modelCache.set(t.id, m);
    }
    return this.modelCache.get(t.id) ?? null;
  }

  /** Frees the cached landmark models (geometry the app marks userData.shared is left alone). */
  private dropModels() {
    for (const m of this.modelCache.values()) m?.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.geometry.userData.shared) mesh.geometry.dispose();
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(x => { if (!x.userData?.shared) x.dispose(); });
    });
    this.modelCache.clear();
  }

  private clearMarks() {
    if (!this.marks) return;
    this.scene.remove(this.marks.group);
    // Ring, dot and stem are ours; the models belong to the cache (reused on the next build).
    for (const it of this.marks.items) {
      for (const o of [...it.float.children]) it.float.remove(o);
    }
    this.marks.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.geometry.userData.shared) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
    this.marks = null;
  }

  /** Each place as a floating toon landmark over a pulsing ring in its colour, on a thin stem. */
  private buildMarks(tags: PlaceTag[]) {
    if (!tags.length) return;
    const group = new THREE.Group();
    const elev = this.venue.floors.find(f => f.id === this.floorId)?.elevation ?? 0;
    const items: NonNullable<IndoorViewer3D['marks']>['items'] = [];
    const pickables: THREE.Object3D[] = [];
    tags.forEach((t, i) => {
      const model = this.modelFor(t)!;
      const color = new THREE.Color(t.color ?? this.theme.ink);
      const root = new THREE.Group();
      root.position.set(t.at.x, elev, t.at.z);
      // Fit the model to LM_SIZE metres, standing on its own centre.
      model.scale.setScalar(1);
      model.position.set(0, 0, 0);
      const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
      const k = LM_SIZE / Math.max(size.x, size.y, size.z, 0.01);
      model.scale.setScalar(k);
      // Centre it on its stem, whatever its own origin.
      const mid = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
      model.position.set(-mid.x, -mid.y, -mid.z);
      const float = new THREE.Group();
      float.position.y = LM_BASE;
      float.add(model);
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.45, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      halo.position.y = 0.05;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color }));
      dot.position.y = 0.045;
      const stemLen = LM_BASE - LM_SIZE * 0.45;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, stemLen, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }));
      stem.position.y = stemLen / 2;
      root.add(float, halo, dot, stem);
      model.traverse(o => { o.userData.placeId = t.id; if ((o as THREE.Mesh).isMesh) { o.castShadow = true; pickables.push(o); } });
      group.add(root);
      items.push({ id: t.id, float, halo, i, k: 1 });
    });
    this.marks = { group, items, pickables };
    this.scene.add(group);
    this.dirty = true;
  }

  /** Bob, sway and pulse the landmarks; the selected one grows. True while they move. */
  private animateMarks(): boolean {
    const m = this.marks;
    if (!m) return false;
    const show = this.mode !== 'follow' && this.mode !== 'walk';
    m.group.visible = show;
    if (!show) return false;
    const t = this.time;
    for (const it of m.items) {
      const on = it.id === this.selected;
      it.k += ((on ? 1.3 : 1) - it.k) * 0.15;
      it.float.scale.setScalar(it.k);
      it.float.position.y = LM_BASE + (this.reduced ? 0 : Math.sin(t * 1.6 + it.i * 0.9) * 0.08);
      it.float.rotation.y = this.reduced ? 0 : Math.sin(t * 0.5 + it.i) * 0.35;
      const ph = this.reduced ? 0.4 : (t * 0.6 + it.i * 0.13) % 1;
      it.halo.scale.setScalar((1 + ph * 1.6) * (on ? 1.3 : 1));
      (it.halo.material as THREE.MeshBasicMaterial).opacity = (1 - ph) * (on ? 0.95 : 0.6);
    }
    return !this.reduced;
  }

  private bindPointer(el: HTMLCanvasElement) {
    const down = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const up = (e: PointerEvent) => {
      const d = this.down;
      this.down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const cur = this.floors.get(this.floorId)?.built;
      if (this.mode === 'walk') {
        const floorHit = cur ? ray.intersectObjects([...cur.pickables, ...cur.parts.slab], false)[0] : undefined;
        if (floorHit && floorHit.point.y < this.camera.position.y - 0.5) {
          const room = pickRoom(this.venue, this.floorId, { x: floorHit.point.x, z: floorHit.point.z });
          const poi = room ? this.venue.pois.find(p => p.roomId === room.id) : undefined;
          const placeId = room ? [poi?.nodeId, room.nodeId].find(id => id && this.tags().some(x => x.id === id)) : undefined;
          if (placeId) this.walkToPlace(placeId);
          else this.walkToPoint(floorHit.point);
        }
        return;
      }
      // A place's landmark first: it floats above everything else.
      const mark = this.marks?.group.visible ? ray.intersectObjects(this.marks.pickables, false)[0] : undefined;
      if (mark?.object.userData.placeId) { this.pick(mark.object.userData.placeId as string); return; }
      const hit = cur ? ray.intersectObjects(cur.pickables, false)[0] : undefined;
      if (!hit) { this.opts.onSelect?.(null); return; }
      const room = pickRoom(this.venue, this.floorId, { x: hit.point.x, z: hit.point.z });
      if (!room) { this.opts.onSelect?.(null); return; }
      const poi = this.venue.pois.find(p => p.roomId === room.id) ?? null;
      const id = poi?.nodeId ?? room.nodeId ?? poi?.id ?? null;
      this.opts.onSelect?.({ id, poiId: poi?.id ?? null, nodeId: poi?.nodeId ?? room.nodeId, roomId: room.id });
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    this.cleanups.push(() => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointerup', up); });
  }

  private pick(id: string) {
    if (this.mode === 'walk') { this.walkToPlace(id); return; }
    const poi = this.venue.pois.find(p => (p.nodeId ?? p.id) === id || p.id === id) ?? null;
    this.opts.onSelect?.({ id, poiId: poi?.id ?? null, nodeId: poi?.nodeId ?? id, roomId: poi?.roomId ?? null });
  }

  private wallCache: { floor: string; lines: { a: Vec2; b: Vec2 }[] } | null = null;
  private obstaclesOn(floorId: string) { return floorId === this.floorId ? this.wallLines() : obstacles(this.venue, floorId); }
  private wallLines() {
    if (this.wallCache?.floor !== this.floorId) this.wallCache = { floor: this.floorId, lines: obstacles(this.venue, this.floorId) };
    return this.wallCache.lines;
  }

  /** The selected place's room, washed in the accent colour. */
  private updateHighlight() {
    if (this.highlight) { this.scene.remove(this.highlight); this.highlight.geometry.dispose(); (this.highlight.material as THREE.Material).dispose(); this.highlight = null; }
    const id = this.selected;
    if (!id) return;
    const poi = this.venue.pois.find(p => (p.nodeId ?? p.id) === id || p.id === id);
    const room = this.venue.rooms.find(r => (poi?.roomId && r.id === poi.roomId) || (r.nodeId && r.nodeId === id));
    if (!room || room.floorId !== this.floorId) return;
    const y = this.venue.floors.find(f => f.id === room.floorId)?.elevation ?? 0;
    const shape = new THREE.Shape(room.polygon.map(p => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, y + 0.025, 0);
    this.highlight = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: this.theme.accent, transparent: true, opacity: 0.28, depthWrite: false }));
    this.highlight.renderOrder = 5;
    this.scene.add(this.highlight);
    this.dirty = true;
  }

  // ── follow subject ─────────────────────────────────────────────────────────

  private updateSubject() {
    const d = this.director;
    const pose = this.pose;
    if (!d || !pose) return;
    const f = this.venue.floors.find(x => x.id === pose.floorId);
    const p = new THREE.Vector3(pose.at.x, pose.y ?? f?.elevation ?? 0, pose.at.z);
    let dir = new THREE.Vector3(Math.cos(pose.heading ?? 0), 0, Math.sin(pose.heading ?? 0));
    let ahead: THREE.Vector3 | null = null;
    let behind: THREE.Vector3 | null = null;
    let onStairs = false;
    if (this.path) {
      const s = this.progress >= 0 ? this.progress : locateOnPath(this.path, pose.at, pose.floorId).s;
      const here = pointAt(this.path, s), next = pointAt(this.path, s + LOOK_AHEAD);
      ahead = v3(next.p);
      const hd = new THREE.Vector3(next.p.x - here.p.x, 0, next.p.z - here.p.z);
      if (pose.heading == null && hd.lengthSq() > 1e-4) dir = hd.normalize();
      // Before the first few metres, extend the line backwards from the start.
      behind = s >= TRAIL ? v3(pointAt(this.path, s - TRAIL).p) : v3(here.p).addScaledVector(v3(pointAt(this.path, 0).dir).setY(0).normalize(), -(TRAIL - s));
      onStairs = here.kind === 'stairs' || here.kind === 'escalator' || next.kind === 'stairs';
      // Climbing toward another floor: show it, and let the ribbon run up to it.
      const toward = pointAt(this.path, s + 6).floorId;
      const transit = onStairs && toward && toward !== this.floorId ? toward : null;
      if (transit !== this.transit) { this.transit = transit; this.syncFloors(); }
    }
    // Is the way ahead hidden behind a wall (from where the visitor stands)?
    const blocked = !!ahead && this.layers.walls && this.wallLines().some(w => crosses(p.x, p.z, ahead!.x, ahead!.z, w.a, w.b));
    d.setSubject({ p, dir, ahead, behind, onStairs, blocked });
  }

  // ── frame loop ─────────────────────────────────────────────────────────────

  private resize() {
    const w = Math.max(1, this.root.clientWidth), h = Math.max(1, this.root.clientHeight);
    this.size = { w, h };
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(w, h, false);
    if (this.renderer) { this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%'; }
    this.dirty = true;
    if (this.raf === 0) this.loop();
  }

  private loop = () => {
    if (this.raf === -1) return;
    cancelAnimationFrame(this.raf);
    if (!this.visible || document.hidden) { this.raf = 0; return; }
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, this.clock.getDelta());
    this.time += dt;
    const r = this.renderer;
    if (!r || !this.director) return;

    // Floor fades.
    let fading = false;
    for (const s of this.floors.values()) {
      if (!s.built || Math.abs(s.opacity - s.target) < 0.001) continue;
      s.opacity += (s.target - s.opacity) * (this.reduced ? 1 : 1 - Math.exp(-dt * 7));
      if (Math.abs(s.opacity - s.target) < 0.01) s.opacity = s.target;
      this.applyOpacity(s);
      fading = true;
    }
    if (this.mode === 'follow') this.updateSubject();
    const moving = this.director.update(dt, this.floors.get(this.floorId)?.built?.solid ?? []);
    const seeing = this.updateSeeThrough(dt);
    const marking = this.animateMarks();
    const animating = marking || this.ribbon.mesh.visible || this.you.group.visible || this.dest.group.visible || this.spin || !!this.director.guiding;
    if (!(moving || fading || animating || seeing || this.dirty)) return;
    this.dirty = false;

    this.ribbon.update(this.reduced ? 0 : this.time);
    this.you.update(this.time, this.reduced);
    this.dest.update(this.time, this.reduced, this.camera);
    r.render(this.scene, this.camera);
    // Names only for the floor in view — and, walking inside, only those not behind a wall.
    if (this.stems) this.stems.visible = this.mode !== 'follow' && this.mode !== 'walk';
    const inside = this.mode === 'follow' || this.mode === 'walk';
    const eye = this.camera.position;
    const walls = inside ? this.wallLines() : [];
    this.labels.update(this.camera, this.size.w, this.size.h, id => (id === this.floorId ? this.floors.get(id)?.opacity ?? 0 : 0),
      inside ? at => !walls.some(w => crosses(eye.x, eye.z, at.x, at.z, w.a, w.b)) : undefined);
  };
}

const v3 = (p: Point3) => new THREE.Vector3(p.x, p.y, p.z);

/** A point on a walk, and the floor it's on. */
interface WalkPoint { p: THREE.Vector3; floorId: string }
function pushPoint(pts: WalkPoint[], p: THREE.Vector3, floorId: string) {
  const q = pts[pts.length - 1];
  if (!q || q.p.distanceTo(p) > 0.05) pts.push({ p, floorId });
  else if (q.floorId !== floorId) q.floorId = floorId;
}
/** Walking to a place stops this far short of it (about a room's doorway), so the place is in front of you. */
const ARRIVE_SHORT = 2.2;

/** How far along the ray (x,z)+t·(dx,dz) it meets segment ab (null if it doesn't). */
function rayHit(x: number, z: number, dx: number, dz: number, a: Vec2, b: Vec2): number | null {
  const ex = b.x - a.x, ez = b.z - a.z;
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a.x - x) * ez - (a.z - z) * ex) / den;
  const u = ((a.x - x) * dz - (a.z - z) * dx) / den;
  return t > 0.05 && u >= 0 && u <= 1 ? t : null;
}

/** Does the sight line (x0,z0)→(x1,z1) cross wall segment ab? */
function crosses(x0: number, z0: number, x1: number, z1: number, a: Vec2, b: Vec2): boolean {
  const d = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d1 = d(a.x, a.z, b.x, b.z, x0, z0), d2 = d(a.x, a.z, b.x, b.z, x1, z1);
  const d3 = d(x0, z0, x1, z1, a.x, a.z), d4 = d(x0, z0, x1, z1, b.x, b.z);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
