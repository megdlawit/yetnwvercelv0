// 3D sources (IFC building models, OBJ / GLB / GLTF) → a 2D plan.
//
// Both are reduced to "elements": a world-space triangle mesh in metres with
// Y up, plus what it is (an IFC class, or a node name). Levels are found by
// clustering where elements start vertically; for the chosen level, walls
// (and spaces) are cut with a horizontal plane at 1 m above the floor — the
// same cut an architect's plan view uses — and objects become markers.

import type { DxfEntity } from '../../dxf/parseDxf';
import type { CadDrawing, Category } from '../types';
import { categoryFromBlock } from '../classify';
import { sliceMesh, mergeCollinear, chainLoops, polygonCentroid, polygonArea } from '../geometry';
import { finish } from './svg';

export interface Element {
  layer: string;            // IFC class name, or "Model" for plain 3D files
  name: string;
  role: 'slice' | 'space' | 'object' | 'box';  // how it becomes 2D
  positions: Float32Array;  // world xyz, metres, Y up
  index: Uint32Array | null;
  min: [number, number, number];
  max: [number, number, number];
}

export function boundsOf(p: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[i + k]); max[k] = Math.max(max[k], p[i + k]); }
  }
  return { min, max };
}

/** Floor levels: cluster the bottoms of slice elements; a gap of 2 m starts a new level. */
export function findLevels(elements: Element[]): number[] {
  const bottoms = elements.filter(e => e.role === 'slice').map(e => e.min[1]).sort((a, b) => a - b);
  if (!bottoms.length) return [Math.min(...elements.map(e => e.min[1]), 0)];
  const levels = [bottoms[0]];
  for (const y of bottoms) if (y - levels[levels.length - 1] > 2) levels.push(y);
  return levels;
}

export function elementsToDrawing(
  elements: Element[], format: CadDrawing['format'], hints: CadDrawing['layerHints'], notes: string[], levelIndex = 0,
): CadDrawing {
  const levels = findLevels(elements);
  const li = Math.min(Math.max(levelIndex, 0), levels.length - 1);
  const floorY = levels[li];
  const nextY = levels[li + 1] ?? Infinity;
  const cutY = floorY + 1.0;
  const onLevel = (e: Element) => e.min[1] < nextY - 0.5 && e.max[1] > floorY + 0.05;

  const entities: DxfEntity[] = [];
  const layers = new Set<string>();
  const add = (e: DxfEntity) => { entities.push(e); layers.add(e.layer); };

  for (const el of elements) {
    if (!onLevel(el)) continue;
    const cx = (el.min[0] + el.max[0]) / 2, cz = (el.min[2] + el.max[2]) / 2;
    if (el.role === 'slice') {
      if (el.min[1] > cutY || el.max[1] < cutY) continue; // doesn't reach the cut (low wall, beam)
      for (const s of mergeCollinear(sliceMesh(el.positions, el.index, cutY), 0.005, 0.005).segs) {
        add({ kind: 'LINE', layer: el.layer, a: { x: s.x1, y: s.y1 }, b: { x: s.x2, y: s.y2 } });
      }
    } else if (el.role === 'space') {
      const y = Math.min(Math.max(cutY, el.min[1] + 0.05), el.max[1] - 0.05);
      const loops = chainLoops(mergeCollinear(sliceMesh(el.positions, el.index, y), 0.005, 0.005).segs, 0.01);
      const loop = loops.sort((a, b) => polygonArea(b) - polygonArea(a))[0];
      const pts = loop ?? [{ x: el.min[0], y: el.min[2] }, { x: el.max[0], y: el.min[2] }, { x: el.max[0], y: el.max[2] }, { x: el.min[0], y: el.max[2] }];
      add({ kind: 'POLYLINE', layer: el.layer, closed: true, pts });
      if (el.name) add({ kind: 'TEXT', layer: el.layer, pos: polygonCentroid(pts), text: el.name });
    } else if (el.role === 'box') {
      // stairs / lifts: their footprint, so the venue builder knows their size
      add({ kind: 'POLYLINE', layer: el.layer, closed: true, pts: [
        { x: el.min[0], y: el.min[2] }, { x: el.max[0], y: el.min[2] }, { x: el.max[0], y: el.max[2] }, { x: el.min[0], y: el.max[2] },
      ] });
    } else {
      const w = el.max[0] - el.min[0], d = el.max[2] - el.min[2];
      add({ kind: 'INSERT', layer: el.layer, block: el.name || el.layer, pos: { x: cx, y: cz }, rotationDeg: d > w ? 90 : 0 });
    }
  }

  if (levels.length > 1) notes = [...notes, `Level ${li + 1} of ${levels.length} (floor at ${floorY.toFixed(2)} m). Choose another level below if needed.`];
  return {
    ...finish(entities, layers),
    format, unitsPerMeter: 1, unitsName: 'metres', flipY: false, notes, layerHints: hints,
    levels: levels.map((y, i) => ({ name: `Level ${i + 1}`, elevation: y })), level: li,
    atLevel: (i: number) => elementsToDrawing(elements, format, hints, notes.filter(n => !n.startsWith('Level ')), i),
  };
}

// ── IFC ──────────────────────────────────────────────────────────────────────

export async function readIfc(data: ArrayBuffer): Promise<CadDrawing> {
  const WebIFC = await import('web-ifc');
  const wasmUrl = (await import('web-ifc/web-ifc.wasm?url')).default;
  const api = new WebIFC.IfcAPI();
  await api.Init((path: string) => (path.endsWith('.wasm') ? wasmUrl : path), true);
  const modelID = api.OpenModel(new Uint8Array(data));

  const classes: [number, string, Element['role'], Category][] = [
    [WebIFC.IFCWALL, 'IfcWall', 'slice', 'walls'],
    [WebIFC.IFCWALLSTANDARDCASE, 'IfcWall', 'slice', 'walls'],
    [WebIFC.IFCCOLUMN, 'IfcColumn', 'slice', 'walls'],
    [WebIFC.IFCSPACE, 'IfcSpace', 'space', 'rooms'],
    [WebIFC.IFCDOOR, 'IfcDoor', 'object', 'doors'],
    [WebIFC.IFCWINDOW, 'IfcWindow', 'object', 'windows'],
    [WebIFC.IFCSTAIR, 'IfcStair', 'box', 'stairs'],
    [WebIFC.IFCSTAIRFLIGHT, 'IfcStair', 'box', 'stairs'],
    [WebIFC.IFCTRANSPORTELEMENT, 'IfcTransportElement', 'box', 'elevators'],
    [WebIFC.IFCFURNISHINGELEMENT, 'IfcFurnishingElement', 'object', 'furniture'],
    [WebIFC.IFCFURNITURE, 'IfcFurnishingElement', 'object', 'furniture'],
  ];
  const byType = new Map(classes.map(c => [c[0], c] as const));
  const elements: Element[] = [];

  try {
    api.StreamAllMeshesWithTypes(modelID, classes.map(c => c[0]), mesh => {
      const type = api.GetLineType(modelID, mesh.expressID) as number;
      const cls = byType.get(type);
      if (!cls) return;
      const pos: number[] = [], idx: number[] = [];
      for (let g = 0; g < mesh.geometries.size(); g++) {
        const pg = mesh.geometries.get(g);
        const geom = api.GetGeometry(modelID, pg.geometryExpressID);
        const v = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const ix = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
        const m = pg.flatTransformation; // column-major 4x4
        const base = pos.length / 3;
        for (let i = 0; i < v.length; i += 6) { // x y z nx ny nz
          const x = v[i], y = v[i + 1], z = v[i + 2];
          pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        }
        for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base);
        geom.delete();
      }
      if (!pos.length) return;
      const positions = new Float32Array(pos);
      let name = '';
      if (cls[2] === 'space') {
        try { const line = api.GetLine(modelID, mesh.expressID); name = line?.LongName?.value || line?.Name?.value || ''; } catch { /* unnamed */ }
      }
      elements.push({ layer: cls[1], name, role: cls[2], positions, index: new Uint32Array(idx), ...boundsOf(positions) });
    });
  } finally {
    api.CloseModel(modelID);
  }

  if (!elements.length) throw new Error('No walls, spaces or doors were found in this IFC file.');
  const hints: NonNullable<CadDrawing['layerHints']> = {};
  for (const [, layer, , category] of classes) hints[layer] = { category, confidence: 0.98, reason: `IFC class ${layer}` };
  return elementsToDrawing(elements, 'ifc', hints, ['Walls are cut 1 m above each floor, like a plan view.']);
}

// ── OBJ / GLB / GLTF ─────────────────────────────────────────────────────────

export async function readModel(data: ArrayBuffer, format: 'obj' | 'glb' | 'gltf'): Promise<CadDrawing> {
  const THREE = await import('three');
  let root: import('three').Object3D;
  if (format === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    root = new OBJLoader().parse(new TextDecoder().decode(data));
  } else {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    root = await new Promise((resolve, reject) => new GLTFLoader().parse(data, '', g => resolve(g.scene), e => reject(
      new Error(format === 'gltf'
        ? 'This .gltf needs files that weren\'t uploaded (textures or .bin). Export it as a single .glb instead.'
        : `Could not read this model: ${(e as unknown as Error)?.message ?? e}`),
    )));
  }
  root.updateMatrixWorld(true);

  const elements: Element[] = [];
  const v = new THREE.Vector3();
  root.traverse(obj => {
    const mesh = obj as import('three').Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const attr = mesh.geometry.attributes.position;
    const positions = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
      positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
    }
    const index = mesh.geometry.index ? new Uint32Array(mesh.geometry.index.array) : null;
    // Objects named like a tree, bench, door … become markers instead of
    // being cut into the walls (a sliced trunk is not a wall).
    const name = (mesh.name || mesh.parent?.name || '').trim();
    const objectCat = name ? categoryFromBlock(name) : null;
    elements.push({
      layer: objectCat ? 'Model objects' : 'Model', name, role: objectCat ? 'object' : 'slice',
      positions, index, ...boundsOf(positions),
    });
  });
  if (!elements.length) throw new Error('This model has no meshes.');
  return elementsToDrawing(elements, format, {
    Model: { category: 'walls', confidence: 0.6, reason: 'The model cut 1 m above the floor' },
  }, ['3D models are assumed to be in metres with Y up (the glTF standard). Walls are the model cut 1 m above each floor.']);
}
