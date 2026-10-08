// The renderer's colours. Defaults are the Indoor design language (paper,
// ink, lime — the landing page); venues override them with their theme.

import * as THREE from 'three';
import type { FloorMaterial, WallMaterial } from '../model';

export interface ViewerTheme {
  /** Background and fog. */
  sky: string;
  /** The ground around the building (scenery). */
  ground: string;
  /** Floor slabs and ceilings. */
  slab: string;
  /** Plaster walls. */
  wall: string;
  /** Door frames, rails and other trim. */
  trim: string;
  /** Walkways (paths layer). */
  path: string;
  /** Route ribbon, and on stairs. */
  route: string;
  routeStairs: string;
  /** You-are-here and destination. */
  you: string;
  destination: string;
  treeA: string;
  treeB: string;
  wood: string;
  glass: string;
  /** Ink: label text and primary UI. */
  ink: string;
  /** Lime: highlights. */
  accent: string;
}

export const INDOOR_THEME: ViewerTheme = {
  sky: '#f8f6f1', ground: '#dfe8d5', slab: '#f1ede4', wall: '#fbfaf6', trim: '#d9d2c3', path: '#8fd06a',
  route: '#2fbf5a', routeStairs: '#f0a020', you: '#2f6bff', destination: '#d9483b',
  treeA: '#5fae6a', treeB: '#4c9a5c', wood: '#b7834f', glass: '#bfe3f2', ink: '#0f3d26', accent: '#3fdc2c',
};

/** Room floors tinted by the editor's room type (tile floors only), as the 2D plan colours them. */
export const ROOM_TINTS: Record<string, string> = {
  office: '#e9efe6', meeting: '#e3ecf5', entrance: '#cfeccf', stairs: '#f6dcd6',
  elevator: '#d8e3fa', restroom: '#d6efee', reception: '#f7ecd0', utility: '#e6e4e0',
};

const WALL_COLORS: Record<WallMaterial, string | null> = {
  plaster: null, brick: '#b4644a', concrete: '#c4c0b6', glass: null, wood: '#a87a4f', stone: '#d6c9ad',
};
const FLOOR_COLORS: Record<FloorMaterial, string> = {
  tile: '#efeae0', wood: '#c99d6e', carpet: '#8f9c8c', concrete: '#cfccc4', stone: '#d8cdb8', marble: '#f2efe9', grass: '#a3cf8f',
};

/** A procedural texture (tiles, planks), repeating once per metre. */
function canvasTexture(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 256): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Textures shared by every floor's materials (made once per viewer). */
export class TextureSet {
  readonly tile: THREE.Texture | null;
  readonly plank: THREE.Texture | null;
  /**
   * The see-through window (one per viewer): walls within `uXrayR` of the
   * line from the eye (A) to what you're looking for (B) aren't drawn.
   */
  readonly xray = { uXrayA: { value: new THREE.Vector3() }, uXrayB: { value: new THREE.Vector3() }, uXrayR: { value: 0 } };
  constructor() {
    // Tiles: 2 per metre, a hair of grout.
    this.tile = canvasTexture((g, s) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(80,70,50,.10)'; g.lineWidth = 3;
      for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(0, (i * s) / 2); g.lineTo(s, (i * s) / 2); g.stroke(); g.beginPath(); g.moveTo((i * s) / 2, 0); g.lineTo((i * s) / 2, s); g.stroke(); }
    });
    // Planks: 6 per metre, staggered joints.
    this.plank = canvasTexture((g, s) => {
      const n = 6, h = s / n;
      for (let i = 0; i < n; i++) {
        const shade = 235 + ((i * 37) % 20);
        g.fillStyle = `rgb(${shade},${shade - 8},${shade - 22})`; g.fillRect(0, i * h, s, h);
        g.fillStyle = 'rgba(60,40,20,.14)'; g.fillRect(0, i * h, s, 1.5);
        const j = ((i * 0.37) % 1) * s; g.fillRect(j, i * h, 1.5, h);
      }
    });
  }
  dispose() { this.tile?.dispose(); this.plank?.dispose(); }
}

/** One floor's materials (each floor has its own, so a floor can be faded on its own). */
export class MaterialLibrary {
  private cache = new Map<string, THREE.Material>();
  private tile: THREE.Texture | null;
  private plank: THREE.Texture | null;

  private xray: TextureSet['xray'];

  constructor(public theme: ViewerTheme, textures: TextureSet) {
    this.tile = textures.tile;
    this.plank = textures.plank;
    this.xray = textures.xray;
  }

  /** Walls, trim, doors, glass, rails: open a soft round window toward what the visitor is looking for. */
  private seeThrough<T extends THREE.Material>(m: T): T {
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.xray);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vXrayW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvXrayW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vXrayW;\nuniform vec3 uXrayA;\nuniform vec3 uXrayB;\nuniform float uXrayR;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (uXrayR > 0.0) {
    vec3 xab = uXrayB - uXrayA;
    float xt = dot(vXrayW - uXrayA, xab) / max(dot(xab, xab), 1e-4);
    if (xt > 0.0 && xt < 1.0) {
      float xd = length(vXrayW - (uXrayA + xab * xt));
      float xr = uXrayR * min(1.0, xt * 5.0) * min(1.0, (1.0 - xt) * 10.0);
      float xn = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
      if (xd < xr * mix(0.78, 1.0, xn)) discard;
    }
  }`);
    };
    m.customProgramCacheKey = () => 'ivw-see-through';
    return m;
  }

  private get<T extends THREE.Material>(key: string, make: () => T): T {
    let m = this.cache.get(key) as T | undefined;
    if (!m) {
      m = make();
      if (/^(wall|cap):|^(trim|wood|glass|metal)$/.test(key)) this.seeThrough(m);
      this.cache.set(key, m);
    }
    return m;
  }

  wall(material: WallMaterial): THREE.MeshStandardMaterial {
    return this.get(`wall:${material}`, () => material === 'glass'
      ? new THREE.MeshStandardMaterial({ color: this.theme.glass, transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0.1, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: WALL_COLORS[material] ?? this.theme.wall, roughness: material === 'concrete' ? 0.95 : 0.85 }));
  }

  floor(material: FloorMaterial, tint?: string | null): THREE.MeshStandardMaterial {
    return this.get(`floor:${material}:${tint ?? ''}`, () => {
      const map = material === 'tile' || material === 'marble' ? this.tile : material === 'wood' ? this.plank : null;
      return new THREE.MeshStandardMaterial({ color: tint ?? (material === 'tile' ? this.theme.slab : FLOOR_COLORS[material]), map, roughness: material === 'marble' ? 0.35 : 0.9, polygonOffset: true, polygonOffsetFactor: -1 });
    });
  }

  /** The darker strip along a wall's top. */
  cap(material: WallMaterial): THREE.MeshStandardMaterial {
    return this.get(`cap:${material}`, () => {
      const w = this.wall(material);
      return new THREE.MeshStandardMaterial({ color: w.color.clone().multiplyScalar(0.78), roughness: 0.8, transparent: w.transparent, opacity: w.opacity });
    });
  }

  slab() { return this.get('slab', () => new THREE.MeshStandardMaterial({ color: this.theme.slab, roughness: 0.95 })); }
  /** Seen only from below (FrontSide facing down), so the overview looks straight in. */
  ceiling() { return this.get('ceiling', () => new THREE.MeshStandardMaterial({ color: '#fbf9f4', roughness: 1, emissive: '#efe9dd', emissiveIntensity: 0.62 })); }
  ground() { return this.get('ground', () => new THREE.MeshStandardMaterial({ color: this.theme.ground, roughness: 1 })); }
  trim() { return this.get('trim', () => new THREE.MeshStandardMaterial({ color: this.theme.trim, roughness: 0.6 })); }
  wood() { return this.get('wood', () => new THREE.MeshStandardMaterial({ color: this.theme.wood, roughness: 0.7 })); }
  glass() { return this.get('glass', () => new THREE.MeshStandardMaterial({ color: this.theme.glass, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2, depthWrite: false })); }
  metal() { return this.get('metal', () => new THREE.MeshStandardMaterial({ color: '#9aa3a6', roughness: 0.35, metalness: 0.6 })); }
  step() { return this.get('step', () => new THREE.MeshStandardMaterial({ color: '#e4dccb', roughness: 0.8 })); }
  path() { return this.get('path', () => new THREE.MeshStandardMaterial({ color: this.theme.path, roughness: 0.9, transparent: true, opacity: 0.85 })); }
  treeA() { return this.get('treeA', () => new THREE.MeshStandardMaterial({ color: this.theme.treeA, roughness: 0.9, flatShading: true })); }
  treeB() { return this.get('treeB', () => new THREE.MeshStandardMaterial({ color: this.theme.treeB, roughness: 0.9, flatShading: true })); }
  bark() { return this.get('bark', () => new THREE.MeshStandardMaterial({ color: '#8a6a4c', roughness: 1 })); }
  stone() { return this.get('stone', () => new THREE.MeshStandardMaterial({ color: '#cfc6b3', roughness: 0.9 })); }
  /** A plain coloured material for scenery (flowers, water, lamps…), shared per colour. */
  paint(color: string, o: { opacity?: number; roughness?: number; emissive?: number; flat?: boolean } = {}) {
    return this.get(`paint:${color}:${o.opacity ?? 1}:${o.emissive ?? 0}`, () => new THREE.MeshStandardMaterial({
      color, roughness: o.roughness ?? 0.8, flatShading: !!o.flat,
      transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1, depthWrite: (o.opacity ?? 1) >= 1,
      emissive: o.emissive ? color : '#000000', emissiveIntensity: o.emissive ?? 0,
    }));
  }

  /** Every material, for per-floor ghosting and clean-up. */
  all(): THREE.Material[] { return [...this.cache.values()]; }

  /** Fade the whole floor (1 = solid). */
  setOpacity(opacity: number) {
    for (const m of this.cache.values()) {
      const base = (m.userData.baseOpacity ??= m.opacity) as number;
      const baseT = (m.userData.baseTransparent ??= m.transparent) as boolean;
      const baseD = (m.userData.baseDepthWrite ??= m.depthWrite) as boolean;
      m.opacity = base * opacity;
      const transparent = baseT || opacity < 1;
      // Recompile only when blending actually switches, not every frame of a fade.
      if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; }
      m.depthWrite = opacity < 1 ? false : baseD;
    }
  }

  /** Cut walls off at a height (section view); null = whole walls. */
  setClip(planes: THREE.Plane[] | null) {
    for (const [k, m] of this.cache) if (k.startsWith('wall:') || k.startsWith('cap:') || k === 'trim' || k === 'glass' || k === 'wood') { m.clippingPlanes = planes; m.needsUpdate = true; }
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}
