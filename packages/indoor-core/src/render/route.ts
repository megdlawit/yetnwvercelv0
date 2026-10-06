// The route ribbon: a flat band along the 3D route with chevrons gliding
// forward. On stairs it follows the slope just above the step edges, in its
// own colour and with tighter chevrons. The part already walked greys out.

import * as THREE from 'three';
import type { Path3D } from '../path3d';
import type { ViewerTheme } from './theme';

const VERT = /* glsl */ `
attribute float aU;
attribute float aV;
attribute float aKind;
varying float vU;
varying float vV;
varying float vKind;
varying float vY;
#include <clipping_planes_pars_vertex>
void main() {
  vU = aU; vV = aV; vKind = aKind; vY = position.y;
  #include <begin_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uOpacity;
uniform vec3 uColor;
uniform vec3 uStairColor;
uniform vec3 uDoneColor;
uniform float uMaxY;
varying float vY;
varying float vU;
varying float vV;
varying float vKind;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  float stair = step(0.5, vKind) * (1.0 - step(1.5, vKind));
  vec3 base = mix(uColor, uStairColor, stair);
  float spacing = mix(1.5, 0.7, stair);
  float k = mix(0.55, 0.8, stair);
  // Chevrons pointing forward, gliding along.
  float phase = fract((vU + abs(vV) * k * 0.5) / spacing - uTime * 0.9);
  float chev = smoothstep(0.0, 0.07, phase) * (1.0 - smoothstep(0.26, 0.36, phase));
  float edge = 1.0 - smoothstep(0.8, 1.0, abs(vV));
  float rim = smoothstep(0.62, 0.8, abs(vV)) * edge;
  float done = 1.0 - step(uProgress, vU);
  vec3 col = mix(base, vec3(1.0), chev * 0.9 * (1.0 - done));
  col = mix(col, base * 0.72, rim * 0.6);
  col = mix(col, uDoneColor, done * 0.8);
  // Stretches on floors above the one in view fade out (follow view).
  float above = smoothstep(uMaxY - 0.4, uMaxY, vY);
  float a = edge * mix(0.96, 0.38, done) * uOpacity * (1.0 - above);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export class RouteRibbon {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private width = 0.9;

  constructor(theme: ViewerTheme) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, clipping: true,
      uniforms: {
        uTime: { value: 0 }, uProgress: { value: -1 }, uOpacity: { value: 1 }, uMaxY: { value: 1e6 },
        uColor: { value: new THREE.Color(theme.route) }, uStairColor: { value: new THREE.Color(theme.routeStairs) }, uDoneColor: { value: new THREE.Color('#b9beb6') },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  setTheme(theme: ViewerTheme) {
    (this.material.uniforms.uColor.value as THREE.Color).set(theme.route);
    (this.material.uniforms.uStairColor.value as THREE.Color).set(theme.routeStairs);
  }

  set(path: Path3D | null) {
    this.mesh.geometry.dispose();
    this.mesh.geometry = path && path.samples.length > 1 ? ribbonGeometry(path, this.width) : new THREE.BufferGeometry();
    this.mesh.visible = !!path && path.samples.length > 1;
  }

  /** Hide the ribbon above this height (the floors not in view); Infinity shows it all. */
  setMaxY(y: number) { this.material.uniforms.uMaxY.value = Number.isFinite(y) ? y : 1e6; }

  /** Metres already walked (greyed out). */
  setProgress(s: number) { this.material.uniforms.uProgress.value = s; }

  update(time: number) { this.material.uniforms.uTime.value = time; }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}

// Colour class per stretch: 0 flat, 1 climbing, 3 lift (a break). Doors are flat (interpolating 2→0 would pass through 1's colour).
const KIND = { walk: 0, door: 0, stairs: 1, escalator: 1, ramp: 1, elevator: 3 } as const;

/** Build the band: one strip per run of samples, broken at lifts (vertical). */
export function ribbonGeometry(path: Path3D, width: number): THREE.BufferGeometry {
  const pos: number[] = [], u: number[] = [], vv: number[] = [], kind: number[] = [], index: number[] = [];
  const S = path.samples;
  // Lift on the step edges on stairs (they stand up to one riser above the slope line).
  const lift = (i: number) => {
    const onStair = (k: number) => k > 0 && k < S.length && KIND[S[k].kind] === 1;
    return onStair(i) || onStair(i + 1) ? 0.22 : 0.05;
  };
  let strip: number[] = [];
  const flush = () => {
    if (strip.length >= 2) emit(strip);
    strip = [];
  };
  const emit = (ids: number[]) => {
    const base = pos.length / 3;
    for (let j = 0; j < ids.length; j++) {
      const i = ids[j], p = S[i].p;
      const prev = S[ids[Math.max(0, j - 1)]].p, next = S[ids[Math.min(ids.length - 1, j + 1)]].p;
      // Tangent in the floor plane, averaged at corners (mitred, capped).
      let tx = 0, tz = 0;
      const din = Math.hypot(p.x - prev.x, p.z - prev.z), dout = Math.hypot(next.x - p.x, next.z - p.z);
      if (din > 1e-6) { tx += (p.x - prev.x) / din; tz += (p.z - prev.z) / din; }
      if (dout > 1e-6) { tx += (next.x - p.x) / dout; tz += (next.z - p.z) / dout; }
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      let miter = 1;
      if (din > 1e-6 && dout > 1e-6) {
        const cos = ((p.x - prev.x) * (next.x - p.x) + (p.z - prev.z) * (next.z - p.z)) / (din * dout);
        miter = Math.min(2, 1 / Math.max(0.5, Math.sqrt((1 + cos) / 2)));
      }
      const w = ((KIND[S[i].kind] === 1 ? width * 0.8 : width) / 2) * miter;
      const sx = -tz * w, sz = tx * w;
      const y = p.y + lift(i);
      const k = KIND[S[Math.min(S.length - 1, i + (j === 0 ? 1 : 0))].kind];
      pos.push(p.x + sx, y, p.z + sz, p.x - sx, y, p.z - sz);
      u.push(S[i].s, S[i].s); vv.push(1, -1); kind.push(k, k);
      if (j > 0) { const a = base + (j - 1) * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  };
  for (let i = 0; i < S.length; i++) {
    const vertical = i > 0 && KIND[S[i].kind] === 3;
    if (vertical) { flush(); strip.push(i); continue; }
    strip.push(i);
  }
  flush();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(u, 1));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(vv, 1));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
