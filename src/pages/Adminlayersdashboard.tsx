// Map layers — the control center's editor for what every visitor sees on
// the outdoor world map: buildings (3D), parking, routes, walkways, stores,
// entrances and live events.
//
// Draw straight on the real map (click to place, click-click-Enter for lines
// and shapes, drag the handles to reshape), switch to the 3D scene for the
// stylised overview, and everything saves to the database by itself — the
// visitor map draws it with the same renderer (src/lib/layers/worldLayers).

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from 'react';
import maplibregl, { type Map as MLMap, type GeoJSONSource } from 'maplibre-gl';
import {
  Box, Building2, Check, ChevronLeft, Clipboard, Copy, Crosshair, DoorOpen, Eye, Globe2, Layers, Loader2, MapPin,
  Navigation, ParkingCircle, Plus, RefreshCw, Store, Theater, Trash2, Truck, Upload, X, AlertTriangle, Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import BaseMap from '@/components/BaseMap';
import MapTypeSwitcher from '@/components/MapTypeSwitcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_MAP_STYLE_ID, MAP_STYLE_STORAGE_KEY, type MapStyleId } from '@/lib/mapStyles';
import type { CustomLayer } from '@/lib/customLayers';
import { useAdminLayers } from '@/hooks/useAdminLayers';
import { fitToLayers, layerPoints, useWorldLayers, type LayerPick } from '@/lib/layers/worldLayers';
import type { LandmarkArea, LandmarkItem, LandmarkLine } from '@/components/landmarks/LandmarkMap';
import type { LandmarkKind } from '@/lib/landmarks/landmarks';

// three.js only loads with the 3D scene.
const LandmarkMap = lazy(() => import('@/components/landmarks/LandmarkMap'));

// ─── The catalogue ────────────────────────────────────────────────────────────
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;
type Geometry = 'point' | 'line' | 'polygon';
type LL = { lat: number; lng: number };
// Features are loosely typed JSON from the database.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Feat = Record<string, any> & { id: string; name: string };

const LAYER_TYPES = {
  stores:    { icon: Store,         label: 'Stores',           one: 'store',     geometry: 'point',   color: '#7c3aed', desc: 'Shops, cafés and services' },
  entrances: { icon: DoorOpen,      label: 'Entrances',        one: 'entrance',  geometry: 'point',   color: '#16a34a', desc: 'Gates and step-free ways in' },
  events:    { icon: Theater,       label: 'Events',           one: 'event',     geometry: 'point',   color: '#dc2626', desc: 'Shows and happenings — pulse when live' },
  buildings: { icon: Building2,     label: 'Buildings',        one: 'building',  geometry: 'polygon', color: '#1d4ed8', desc: '3D footprints, height from floors' },
  parking:   { icon: ParkingCircle, label: 'Parking',          one: 'parking area', geometry: 'polygon', color: '#0891b2', desc: 'Zones with live free spaces' },
  navpaths:  { icon: Navigation,    label: 'Walkways',         one: 'walkway',   geometry: 'line',    color: '#1a7a45', desc: 'Guided walking routes, flowing on the map' },
  routes:    { icon: Truck,         label: 'Service routes',   one: 'route',     geometry: 'line',    color: '#d97706', desc: 'Delivery and staff paths' },
} as const satisfies Record<string, { icon: IconComponent; label: string; one: string; geometry: Geometry; color: string; desc: string }>;
type LayerType = keyof typeof LAYER_TYPES;

interface Layer { id: string; name: string; type: LayerType; color: string; visible: boolean; features: Feat[] }

type Field =
  | { key: string; label: string; kind: 'text' | 'number' | 'datetime' }
  | { key: string; label: string; kind: 'select'; options: string[] }
  | { key: string; label: string; kind: 'toggle'; hint?: string };

const FIELDS: Record<LayerType, Field[]> = {
  stores: [{ key: 'category', label: 'Category', kind: 'select', options: ['retail', 'food', 'culture', 'service'] }, { key: 'isOpen', label: 'Open now', kind: 'toggle' }],
  entrances: [{ key: 'isMainEntrance', label: 'Main entrance', kind: 'toggle' }, { key: 'isAccessible', label: 'Step-free', kind: 'toggle', hint: 'Wheelchair users can use it' }],
  events: [
    { key: 'category', label: 'Category', kind: 'select', options: ['performance', 'exhibit', 'food', 'sport', 'workshop'] },
    { key: 'startTime', label: 'Starts', kind: 'datetime' }, { key: 'endTime', label: 'Ends', kind: 'datetime' },
    { key: 'isLive', label: 'Live now', kind: 'toggle', hint: 'Also live automatically between its times' },
  ],
  buildings: [{ key: 'floors', label: 'Floors', kind: 'number' }, { key: 'use', label: 'Use', kind: 'select', options: ['cultural', 'civic', 'commercial', 'residential', 'utility'] }],
  parking: [{ key: 'capacity', label: 'Spaces', kind: 'number' }, { key: 'available', label: 'Free now', kind: 'number' }, { key: 'type', label: 'Type', kind: 'select', options: ['surface', 'covered', 'vip', 'staff'] }],
  navpaths: [{ key: 'difficulty', label: 'Difficulty', kind: 'select', options: ['easy', 'moderate', 'hard'] }],
  routes: [{ key: 'mode', label: 'Mode', kind: 'select', options: ['delivery', 'service', 'emergency', 'supply'] }, { key: 'isActive', label: 'Active', kind: 'toggle' }],
};

const hourFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const DEFAULTS: Record<LayerType, () => Record<string, unknown>> = {
  stores: () => ({ category: 'retail', isOpen: true }),
  entrances: () => ({ isMainEntrance: false, isAccessible: true }),
  events: () => ({ category: 'performance', isLive: false, startTime: hourFromNow(1), endTime: hourFromNow(3) }),
  buildings: () => ({ floors: 2, use: 'cultural' }),
  parking: () => ({ capacity: 50, available: 50, type: 'surface' }),
  navpaths: () => ({ difficulty: 'easy', distanceM: 0 }),
  routes: () => ({ mode: 'service', isActive: true }),
};

// ─── Samples for a brand-new platform (Unity Park, Addis Ababa) ──────────────
const PARK: LL = { lat: 9.0192, lng: 38.7628 };
const off = (dLat: number, dLng: number) => ({ lat: PARK.lat + dLat, lng: PARK.lng + dLng });
const rect = (cLat: number, cLng: number, dLat: number, dLng: number) => [off(cLat - dLat, cLng - dLng), off(cLat - dLat, cLng + dLng), off(cLat + dLat, cLng + dLng), off(cLat + dLat, cLng - dLng)];
const SAMPLE_LAYERS: Layer[] = [
  { id: 'layer-buildings', name: 'Buildings', type: 'buildings', color: '#1d4ed8', visible: true, features: [
    { id: 'b1', name: 'Main Exhibition Hall', floors: 3, use: 'cultural', polygon: rect(0.0005, 0.0008, 0.0004, 0.0007) },
    { id: 'b2', name: 'Admin Block', floors: 2, use: 'civic', polygon: rect(-0.0008, -0.0006, 0.0003, 0.0005) },
  ] },
  { id: 'layer-parking', name: 'Parking', type: 'parking', color: '#0891b2', visible: true, features: [
    { id: 'p1', name: 'Visitor Parking A', capacity: 120, available: 43, type: 'surface', polygon: rect(-0.0018, 0.0014, 0.0005, 0.0008) },
  ] },
  { id: 'layer-entrances', name: 'Entrances', type: 'entrances', color: '#16a34a', visible: true, features: [
    { id: 'e1', name: 'Main Gate', ...off(-0.0016, 0), isAccessible: true, isMainEntrance: true },
    { id: 'e2', name: 'North Entrance', ...off(0.0016, 0), isAccessible: true, isMainEntrance: false },
  ] },
  { id: 'layer-events', name: 'Events', type: 'events', color: '#dc2626', visible: true, features: [
    { id: 'ev1', name: 'Cultural Show', category: 'performance', isLive: false, ...off(0.0014, -0.0004), startTime: hourFromNow(-0.5), endTime: hourFromNow(1) },
  ] },
  { id: 'layer-navpaths', name: 'Walkways', type: 'navpaths', color: '#1a7a45', visible: true, features: [
    { id: 'np1', name: 'Main Promenade', difficulty: 'easy', distanceM: 356, waypoints: [off(-0.0016, 0), off(0, 0), off(0.0016, 0)] },
  ] },
  { id: 'layer-stores', name: 'Stores', type: 'stores', color: '#7c3aed', visible: false, features: [
    { id: 's1', name: 'Gift Shop', category: 'retail', ...off(0.0008, 0.0006), isOpen: true },
    { id: 's2', name: 'Café Selam', category: 'food', ...off(-0.0005, 0.0012), isOpen: true },
  ] },
];

// ─── Geometry helpers ─────────────────────────────────────────────────────────
const isLL = (p: unknown): p is LL => !!p && Number.isFinite((p as LL).lat) && Number.isFinite((p as LL).lng);
function metres(a: LL, b: LL) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const pathLength = (pts: LL[]) => pts.slice(1).reduce((s, p, i) => s + metres(pts[i], p), 0);
function areaM2(pts: LL[]) {
  if (pts.length < 3) return 0;
  const k = Math.cos((pts[0].lat * Math.PI) / 180) * 111320, j = 110540;
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p.lng * k * q.lat * j - q.lng * k * p.lat * j; }
  return Math.abs(a / 2);
}
/** A feature's points, whatever its geometry. */
function vertices(type: LayerType, f: Feat): LL[] {
  const g = LAYER_TYPES[type].geometry;
  if (g === 'point') return isLL(f) ? [{ lat: f.lat, lng: f.lng }] : [];
  return ((g === 'line' ? f.waypoints : f.polygon) ?? []).filter(isLL);
}
function withVertices(type: LayerType, f: Feat, pts: LL[]): Feat {
  const g = LAYER_TYPES[type].geometry;
  if (g === 'point') return { ...f, lat: pts[0].lat, lng: pts[0].lng };
  if (g === 'line') return { ...f, waypoints: pts, ...(type === 'navpaths' ? { distanceM: Math.round(pathLength(pts)) } : {}) };
  return { ...f, polygon: pts };
}
const newId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ─── The 3D scene (the home map's look) ───────────────────────────────────────
const KIND_OF: Partial<Record<LayerType, LandmarkKind>> = { stores: 'bag', events: 'flag', entrances: 'pin', buildings: 'crown', parking: 'pin' };
function useLayerScene(layers: Layer[]) {
  return useMemo(() => {
    const all = layerPoints(layers.filter(l => l.visible) as unknown as CustomLayer[]);
    const c = all.length ? { lat: all.reduce((s, p) => s + p.lat, 0) / all.length, lng: all.reduce((s, p) => s + p.lng, 0) / all.length } : PARK;
    const k = Math.cos((c.lat * Math.PI) / 180);
    const P = (p: LL) => ({ x: (p.lng - c.lng) * k * 111320, y: (c.lat - p.lat) * 110540 });
    const items: LandmarkItem[] = [], lines: LandmarkLine[] = [], areas: LandmarkArea[] = [];
    for (const l of layers) {
      if (!l.visible) continue;
      for (const f of l.features) {
        const id = `${l.id}::${f.id}`, pts = vertices(l.type, f);
        const g = LAYER_TYPES[l.type].geometry;
        if (g === 'line' && pts.length > 1) lines.push({ id, points: pts.map(P), color: l.color, width: l.type === 'navpaths' ? 1.2 : 0.9 });
        else if (g === 'polygon' && pts.length >= 3) {
          const ps = pts.map(P);
          areas.push({ id, points: ps, color: l.color });
          const m = ps.reduce((a, p) => ({ x: a.x + p.x / ps.length, y: a.y + p.y / ps.length }), { x: 0, y: 0 });
          items.push({ id, name: f.name, x: m.x, y: m.y, color: l.color, kind: KIND_OF[l.type] ?? 'pin', sub: l.name, muted: true });
        } else if (g === 'point' && pts.length) {
          const p = P(pts[0]);
          items.push({ id, name: f.name, x: p.x, y: p.y, color: l.type === 'events' && f.isLive ? '#dc2626' : l.color, kind: l.type === 'entrances' && f.isMainEntrance ? 'crown' : KIND_OF[l.type] ?? 'pin', sub: l.name, muted: l.type === 'stores' && f.isOpen === false });
        }
      }
    }
    return { items, lines, areas };
  }, [layers]);
}

// ─── The world map, editable ──────────────────────────────────────────────────
interface Draft { layerId: string; geometry: Geometry; points: LL[] }

function WorldEditor({ layers, selected, onPick, draft, onMapClick, onFinishDraft, onMove, fitSignal, flyTo }: {
  layers: Layer[];
  selected: LayerPick | null;
  onPick: (p: LayerPick) => void;
  draft: Draft | null;
  onMapClick: (p: LL) => void;
  onFinishDraft: () => void;
  onMove: (pts: LL[]) => void;
  fitSignal: number;
  flyTo: { at: LL; key: number } | null;
}) {
  const [map, setMap] = useState<MLMap | null>(null);
  const [styleId, setStyleId] = useState<MapStyleId>(() => { try { return (localStorage.getItem(MAP_STYLE_STORAGE_KEY) as MapStyleId) || DEFAULT_MAP_STYLE_ID; } catch { return DEFAULT_MAP_STYLE_ID; } });
  const [tilt, setTilt] = useState(true);
  const handles = useRef<maplibregl.Marker[]>([]);
  const fitted = useRef(false);
  useEffect(() => { try { localStorage.setItem(MAP_STYLE_STORAGE_KEY, styleId); } catch { /* ignore */ } }, [styleId]);

  const asCustom = layers as unknown as CustomLayer[];
  useWorldLayers(map, asCustom, { onPick, selected });

  // First look: frame the layers.
  useEffect(() => {
    if (!map || fitted.current || !layers.length) return;
    fitted.current = true;
    fitToLayers(map, asCustom, PARK, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, layers.length]);
  useEffect(() => {
    if (map && fitSignal) fitToLayers(map, asCustom, PARK);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);
  useEffect(() => { if (map && flyTo) map.easeTo({ center: [flyTo.at.lng, flyTo.at.lat], zoom: Math.max(map.getZoom(), 17.5), duration: 700 }); }, [map, flyTo]);

  // The shape being drawn.
  useEffect(() => {
    if (!map) return;
    const put = () => {
      if (!map.isStyleLoaded()) return;
      if (!map.getSource('yn-draft')) {
        map.addSource('yn-draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'yn-draft-fill', type: 'fill', source: 'yn-draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#3fdc2c', 'fill-opacity': 0.2 } });
        map.addLayer({ id: 'yn-draft-line', type: 'line', source: 'yn-draft', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#0f3d26', 'line-width': 3, 'line-dasharray': [2, 1.5] } });
        map.addLayer({ id: 'yn-draft-pt', type: 'circle', source: 'yn-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#3fdc2c', 'circle-stroke-color': '#0f3d26', 'circle-stroke-width': 2 } });
      }
      const pts = draft?.points ?? [];
      const c = pts.map(p => [p.lng, p.lat]);
      const features: unknown[] = c.map(x => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: x } }));
      if (c.length >= 2) features.push(draft?.geometry === 'polygon' && c.length >= 3
        ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...c, c[0]]] } }
        : { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } });
      (map.getSource('yn-draft') as GeoJSONSource).setData({ type: 'FeatureCollection', features } as Parameters<GeoJSONSource['setData']>[0]);
    };
    put();
    map.on('style.load', put);
    return () => { map.off('style.load', put); };
  }, [map, draft]);

  // Drawing: double-click finishes (instead of zooming), the cursor is a crosshair.
  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas();
    if (draft) { map.doubleClickZoom.disable(); canvas.style.cursor = 'crosshair'; } else { map.doubleClickZoom.enable(); canvas.style.cursor = ''; }
    const dbl = (e: maplibregl.MapMouseEvent) => { if (draft && draft.geometry !== 'point') { e.preventDefault(); onFinishDraft(); } };
    map.on('dblclick', dbl);
    return () => { map.off('dblclick', dbl); };
  }, [map, draft, onFinishDraft]);

  // Drag handles on the selected feature's points.
  const sel = selected ? layers.find(l => l.id === selected.layerId) : null;
  const selFeat = sel?.features.find(f => f.id === selected?.featureId) ?? null;
  const selPts = sel && selFeat ? vertices(sel.type, selFeat) : [];
  const selKey = JSON.stringify(selPts);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  useEffect(() => {
    handles.current.forEach(m => m.remove());
    handles.current = [];
    if (!map || draft || !selPts.length) return;
    const pts = selPts.map(p => ({ ...p }));
    pts.forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'h-4 w-4 rounded-full border-[3px] border-[#0f3d26] bg-white shadow-md cursor-grab active:cursor-grabbing';
      el.title = 'Drag to move';
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([p.lng, p.lat]).addTo(map);
      m.on('dragend', () => { const ll = m.getLngLat(); pts[i] = { lat: ll.lat, lng: ll.lng }; moveRef.current([...pts]); });
      handles.current.push(m);
    });
    return () => { handles.current.forEach(m => m.remove()); handles.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, draft, selKey]);

  return (
    <div className="relative h-full w-full">
      <BaseMap styleId={styleId} initialCenter={PARK} initialZoom={16} pitch={tilt ? 55 : 0} onMapInstance={setMap} onClick={onMapClick} className="absolute inset-0" />
      <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2">
        <div className="pointer-events-auto"><MapTypeSwitcher value={styleId} onChange={setStyleId} variant="compact" /></div>
        <button onClick={() => setTilt(t => !t)} aria-pressed={tilt} title={tilt ? 'Flat view' : '3D tilt'}
          className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-white text-ink shadow-[0_6px_20px_rgba(20,50,30,.18)] aria-pressed:bg-ink aria-pressed:text-white">
          <Box className="h-[18px] w-[18px]" />
        </button>
        <button onClick={() => map && fitToLayers(map, asCustom, PARK)} title="Show all layers"
          className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-white text-ink shadow-[0_6px_20px_rgba(20,50,30,.18)]">
          <Crosshair className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────
export default function AdminLayersDashboard({ embedded = false }: { embedded?: boolean }) {
  const { layers: raw, setLayers: setRaw, state, error, savedAt, reload } = useAdminLayers(SAMPLE_LAYERS as unknown as CustomLayer[]);
  const layers = raw as unknown as Layer[];
  const setLayers = setRaw as unknown as (v: Layer[] | ((p: Layer[]) => Layer[])) => void;

  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<LayerPick | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [view, setView] = useState<'world' | 'scene'>('world');
  const [adding, setAdding] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);
  const [flyTo, setFlyTo] = useState<{ at: LL; key: number } | null>(null);
  const [venues, setVenues] = useState<{ id: string; name: string; lat: number; lng: number }[]>([]);
  const scene = useLayerScene(layers);

  useEffect(() => {
    supabase.from('buildings').select('id, name, origin_lat, origin_lng').not('origin_lat', 'is', null).order('name').limit(200)
      .then(({ data }) => setVenues((data ?? []).filter(b => b.origin_lat != null && b.origin_lng != null).map(b => ({ id: b.id, name: b.name, lat: b.origin_lat as number, lng: b.origin_lng as number }))));
  }, []);

  const open = layers.find(l => l.id === openId) ?? null;
  const selLayer = selected ? layers.find(l => l.id === selected.layerId) ?? null : null;
  const selFeat = selLayer?.features.find(f => f.id === selected?.featureId) ?? null;

  const updateLayer = (id: string, patch: Partial<Layer>) => setLayers(ls => ls.map(l => (l.id === id ? { ...l, ...patch } : l)));
  const updateFeature = (layerId: string, featureId: string, fn: (f: Feat) => Feat) =>
    setLayers(ls => ls.map(l => (l.id === layerId ? { ...l, features: l.features.map(f => (f.id === featureId ? fn(f) : f)) } : l)));
  const removeFeature = (layerId: string, featureId: string) => {
    setLayers(ls => ls.map(l => (l.id === layerId ? { ...l, features: l.features.filter(f => f.id !== featureId) } : l)));
    setSelected(null);
  };
  const removeLayer = (l: Layer) => {
    if (!window.confirm(`Delete "${l.name}" and its ${l.features.length} item${l.features.length === 1 ? '' : 's'}? Visitors stop seeing it.`)) return;
    setLayers(ls => ls.filter(x => x.id !== l.id));
    setOpenId(null); setSelected(null);
  };
  const pickFeature = useCallback((p: LayerPick) => { setSelected(p); setOpenId(p.layerId); }, []);
  const focus = (l: Layer, f: Feat) => {
    const pts = vertices(l.type, f);
    if (pts.length) setFlyTo({ at: { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length }, key: Date.now() });
  };

  // ── Drawing ──
  const startDraw = (l: Layer) => {
    setView('world'); setSelected(null);
    if (!l.visible) updateLayer(l.id, { visible: true });
    setDraft({ layerId: l.id, geometry: LAYER_TYPES[l.type].geometry, points: [] });
  };
  const commitDraft = useCallback((pts: LL[], d: Draft) => {
    const l = layers.find(x => x.id === d.layerId);
    if (!l) return;
    const n = l.features.length + 1;
    const base: Feat = { id: newId(l.type.slice(0, 2)), name: `${LAYER_TYPES[l.type].one[0].toUpperCase()}${LAYER_TYPES[l.type].one.slice(1)} ${n}`, ...DEFAULTS[l.type]() };
    const f = withVertices(l.type, base, pts);
    setLayers(ls => ls.map(x => (x.id === l.id ? { ...x, features: [...x.features, f] } : x)));
    setDraft(null);
    setSelected({ layerId: l.id, featureId: f.id });
    toast.success(`${f.name} added — name it on the left`);
  }, [layers, setLayers]);
  const finishDraft = useCallback(() => {
    setDraft(d => {
      if (!d) return d;
      const need = d.geometry === 'polygon' ? 3 : 2;
      if (d.points.length < need) { toast.info(`Click at least ${need} points first`); return d; }
      queueMicrotask(() => commitDraft(d.points, d));
      return d;
    });
  }, [commitDraft]);
  const onMapClick = useCallback((p: LL) => {
    if (!draft) return;
    if (draft.geometry === 'point') { commitDraft([p], draft); return; }
    setDraft(d => (d ? { ...d, points: [...d.points, p] } : d));
  }, [draft, commitDraft]);
  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDraft(null);
      else if (e.key === 'Enter') finishDraft();
      else if (e.key === 'Backspace' && !(e.target instanceof HTMLInputElement)) setDraft(d => (d ? { ...d, points: d.points.slice(0, -1) } : d));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, finishDraft]);

  const onMove = useCallback((pts: LL[]) => {
    if (!selected) return;
    const l = layers.find(x => x.id === selected.layerId);
    if (l) updateFeature(l.id, selected.featureId, f => withVertices(l.type, f, pts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, layers]);

  const totalFeatures = layers.reduce((n, l) => n + l.features.length, 0);
  const showing = layers.filter(l => l.visible).length;

  return (
    <div className={cn('flex flex-col gap-4 font-inter', embedded ? 'p-4 sm:p-5' : 'min-h-screen bg-paper p-4 sm:p-6')}>
      {/* ── Top bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        {!embedded && <h1 className="mr-auto font-bricolage text-2xl font-bold text-ink">Map layers</h1>}
        <div className={cn('flex flex-wrap items-center gap-2', embedded && 'mr-auto')}>
          <Stat icon={Layers} label="layers" value={layers.length} />
          <Stat icon={Eye} label="on the map" value={showing} />
          <Stat icon={MapPin} label="items" value={totalFeatures} />
        </div>
        <SaveState state={state} error={error} savedAt={savedAt} onRetry={reload} />
        <select aria-label="Go to a venue" defaultValue="" className="h-9 max-w-[180px] rounded-full border bg-card px-3 text-sm"
          onChange={e => { const v = venues.find(x => x.id === e.target.value); if (v) { setView('world'); setFlyTo({ at: v, key: Date.now() }); } e.target.value = ''; }}>
          <option value="" disabled>Go to a venue…</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => setJsonOpen(true)}><Clipboard className="mr-1.5 h-4 w-4" /> JSON</Button>
        <Button size="sm" className="rounded-full" onClick={() => setAdding(true)}><Plus className="mr-1.5 h-4 w-4" /> New layer</Button>
      </div>

      <div className="grid min-h-0 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* ── Left: layers, then the open layer, then the selected item ── */}
        <aside className="flex max-h-[calc(100dvh-210px)] min-h-[520px] flex-col overflow-hidden rounded-3xl border bg-card">
          {selLayer && selFeat ? (
            <FeaturePanel layer={selLayer} feature={selFeat}
              onBack={() => setSelected(null)}
              onChange={fn => updateFeature(selLayer.id, selFeat.id, fn)}
              onDelete={() => removeFeature(selLayer.id, selFeat.id)}
              onFocus={() => focus(selLayer, selFeat)} />
          ) : open ? (
            <LayerPanel layer={open} drawing={draft?.layerId === open.id}
              onBack={() => setOpenId(null)}
              onChange={p => updateLayer(open.id, p)}
              onDelete={() => removeLayer(open)}
              onDraw={() => startDraw(open)}
              onPick={f => { setSelected({ layerId: open.id, featureId: f.id }); focus(open, f); }} />
          ) : (
            <div className="flex-1 overflow-y-auto p-3">
              <p className="px-2 pb-2 pt-1 text-xs text-sub">Everything here shows on every visitor's outdoor map. Switch a layer off to hide it.</p>
              {state === 'loading' ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-sub"><Loader2 className="h-4 w-4 animate-spin" /> Loading layers…</div>
              ) : layers.length === 0 ? (
                <div className="py-14 text-center">
                  <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-ink/[.06]"><Layers className="h-6 w-6 text-ink" /></span>
                  <p className="font-semibold text-ink">No layers yet</p>
                  <p className="mt-1 text-sm text-sub">Add buildings, parking, walkways or events.</p>
                  <Button size="sm" className="mt-4 rounded-full" onClick={() => setAdding(true)}><Plus className="mr-1.5 h-4 w-4" /> New layer</Button>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {layers.map(l => {
                    const meta = LAYER_TYPES[l.type] ?? LAYER_TYPES.stores;
                    return (
                      <li key={l.id}>
                        <div role="button" tabIndex={0} onClick={() => setOpenId(l.id)} onKeyDown={e => e.key === 'Enter' && setOpenId(l.id)}
                          className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-transparent p-2.5 transition-colors hover:border-border hover:bg-muted/40">
                          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-sm" style={{ background: l.color }}><meta.icon className="h-5 w-5" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink">{l.name}</span>
                            <span className="block truncate text-xs text-sub">{meta.label} · {l.features.length} item{l.features.length === 1 ? '' : 's'}</span>
                          </span>
                          <span onClick={e => e.stopPropagation()}><Switch checked={l.visible} onCheckedChange={v => updateLayer(l.id, { visible: v })} aria-label={l.visible ? 'Hide layer' : 'Show layer'} /></span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </aside>

        {/* ── Right: the map ── */}
        <section className="relative h-[calc(100dvh-210px)] min-h-[520px] overflow-hidden rounded-3xl border bg-muted/40 shadow-[0_18px_50px_rgba(20,50,30,.10)]">
          {view === 'world' ? (
            <WorldEditor layers={layers} selected={selected} onPick={pickFeature} draft={draft} onMapClick={onMapClick} onFinishDraft={finishDraft} onMove={onMove} fitSignal={fitSignal} flyTo={flyTo} />
          ) : (
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-sub">Building the 3D scene…</div>}>
              <LandmarkMap items={scene.items} lines={scene.lines} areas={scene.areas} className="h-full"
                selectedId={selected ? `${selected.layerId}::${selected.featureId}` : null}
                onSelect={id => { if (id) { const [layerId, featureId] = id.split('::'); pickFeature({ layerId, featureId }); } }}
                emptyText="Switch a layer on to see it here in 3D" />
            </Suspense>
          )}

          {/* View switch */}
          <div className="absolute left-3 top-3 flex rounded-full border border-white/80 bg-[rgba(255,253,248,.9)] p-1 shadow-lg backdrop-blur-md" role="group" aria-label="View">
            {([['world', Globe2, 'World map'], ['scene', Box, '3D scene']] as const).map(([v, Icon, label]) => (
              <button key={v} onClick={() => { setView(v); if (v === 'scene') setDraft(null); }} aria-pressed={view === v}
                className={cn('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors', view === v ? 'bg-ink text-white' : 'text-sub hover:text-ink')}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          {/* Legend */}
          {view === 'world' && !draft && (
            <div className="pointer-events-none absolute bottom-3 left-3 hidden max-w-[60%] flex-wrap gap-1.5 sm:flex">
              {layers.filter(l => l.visible).map(l => (
                <span key={l.id} className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-ink shadow backdrop-blur">
                  <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />{l.name}
                </span>
              ))}
            </div>
          )}

          {/* Drawing banner */}
          {draft && (() => {
            const l = layers.find(x => x.id === draft.layerId);
            const need = draft.geometry === 'polygon' ? 3 : 2;
            return (
              <div className="absolute inset-x-3 bottom-3 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-xl">
                <Pencil className="h-4 w-4 shrink-0 text-lime" />
                <span className="min-w-0 flex-1">
                  {draft.geometry === 'point'
                    ? <>Click the map to place the {l ? LAYER_TYPES[l.type].one : 'item'}.</>
                    : <>Click to add points ({draft.points.length}{draft.points.length < need ? `/${need}` : ''}) · double-click or Enter to finish · Backspace undoes a point</>}
                </span>
                {draft.geometry !== 'point' && (
                  <Button size="sm" variant="secondary" className="h-8 rounded-full" disabled={draft.points.length < need} onClick={finishDraft}><Check className="mr-1 h-4 w-4" /> Finish</Button>
                )}
                <Button size="sm" variant="ghost" className="h-8 rounded-full text-white hover:bg-white/10 hover:text-white" onClick={() => setDraft(null)}><X className="mr-1 h-4 w-4" /> Cancel</Button>
              </div>
            );
          })()}
        </section>
      </div>

      {adding && <AddLayer onClose={() => setAdding(false)} onAdd={l => { setLayers(ls => [...ls, l]); setOpenId(l.id); setAdding(false); startDraw(l); }} />}
      {jsonOpen && <JsonDialog layers={layers} onClose={() => setJsonOpen(false)} onImport={next => { setLayers(next); setFitSignal(n => n + 1); }} />}
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────
function Stat({ icon: Icon, label, value }: { icon: IconComponent; label: string; value: number }) {
  return (
    <span className="flex h-9 items-center gap-1.5 rounded-full border bg-card px-3 text-sm">
      <Icon className="h-4 w-4 text-moss" /><b className="tabular-nums text-ink">{value}</b><span className="text-sub">{label}</span>
    </span>
  );
}

function SaveState({ state, error, savedAt, onRetry }: { state: string; error: string | null; savedAt: Date | null; onRetry: () => void }) {
  if (state === 'error') return (
    <span className="flex h-9 max-w-[340px] items-center gap-1.5 rounded-full bg-destructive/10 px-3 text-xs font-medium text-destructive" title={error ?? ''}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{error ?? 'Not saved'}</span>
      <button onClick={onRetry} className="ml-1 shrink-0 underline">Retry</button>
    </span>
  );
  if (state === 'saving' || state === 'loading') return <span className="flex h-9 items-center gap-1.5 rounded-full px-2 text-xs text-sub"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {state === 'loading' ? 'Loading' : 'Saving'}…</span>;
  return <span className="flex h-9 items-center gap-1.5 rounded-full px-2 text-xs text-sub"><Check className="h-3.5 w-3.5 text-emerald-600" /> Saved{savedAt ? ` · ${savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''} · live for visitors</span>;
}

const SWATCHES = ['#1d4ed8', '#0891b2', '#16a34a', '#1a7a45', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#d97706', '#0f3d26'];

function LayerPanel({ layer, drawing, onBack, onChange, onDelete, onDraw, onPick }: {
  layer: Layer; drawing: boolean; onBack: () => void; onChange: (p: Partial<Layer>) => void; onDelete: () => void; onDraw: () => void; onPick: (f: Feat) => void;
}) {
  const meta = LAYER_TYPES[layer.type] ?? LAYER_TYPES.stores;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <button onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted" aria-label="All layers"><ChevronLeft className="h-5 w-5" /></button>
        <span className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ background: layer.color }}><meta.icon className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0 flex-1"><p className="text-[11px] font-bold uppercase tracking-[.12em] text-moss">{meta.label}</p><p className="truncate text-sm font-semibold text-ink">{layer.name}</p></div>
        <Switch checked={layer.visible} onCheckedChange={v => onChange({ visible: v })} aria-label="Show on the map" />
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <label className="block text-xs font-semibold text-sub">Layer name
          <Input className="mt-1" value={layer.name} onChange={e => onChange({ name: e.target.value })} />
        </label>
        <div>
          <p className="text-xs font-semibold text-sub">Colour</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {SWATCHES.map(c => (
              <button key={c} onClick={() => onChange({ color: c })} aria-label={c} className={cn('h-7 w-7 rounded-full ring-offset-2 transition', layer.color === c && 'ring-2 ring-ink')} style={{ background: c }} />
            ))}
            <input type="color" value={layer.color} onChange={e => onChange({ color: e.target.value })} className="h-7 w-9 cursor-pointer rounded-md border bg-transparent p-0.5" aria-label="Custom colour" />
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-sub">{layer.features.length} {layer.features.length === 1 ? meta.one : `${meta.one}s`}</p>
          </div>
          <ul className="space-y-1">
            {layer.features.map(f => {
              const pts = vertices(layer.type, f);
              const info = meta.geometry === 'polygon' ? `${Math.round(areaM2(pts)).toLocaleString()} m²` : meta.geometry === 'line' ? `${Math.round(pathLength(pts))} m` : pts.length ? `${pts[0].lat.toFixed(5)}, ${pts[0].lng.toFixed(5)}` : 'not placed';
              return (
                <li key={f.id}>
                  <button onClick={() => onPick(f)} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-muted/60">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: layer.color }} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{f.name || 'Untitled'}</span><span className="block truncate text-[11px] text-sub">{info}</span></span>
                    <ChevronLeft className="h-4 w-4 rotate-180 text-sub" />
                  </button>
                </li>
              );
            })}
          </ul>
          <Button variant="outline" className="mt-2 w-full rounded-xl border-dashed" onClick={onDraw} disabled={drawing}>
            <Plus className="mr-1.5 h-4 w-4" /> {drawing ? 'Drawing on the map…' : `Add ${meta.one}`}
          </Button>
          <p className="mt-1.5 text-[11px] text-sub">{meta.geometry === 'point' ? 'Then click the map where it is.' : meta.geometry === 'line' ? 'Then click along the route; double-click to finish.' : 'Then click its corners; double-click to finish.'}</p>
        </div>
      </div>
      <div className="border-t p-3">
        <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="mr-1.5 h-4 w-4" /> Delete layer</Button>
      </div>
    </div>
  );
}

function FeaturePanel({ layer, feature, onBack, onChange, onDelete, onFocus }: {
  layer: Layer; feature: Feat; onBack: () => void; onChange: (fn: (f: Feat) => Feat) => void; onDelete: () => void; onFocus: () => void;
}) {
  const meta = LAYER_TYPES[layer.type] ?? LAYER_TYPES.stores;
  const pts = vertices(layer.type, feature);
  const set = (k: string, v: unknown) => onChange(f => ({ ...f, [k]: v }));
  const local = (iso: string) => { const d = new Date(iso); if (!Number.isFinite(d.getTime())) return ''; const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <button onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted" aria-label={`Back to ${layer.name}`}><ChevronLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1"><p className="text-[11px] font-bold uppercase tracking-[.12em]" style={{ color: layer.color }}>{layer.name}</p><p className="truncate text-sm font-semibold text-ink">{feature.name || 'Untitled'}</p></div>
        <button onClick={onFocus} className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted" title="Show on the map"><Crosshair className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
        <label className="block text-xs font-semibold text-sub">Name
          <Input className="mt-1" autoFocus={feature.name.match(/ \d+$/) != null} value={feature.name} onChange={e => set('name', e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          {FIELDS[layer.type].map(fd => fd.kind === 'toggle' ? (
            <label key={fd.key} className="col-span-2 flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5">
              <span><span className="block text-sm font-medium text-ink">{fd.label}</span>{fd.hint && <span className="block text-[11px] text-sub">{fd.hint}</span>}</span>
              <Switch checked={!!feature[fd.key]} onCheckedChange={v => set(fd.key, v)} />
            </label>
          ) : (
            <label key={fd.key} className={cn('block text-xs font-semibold text-sub', fd.kind === 'datetime' && 'col-span-2')}>{fd.label}
              {fd.kind === 'select' ? (
                <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm capitalize text-ink" value={feature[fd.key] ?? ''} onChange={e => set(fd.key, e.target.value)}>
                  {fd.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : fd.kind === 'datetime' ? (
                <Input className="mt-1" type="datetime-local" value={local(feature[fd.key])} onChange={e => e.target.value && set(fd.key, new Date(e.target.value).toISOString())} />
              ) : fd.kind === 'number' ? (
                <Input className="mt-1" type="number" min={0} value={feature[fd.key] ?? ''} onChange={e => set(fd.key, e.target.value === '' ? null : Number(e.target.value))} />
              ) : (
                <Input className="mt-1" value={feature[fd.key] ?? ''} onChange={e => set(fd.key, e.target.value)} />
              )}
            </label>
          ))}
        </div>
        <div className="rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-sub">
          {meta.geometry === 'point' && pts[0] && <>At {pts[0].lat.toFixed(6)}, {pts[0].lng.toFixed(6)}. </>}
          {meta.geometry === 'line' && <>{pts.length} points · {Math.round(pathLength(pts))} m long. </>}
          {meta.geometry === 'polygon' && <>{pts.length} corners · {Math.round(areaM2(pts)).toLocaleString()} m². </>}
          Drag the white handles on the map to {meta.geometry === 'point' ? 'move it' : 'reshape it'}.
        </div>
      </div>
      <div className="border-t p-3">
        <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="mr-1.5 h-4 w-4" /> Delete {meta.one}</Button>
      </div>
    </div>
  );
}

function AddLayer({ onClose, onAdd }: { onClose: () => void; onAdd: (l: Layer) => void }) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-t-3xl bg-card p-5 shadow-2xl sm:rounded-3xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div><h2 className="font-bricolage text-xl font-bold text-ink">New layer</h2><p className="text-sm text-sub">Pick what you want to put on the map — you'll draw it next.</p></div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-muted" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.entries(LAYER_TYPES) as [LayerType, (typeof LAYER_TYPES)[LayerType]][]).map(([type, meta]) => (
            <button key={type} onClick={() => onAdd({ id: newId('layer'), name: meta.label, type, color: meta.color, visible: true, features: [] })}
              className="flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors hover:border-ink/30 hover:bg-muted/40">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: meta.color }}><meta.icon className="h-5 w-5" /></span>
              <span className="min-w-0"><span className="block text-sm font-semibold text-ink">{meta.label}</span><span className="block text-xs text-sub">{meta.desc}</span></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function JsonDialog({ layers, onClose, onImport }: { layers: Layer[]; onClose: () => void; onImport: (l: Layer[]) => void }) {
  const [text, setText] = useState(() => JSON.stringify(layers, null, 2));
  const [copied, setCopied] = useState(false);
  const apply = () => {
    try {
      const next = JSON.parse(text) as Layer[];
      if (!Array.isArray(next) || next.some(l => !l?.id || !LAYER_TYPES[l.type as LayerType] || !Array.isArray(l.features))) throw new Error('Each layer needs an id, a known type and a features list.');
      if (!window.confirm(`Replace all layers with these ${next.length}? Visitors will see the change.`)) return;
      onImport(next); onClose();
      toast.success('Layers imported');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'That is not valid JSON'); }
  };
  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-t-3xl bg-card p-5 shadow-2xl sm:rounded-3xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div><h2 className="font-bricolage text-xl font-bold text-ink">Layers as JSON</h2><p className="text-sm text-sub">Copy to back up or move layers between projects; paste and import to replace them.</p></div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-muted" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} spellCheck={false} className="min-h-[320px] flex-1 resize-none rounded-xl border bg-muted/30 p-3 font-mono text-[11.5px] text-ink" />
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="outline" className="rounded-full" onClick={() => setText(JSON.stringify(layers, null, 2))}><RefreshCw className="mr-1.5 h-4 w-4" /> Reset</Button>
          <Button variant="outline" className="rounded-full" onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })}>
            {copied ? <><Check className="mr-1.5 h-4 w-4" /> Copied</> : <><Copy className="mr-1.5 h-4 w-4" /> Copy</>}
          </Button>
          <Button className="rounded-full" onClick={apply}><Upload className="mr-1.5 h-4 w-4" /> Import</Button>
        </div>
      </div>
    </div>
  );
}

