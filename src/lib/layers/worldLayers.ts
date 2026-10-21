// Custom map layers on the real world map (MapLibre): the same drawing for
// the admin's layer editor and the visitors' outdoor map, so what an admin
// sees is what visitors get.
//
//   buildings → 3D extruded footprints (height from their floors)
//   parking   → low glowing slabs with a "P" badge and live free spaces
//   routes    → glowing lines, dashed when inactive
//   navpaths  → glowing walkways with flowing dashes, coloured by difficulty
//   stores / entrances / events → round badges with an icon and a name pill;
//                live events pulse
//
// Lines and shapes are GL layers (they tilt and extrude with the camera);
// badges are HTML markers, so they need no font glyphs (our base maps are
// raster tiles) and stay crisp. Survives base-map style switches.

import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MLMap, type GeoJSONSource } from 'maplibre-gl';
import type { CustomLayer } from '@/lib/customLayers';

type LL = { lat: number; lng: number };
// Layer features are loosely typed JSON (they come from the database).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Feat = Record<string, any>;

export interface LayerPick { layerId: string; featureId: string }

type GFeature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'LineString'; coordinates: number[][] } };
type GData = Parameters<GeoJSONSource['setData']>[0];

export interface WorldLayersOptions {
  /** Admin: a click selects a feature (no popup). Visitors: a click opens its card. */
  onPick?: (p: LayerPick) => void;
  /** The feature being edited — drawn highlighted. */
  selected?: LayerPick | null;
}

const SRC = { polys: 'yn-layer-polys', lines: 'yn-layer-lines' } as const;
const L = {
  extrude: 'yn-layer-extrude', polyLine: 'yn-layer-poly-outline', glow: 'yn-layer-line-glow',
  line: 'yn-layer-line', lineDash: 'yn-layer-line-dash', flow: 'yn-layer-line-flow',
} as const;
const DIFFICULTY: Record<string, string> = { easy: '#16a34a', moderate: '#d97706', hard: '#dc2626' };

const ICONS: Record<string, string> = {
  stores: '<path d="M4 8h16l-1.2 11.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8z"/><path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"/>',
  entrances: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l4-4-4-4"/><path d="M14 12H4"/>',
  events: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
  parking: '<path d="M9 18V6h4.5a3.5 3.5 0 0 1 0 7H9"/>',
  buildings: '<path d="M4 21V5l8-3 8 3v16"/><path d="M9 21v-5h6v5"/><path d="M9 9h.01M15 9h.01M9 12.5h.01M15 12.5h.01"/>',
  accessible: '<circle cx="12" cy="4.5" r="1.6"/><path d="M10 8h4l-.5 5h3.5l2 5"/><path d="M9.2 11.2A5.5 5.5 0 1 0 15 19"/>',
};
const svg = (paths: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const isLL = (p: unknown): p is LL => !!p && typeof (p as LL).lat === 'number' && typeof (p as LL).lng === 'number' && Number.isFinite((p as LL).lat) && Number.isFinite((p as LL).lng);
const ring = (pts: LL[]) => { const r = pts.filter(isLL).map(p => [p.lng, p.lat]); if (r.length >= 3) r.push(r[0]); return r; };
const centroid = (pts: LL[]): LL => { const v = pts.filter(isLL); return { lat: v.reduce((s, p) => s + p.lat, 0) / v.length, lng: v.reduce((s, p) => s + p.lng, 0) / v.length }; };

/** Is the event on right now (its flag, or its times)? */
export function eventIsLive(f: Feat, now = Date.now()): boolean {
  if (f.isLive) return true;
  const a = Date.parse(f.startTime ?? ''), b = Date.parse(f.endTime ?? '');
  return Number.isFinite(a) && Number.isFinite(b) && a <= now && now <= b;
}

/** Every coordinate in the layers (for fitting the camera). */
export function layerPoints(layers: CustomLayer[]): LL[] {
  const out: LL[] = [];
  for (const l of layers) for (const f of l.features as Feat[]) {
    if (isLL(f)) out.push(f);
    for (const p of [...(f.waypoints ?? []), ...(f.polygon ?? [])]) if (isLL(p)) out.push(p);
  }
  return out;
}

export function fitToLayers(map: MLMap, layers: CustomLayer[], fallback?: LL, duration = 800) {
  const pts = layerPoints(layers);
  if (!pts.length) { if (fallback) map.easeTo({ center: [fallback.lng, fallback.lat], zoom: 16.5, duration }); return; }
  if (pts.length === 1) { map.easeTo({ center: [pts[0].lng, pts[0].lat], zoom: 17.5, duration }); return; }
  const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
  map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 70, maxZoom: 18.5, duration });
}

function geojson(layers: CustomLayer[], selected: LayerPick | null | undefined) {
  const polys: GFeature[] = [], lines: GFeature[] = [];
  for (const l of layers) {
    if (!l.visible) continue;
    for (const f of l.features as Feat[]) {
      const sel = !!selected && selected.layerId === l.id && selected.featureId === f.id;
      const props = { layerId: l.id, featureId: f.id, name: f.name ?? '', color: l.color, type: l.type, selected: sel ? 1 : 0 };
      if ((l.type === 'buildings' || l.type === 'parking') && Array.isArray(f.polygon)) {
        const r = ring(f.polygon);
        if (r.length < 4) continue;
        const height = l.type === 'buildings' ? Math.max(1, Number(f.floors) || 1) * 3.6 : 0.5;
        polys.push({ type: 'Feature', properties: { ...props, height, base: 0 }, geometry: { type: 'Polygon', coordinates: [r] } });
      } else if ((l.type === 'routes' || l.type === 'navpaths') && Array.isArray(f.waypoints)) {
        const c = f.waypoints.filter(isLL).map((p: LL) => [p.lng, p.lat]);
        if (c.length < 2) continue;
        const color = l.type === 'navpaths' ? DIFFICULTY[f.difficulty] ?? l.color : l.color;
        const active = l.type === 'navpaths' ? 1 : f.isActive === false ? 0 : 1;
        lines.push({ type: 'Feature', properties: { ...props, color, active, flow: l.type === 'navpaths' ? 1 : 0 }, geometry: { type: 'LineString', coordinates: c } });
      }
    }
  }
  return { polys: { type: 'FeatureCollection' as const, features: polys }, lines: { type: 'FeatureCollection' as const, features: lines } };
}

let styleInjected = false;
function injectStyle() {
  if (styleInjected || typeof document === 'undefined') return;
  styleInjected = true;
  const el = document.createElement('style');
  el.textContent = `
.ynl-mk{position:absolute;width:max-content;display:flex;flex-direction:column;align-items:center;cursor:pointer;font-family:'Indoor Inter',Inter,system-ui,sans-serif;transform-origin:50% 100%;}
.ynl-badge{position:relative;display:grid;place-items:center;width:34px;height:34px;border-radius:999px;color:#fff;border:2.5px solid #fff;box-shadow:0 6px 16px rgba(15,61,38,.32),0 1px 3px rgba(0,0,0,.2);transition:transform .15s ease;}
.ynl-mk:hover .ynl-badge,.ynl-mk.is-sel .ynl-badge{transform:scale(1.14);}
.ynl-mk.is-sel .ynl-badge{box-shadow:0 0 0 4px rgba(63,220,44,.55),0 8px 20px rgba(15,61,38,.35);}
.ynl-badge.is-muted{filter:grayscale(.85);opacity:.75;}
.ynl-badge.is-p{border-radius:10px;font:800 16px/1 system-ui;}
.ynl-tail{width:2px;height:7px;background:rgba(15,61,38,.45);border-radius:2px;}
.ynl-pill{margin-top:3px;max-width:150px;padding:3px 8px;border-radius:999px;background:rgba(255,253,248,.94);color:#0f3d26;font-size:11px;font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 3px 10px rgba(15,61,38,.18);}
.ynl-pill small{display:block;font-weight:600;font-size:9.5px;color:#4f6b5a;}
.ynl-far .ynl-pill{display:none;}
.ynl-far .ynl-badge{width:26px;height:26px;}
.ynl-ring{position:absolute;inset:-2px;border-radius:999px;border:2px solid currentColor;animation:ynl-ping 1.8s ease-out infinite;pointer-events:none;}
.ynl-ring.r2{animation-delay:.6s;}
@keyframes ynl-ping{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.6);opacity:0}}
.ynl-live{position:absolute;top:-6px;right:-14px;padding:1px 5px;border-radius:999px;background:#dc2626;color:#fff;font:800 8.5px/1.4 system-ui;letter-spacing:.06em;border:1.5px solid #fff;}
.ynl-pop .maplibregl-popup-content{padding:12px 14px;border-radius:16px;box-shadow:0 16px 40px rgba(15,61,38,.22);font-family:'Indoor Inter',Inter,system-ui,sans-serif;color:#0f3d26;min-width:180px;}
.ynl-pop h4{margin:0;font-size:14px;font-weight:800;}
.ynl-pop p{margin:3px 0 0;font-size:12px;color:#4f6b5a;}
.ynl-pop .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;}
.ynl-pop .chips span{padding:2px 8px;border-radius:999px;background:#eef6ee;font-size:11px;font-weight:600;}
.ynl-pop .bar{height:6px;border-radius:999px;background:#e7efe7;margin-top:8px;overflow:hidden;}
.ynl-pop .bar i{display:block;height:100%;border-radius:999px;}
`;
  document.head.appendChild(el);
}

const fmtTime = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; };

/** The card shown when a visitor taps a feature. */
export function featureCard(l: CustomLayer, f: Feat): string {
  const chips: string[] = [];
  let sub = esc(l.name), extra = '';
  switch (l.type) {
    case 'stores': sub = `${esc(f.category ?? 'Shop')} · ${f.isOpen === false ? 'Closed now' : 'Open now'}`; break;
    case 'entrances': if (f.isMainEntrance) chips.push('Main entrance'); chips.push(f.isAccessible ? '♿ Step-free' : 'Has steps'); break;
    case 'events': {
      const live = eventIsLive(f);
      sub = `${live ? '🔴 Live now' : 'Coming up'} · ${fmtTime(f.startTime)}–${fmtTime(f.endTime)}`;
      if (f.category) chips.push(esc(f.category));
      break;
    }
    case 'parking': {
      const cap = Number(f.capacity) || 0, free = Math.max(0, Math.min(cap, Number(f.available ?? cap)));
      sub = `${free} of ${cap} spaces free · ${esc(f.type ?? 'surface')}`;
      const pct = cap ? free / cap : 0;
      extra = `<div class="bar"><i style="width:${Math.round(pct * 100)}%;background:${pct > 0.3 ? '#16a34a' : pct > 0.1 ? '#d97706' : '#dc2626'}"></i></div>`;
      break;
    }
    case 'buildings': sub = `${Number(f.floors) || 1} floor${Number(f.floors) === 1 ? '' : 's'} · ${esc(f.use ?? 'building')}`; break;
    case 'routes': sub = `${esc(f.mode ?? 'route')} · ${f.isActive === false ? 'inactive' : 'active'}`; break;
    case 'navpaths': sub = `${f.distanceM ? `${Math.round(f.distanceM)} m · ` : ''}${esc(f.difficulty ?? 'easy')} walk`; break;
  }
  return `<h4>${esc(f.name)}</h4><p>${sub}</p>${extra}${chips.length ? `<div class="chips">${chips.map(c => `<span>${c}</span>`).join('')}</div>` : ''}`;
}

/**
 * Draws custom layers on a MapLibre map. Call update() whenever layers or
 * the selection change; destroy() removes everything.
 */
export function attachWorldLayers(map: MLMap, opts: WorldLayersOptions = {}) {
  injectStyle();
  let layers: CustomLayer[] = [];
  let selected = opts.selected ?? null;
  let markers: maplibregl.Marker[] = [];
  let popup: maplibregl.Popup | null = null;
  let raf = 0, dashStep = 0, lastDash = 0;
  let alive = true;

  const find = (layerId: string, featureId: string) => {
    const l = layers.find(x => x.id === layerId);
    const f = (l?.features as Feat[] | undefined)?.find(x => x.id === featureId);
    return l && f ? { l, f } : null;
  };
  const pick = (layerId: string, featureId: string, at: [number, number]) => {
    if (opts.onPick) { opts.onPick({ layerId, featureId }); return; }
    const hit = find(layerId, featureId);
    if (!hit) return;
    popup?.remove();
    popup = new maplibregl.Popup({ className: 'ynl-pop', offset: 18, closeButton: false, maxWidth: '260px' }).setLngLat(at).setHTML(featureCard(hit.l, hit.f)).addTo(map);
  };

  const ensure = () => {
    if (!map.getSource(SRC.polys)) map.addSource(SRC.polys, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    if (!map.getSource(SRC.lines)) map.addSource(SRC.lines, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const add = (spec: maplibregl.LayerSpecification) => { if (!map.getLayer(spec.id)) map.addLayer(spec); };
    add({
      id: L.extrude, type: 'fill-extrusion', source: SRC.polys,
      paint: {
        'fill-extrusion-color': ['case', ['==', ['get', 'selected'], 1], '#3fdc2c', ['get', 'color']],
        'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': 0.82, 'fill-extrusion-vertical-gradient': true,
      },
    });
    add({ id: L.polyLine, type: 'line', source: SRC.polys, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'selected'], 1], 3.5, 2], 'line-opacity': 0.95 } });
    add({ id: L.glow, type: 'line', source: SRC.lines, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'selected'], 1], 18, 12], 'line-blur': 8, 'line-opacity': ['case', ['==', ['get', 'active'], 1], 0.45, 0.18] } });
    add({ id: L.line, type: 'line', source: SRC.lines, filter: ['==', ['get', 'active'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3, 19, 6] } });
    add({ id: L.lineDash, type: 'line', source: SRC.lines, filter: ['==', ['get', 'active'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [1.5, 2], 'line-opacity': 0.7 } });
    add({ id: L.flow, type: 'line', source: SRC.lines, filter: ['==', ['get', 'flow'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.2, 19, 2.6], 'line-dasharray': [0, 4, 3], 'line-opacity': 0.9 } });
  };

  // Flowing dashes along walkways (the MapLibre dash-sequence trick).
  const DASHES = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
  const animate = (t: number) => {
    if (!alive) return;
    if (t - lastDash > 70 && map.getLayer(L.flow)) {
      lastDash = t; dashStep = (dashStep + 1) % DASHES.length;
      map.setPaintProperty(L.flow, 'line-dasharray', DASHES[dashStep]);
    }
    raf = requestAnimationFrame(animate);
  };

  const drawMarkers = () => {
    markers.forEach(m => m.remove());
    markers = [];
    const far = map.getZoom() < 15.5;
    for (const l of layers) {
      if (!l.visible) continue;
      for (const f of l.features as Feat[]) {
        let at: LL | null = null;
        if ((l.type === 'stores' || l.type === 'entrances' || l.type === 'events') && isLL(f)) at = f;
        else if ((l.type === 'buildings' || l.type === 'parking') && Array.isArray(f.polygon) && f.polygon.filter(isLL).length >= 3) at = centroid(f.polygon);
        else continue;
        if (!at) continue;
        const sel = !!selected && selected.layerId === l.id && selected.featureId === f.id;
        const el = document.createElement('div');
        el.className = `ynl-mk${sel ? ' is-sel' : ''}${far ? ' ynl-far' : ''}`;
        const live = l.type === 'events' && eventIsLive(f);
        const muted = l.type === 'stores' && f.isOpen === false;
        const color = live ? '#dc2626' : l.color;
        const icon = l.type === 'entrances' && f.isAccessible ? ICONS.accessible : ICONS[l.type] ?? ICONS.stores;
        let sub = '';
        if (l.type === 'parking') { const cap = Number(f.capacity) || 0; sub = `${Math.max(0, Number(f.available ?? cap))}/${cap} free`; }
        else if (l.type === 'events') sub = live ? 'Live now' : fmtTime(f.startTime);
        else if (l.type === 'stores') sub = f.isOpen === false ? 'Closed' : 'Open';
        else if (l.type === 'buildings') sub = `${Number(f.floors) || 1} fl`;
        el.innerHTML = `
          <div class="ynl-badge${muted ? ' is-muted' : ''}${l.type === 'parking' ? ' is-p' : ''}" style="background:${esc(color)};color:#fff">
            ${live ? '<span class="ynl-ring" style="color:#dc2626"></span><span class="ynl-ring r2" style="color:#dc2626"></span><span class="ynl-live">LIVE</span>' : ''}
            ${l.type === 'parking' ? 'P' : svg(icon, 16)}
          </div>
          ${l.type === 'buildings' || l.type === 'parking' ? '' : '<div class="ynl-tail"></div>'}
          <div class="ynl-pill">${esc(f.name)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
        el.addEventListener('click', e => { e.stopPropagation(); pick(l.id, f.id, [at!.lng, at!.lat]); });
        markers.push(new maplibregl.Marker({ element: el, anchor: l.type === 'buildings' || l.type === 'parking' ? 'center' : 'bottom' }).setLngLat([at.lng, at.lat]).addTo(map));
      }
    }
  };

  let waiting = false;
  const draw = () => {
    if (!alive) return;
    // isStyleLoaded() stays false while tiles stream in, so just try; if the
    // style itself isn't ready yet, MapLibre throws — try again when it is.
    try { ensure(); } catch {
      if (!waiting) { waiting = true; map.once('styledata', () => { waiting = false; draw(); }); }
      return;
    }
    const g = geojson(layers, selected);
    (map.getSource(SRC.polys) as GeoJSONSource).setData(g.polys as GData);
    (map.getSource(SRC.lines) as GeoJSONSource).setData(g.lines as GData);
    drawMarkers();
  };

  const onClickShape = (e: maplibregl.MapLayerMouseEvent) => {
    const p = e.features?.[0]?.properties as { layerId?: string; featureId?: string } | undefined;
    if (p?.layerId && p.featureId) pick(p.layerId, p.featureId, [e.lngLat.lng, e.lngLat.lat]);
  };
  const pointer = () => { map.getCanvas().style.cursor = 'pointer'; };
  const unpointer = () => { map.getCanvas().style.cursor = ''; };
  let farNow = map.getZoom() < 15.5;
  const onZoom = () => { const far = map.getZoom() < 15.5; if (far !== farNow) { farNow = far; markers.forEach(m => m.getElement().classList.toggle('ynl-far', far)); } };
  // A base-map switch (setStyle) drops our sources and layers: put them back.
  const onStyle = () => draw();

  map.on('style.load', onStyle);
  map.on('zoom', onZoom);
  for (const id of [L.extrude, L.line, L.lineDash, L.glow]) {
    map.on('click', id, onClickShape);
    map.on('mouseenter', id, pointer);
    map.on('mouseleave', id, unpointer);
  }
  draw();
  raf = requestAnimationFrame(animate);

  return {
    update(next: CustomLayer[], sel: LayerPick | null = selected) { layers = next; selected = sel; draw(); },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      popup?.remove();
      markers.forEach(m => m.remove());
      map.off('style.load', onStyle);
      map.off('zoom', onZoom);
      for (const id of [L.extrude, L.line, L.lineDash, L.glow]) {
        map.off('click', id, onClickShape);
        map.off('mouseenter', id, pointer);
        map.off('mouseleave', id, unpointer);
      }
      try {
        for (const id of Object.values(L)) if (map.getLayer(id)) map.removeLayer(id);
        for (const id of Object.values(SRC)) if (map.getSource(id)) map.removeSource(id);
      } catch { /* the map is already gone */ }
    },
  };
}

/** React glue: draws `layers` on `map` and keeps them in sync. */
export function useWorldLayers(map: MLMap | null, layers: CustomLayer[], opts: WorldLayersOptions = {}) {
  const ref = useRef<ReturnType<typeof attachWorldLayers> | null>(null);
  const pickRef = useRef(opts.onPick);
  pickRef.current = opts.onPick;
  const hasPick = !!opts.onPick;
  useEffect(() => {
    if (!map) return;
    const h = attachWorldLayers(map, { onPick: hasPick ? p => pickRef.current?.(p) : undefined });
    ref.current = h;
    return () => { h.destroy(); ref.current = null; };
  }, [map, hasPick]);
  useEffect(() => { ref.current?.update(layers, opts.selected ?? null); }, [layers, opts.selected, map, hasPick]);
}
