import { describe, expect, it } from 'vitest';
import { calibrate, editorToImage, imageToEditor, initialPlacement, parseUnderlay } from './underlay';

describe('underlay transform', () => {
  const t = { x: 100, y: 50, scale: 0.5, rotationDeg: 30 };

  it('round-trips image ↔ editor', () => {
    const p = { x: 812, y: 377 };
    const back = editorToImage(t, imageToEditor(t, p));
    expect(back.x).toBeCloseTo(812, 6);
    expect(back.y).toBeCloseTo(377, 6);
  });

  it('calibrates from two points: the right length, straightened, A kept in place', () => {
    // Two points on the image 400 px apart, drawn at an angle; really 10 m apart.
    const a = imageToEditor(t, { x: 100, y: 100 }), b = imageToEditor(t, { x: 500, y: 100 });
    const c = calibrate(t, a, b, 10, 'horizontal');
    const a2 = imageToEditor(c, { x: 100, y: 100 }), b2 = imageToEditor(c, { x: 500, y: 100 });
    expect(Math.hypot(b2.x - a2.x, b2.y - a2.y)).toBeCloseTo(400, 6); // 10 m × 40 px
    expect(b2.y - a2.y).toBeCloseTo(0, 6);                            // left–right now
    expect(a2.x).toBeCloseTo(a.x, 6);
    expect(a2.y).toBeCloseTo(a.y, 6);
  });

  it('keeps the drawn angle when asked, and turns a line up–down', () => {
    const a = { x: 0, y: 0 }, b = { x: 30, y: 40 };
    const keep = calibrate({ x: 0, y: 0, scale: 1, rotationDeg: 0 }, a, b, 2.5, 'as-drawn');
    expect(keep.scale).toBeCloseTo(100 / 50, 6);
    expect(keep.rotationDeg).toBeCloseTo(0, 6);
    const vert = calibrate({ x: 0, y: 0, scale: 1, rotationDeg: 0 }, a, b, 2.5, 'vertical');
    const b2 = imageToEditor(vert, b);
    expect(b2.x).toBeCloseTo(0, 6);
    expect(b2.y).toBeCloseTo(100, 6);
  });

  it('places a new plan over the drawing, or 40 m wide', () => {
    expect(initialPlacement(2000, 1000, null).scale).toBeCloseTo(1600 / 2000);
    expect(initialPlacement(1000, 500, { minX: 10, minY: 20, maxX: 810, maxY: 420 })).toMatchObject({ x: 10, y: 20, scale: 0.8 });
  });

  it('reads stored settings defensively', () => {
    expect(parseUnderlay(null)).toBeNull();
    expect(parseUnderlay({ path: 'b/f/x.png', opacity: 4 })).toMatchObject({ opacity: 1, visible: true, locked: false, scale: 1 });
  });
});
