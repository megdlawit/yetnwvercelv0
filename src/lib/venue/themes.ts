// Visual themes for a venue's 3D world and visitor map. One per venue
// (buildings.theme); the 3D view and the map read their colours from here.

export type ThemeId = 'park' | 'heritage' | 'modern';

export interface VenueTheme {
  id: ThemeId;
  label: string;
  description: string;
  /** 3D colours, light mode. */
  sky: string; ground: string; slab: string; wall: string; path: string; primary: string; route: string;
  treeA: string; treeB: string;
  /** Accent for the visitor map's buttons and pins. */
  accent: string;
}

export const THEMES: Record<ThemeId, VenueTheme> = {
  park: {
    id: 'park', label: 'Park', description: 'Green lawns, white pavilions, leafy trees — gardens and outdoor venues.',
    sky: '#e8f1ea', ground: '#cfe3c7', slab: '#f3f1ec', wall: '#fbfaf7', path: '#8fd3ab', primary: '#0f5e3a', route: '#0ea5e9',
    treeA: '#5fae6a', treeB: '#4c9a5c', accent: '#0f5e3a',
  },
  heritage: {
    id: 'heritage', label: 'Heritage', description: 'Warm stone, terracotta and earth tones — historic sites and museums.',
    sky: '#f4ece0', ground: '#e3d3b4', slab: '#efe4d0', wall: '#e8d9bd', path: '#d9a066', primary: '#8a4b20', route: '#b45309',
    treeA: '#7a9a4c', treeB: '#5f7f3a', accent: '#8a4b20',
  },
  modern: {
    id: 'modern', label: 'Modern', description: 'Cool greys, glass blues and clean lines — campuses, malls and offices.',
    sky: '#eef2f7', ground: '#d7dde6', slab: '#f6f8fb', wall: '#ffffff', path: '#93c5fd', primary: '#1d4ed8', route: '#7c3aed',
    treeA: '#6aa57a', treeB: '#4f8a63', accent: '#1d4ed8',
  },
};

/** "#0f5e3a" → "153 72% 21%", the form the app's `--primary` CSS variable takes. */
export function hexToHslVar(hex: string): string {
  const v = parseInt(hex.replace('#', ''), 16);
  const r = (v >> 16 & 255) / 255, g = (v >> 8 & 255) / 255, b = (v & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return `${Math.round((h * 60 + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export const themeOf =(id: string | null | undefined): VenueTheme => THEMES[(id as ThemeId) in THEMES ? (id as ThemeId) : 'park'];

/** "#0f5e3a" and "#ffffff" mixed: t = 0 is a, t = 1 is b. */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => { const v = parseInt(h.replace('#', ''), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
  const [x, y] = [p(a), p(b)];
  return `#${x.map((c, i) => Math.round(c + (y[i] - c) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** "#0f5e3a" at 40%: "rgb(15 94 58 / 0.4)". */
export function alphaHex(hex: string, a: number): string {
  const v = parseInt(hex.replace('#', ''), 16);
  return `rgb(${v >> 16 & 255} ${v >> 8 & 255} ${v & 255} / ${a})`;
}

/**
 * The plan-building animation's colours, from the venue's theme: a deep board
 * in the theme's own colour (green for Park, earth for Heritage, navy for
 * Modern), light walls, rooms in the path colour and paths in the route colour.
 */
export function buildPalette(t: VenueTheme) {
  return {
    board: mixHex(t.primary, '#000000', 0.55), boardDark: mixHex(t.primary, '#000000', 0.72),
    grid: alphaHex(t.path, 0.16), scan: alphaHex(t.path, 0.28),
    wall: mixHex(t.wall, '#ffffff', 0.6), wallLayer: alphaHex(t.path, 0.55),
    roomFill: alphaHex(t.path, 0.18), roomStroke: alphaHex(t.path, 0.5),
    route: t.route, routeGlow: alphaHex(t.route, 0.32), routeLight: mixHex(t.route, '#ffffff', 0.55), routeDot: mixHex(t.route, '#ffffff', 0.2),
  };
}
export type BuildPalette = ReturnType<typeof buildPalette>;
