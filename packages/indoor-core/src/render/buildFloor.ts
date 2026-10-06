// One floor as 3D: walls with real door and window openings, floor slab
// (with stairwells cut out), room floors, ceilings, stairs and lifts up to
// the next floor, scenery and walkways. Geometry is merged per material, so
// a floor is a handful of draw calls however big the venue.
//
// Built in the floor's own frame (y = 0 at its surface); the viewer lifts
// the group to the floor's elevation.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { IndoorConnector, IndoorFloor, IndoorOpening, IndoorVenue, IndoorWall, Vec2 } from '../model';
import { add, dist, pointInPolygon, rectCorners, rot, scale, sub, v } from '../geometry';
import { ROOM_TINTS, type MaterialLibrary } from './theme';

export type LayerId = 'walls' | 'rooms' | 'objects' | 'labels' | 'paths' | 'otherFloors' | 'scenery';
export type Layers = Record<LayerId, boolean>;
export const DEFAULT_LAYERS: Layers = { walls: true, rooms: true, objects: true, labels: true, paths: false, otherFloors: true, scenery: true };

export interface BuiltFloor {
  floorId: string;
  group: THREE.Group;
  mats: MaterialLibrary;
  /** Meshes per layer, so layers toggle without a rebuild. */
  parts: Record<'walls' | 'rooms' | 'objects' | 'paths' | 'scenery' | 'ceilings' | 'slab', THREE.Object3D[]>;
  /** Room floors, for tapping a room. */
  pickables: THREE.Mesh[];
  /** Walls, for keeping the follow camera on the visitor's side of them. */
  solid: THREE.Mesh[];
  dispose(): void;
}

const SLAB = 0.22;
/** Door leaves stand almost fully open, flat against the wall — out of the way of anyone walking through. */
const OPEN_ANGLE = (168 * Math.PI) / 180;

// ── geometry helpers ─────────────────────────────────────────────────────────

/** A box of size (w × h × d), centred at (x, y, z), turned to run along `angle` (radians in the plan). */
function box(w: number, h: number, d: number, x: number, y: number, z: number, angle = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001));
  if (angle) g.rotateY(-angle);
  g.translate(x, y, z);
  return g;
}

/** A flat polygon at height y, facing up (or down for ceilings). */
function flat(poly: Vec2[], y: number, down = false): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map(p => new THREE.Vector2(p.x, down ? p.z : -p.z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

class Bucket {
  private list = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(m: THREE.Material, g: THREE.BufferGeometry) { (this.list.get(m) ?? this.list.set(m, []).get(m)!).push(g); }
  /** One mesh per material. */
  meshes(opts: { cast?: boolean; receive?: boolean } = {}): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [m, gs] of this.list) {
      if (!gs.length) continue;
      const indexed = gs.filter(g => g.index), plain = gs.filter(g => !g.index);
      for (const group of [indexed, plain]) {
        if (!group.length) continue;
        const merged = group.length === 1 ? group[0] : mergeGeometries(group, false);
        if (group.length > 1) for (const g of group) g.dispose();
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, m);
        mesh.castShadow = !!opts.cast; mesh.receiveShadow = !!opts.receive;
        out.push(mesh);
      }
    }
    this.list.clear();
    return out;
  }
}

// ── the floor ────────────────────────────────────────────────────────────────

export function buildFloor(venue: IndoorVenue, floor: IndoorFloor, mats: MaterialLibrary): BuiltFloor {
  const group = new THREE.Group();
  group.name = `floor:${floor.id}`;
  const parts: BuiltFloor['parts'] = { walls: [], rooms: [], objects: [], paths: [], scenery: [], ceilings: [], slab: [] };
  const pickables: THREE.Mesh[] = [];
  const elevation = new Map(venue.floors.map(f => [f.id, f.elevation]));
  const ceilingOf = new Map(venue.floors.map(f => [f.id, f.ceilingHeight]));

  const walls = venue.walls.filter(w => w.floorId === floor.id);
  const rooms = venue.rooms.filter(r => r.floorId === floor.id);
  const nodes = venue.nodes.filter(n => n.floorId === floor.id);
  const openings = venue.openings.filter(o => o.floorId === floor.id);
  const props = venue.props.filter(p => p.floorId === floor.id);
  const climbing = venue.connectors.filter(c => c.fromFloorId === floor.id);
  const arriving = venue.connectors.filter(c => c.toFloorId === floor.id);

  // Slab: the floor's extent, with stairwells and lift shafts from below cut out.
  const pts: Vec2[] = [...walls.flatMap(w => [w.a, w.b]), ...rooms.flatMap(r => r.polygon), ...nodes.map(n => n.at), ...climbing.flatMap(c => [c.bottom, c.top])];
  if (pts.length) {
    const m = 0.4;
    const minX = Math.min(...pts.map(p => p.x)) - m, maxX = Math.max(...pts.map(p => p.x)) + m;
    const minZ = Math.min(...pts.map(p => p.z)) - m, maxZ = Math.max(...pts.map(p => p.z)) + m;
    const shape = new THREE.Shape([new THREE.Vector2(minX, -minZ), new THREE.Vector2(maxX, -minZ), new THREE.Vector2(maxX, -maxZ), new THREE.Vector2(minX, -maxZ)]);
    for (const c of arriving) {
      const hole = rectCorners(c.center, c.width + 0.1, Math.max(c.depth, 0.5) + 0.1, c.dir);
      shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p.x, -p.z))));
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: SLAB, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -SLAB, 0);
    const slab = new THREE.Mesh(g, mats.slab());
    slab.receiveShadow = true;
    parts.slab.push(slab);

    // Scenery: the ground around the building (lowest floor only).
    if (floor.order === 0) {
      const r = Math.max(maxX - minX, maxZ - minZ) * 2 + 30;
      const ground = new THREE.Mesh(new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2).translate((minX + maxX) / 2, -0.06, (minZ + maxZ) / 2), mats.ground());
      ground.receiveShadow = true;
      parts.scenery.push(ground);
      parts.scenery.push(...surroundingTrees({ minX, maxX, minZ, maxZ }, mats));
    }
  }

  // Rooms: their floors (by material) and ceilings (seen only from inside).
  // Merged per material; a tap finds its room from where it landed (pickRoom).
  const roomFloors = new Bucket(), ceilings = new Bucket();
  for (const r of rooms) {
    roomFloors.add(mats.floor(r.floorMaterial, r.floorMaterial === 'tile' ? ROOM_TINTS[r.type] ?? null : null), flat(r.polygon, 0.012));
    if (r.ceiling) ceilings.add(mats.ceiling(), flat(r.polygon, floor.ceilingHeight, true));
  }
  const roomMeshes = roomFloors.meshes({ receive: true });
  parts.rooms.push(...roomMeshes);
  pickables.push(...roomMeshes);
  parts.ceilings.push(...ceilings.meshes());

  // Walls, cut around their openings; a darker cap on top reads well from above.
  const wallB = new Bucket(), trimB = new Bucket(), glassB = new Bucket(), woodB = new Bucket();
  const byWall = new Map<string, IndoorOpening[]>();
  for (const o of openings) if (o.wallId) (byWall.get(o.wallId) ?? byWall.set(o.wallId, []).get(o.wallId)!).push(o);
  for (const w of walls) wallPieces(w, (byWall.get(w.id) ?? []).sort((a, b) => a.offset - b.offset), mats, wallB, trimB);
  for (const o of openings) openingDetail(o, walls.find(w => w.id === o.wallId) ?? null, mats, trimB, glassB, woodB);
  const wallMeshes = wallB.meshes({ cast: true, receive: true });
  parts.walls.push(...wallMeshes, ...trimB.meshes({ cast: true }), ...glassB.meshes());
  parts.objects.push(...woodB.meshes({ cast: true }));

  // Stairs, lifts, ramps and escalators up from this floor.
  const objB = new Bucket();
  for (const c of climbing) connectorGeometry(c, (elevation.get(c.toFloorId) ?? 0) - (elevation.get(c.fromFloorId) ?? 0), ceilingOf.get(c.toFloorId) ?? 2.8, mats, objB);

  // Scenery and furniture the venue placed.
  for (const p of props) {
    const ang = p.angle;
    switch (p.kind) {
      case 'tree': tree(p.at, Math.max(1, p.width), objB, mats, p.id.length % 2 === 0); break;
      case 'bench':
        objB.add(mats.wood(), box(p.width, 0.08, p.depth, p.at.x, 0.45, p.at.z, ang));
        for (const s of [-1, 1]) { const o = add(p.at, scale(rot(v(1, 0), ang), (s * p.width) / 2.6)); objB.add(mats.metal(), box(0.06, 0.45, p.depth * 0.8, o.x, 0.225, o.z, ang)); }
        break;
      case 'furniture': objB.add(mats.wood(), box(p.width, 0.75, p.depth, p.at.x, 0.375, p.at.z, ang)); break;
      case 'landmark':
        objB.add(mats.stone(), box(p.width, 0.5, p.depth, p.at.x, 0.25, p.at.z, ang));
        objB.add(mats.stone(), box(p.width * 0.35, 2.2, p.depth * 0.35, p.at.x, 1.6, p.at.z, ang));
        break;
      case 'entrance': objB.add(mats.trim(), box(p.width, 0.02, p.depth * 0.6, p.at.x, 0.02, p.at.z, ang)); break;
      default: break;
    }
  }
  parts.objects.push(...objB.meshes({ cast: true, receive: true }));

  // Walkways (the paths layer).
  const pathB = new Bucket();
  const node = new Map(nodes.map(n => [n.id, n]));
  for (const e of venue.edges) {
    const a = node.get(e.from), b = node.get(e.to);
    if (!a || !b) continue;
    const L = dist(a.at, b.at);
    if (L < 0.05) continue;
    pathB.add(mats.path(), box(L + 0.45, 0.02, 0.45, (a.at.x + b.at.x) / 2, 0.03, (a.at.z + b.at.z) / 2, Math.atan2(b.at.z - a.at.z, b.at.x - a.at.x)));
  }
  parts.paths.push(...pathB.meshes());

  for (const list of Object.values(parts)) for (const o of list) group.add(o);
  group.position.y = floor.elevation;

  return {
    floorId: floor.id, group, mats, parts, pickables, solid: wallMeshes,
    dispose() {
      group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      mats.dispose();
    },
  };
}

export { obstacles } from '../walls';

/** The room under a point on a floor (from a tap on the room floors). */
export function pickRoom(venue: IndoorVenue, floorId: string, p: Vec2) {
  return venue.rooms.find(r => r.floorId === floorId && pointInPolygon(p, r.polygon)) ?? null;
}

// ── walls and openings ───────────────────────────────────────────────────────

function wallPieces(w: IndoorWall, ops: IndoorOpening[], mats: MaterialLibrary, out: Bucket, caps: Bucket) {
  const mat = mats.wall(w.material);
  const L = dist(w.a, w.b);
  if (L < 0.01) return;
  const ang = Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x);
  const d = v((w.b.x - w.a.x) / L, (w.b.z - w.a.z) / L);
  const ext = w.thickness / 2; // overlap at the ends closes the corners
  const piece = (s0: number, s1: number, y0: number, y1: number) => {
    if (s1 - s0 < 0.005 || y1 - y0 < 0.005) return;
    const c = add(w.a, scale(d, (s0 + s1) / 2));
    out.add(mat, box(s1 - s0, y1 - y0, w.thickness, c.x, (y0 + y1) / 2, c.z, ang));
  };
  let s = -ext;
  for (const o of ops) {
    const o0 = Math.max(-ext, o.offset - o.width / 2), o1 = Math.min(L + ext, o.offset + o.width / 2);
    piece(s, o0, 0, w.height);
    if (o.kind === 'window') { piece(o0, o1, 0, o.sill); piece(o0, o1, Math.min(w.height, o.sill + o.height), w.height); }
    else piece(o0, o1, Math.min(w.height, o.height), w.height);
    s = Math.max(s, o1);
  }
  piece(s, L + ext, 0, w.height);
  // Cap: a slightly darker strip along the top, so the plan reads from above.
  const c = add(w.a, scale(d, L / 2));
  caps.add(mats.cap(w.material), box(L + w.thickness, 0.025, w.thickness + 0.01, c.x, w.height + 0.0125, c.z, ang));
}

function openingDetail(o: IndoorOpening, wall: IndoorWall | null, mats: MaterialLibrary, trim: Bucket, glass: Bucket, wood: Bucket) {
  const t = (wall?.thickness ?? 0.18) + 0.03;
  const d = v(Math.cos(o.angle), Math.sin(o.angle));
  const left = sub(o.at, scale(d, o.width / 2)), right = add(o.at, scale(d, o.width / 2));
  const jamb = 0.06;
  if (o.kind === 'window') {
    glass.add(mats.glass(), box(o.width, o.height, 0.02, o.at.x, o.sill + o.height / 2, o.at.z, o.angle));
    for (const y of [o.sill, o.sill + o.height]) trim.add(mats.trim(), box(o.width + jamb, jamb, t, o.at.x, y, o.at.z, o.angle));
    for (const p of [left, right]) trim.add(mats.trim(), box(jamb, o.height, t, p.x, o.sill + o.height / 2, p.z, o.angle));
    // Mullion.
    trim.add(mats.trim(), box(0.035, o.height, 0.05, o.at.x, o.sill + o.height / 2, o.at.z, o.angle));
    return;
  }
  // Door frame (doors and arches).
  for (const p of [left, right]) trim.add(mats.trim(), box(jamb, o.height, t, p.x, o.height / 2, p.z, o.angle));
  trim.add(mats.trim(), box(o.width + jamb, jamb, t, o.at.x, o.height, o.at.z, o.angle));
  if (o.kind !== 'door') return;
  // The leaf, hinged at the left jamb and standing open into the room.
  const leafW = o.width - jamb, leafDir = rot(d, OPEN_ANGLE);
  // Clear of the wall face it folds back against.
  const face = scale(v(-d.z, d.x), t / 2 + 0.03);
  const c = add(add(add(left, scale(d, jamb / 2)), scale(leafDir, leafW / 2)), face);
  wood.add(mats.wood(), box(leafW, o.height - 0.03, 0.045, c.x, (o.height - 0.03) / 2, c.z, Math.atan2(leafDir.z, leafDir.x)));
}

// ── stairs, lifts, ramps, escalators ─────────────────────────────────────────

function connectorGeometry(c: IndoorConnector, rise: number, upperCeiling: number, mats: MaterialLibrary, out: Bucket) {
  const ang = Math.atan2(c.dir.z, c.dir.x);
  const run = dist(c.bottom, c.top);
  if (c.kind === 'elevator') {
    const H = rise + upperCeiling;
    out.add(mats.glass(), box(c.width, H, c.depth, c.center.x, H / 2, c.center.z, ang));
    for (const p of rectCorners(c.center, c.width, c.depth, c.dir)) out.add(mats.metal(), box(0.08, H, 0.08, p.x, H / 2, p.z));
    return;
  }
  if (c.kind === 'ramp') {
    const slope = Math.atan2(rise, Math.max(run, 0.1));
    const g = new THREE.BoxGeometry(Math.hypot(run, rise), 0.15, c.width);
    g.rotateZ(slope); g.rotateY(-ang);
    const m = add(c.bottom, scale(c.dir, run / 2));
    g.translate(m.x, rise / 2, m.z);
    out.add(mats.slab(), g);
    rails(c, rise, run, mats, out);
    return;
  }
  // Stairs and escalators: a solid flight, step by step (a flat landing half way if asked).
  const n = Math.max(2, c.steps);
  const flights: { s0: number; s1: number; y0: number; y1: number; steps: number }[] = c.landing === 'mid'
    ? [{ s0: 0, s1: 0.4 * run, y0: 0, y1: rise / 2, steps: Math.ceil(n / 2) }, { s0: 0.6 * run, s1: run, y0: rise / 2, y1: rise, steps: Math.floor(n / 2) }]
    : [{ s0: 0, s1: run, y0: 0, y1: rise, steps: n }];
  const mat = c.kind === 'escalator' ? mats.metal() : mats.step();
  for (const f of flights) {
    const tread = (f.s1 - f.s0) / f.steps, r = (f.y1 - f.y0) / f.steps;
    for (let i = 0; i < f.steps; i++) {
      const top = f.y0 + (i + 1) * r;
      const at = add(c.bottom, scale(c.dir, f.s0 + (i + 0.5) * tread));
      out.add(mat, box(tread, top, c.width, at.x, top / 2, at.z, ang));
      // Nosing: a lighter lip on each step edge.
      const lip = add(c.bottom, scale(c.dir, f.s0 + i * tread + 0.015));
      out.add(mats.trim(), box(0.03, 0.02, c.width, lip.x, top - 0.01, lip.z, ang));
    }
  }
  if (c.landing === 'mid') {
    const m = add(c.bottom, scale(c.dir, run / 2));
    out.add(mat, box(0.2 * run, rise / 2, c.width, m.x, rise / 4, m.z, ang));
  }
  rails(c, rise, run, mats, out);
}

/** Handrails along both sides at 0.9 m, with posts at each end. */
function rails(c: IndoorConnector, rise: number, run: number, mats: MaterialLibrary, out: Bucket) {
  const slope = Math.atan2(rise, Math.max(run, 0.1));
  const across = v(-c.dir.z, c.dir.x);
  for (const side of [-1, 1]) {
    const off = scale(across, side * (c.width / 2 - 0.04));
    const g = new THREE.BoxGeometry(Math.hypot(run, rise), 0.05, 0.05);
    g.rotateZ(slope); g.rotateY(-Math.atan2(c.dir.z, c.dir.x));
    const m = add(add(c.bottom, scale(c.dir, run / 2)), off);
    g.translate(m.x, rise / 2 + 0.9, m.z);
    out.add(mats.metal(), g);
    for (const [p, y] of [[c.bottom, 0], [c.top, rise]] as const) {
      const q = add(p, off);
      out.add(mats.metal(), box(0.05, 0.9, 0.05, q.x, y + 0.45, q.z));
    }
  }
}

// ── trees ────────────────────────────────────────────────────────────────────

function tree(at: Vec2, size: number, out: Bucket, mats: MaterialLibrary, alt: boolean) {
  const h = 1 + size * 0.35;
  const trunk = new THREE.CylinderGeometry(0.1 * size / 2, 0.14 * size / 2, h, 6);
  trunk.translate(at.x, h / 2, at.z);
  out.add(mats.bark(), trunk);
  const crown = new THREE.IcosahedronGeometry(size * 0.45, 0);
  crown.translate(at.x, h + size * 0.3, at.z);
  out.add(alt ? mats.treeB() : mats.treeA(), crown);
}

/** A seeded ring of trees around the building (scenery), the same every visit. */
function surroundingTrees(b: { minX: number; maxX: number; minZ: number; maxZ: number }, mats: MaterialLibrary): THREE.Mesh[] {
  let seed = Math.round((b.maxX - b.minX) * 131 + (b.maxZ - b.minZ) * 71) || 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const out = new Bucket();
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const rx = (b.maxX - b.minX) / 2 + 4, rz = (b.maxZ - b.minZ) / 2 + 4;
  const count = Math.min(60, Math.round((rx + rz) * 1.2));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.3;
    const k = 1 + rnd() * 0.9;
    tree(v(cx + Math.cos(a) * rx * k, cz + Math.sin(a) * rz * k), 2 + rnd() * 2.2, out, mats, rnd() > 0.5);
  }
  return out.meshes({ cast: true });
}
