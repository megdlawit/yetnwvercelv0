import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEditorHistory } from './useEditorHistory';
import { useSvgViewport } from './useSvgViewport';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

describe('useEditorHistory', () => {
  // A tiny "database": each command appends/removes a value.
  const setup = () => {
    const db: string[] = [];
    const { result } = renderHook(() => useEditorHistory());
    const add = (v: string) => {
      db.push(v);
      result.current.push({
        label: `add ${v}`,
        undo: async () => { db.splice(db.lastIndexOf(v), 1); },
        redo: async () => { db.push(v); },
      });
    };
    return { db, result, add };
  };

  it('undoes and redoes in order', async () => {
    const { db, result, add } = setup();
    act(() => { add('a'); add('b'); });
    expect(result.current.undoLabel).toBe('add b');

    await act(() => result.current.undo());
    expect(db).toEqual(['a']);
    await act(() => result.current.undo());
    expect(db).toEqual([]);
    expect(result.current.canUndo).toBe(false);

    await act(() => result.current.redo());
    expect(db).toEqual(['a']);
    expect(result.current.redoLabel).toBe('add b');
  });

  it('a new action clears the redo stack', async () => {
    const { result, add } = setup();
    act(() => add('a'));
    await act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    act(() => add('c'));
    expect(result.current.canRedo).toBe(false);
  });

  it('ignores a second undo while the first is still running', async () => {
    const { result } = renderHook(() => useEditorHistory());
    let release!: () => void;
    const undo = vi.fn(() => new Promise<void>(r => { release = r; }));
    act(() => {
      result.current.push({ label: 'one', undo: async () => {}, redo: async () => {} });
      result.current.push({ label: 'two', undo, redo: async () => {} });
    });
    let first!: Promise<void>;
    act(() => { first = result.current.undo(); });
    await act(() => result.current.undo()); // should be a no-op
    release();
    await act(() => first);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(result.current.undoLabel).toBe('one');
  });

  it('clears history when an undo fails, so stale steps are never replayed', async () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.push({ label: 'ok', undo: async () => {}, redo: async () => {} });
      result.current.push({ label: 'bad', undo: async () => { throw new Error('network'); }, redo: async () => {} });
    });
    await act(() => result.current.undo());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});

describe('useSvgViewport', () => {
  // jsdom has no ResizeObserver; report the container as 1000 × 500.
  vi.stubGlobal('ResizeObserver', class {
    constructor(private cb: ResizeObserverCallback) {}
    observe() { this.cb([{ contentRect: { width: 1000, height: 500 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    disconnect() {}
  });

  const container = () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 1000 });
    Object.defineProperty(el, 'clientHeight', { value: 500 });
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON() {} });
    return el;
  };

  it('fits content far from the origin into view (the "invisible nodes" bug)', () => {
    const { result } = renderHook(() => useSvgViewport());
    act(() => result.current.ref(container()));
    // An imported plan 300 m wide sitting at negative y.
    act(() => result.current.fitTo({ minX: 0, minY: -9000, maxX: 12000, maxY: -3000 }, 0));
    const vb = result.current.viewBox;
    expect(vb.x).toBeLessThanOrEqual(0);
    expect(vb.x + vb.w).toBeGreaterThanOrEqual(12000);
    expect(vb.y).toBeLessThanOrEqual(-9000);
    expect(vb.y + vb.h).toBeGreaterThanOrEqual(-3000);
  });

  it('zooming keeps the point under the cursor fixed', () => {
    const { result } = renderHook(() => useSvgViewport());
    act(() => result.current.ref(container()));
    act(() => result.current.fitTo({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, 0));
    const before = result.current.viewBox;
    // world point under screen (250, 100)
    const wx = before.x + 250 * (before.w / 1000), wy = before.y + 100 * (before.h / 500);
    act(() => result.current.zoomAt(250, 100, 2));
    const after = result.current.viewBox;
    expect(after.x + 250 * (after.w / 1000)).toBeCloseTo(wx);
    expect(after.y + 100 * (after.h / 500)).toBeCloseTo(wy);
    expect(after.w).toBeCloseTo(before.w / 2);
  });
});
