// How a venue's indoor map looks to visitors — set by the institution under
// Venue Settings → Indoor 3D map (buildings.map_settings), and published with
// the rest of the venue. Visitors can still flip each layer in Map Layers;
// these are only the defaults.

export type IndoorView = '3d' | '2d';

export type IndoorLayerId = 'walls' | 'rooms' | 'objects' | 'labels' | 'paths' | 'otherFloors' | 'scenery';

export interface VenueMapSettings {
  /** Which indoor view opens first. */
  defaultView: IndoorView;
  /** How tall walls stand in 3D, in metres. */
  wallHeightM: number;
  /** Which details show by default. */
  layers: Record<IndoorLayerId, boolean>;
}

export const WALL_HEIGHT_RANGE = { min: 2, max: 8, step: 0.2 } as const;

export const DEFAULT_LAYERS: Record<IndoorLayerId, boolean> = {
  walls: true, rooms: true, objects: true, labels: true, paths: false, otherFloors: true, scenery: true,
};

export const DEFAULT_MAP_SETTINGS: VenueMapSettings = { defaultView: '3d', wallHeightM: 2.8, layers: DEFAULT_LAYERS };

/** Every indoor layer, in the order shown to visitors and institutions. */
export const INDOOR_LAYERS: { id: IndoorLayerId; label: string; description: string; color: string }[] = [
  { id: 'walls', label: 'Walls', description: 'Walls and partitions', color: '#64748b' },
  { id: 'rooms', label: 'Rooms', description: 'Coloured room floors', color: '#0ea5e9' },
  { id: 'objects', label: '3D objects', description: 'Doors, stairs, furniture, trees', color: '#d97706' },
  { id: 'labels', label: 'Labels', description: 'Names of places and rooms', color: '#7c3aed' },
  { id: 'paths', label: 'Walkways', description: 'Every walkable path', color: '#16a34a' },
  { id: 'otherFloors', label: 'Other floors', description: 'The rest of the building, stacked', color: '#db2777' },
  { id: 'scenery', label: 'Scenery', description: 'Trees around the venue (3D)', color: '#059669' },
];

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Settings from a building row (draft or published snapshot). Anything missing
 * or malformed falls back to the defaults; the opening view falls back to the
 * home page's hero view.
 */
export function parseMapSettings(raw: unknown, heroView?: string | null): VenueMapSettings {
  const s = isRecord(raw) ? raw : {};
  const layers = { ...DEFAULT_LAYERS };
  if (isRecord(s.layers)) {
    for (const id of Object.keys(DEFAULT_LAYERS) as IndoorLayerId[]) {
      if (typeof s.layers[id] === 'boolean') layers[id] = s.layers[id] as boolean;
    }
  }
  const h = typeof s.wallHeightM === 'number' && Number.isFinite(s.wallHeightM) ? s.wallHeightM : DEFAULT_MAP_SETTINGS.wallHeightM;
  const defaultView: IndoorView = s.defaultView === '2d' || s.defaultView === '3d' ? s.defaultView : heroView === '2d' ? '2d' : '3d';
  return { defaultView, wallHeightM: Math.min(WALL_HEIGHT_RANGE.max, Math.max(WALL_HEIGHT_RANGE.min, h)), layers };
}
