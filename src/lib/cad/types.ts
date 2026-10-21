// The common shape every import format is read into. DXF is parsed natively;
// SVG, PDF, IFC and 3D models are converted into the same entity list (lines,
// polylines, circles, arcs, text, block inserts on named layers), so layer
// mapping, cleanup and venue building are written once for all of them.

import type { ParsedDxf } from '../dxf/parseDxf';

export type CadFormat = 'dxf' | 'dwg' | 'svg' | 'pdf' | 'ifc' | 'obj' | 'glb' | 'gltf';

export interface CadDrawing extends ParsedDxf {
  format: CadFormat;
  /** Drawing units per real metre, when the file says (or the format fixes it); null = unknown. */
  unitsPerMeter: number | null;
  unitsName: string;
  /** Y axis points up in the drawing (CAD, PDF) and must be flipped for the editor. */
  flipY: boolean;
  /** Format-specific notes shown in the import review (e.g. "page 1 of 3 used"). */
  notes: string[];
  /** Reader-level knowledge of what a layer is (IFC classes, PDF pen weights); beats name guessing. */
  layerHints?: Record<string, { category: Category; confidence: number; reason: string }>;
  /** Multi-level sources (IFC, 3D models): the levels found, the one shown, and how to read another. */
  levels?: { name: string; elevation: number }[];
  level?: number;
  atLevel?: (index: number) => CadDrawing;
  /** DWG only: the DXF text the server converted it to (sent to the layer labeler and kept as the source). */
  convertedDxf?: string;
}

/** What a CAD layer becomes in the venue. */
export type Category =
  | 'walls' | 'doors' | 'windows' | 'rooms' | 'stairs' | 'elevators'
  | 'furniture' | 'trees' | 'labels' | 'ignore';

export const CATEGORY_LABELS: Record<Category, string> = {
  walls: 'Walls', doors: 'Doors', windows: 'Windows', rooms: 'Rooms', stairs: 'Stairs',
  elevators: 'Elevators', furniture: 'Furniture', trees: 'Trees & plants', labels: 'Labels', ignore: 'Ignore',
};

export type LayerMapping = Record<string, Category>;
