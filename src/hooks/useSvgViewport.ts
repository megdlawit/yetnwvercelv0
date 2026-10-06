// Pan / zoom / fit-to-content for an SVG canvas that fills its container.
//
// The view is a centre point plus a scale (screen px per world unit); the
// SVG viewBox is derived from that and the container's measured size, so the
// viewBox always has the container's aspect ratio and nothing is letterboxed.
// That keeps "1 screen px = 1/scale world units" true everywhere, which the
// editor relies on to draw nodes and labels at a constant on-screen size.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

const MIN_SCALE = 0.02;
const MAX_SCALE = 20;
const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

export type Inset = { left?: number; bottom?: number };

export function useSvgViewport() {
  // A callback ref (not a RefObject): the canvas may mount after this hook
  // first runs (e.g. behind a loading screen), and the observers below must
  // attach whenever it appears.
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setViewState] = useState({ cx: 400, cy: 250, scale: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  // Glides (centerOn) run frame by frame; anything the person does — dragging,
  // zooming, fitting — stops a glide in progress so it never fights them.
  const glide = useRef<number | null>(null);
  const stopGlide = () => { if (glide.current != null) { cancelAnimationFrame(glide.current); glide.current = null; } };
  const setView: typeof setViewState = useCallback(v => { stopGlide(); setViewState(v); }, []);
  useEffect(() => stopGlide, []);

  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const w = (size.w || 800) / view.scale;
  const h = (size.h || 500) / view.scale;
  const viewBox = { x: view.cx - w / 2, y: view.cy - h / 2, w, h };

  // Zoom keeping the world point under (clientX, clientY) fixed on screen.
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const rect = el?.getBoundingClientRect();
    setView(v => {
      const scale = clamp(v.scale * factor);
      if (!rect) return { ...v, scale };
      const sx = clientX - rect.left - rect.width / 2;
      const sy = clientY - rect.top - rect.height / 2;
      return {
        scale,
        cx: v.cx + sx / v.scale - sx / scale,
        cy: v.cy + sy / v.scale - sy / scale,
      };
    });
  }, [el, setView]);

  const zoomBy = useCallback((factor: number) => {
    const rect = el?.getBoundingClientRect();
    if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }, [el, zoomAt]);

  const panByScreen = useCallback((dx: number, dy: number) => {
    setView(v => ({ ...v, cx: v.cx - dx / v.scale, cy: v.cy - dy / v.scale }));
  }, [setView]);

  // `inset`: screen pixels covered by floating panels (left) or a bottom sheet
  // (bottom) — the fit and the centring then use the part still visible.
  const fitTo = useCallback((b: Bounds, paddingPx = 48, inset: Inset = {}) => {
    const { left = 0, bottom = 0 } = inset;
    const cw = (el?.clientWidth || 800) - left, ch = (el?.clientHeight || 500) - bottom;
    const bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
    const scale = clamp(Math.min((cw - paddingPx * 2) / bw, (ch - paddingPx * 2) / bh));
    setView({ cx: (b.minX + b.maxX) / 2 - left / 2 / scale, cy: (b.minY + b.maxY) / 2 + bottom / 2 / scale, scale });
  }, [el, setView]);

  // Bring a world point to the centre of the screen, optionally zooming in
  // to at least `minScale` so the thing being shown is actually visible.
  // Glides there (ease-out) unless `durationMs` is 0.
  const centerOn = useCallback((x: number, y: number, minScale = 0, inset: Inset = {}, durationMs = 320) => {
    const { left = 0, bottom = 0 } = inset;
    const from = viewRef.current;
    const scale = clamp(Math.max(from.scale, minScale));
    const to = { cx: x - left / 2 / scale, cy: y + bottom / 2 / scale, scale };
    stopGlide();
    if (durationMs <= 0 || typeof requestAnimationFrame === 'undefined') { setViewState(to); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs), e = 1 - (1 - t) ** 3;
      setViewState({ cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, scale: from.scale + (to.scale - from.scale) * e });
      glide.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    glide.current = requestAnimationFrame(step);
  }, []);

  // Wheel zoom needs a non-passive native listener to stop the page scrolling.
  useEffect(() => {
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Trackpad two-finger scroll (no ctrl) pans; mouse wheel and pinch
      // (which browsers report as ctrl+wheel) zoom.
      const isTrackpadPan = !e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 0;
      if (isTrackpadPan) { panByScreen(-e.deltaX, -e.deltaY); return; }
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [el, zoomAt, panByScreen]);

  return { ref: setEl, viewBox, scale: view.scale, size, zoomAt, zoomBy, panByScreen, fitTo, centerOn };
}
