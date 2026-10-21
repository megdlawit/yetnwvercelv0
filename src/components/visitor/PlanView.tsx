// The visitor's 2D map of one floor: pan/zoom, tap a place, the route on top,
// and a live "you are here" dot that the map follows while navigating.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapFeature } from '@/lib/venue/features';
import type { NavEdge, NavNode, Room, Wall } from '@/data/types';
import { DEFAULT_LAYERS, type IndoorLayerId } from '@/lib/venue/mapSettings';
import { useSvgViewport, type Inset } from '@/hooks/useSvgViewport';
import { roomOutline } from '@/lib/venue/features';
import FeatureGlyph from '@/components/venue/FeatureGlyph';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS, CATEGORY_ICONS, PX_PER_METER, type Place } from './types';

export default function PlanView({ floorId, data, selected, start, route, onSelect, places, here, follow, focus, heading, inset, layers, registerControls, theme, onZoomOutExit }: {
  floorId: string | null;
  data: { walls: Wall[]; rooms: Room[]; features: MapFeature[]; nodes: NavNode[]; edges?: NavEdge[] };
  selected: string | null; start: string | null;
  route: { x: number; y: number }[] | null;
  onSelect: (id: string) => void;
  places: Place[];
  /** The visitor's position on this floor. */
  here: { x: number; y: number } | null;
  /** Keep the map centred on `here` (while navigating). */
  follow: boolean;
  /** Bump `nonce` to centre and zoom in on a spot (Explore, search results). */
  focus?: { x: number; y: number; nonce: number } | null;
  /** Which way the visitor faces (degrees on the plan, 0 = right), from the compass. */
  heading?: number | null;
  /** Screen pixels hidden by the floating panel / bottom sheet. */
  inset?: Inset;
  /** Which details to draw (Map Layers). Omitted: everything except walkways. */
  layers?: Partial<Record<IndoorLayerId, boolean>>;
  /** Hands out zoom / recenter for map buttons outside the plan. */
  registerControls?: (controls: { zoomIn: () => void; zoomOut: () => void; recenter: () => void }) => void;
  /** The venue's colours (route, rooms). */
  theme?: { primary: string; route: string; slab: string; ground: string };
  /** Zoomed out until the floor is small in the middle (go to the outdoor map). */
  onZoomOutExit?: () => void;
}) {
  const show = { ...DEFAULT_LAYERS, ...layers };
  const viewport = useSvgViewport();
  const k = 1 / viewport.scale;
  const [drag, setDrag] = useState<{ x: number; y: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const bounds = useMemo(() => {
    const xs: number[] = [], ys: number[] = [];
    data.walls.forEach(w => { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); });
    data.rooms.forEach(r => { xs.push(r.x, r.x + r.width); ys.push(r.y, r.y + r.height); });
    data.nodes.forEach(n => { xs.push(n.x); ys.push(n.y); });
    return xs.length ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } : null;
  }, [data]);

  // Fit when the floor changes or the map first gets a size.
  const { fitTo, size, centerOn, zoomBy } = viewport;
  useEffect(() => {
    registerControls?.({ zoomIn: () => zoomBy(1.35), zoomOut: () => zoomBy(1 / 1.35), recenter: () => { if (bounds) fitTo(bounds, 32, inset); } });
  }, [registerControls, zoomBy, fitTo, bounds, inset]);
  useEffect(() => { if (bounds && size.w > 0) fitTo(bounds, 32, inset); }, [floorId, size.w > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  // Zooming well out past the whole floor heads outside (after a short pause, and again only once zoomed back in).
  const exitArmed = useRef(true);
  useEffect(() => {
    if (!onZoomOutExit || !bounds || size.w <= 0) return;
    const fit = Math.min(size.w / Math.max(1, bounds.maxX - bounds.minX), size.h / Math.max(1, bounds.maxY - bounds.minY));
    const ratio = viewport.scale / fit;
    if (ratio > 0.6) { exitArmed.current = true; return; }
    if (ratio > 0.4 || !exitArmed.current) return;
    const t = setTimeout(() => { exitArmed.current = false; onZoomOutExit(); }, 280);
    return () => clearTimeout(t);
  }, [viewport.scale, size.w, size.h, bounds, onZoomOutExit]);
  useEffect(() => { if (follow && here && size.w > 0 && !drag) centerOn(here.x, here.y, 0, inset); }, [follow, here?.x, here?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focus && focus.nonce > 0 && size.w > 0) centerOn(focus.x, focus.y, 1.1, inset); }, [focus?.nonce, size.w > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const placesHere = useMemo(() => places.filter(p => p.floorId === floorId), [places, floorId]);
  const nodeById = useMemo(() => new Map(data.nodes.map(n => [n.id, n] as const)), [data.nodes]);
  // Place names that don't collide: the picked and hovered place first, then the rest in order.
  const nameTags = useMemo(() => {
    const wantAll = show.labels && viewport.scale > 0.45;
    const order = [...placesHere].sort((a, b) => Number(b.id === selected) * 2 + Number(b.id === hover) - (Number(a.id === selected) * 2 + Number(a.id === hover)));
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const out: { id: string; name: string; x: number; y: number; fs: number; strong: boolean }[] = [];
    for (const p of order) {
      const strong = p.id === selected || p.id === hover;
      if (!wantAll && !strong) continue;
      const r = (p.id === selected ? 15 : p.id === hover ? 12.5 : 11) * k;
      const fs = (strong ? 13 : 11) * k, y = p.y - r - 6 * k;
      const w = p.name.length * fs * 0.56 + 6 * k, h = fs * 1.25;
      const b = { x0: p.x - w / 2, y0: y - h, x1: p.x + w / 2, y1: y + fs * 0.3 };
      // Names keep clear of each other and of other places' pins.
      const hitsName = boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
      const hitsPin = placesHere.some(q => q.id !== p.id && q.x + 11 * k > b.x0 && q.x - 11 * k < b.x1 && q.y + 11 * k > b.y0 && q.y - 11 * k < b.y1);
      if (!strong && (hitsName || hitsPin)) continue;
      boxes.push(b);
      out.push({ id: p.id, name: p.name, x: p.x, y, fs, strong });
    }
    return out;
  }, [placesHere, show.labels, viewport.scale, selected, hover, k]);
  const routeColor = theme?.route ?? '#0ea5e9';
  const vb = viewport.viewBox;
  return (
    <div ref={viewport.ref} className="h-full w-full select-none bg-muted/40 touch-none" style={theme ? { background: `linear-gradient(180deg, ${theme.ground}33, ${theme.ground}66)` } : undefined}>
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className={cn('h-full w-full', drag?.moved ? 'cursor-grabbing' : 'cursor-grab')}
        onPointerDown={e => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ x: e.clientX, y: e.clientY, moved: false }); }}
        onPointerMove={e => {
          if (!drag) return;
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
          if (drag.moved || Math.hypot(dx, dy) > 4) { viewport.panByScreen(dx, dy); setDrag({ x: e.clientX, y: e.clientY, moved: true }); }
        }}
        onPointerUp={() => setDrag(null)}>
        {show.rooms && data.rooms.map(r => (
          <polygon key={r.id} points={roomOutline(r).map(p => `${p.x},${p.y}`).join(' ')}
            fill={r.nodeId && r.nodeId === selected ? 'hsl(var(--primary) / 0.18)' : theme ? theme.slab : 'hsl(var(--nav-room))'}
            stroke="hsl(var(--border))" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {show.walls && (
          <path d={data.walls.map(w => `M${w.x1} ${w.y1}L${w.x2} ${w.y2}`).join('')} stroke="hsl(var(--foreground) / 0.75)" strokeWidth={2.5}
            strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke" />
        )}
        {show.paths && data.edges && (
          <path d={data.edges.map(e => { const a = nodeById.get(e.fromNodeId), b = nodeById.get(e.toNodeId); return a && b ? `M${a.x} ${a.y}L${b.x} ${b.y}` : ''; }).join('')}
            stroke={theme?.primary ?? 'hsl(var(--primary))'} strokeOpacity={0.35} strokeWidth={5} strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke" className="pointer-events-none" />
        )}
        {data.features.filter(f => (f.kind === 'label' ? show.labels && viewport.scale > 0.6 : show.objects)).map(f => (
          <g key={f.id} className="pointer-events-none"><FeatureGlyph f={f} pxPerMeter={PX_PER_METER} k={k} selected={false} /></g>
        ))}
        {route && route.length > 1 && (
          <>
            <polyline points={route.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={routeColor} strokeWidth={12} strokeLinecap="round"
              strokeLinejoin="round" vectorEffect="non-scaling-stroke" strokeOpacity={0.2} />
            <polyline points={route.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={routeColor} strokeWidth={5} strokeLinecap="round"
              strokeLinejoin="round" vectorEffect="non-scaling-stroke" strokeOpacity={0.95} strokeDasharray="1 10">
              <animate attributeName="stroke-dashoffset" from="22" to="0" dur="1s" repeatCount="indefinite" />
            </polyline>
            <polyline points={route.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={routeColor} strokeWidth={5} strokeLinecap="round"
              strokeLinejoin="round" vectorEffect="non-scaling-stroke" strokeOpacity={0.55} />
          </>
        )}
        {placesHere.map(p => {
          const isSel = p.id === selected, isStart = p.id === start && !!route, isHover = p.id === hover;
          const color = isStart ? '#0ea5e9' : CATEGORY_COLORS[p.category];
          const Icon = CATEGORY_ICONS[p.category];
          const r = (isSel ? 15 : isHover ? 12.5 : 11) * k;
          return (
            <g key={p.id} className="cursor-pointer" onClick={e => { e.stopPropagation(); if (!drag?.moved) onSelect(p.id); }}
              onPointerEnter={() => setHover(p.id)} onPointerLeave={() => setHover(h => (h === p.id ? null : h))}>
              {isSel && (
                <circle cx={p.x} cy={p.y} r={r * 1.6} fill={color} opacity={0.25}>
                  <animate attributeName="r" values={`${r * 1.2};${r * 2.1};${r * 1.2}`} dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.35;0;0.35" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={p.x} cy={p.y + 1.5 * k} r={r} fill="#000" opacity={0.18} />
              <circle cx={p.x} cy={p.y} r={r} fill={color} stroke="#fff" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
              <Icon x={p.x - r * 0.55} y={p.y - r * 0.55} width={r * 1.1} height={r * 1.1} color="#fff" strokeWidth={2.4} className="pointer-events-none" />
            </g>
          );
        })}
        {/* Names above every pin, and only where they fit (the picked and hovered place first). */}
        {nameTags.map(t => (
          <text key={t.id} x={t.x} y={t.y} textAnchor="middle" fontSize={t.fs} stroke="hsl(var(--background))" strokeWidth={3.5 * k}
            paintOrder="stroke" className={cn('pointer-events-none fill-foreground', t.strong && 'font-semibold')}>{t.name}</text>
        ))}
        {here && (
          <g className="pointer-events-none" aria-label="You are here">
            <circle cx={here.x} cy={here.y} r={22 * k} fill="#0ea5e9" opacity={0.18}>
              <animate attributeName="r" values={`${12 * k};${26 * k};${12 * k}`} dur="2s" repeatCount="indefinite" />
            </circle>
            {heading != null && (
              <path d={`M0 0 L${34 * k} ${-15 * k} A${37 * k} ${37 * k} 0 0 1 ${34 * k} ${15 * k} Z`} fill="#0ea5e9" opacity={0.3}
                transform={`translate(${here.x} ${here.y}) rotate(${heading})`} />
            )}
            <circle cx={here.x} cy={here.y} r={8 * k} fill="#0ea5e9" stroke="#fff" strokeWidth={3} vectorEffect="non-scaling-stroke" />
          </g>
        )}
      </svg>
    </div>
  );
}
