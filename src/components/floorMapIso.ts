/** Shared isometric projection + palette for FloorMap — matches Unity Park reference design. */

export const ISO = {
  // Sky / background — very light blue-grey like the reference
  skyTop:        '#dce9f5',
  skyBottom:     '#eef5fc',
  cloud:         'rgba(255,255,255,0.85)',

  // Building blocks — warm light grey, matches the reference's building footprints
  blockTop:      '#eeecea',
  blockTopHi:    '#f5f3f0',
  blockSide:     '#d4d0ca',
  blockSideDark: '#c0bbb4',
  blockDetail:   '#aaa89e',

  // Corridors / walkways — bright white like the reference
  corridor:      '#f8f6f2',
  corridorEdge:  '#e8e4de',

  // Main road / central path — warm beige (matches outdoor path style)
  mainRoad:      '#e6ddd0',
  mainRoadEdge:  '#d0c8b8',

  // Route colors
  route:         '#1a7a45',
  routeGlow:     'rgba(26,122,69,0.22)',
  routeDone:     '#7bbf99',
  destPin:       '#1a7a45',

  // Parking
  parking:       '#5b9bd5',

  extrude: 14,
} as const;

/** Dimetric projection — keeps indoor x/y coords, adds depth on screen Y. */
export function toIso(x: number, y: number, z = 0): { x: number; y: number } {
  return {
    x: x * 1 + y * 0.42,
    y: y * 0.58 - z,
  };
}

export function isoRectCorners(
  x: number, y: number, w: number, h: number, z = 0,
): [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] {
  return [
    toIso(x, y, z),
    toIso(x + w, y, z),
    toIso(x + w, y + h, z),
    toIso(x, y + h, z),
  ];
}

export function cornersPath(corners: { x: number; y: number }[]): string {
  return corners.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ') + ' Z';
}

/** Deterministic inner shapes for block tops (rects + circles). */
export function blockDetails(
  x: number, y: number, w: number, h: number, seed: string,
): Array<{ type: 'rect' | 'circle'; x: number; y: number; w?: number; h?: number; r?: number }> {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const rnd = (n: number) => {
    hash = (hash * 1103515245 + 12345) | 0;
    return ((hash >>> 0) % 1000) / 1000 * n;
  };
  const shapes: Array<{ type: 'rect' | 'circle'; x: number; y: number; w?: number; h?: number; r?: number }> = [];
  const count = 2 + Math.floor(rnd(3));
  for (let i = 0; i < count; i++) {
    const px = x + 8 + rnd(Math.max(8, w - 24));
    const py = y + 8 + rnd(Math.max(8, h - 24));
    if (i % 2 === 0) {
      shapes.push({ type: 'rect', x: px, y: py, w: 10 + rnd(18), h: 8 + rnd(14) });
    } else {
      shapes.push({ type: 'circle', x: px, y: py, r: 4 + rnd(8) });
    }
  }
  return shapes;
}

export const PIN_IMAGES: Record<string, string> = {
  animal:   'https://images.unsplash.com/photo-1614846027182-cecf8fc9e5e0?w=120&q=70',
  garden:   'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=120&q=70',
  cafe:     'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=120&q=70',
  market:   'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=120&q=70',
  landmark: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&q=70',
  exhibit:  'https://images.unsplash.com/photo-1534759846116-5799c33ce22a?w=120&q=70',
  default:  'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=120&q=70',
};

export function poiImageUrl(imageUrl: string | null | undefined, subcategory?: string | null): string {
  if (imageUrl) return imageUrl;
  const key = subcategory?.toLowerCase() ?? 'default';
  return PIN_IMAGES[key] ?? PIN_IMAGES.default;
}