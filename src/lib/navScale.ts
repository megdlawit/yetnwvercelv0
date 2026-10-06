/**
 * navScale — how many floor-plan pixels make one real metre.
 *
 * Plans drawn in the floor editor use 40 px per metre, and a georeferenced
 * venue stores its scale as `meters_per_pixel`. The database default for
 * that column is 1, which no real plan uses, so — like anchorOf() in
 * lib/venue/geoVenue — anything outside a plausible range means "not set"
 * and falls back to the editor's scale.
 *
 * Buildings with no scale at all (the built-in sample buildings) keep the
 * navigation engine's original "1 unit = 1 m" behaviour.
 */

export const EDITOR_PX_PER_METER = 40;

/** A usable meters-per-pixel value for a building row (never the "unset" default of 1). */
export function sanitizeMetersPerPixel(v: number | null | undefined): number {
  return v != null && v > 0 && v < 0.5 ? v : 1 / EDITOR_PX_PER_METER;
}

/** Pixels per metre for the navigation engine; 1 (legacy units) when the building has no scale. */
export function pxPerMeterOf(b: { metersPerPixel?: number | null; planPxPerMeter?: number | null } | null | undefined): number {
  // The plan's own drawing scale wins: the world-map fit is set by eye.
  if (b?.planPxPerMeter && b.planPxPerMeter > 0) return b.planPxPerMeter;
  const mpp = b?.metersPerPixel;
  return mpp != null && mpp > 0 && mpp < 0.5 ? 1 / mpp : 1;
}

/** The drawing area a floor needs: its furthest point plus a margin (never smaller than the old 800×500). */
export function planExtent(points: { x: number; y: number; width?: number; height?: number }[]): { width: number; height: number } {
  let w = 800, h = 500;
  for (const p of points) {
    w = Math.max(w, p.x + (p.width ?? 0) + 60);
    h = Math.max(h, p.y + (p.height ?? 0) + 60);
  }
  return { width: Math.ceil(w), height: Math.ceil(h) };
}
