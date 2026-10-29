import { describe, expect, it } from 'vitest';
import { imageUrlsOf, lngLatToTile, packageOutdated, sizeText, tileUrl, tilesAround } from './venuePackage';

describe('map tiles around a venue', () => {
  it('finds the tile a point is in', () => {
    // Addis Ababa (Unity Park) at zoom 0 and 14
    expect(lngLatToTile(38.7633, 9.0227, 0)).toEqual({ x: 0, y: 0 });
    const t = lngLatToTile(38.7633, 9.0227, 14);
    expect(t.x).toBe(9956);
    expect(t.y).toBe(7779);   // checked against the standard formula independently
  });
  it('covers the radius at every zoom, lowest first, within the cap', () => {
    const tiles = tilesAround(9.0227, 38.7633, 700, 14, 18, 260);
    expect(tiles[0].z).toBe(14);
    expect(tiles.length).toBeLessThanOrEqual(260);
    expect(new Set(tiles.map(t => t.z)).has(17)).toBe(true);
    // A bigger radius stops at the cap instead of going past it.
    expect(tilesAround(9.0227, 38.7633, 50_000, 10, 18, 100).length).toBeLessThanOrEqual(100);
  });
  it('fills in tile URLs', () => {
    expect(tileUrl('https://t/{z}/{y}/{x}', { z: 3, x: 4, y: 5 })).toBe('https://t/3/5/4');
  });
});

describe('what a package holds', () => {
  it('collects every photo once, web links only', () => {
    const urls = imageUrlsOf({
      pois: [{ images: ['https://a/1.jpg', 'https://a/2.jpg'], image_url: 'https://a/1.jpg' }, { images: [], image_url: 'data:image/png;base64,xx' }] as never,
      content: [{ image_url: 'https://a/story.jpg' }] as never,
    }, { cover_url: 'https://a/cover.jpg' });
    expect(urls.sort()).toEqual(['https://a/1.jpg', 'https://a/2.jpg', 'https://a/cover.jpg', 'https://a/story.jpg']);
  });
  it('knows when the venue was published again since', () => {
    expect(packageOutdated({ version: '2026-10-01T00:00:00Z' }, '2026-10-20T00:00:00Z')).toBe(true);
    expect(packageOutdated({ version: '2026-10-20T00:00:00Z' }, '2026-10-20T00:00:00Z')).toBe(false);
    expect(packageOutdated({ version: null }, '2026-10-20T00:00:00Z')).toBe(true);
    expect(packageOutdated({ version: '2026-10-20T00:00:00Z' }, null)).toBe(false);
  });
  it('writes sizes plainly', () => {
    expect(sizeText(2048)).toBe('2 KB');
    expect(sizeText(5.5 * 1024 * 1024)).toBe('5.5 MB');
  });
});
