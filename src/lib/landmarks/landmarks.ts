// The home page map's floating 3D landmarks — lion, giraffe, throne, palace
// crown, flowers, jacaranda, trees, jebena, book, flag — for any place: the
// same models and toon look (src/landing/scene), built with the app's three.js.

import * as THREE from 'three';
import { ASSETS, LIONGEO } from '@/landing/scene/models';
import type { LandmarkKind } from './kinds';

export { LANDMARK_LABELS, landmarkFor, type LandmarkKind } from './kinds';

const b64 = <T extends ArrayBufferView>(text: string, Ctor: new (buf: ArrayBuffer) => T): T => {
  const s = atob(text), u = new Uint8Array(s.length);
  for (let k = 0; k < s.length; k++) u[k] = s.charCodeAt(k);
  return new Ctor(u.buffer);
};

/** Livelier colours, as the home map does. */
function saturate(attr: THREE.BufferAttribute, ks = 1.3, kl = 1.05) {
  const c = new THREE.Color(), h = { h: 0, s: 0, l: 0 };
  for (let k = 0; k < attr.count; k++) {
    c.setRGB(attr.getX(k), attr.getY(k), attr.getZ(k));
    c.getHSL(h);
    c.setHSL(h.h, Math.min(1, h.s * ks + (ks > 1 ? 0.05 : 0)), Math.min(0.72, h.l * kl + (kl > 1 ? 0.02 : 0)));
    attr.setXYZ(k, c.r, c.g, c.b);
  }
  attr.needsUpdate = true;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function assetGeometry(key: string): THREE.BufferGeometry {
  const hit = geoCache.get(key);
  if (hit) return hit;
  const A = (ASSETS as Record<string, { p: string; c: string; mn: number[]; mx: number[] }>)[key];
  const q = b64(A.p, Int16Array), fc = b64(A.c, Uint8Array), n = q.length / 3;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) {
    pos[k * 3 + a] = A.mn[a] + ((q[k * 3 + a] + 32768) / 65535) * (A.mx[a] - A.mn[a]);
    col[k * 3 + a] = fc[Math.floor(k / 3) * 3 + a] / 255;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const [ks, kl] = ({ '1': [1.0, 0.8], '8': [0.85, 0.97], '3': [1.15, 0.86] } as Record<string, number[]>)[key] ?? [1.3, 1.05];
  saturate(geo.attributes.color as THREE.BufferAttribute, ks, kl);
  geo.computeVertexNormals();
  geo.userData.shared = true;
  geoCache.set(key, geo);
  return geo;
}

function lionGeometry(): THREE.BufferGeometry {
  const hit = geoCache.get('lion');
  if (hit) return hit;
  const L = LIONGEO as { p: string; uv: string; i: string; c: string };
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(b64(L.p, Float32Array), 3));
  geo.setIndex(new THREE.BufferAttribute(b64(L.i, Uint16Array), 1));
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  const fc = b64(L.c, Uint8Array), n = geo.attributes.position.count, cc = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) { const f = Math.floor(k / 3); for (let q = 0; q < 3; q++) cc[k * 3 + q] = fc[f * 3 + q] / 255; }
  geo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  saturate(geo.attributes.color as THREE.BufferAttribute);
  geo.userData.shared = true;
  geoCache.set('lion', geo);
  return geo;
}

const toonRamp = (() => {
  let t: THREE.DataTexture | null = null;
  return () => {
    if (t) return t;
    t = new THREE.DataTexture(new Uint8Array([115, 175, 225]), 3, 1, THREE.RedFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  };
})();

const toon = (o: { color?: string; vertexColors?: boolean; emissive?: number }) => new THREE.MeshToonMaterial({
  color: o.vertexColors ? '#ffffff' : o.color ?? '#ffffff', vertexColors: !!o.vertexColors, gradientMap: toonRamp(), side: THREE.DoubleSide,
  emissive: o.vertexColors ? '#ffffff' : o.color ?? '#000000', emissiveIntensity: o.emissive ?? (o.vertexColors ? 0.03 : 0.12),
});

const outlineMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide });
outlineMat.userData.shared = true; // one for every landmark: never disposed with a model

/** A white outline round a mesh (the toon look of the procedural landmarks). */
function outline(m: THREE.Mesh) {
  m.geometry.computeBoundingSphere();
  const s = m.geometry.boundingSphere!;
  const r = s.radius || 0.1;
  const ol = new THREE.Mesh(m.geometry, outlineMat);
  ol.scale.setScalar((r + 0.05) / r);
  ol.position.copy(s.center).multiplyScalar(-(ol.scale.x - 1));
  m.add(ol);
}

function part(g: THREE.Group, geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, toon({ color }));
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true;
  outline(m);
  g.add(m);
  return m;
}

function asset(g: THREE.Group, key: string, ry: number, sc: number, yo = 0) {
  const m = new THREE.Mesh(assetGeometry(key), toon({ vertexColors: true }));
  m.rotation.y = ry; m.scale.setScalar(sc); m.position.y = yo; m.castShadow = true;
  g.add(m);
}

/** A landmark model, about 1 unit tall, centred on the origin. */
export function buildLandmark(kind: LandmarkKind, color = '#16a34a'): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'lion': { const m = new THREE.Mesh(lionGeometry(), toon({ vertexColors: true, emissive: 0.08 })); m.scale.setScalar(1.15); g.add(m); break; }
    case 'giraffe': asset(g, '9', -0.7, 2.0); break;
    case 'throne': asset(g, '6', 0.35, 1.35); break;
    case 'crown': asset(g, '4', 0, 1.25); break;
    case 'flowers': asset(g, '8', 0, 1.5); break;
    case 'jacaranda': asset(g, '3', 0, 1.25); break;
    case 'trees': asset(g, '1', 0.785, 1.45, 0.15); break;
    case 'jebena': asset(g, '7', -1.5708, 1.25, 0.6); break;
    case 'book':
      for (const s of [-1, 1]) {
        const p = new THREE.Group(); p.rotation.z = s * 0.28; g.add(p);
        part(p, new THREE.BoxGeometry(0.5, 0.04, 0.66), '#6b3a24', s * 0.26, -0.02, 0);
        part(p, new THREE.BoxGeometry(0.46, 0.07, 0.6), '#fbf6ea', s * 0.25, 0.03, 0);
      }
      part(g, new THREE.CylinderGeometry(0.02, 0.02, 0.66, 6), '#6b3a24', 0, -0.02, 0, Math.PI / 2);
      break;
    case 'flag': {
      part(g, new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8), '#d9d4c8', -0.38, -0.05, 0);
      part(g, new THREE.SphereGeometry(0.05, 10, 8), '#e8b53a', -0.38, 0.57, 0);
      const geo = new THREE.PlaneGeometry(0.8, 0.54, 16, 6), pp = geo.attributes.position, cols: number[] = [];
      for (let i = 0; i < pp.count; i++) {
        const x = pp.getX(i), y = pp.getY(i);
        pp.setZ(i, Math.sin((x + 0.4) * 5) * 0.06 * (x + 0.4));
        const c = new THREE.Color(y > 0.09 ? '#1f9a45' : y < -0.09 ? '#d6303a' : '#f2c62e');
        cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, toon({ vertexColors: true })); m.position.set(0.02, 0.28, 0); g.add(m);
      part(g, new THREE.CircleGeometry(0.11, 24), '#2f5fb3', 0.04, 0.28, 0.06);
      break;
    }
    case 'bag':
      part(g, new THREE.BoxGeometry(0.62, 0.62, 0.3), color, 0, 0, 0);
      part(g, new THREE.TorusGeometry(0.16, 0.035, 8, 20, Math.PI), '#2b1d12', 0, 0.31, 0);
      break;
    default: {
      // A map pin in the place's colour.
      part(g, new THREE.SphereGeometry(0.34, 20, 14), color, 0, 0.22, 0);
      part(g, new THREE.ConeGeometry(0.22, 0.5, 18), color, 0, -0.22, 0, Math.PI);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), toon({ color: '#ffffff' })); dot.position.set(0, 0.24, 0.27); g.add(dot);
    }
  }
  return g;
}
