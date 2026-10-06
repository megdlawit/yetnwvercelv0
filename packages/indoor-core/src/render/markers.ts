// You-are-here (a blue puck with a heading beam and a breathing ring) and
// the destination (a pin over a pulsing ring), drawn in the scene.

import * as THREE from 'three';
import type { ViewerTheme } from './theme';

export class YouMarker {
  readonly group = new THREE.Group();
  private ring: THREE.Mesh;
  private beam: THREE.Mesh;
  private mats: THREE.Material[] = [];

  constructor(theme: ViewerTheme) {
    const blue = new THREE.Color(theme.you);
    const m = (o: THREE.MeshBasicMaterialParameters) => { const x = new THREE.MeshBasicMaterial({ depthWrite: false, transparent: true, ...o }); this.mats.push(x); return x; };
    const flat = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2);
    const halo = new THREE.Mesh(flat(new THREE.CircleGeometry(0.62, 40)), m({ color: blue, opacity: 0.16 }));
    const white = new THREE.Mesh(flat(new THREE.CircleGeometry(0.3, 32)), m({ color: '#ffffff' }));
    const dot = new THREE.Mesh(flat(new THREE.CircleGeometry(0.22, 32)), m({ color: blue }));
    white.position.y = 0.01; dot.position.y = 0.02;
    // Heading: a soft wedge pointing the way the visitor faces (+x before turning).
    const wedge = new THREE.Shape();
    wedge.moveTo(0, 0); wedge.absarc(0, 0, 1.6, -0.45, 0.45, false); wedge.lineTo(0, 0);
    this.beam = new THREE.Mesh(new THREE.ShapeGeometry(wedge, 12).rotateX(-Math.PI / 2), m({ color: blue, opacity: 0.22 }));
    this.beam.position.y = 0.005;
    this.ring = new THREE.Mesh(flat(new THREE.RingGeometry(0.5, 0.58, 40)), m({ color: blue, opacity: 0.5 }));
    this.group.add(halo, this.beam, white, dot, this.ring);
    this.group.renderOrder = 12;
    this.group.traverse(o => { o.renderOrder = 12; });
    this.group.visible = false;
  }

  set(p: { x: number; y: number; z: number } | null, heading: number | null) {
    this.group.visible = !!p;
    if (!p) return;
    this.group.position.set(p.x, p.y + 0.06, p.z);
    this.beam.visible = heading != null;
    // heading: radians in the plan, 0 = +x, clockwise on screen (atan2(dz, dx)).
    if (heading != null) this.beam.rotation.y = -heading;
  }

  update(t: number, reduced: boolean) {
    const k = reduced ? 0.5 : (t * 0.6) % 1;
    this.ring.scale.setScalar(1 + k * 1.4);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k);
  }

  dispose() { this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); for (const m of this.mats) m.dispose(); }
}

export class DestinationMarker {
  readonly group = new THREE.Group();
  private pin = new THREE.Group();
  private ring: THREE.Mesh;
  private mats: THREE.Material[] = [];

  constructor(theme: ViewerTheme) {
    const red = new THREE.Color(theme.destination);
    const std = new THREE.MeshStandardMaterial({ color: red, roughness: 0.35, emissive: red, emissiveIntensity: 0.25 });
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 });
    const ringM = new THREE.MeshBasicMaterial({ color: red, transparent: true, opacity: 0.45, depthWrite: false });
    this.mats.push(std, white, ringM);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16), std);
    head.position.y = 1.7;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 20), std);
    tip.rotation.x = Math.PI; tip.position.y = 1.32;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), white);
    eye.position.set(0, 1.72, 0.26);
    this.pin.add(head, tip, eye);
    this.pin.traverse(o => { o.castShadow = true; });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.62, 40).rotateX(-Math.PI / 2), ringM);
    this.ring.position.y = 0.04;
    this.group.add(this.pin, this.ring);
    this.group.visible = false;
  }

  set(p: { x: number; y: number; z: number } | null) {
    this.group.visible = !!p;
    if (p) this.group.position.set(p.x, p.y, p.z);
  }

  update(t: number, reduced: boolean, camera: THREE.Camera) {
    if (!reduced) {
      this.pin.position.y = Math.sin(t * 2.2) * 0.08;
      const k = (t * 0.55) % 1;
      this.ring.scale.setScalar(1 + k * 1.2);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k);
    }
    // Keep the face of the pin toward the camera.
    const c = camera.position;
    this.pin.rotation.y = Math.atan2(c.x - this.group.position.x, c.z - this.group.position.z);
  }

  dispose() { this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); for (const m of this.mats) m.dispose(); }
}
