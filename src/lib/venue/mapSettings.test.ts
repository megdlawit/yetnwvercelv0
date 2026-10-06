import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYERS, parseMapSettings } from './mapSettings';

describe('parseMapSettings', () => {
  it('uses the defaults for an empty or missing value', () => {
    expect(parseMapSettings(null)).toEqual({ defaultView: '3d', wallHeightM: 2.8, layers: DEFAULT_LAYERS });
    expect(parseMapSettings({})).toEqual(parseMapSettings(undefined));
  });

  it('opens on the home page hero view when no view was chosen', () => {
    expect(parseMapSettings({}, '2d').defaultView).toBe('2d');
    expect(parseMapSettings({ defaultView: '3d' }, '2d').defaultView).toBe('3d');
  });

  it('keeps chosen layers and ignores junk', () => {
    const s = parseMapSettings({ layers: { walls: false, scenery: 'no', nonsense: true }, wallHeightM: 4.2 });
    expect(s.layers.walls).toBe(false);
    expect(s.layers.scenery).toBe(true);
    expect(s.wallHeightM).toBe(4.2);
    expect('nonsense' in s.layers).toBe(false);
  });

  it('keeps the wall height within range', () => {
    expect(parseMapSettings({ wallHeightM: 50 }).wallHeightM).toBe(8);
    expect(parseMapSettings({ wallHeightM: 0.5 }).wallHeightM).toBe(2);
  });
});
