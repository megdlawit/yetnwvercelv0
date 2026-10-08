// A small 3D map in the home page's style: a floating island, the plan or
// routes drawn on it, and each place as a floating toon landmark (lion,
// giraffe, throne, crown…) bobbing over a pulsing ring in its colour. Drag
// to turn, scroll to zoom, click a landmark to pick it.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildLandmark, type LandmarkKind } from '@/lib/landmarks/landmarks';

export interface LandmarkItem {
  id: string;
  name: string;
  /** Plan position, any units (the map fits whatever it's given). */
  x: number;
  y: number;
  color: string;
  kind: LandmarkKind;
  /** A second line on its label. */
  sub?: string | null;
  /** Shown smaller and dimmer (e.g. hidden from visitors). */
  muted?: boolean;
}
export interface LandmarkLine { id: string; points: { x: number; y: number }[]; color: string; width?: number }
export interface LandmarkArea { id: string; points: { x: number; y: number }[]; color: string }

const ISLAND_TOP = '#9edc7e', ISLAND_SIDE = '#e7d3a1', WALL = '#f6f2e8';
const SIZE = 36; // the island's long side, in scene units

export default function LandmarkMap({ items, lines = [], areas = [], walls = [], selectedId, onSelect, className, emptyText }: {
  items: LandmarkItem[];
  lines?: LandmarkLine[];
  areas?: LandmarkArea[];
  /** The plan's walls, as context. */
  walls?: { x1: number; y1: number; x2: number; y2: number }[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  className?: string;
  emptyText?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const api = useRef<{ select: (id: string | null) => void } | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Build the scene whenever the content changes.
  useEffect(() => {
    const el = host.current, lab = labels.current;
    if (!el || !lab) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // Fit everything to the island.
    const pts = [...items.map(i => ({ x: i.x, y: i.y })), ...lines.flatMap(l => l.points), ...areas.flatMap(a => a.points), ...walls.flatMap(w => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }])];
    const minX = pts.length ? Math.min(...pts.map(p => p.x)) : 0, maxX = pts.length ? Math.max(...pts.map(p => p.x)) : 1;
    const minY = pts.length ? Math.min(...pts.map(p => p.y)) : 0, maxY = pts.length ? Math.max(...pts.map(p => p.y)) : 1;
    const span = Math.max(maxX - minX, maxY - minY, 1e-6);
    const k = SIZE / span, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const W = (p: { x: number; y: number }) => new THREE.Vector3((p.x - cx) * k, 0, (p.y - cy) * k);
    const halfW = Math.max(6, ((maxX - minX) * k) / 2 + 5), halfD = Math.max(6, ((maxY - minY) * k) / 2 + 5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#eef4ea', 80, 160);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.44; controls.minDistance = 10; controls.maxDistance = 120;
    controls.autoRotate = !reduced; controls.autoRotateSpeed = 0.35;
    controls.addEventListener('start', () => { controls.autoRotate = false; });
    const fit = Math.max(halfW, halfD);
    camera.position.set(fit * 0.95, fit * 1.05, fit * 1.2);
    controls.target.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight('#ffffff', '#b7c9a8', 1.15));
    const sun = new THREE.DirectionalLight('#fff7e6', 1.5);
    sun.position.set(-fit, fit * 2, fit * 0.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -fit * 1.4, right: fit * 1.4, top: fit * 1.4, bottom: -fit * 1.4, near: 1, far: fit * 6 });
    scene.add(sun);

    // The island: a rounded slab, grass on top, sand on the sides.
    const shape = new THREE.Shape();
    const r = Math.min(halfW, halfD) * 0.35;
    shape.moveTo(-halfW + r, -halfD); shape.lineTo(halfW - r, -halfD); shape.quadraticCurveTo(halfW, -halfD, halfW, -halfD + r);
    shape.lineTo(halfW, halfD - r); shape.quadraticCurveTo(halfW, halfD, halfW - r, halfD); shape.lineTo(-halfW + r, halfD);
    shape.quadraticCurveTo(-halfW, halfD, -halfW, halfD - r); shape.lineTo(-halfW, -halfD + r); shape.quadraticCurveTo(-halfW, -halfD, -halfW + r, -halfD);
    const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.6, bevelSegments: 3 });
    slabGeo.rotateX(Math.PI / 2);
    const slab = new THREE.Mesh(slabGeo, [new THREE.MeshStandardMaterial({ color: ISLAND_TOP, roughness: 1 }), new THREE.MeshStandardMaterial({ color: ISLAND_SIDE, roughness: 1 })]);
    slab.position.y = -0.62; slab.receiveShadow = true; // the bevel lifts the top by 0.6
    scene.add(slab);

    // Scattered low-poly trees round the edge, as on the home map.
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const treeMat = [new THREE.MeshStandardMaterial({ color: '#4caf50', flatShading: true }), new THREE.MeshStandardMaterial({ color: '#2e8b57', flatShading: true })];
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#8a6a4c' });
    for (let i = 0; i < Math.round((halfW + halfD) * 1.1); i++) {
      const edge = rnd() < 0.5;
      const x = edge ? (rnd() < 0.5 ? -1 : 1) * (halfW - 1.2 - rnd() * 1.5) : (rnd() * 2 - 1) * (halfW - 1.5);
      const z = edge ? (rnd() * 2 - 1) * (halfD - 1.5) : (rnd() < 0.5 ? -1 : 1) * (halfD - 1.2 - rnd() * 1.5);
      const s = 0.6 + rnd() * 0.6;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.6 * s, 1.5 * s, 7), treeMat[i % 2]);
      crown.position.set(x, 1.25 * s, z); crown.castShadow = true;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s, 0.1 * s, 0.6 * s, 6), trunkMat);
      trunk.position.set(x, 0.3 * s, z);
      scene.add(crown, trunk);
    }

    // The plan's walls as low white blocks.
    if (walls.length) {
      const wm = new THREE.MeshStandardMaterial({ color: WALL, roughness: 0.9 });
      for (const w of walls) {
        const a = W({ x: w.x1, y: w.y1 }), b = W({ x: w.x2, y: w.y2 });
        const len = a.distanceTo(b);
        if (len < 0.05) continue;
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.55, 0.14), wm);
        m.position.set((a.x + b.x) / 2, 0.28, (a.z + b.z) / 2);
        m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
        m.castShadow = m.receiveShadow = true;
        scene.add(m);
      }
    }
    // Areas: soft coloured patches.
    for (const ar of areas) {
      if (ar.points.length < 3) continue;
      const s = new THREE.Shape(ar.points.map(p => { const v = W(p); return new THREE.Vector2(v.x, -v.z); }));
      const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); g.translate(0, 0.03, 0);
      scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: ar.color, transparent: true, opacity: 0.35, depthWrite: false })));
    }
    // Lines: glowing tubes (routes, paths).
    for (const ln of lines) {
      if (ln.points.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(ln.points.map(p => W(p).setY(0.18)), false, 'centripetal', 0.2);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, ln.points.length * 8), (ln.width ?? 1) * 0.16, 8, false),
        new THREE.MeshStandardMaterial({ color: ln.color, emissive: ln.color, emissiveIntensity: 0.45, roughness: 0.5 }));
      tube.castShadow = true;
      scene.add(tube);
    }

    // The landmarks.
    const pickables: THREE.Object3D[] = [];
    const marks = items.map((it, i) => {
      const root = new THREE.Group();
      const at = W(it);
      root.position.copy(at);
      const model = buildLandmark(it.kind, it.color);
      const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
      const scale = (it.muted ? 2.6 : 3.8) / Math.max(size.x, size.y, size.z, 0.01);
      model.scale.multiplyScalar(scale);
      const float = new THREE.Group();
      float.add(model);
      const base = it.muted ? 2.8 : 4.2;
      float.position.y = base;
      root.add(float);
      // The halo on the ground, and a thin stem up to the landmark.
      const halo = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.32, 48), new THREE.MeshBasicMaterial({ color: it.color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      halo.rotation.x = -Math.PI / 2; halo.position.y = 0.06;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: it.color }));
      dot.rotation.x = -Math.PI / 2; dot.position.y = 0.05;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, base - 0.6, 6), new THREE.MeshBasicMaterial({ color: it.color, transparent: true, opacity: 0.55 }));
      stem.position.y = (base - 0.6) / 2;
      root.add(halo, dot, stem);
      model.traverse(o => { o.userData.mark = it.id; if ((o as THREE.Mesh).isMesh) pickables.push(o); });
      scene.add(root);
      return { it, i, root, float, halo, base, k: 1 };
    });

    // Labels.
    const tags = new Map<string, HTMLButtonElement>();
    lab.replaceChildren();
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lm-tag';
      b.style.setProperty('--c', it.color);
      b.innerHTML = '';
      const name = document.createElement('b'); name.textContent = it.name; b.appendChild(name);
      if (it.sub) { const s = document.createElement('small'); s.textContent = it.sub; b.appendChild(s); }
      b.addEventListener('click', e => { e.stopPropagation(); onSelectRef.current?.(it.id); });
      lab.appendChild(b);
      tags.set(it.id, b);
    }

    let selected: string | null = null, hovered: string | null = null;
    const flyTo = new THREE.Vector3(), flyTarget = { on: false };
    api.current = {
      select: id => {
        selected = id;
        const m = marks.find(x => x.it.id === id);
        if (m) { flyTo.copy(m.root.position); flyTarget.on = true; controls.autoRotate = false; }
      },
    };

    // Picking.
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    const hit = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return (ray.intersectObjects(pickables, false)[0]?.object.userData.mark as string | undefined) ?? null;
    };
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const pu = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      onSelectRef.current?.(hit(e));
    };
    const pm = (e: PointerEvent) => { hovered = hit(e); renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab'; };
    renderer.domElement.addEventListener('pointerdown', pd);
    renderer.domElement.addEventListener('pointerup', pu);
    renderer.domElement.addEventListener('pointermove', pm);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`; renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const v = new THREE.Vector3();
    let raf = 0;
    const clock = new THREE.Clock();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const t = clock.getElapsedTime();
      if (flyTarget.on) {
        controls.target.lerp(flyTo, 0.08);
        if (controls.target.distanceTo(flyTo) < 0.05) flyTarget.on = false;
      }
      controls.update();
      for (const m of marks) {
        const on = m.it.id === selected || m.it.id === hovered;
        m.k += ((on ? 1.25 : 1) - m.k) * 0.15;
        m.float.scale.setScalar(m.k);
        m.float.position.y = m.base + (reduced ? 0 : Math.sin(t * 1.6 + m.i * 0.9) * 0.18);
        m.float.rotation.y = reduced ? 0 : Math.sin(t * 0.5 + m.i) * 0.35;
        const ph = reduced ? 0.4 : (t * 0.6 + m.i * 0.13) % 1;
        m.halo.scale.setScalar((1.6 + ph * 2.4) * (on ? 1.3 : 1));
        (m.halo.material as THREE.MeshBasicMaterial).opacity = (1 - ph) * (on ? 0.95 : 0.55);
      }
      renderer.render(scene, camera);
      // Labels follow their landmarks; the selected and hovered ones always show.
      const w = el.clientWidth, h = el.clientHeight, many = items.length > 8;
      for (const m of marks) {
        const tag = tags.get(m.it.id)!;
        v.copy(m.root.position); v.y += m.base + 2.4;
        v.project(camera);
        const show = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && (!many || m.it.id === selected || m.it.id === hovered);
        tag.style.visibility = show ? 'visible' : 'hidden';
        if (!show) continue;
        tag.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
        tag.classList.toggle('on', m.it.id === selected);
        tag.style.zIndex = m.it.id === selected ? '5' : String(Math.round((1 - v.z) * 1000));
      }
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pd);
      renderer.domElement.removeEventListener('pointerup', pu);
      renderer.domElement.removeEventListener('pointermove', pm);
      scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
      lab.replaceChildren();
      api.current = null;
    };
  }, [items, lines, areas, walls]);

  useEffect(() => { api.current?.select(selectedId ?? null); }, [selectedId, items]);

  return (
    <div className={`relative overflow-hidden rounded-3xl ${className ?? ''}`}
      style={{ background: 'radial-gradient(120% 90% at 50% 10%, #f8fbf4 0%, #e6f0df 55%, #d7e6cf 100%)' }}>
      <style>{`
        .lm-tag{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:1px;padding:4px 10px;border:0;border-radius:999px;
          background:rgba(255,255,255,.95);color:#0f3d26;font:600 11.5px/1.2 Inter,system-ui,sans-serif;white-space:nowrap;cursor:pointer;
          box-shadow:0 6px 16px rgba(15,40,25,.18);pointer-events:auto;will-change:transform}
        .lm-tag b{font-weight:700;display:flex;align-items:center;gap:5px}
        .lm-tag b::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--c)}
        .lm-tag small{font-size:10px;font-weight:600;color:#6b7168}
        .lm-tag.on{background:#0f3d26;color:#fff}.lm-tag.on small{color:rgba(255,255,255,.75)}
      `}</style>
      <div ref={host} className="absolute inset-0" />
      <div ref={labels} className="pointer-events-none absolute inset-0" />
      {!items.length && !lines.length && emptyText && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm font-medium text-[#3f5a45]">{emptyText}</div>
      )}
    </div>
  );
}
