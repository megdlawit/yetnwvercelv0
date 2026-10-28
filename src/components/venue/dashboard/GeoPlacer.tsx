// "Place on the world map": the plan floats over a satellite map; drag the
// map until the plan lines up with the real site, turn it, fine-tune its
// size, and save. That position (buildings.origin_lat / origin_lng /
// rotation_deg / meters_per_pixel) puts the venue in the outdoor view and
// lets GPS work with it.

import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { toast } from 'sonner';
import { LocateFixed, RotateCw, RotateCcw, Loader2, Satellite, Map as MapIcon, Trash2, Crosshair } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { indoorToGeo } from '@/lib/geo/GeoMath';
import { anchorForCenter, anchorOf, DEFAULT_MPP, planBounds } from '@/lib/venue/geoVenue';
import { roomOutline } from '@/lib/venue/features';
import { useFloorGeometry } from './VenueViewer';
import { useFloorDrawing } from '@/components/visitor/useFloorDrawing';
import { drawingGeoJSON } from '@/lib/venue/geoVenue';
import type { VenueData } from './useVenue';
import PlaceSearch from './PlaceSearch';
import { readLatLng, type PlaceSuggestion } from '@/hooks/usePlaceSuggestions';

const SATELLITE: StyleSpecification = {
  version: 8,
  sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: '© Esri, Maxar, Earthstar Geographics' } },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};
const STREETS = 'https://tiles.openfreemap.org/styles/liberty';
const ADDIS = { lat: 9.0108, lng: 38.7613 };

export default function GeoPlacer({ data, onSaved }: { data: VenueData; onSaved: () => void }) {
  const b = data.building;
  const ground = useMemo(() => [...data.floors].sort((x, y) => x.level - y.level)[0], [data.floors]);
  const geo = useFloorGeometry(b.id, ground?.id ?? null);
  // The architect's drawing, when the floor was imported from CAD: much easier to line up than bare walls.
  const drawing = useFloorDrawing(ground?.id ?? null, true);
  const saved = anchorOf(b);
  const [rotation, setRotation] = useState(saved?.rotationDeg ?? 0);
  const [scale, setScale] = useState(saved ? saved.metersPerPixel / DEFAULT_MPP : 1);
  const [opacity, setOpacity] = useState(0.85);
  const [base, setBase] = useState<'satellite' | 'streets'>('satellite');
  const [busy, setBusy] = useState<'save' | null>(null);
  // Where the map is looking, so suggestions favour places nearby.
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  // The crosshair's coordinates, which is where the plan's centre lands; type to go there.
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');
  const [coordError, setCoordError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const live = useRef({ rotation, scale, opacity });
  live.current = { rotation, scale, opacity };

  const bounds = useMemo(() => (geo ? planBounds(geo.walls, geo.rooms, geo.nodes) : null), [geo]);
  const center = bounds ? { x: bounds.cx, y: bounds.cy } : { x: 0, y: 0 };
  const centerRef = useRef(center);
  centerRef.current = center;
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  // Draw the plan where it would land if saved now (centred on the map's centre).
  const draw = () => {
    const map = mapRef.current, g = geoRef.current;
    if (!map || !g || !map.getSource('plan-walls')) return;
    const c = map.getCenter();
    const a = anchorForCenter({ lat: c.lat, lng: c.lng }, centerRef.current, live.current.rotation, DEFAULT_MPP * live.current.scale);
    const pt = (x: number, y: number) => { const p = indoorToGeo(a, x, y); return [p.lng, p.lat]; };
    // Redrawn on every move: the building's shell is what you line up, so furniture stays out.
    const dr = drawingGeoJSON(a, drawingRef.current, {}, ['furniture', 'trees']);
    (map.getSource('plan-drawing') as maplibregl.GeoJSONSource | undefined)?.setData(dr.planLines as never);
    (map.getSource('plan-poche') as maplibregl.GeoJSONSource | undefined)?.setData(dr.planPoche as never);
    (map.getSource('plan-walls') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection', features: (dr.planLines.features.length ? [] : g.walls).map(w => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [pt(w.x1, w.y1), pt(w.x2, w.y2)] } })),
    });
    (map.getSource('plan-rooms') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection', features: g.rooms.map(r => { const ring = roomOutline(r).map(p => pt(p.x, p.y)); return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } }; }),
    });
    map.setPaintProperty('plan-walls', 'line-opacity', live.current.opacity);
    map.setPaintProperty('plan-rooms', 'fill-opacity', live.current.opacity * (dr.planLines.features.length ? 0.15 : 0.35));
    if (map.getLayer('plan-drawing')) map.setPaintProperty('plan-drawing', 'line-opacity', live.current.opacity);
    if (map.getLayer('plan-poche')) map.setPaintProperty('plan-poche', 'fill-opacity', live.current.opacity * 0.8);
  };

  useEffect(() => {
    if (!box.current) return;
    const start = saved ? indoorToGeo(saved, centerRef.current.x, centerRef.current.y) : ADDIS;
    const map = new maplibregl.Map({ container: box.current, style: SATELLITE, center: [start.lng, start.lat], zoom: saved ? 18 : 15, dragRotate: false, pitchWithRotate: false, attributionControl: { compact: true } });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    mapRef.current = map;
    map.on('style.load', () => {
      if (!map.getSource('plan-walls')) map.addSource('plan-walls', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      if (!map.getSource('plan-rooms')) map.addSource('plan-rooms', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      if (!map.getLayer('plan-rooms')) map.addLayer({ id: 'plan-rooms', type: 'fill', source: 'plan-rooms', paint: { 'fill-color': '#facc15', 'fill-opacity': 0.3 } });
      if (!map.getLayer('plan-walls')) map.addLayer({ id: 'plan-walls', type: 'line', source: 'plan-walls', paint: { 'line-color': '#fde047', 'line-width': 2 } });
      for (const id of ['plan-drawing', 'plan-poche']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      if (!map.getLayer('plan-poche')) map.addLayer({ id: 'plan-poche', type: 'fill', source: 'plan-poche', paint: { 'fill-color': '#fde047', 'fill-opacity': 0.7 } });
      if (!map.getLayer('plan-drawing')) map.addLayer({ id: 'plan-drawing', type: 'line', source: 'plan-drawing', paint: {
        'line-color': '#fde047', 'line-width': ['match', ['get', 'layer'], 'walls', 1.8, 'furniture', 0.7, 1],
      } });
      draw();
    });
    let raf = 0;
    map.on('move', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
    const look = () => {
      const c = map.getCenter();
      setNear({ lat: c.lat, lng: c.lng });
      setLatText(c.lat.toFixed(6)); setLngText(c.lng.toFixed(6)); setCoordError(null);
    };
    map.on('moveend', look);
    look();
    return () => { cancelAnimationFrame(raf); map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { draw(); }, [rotation, scale, opacity, geo, drawing]);  
  const firstBase = useRef(true);
  useEffect(() => {
    if (firstBase.current) { firstBase.current = false; return; }
    mapRef.current?.setStyle(base === 'satellite' ? SATELLITE : STREETS);
  }, [base]);

  // Fit the zoom to the plan's size once it has loaded (first placement only).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bounds || saved) return;
    const metres = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * DEFAULT_MPP;
    if (metres > 0) map.setZoom(Math.min(19, Math.max(14, Math.log2(40075000 * Math.cos(map.getCenter().lat * Math.PI / 180) / (metres * 3)) - 0.5)));
  }, [bounds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly to a picked place: fit a park or campus whole, zoom in close on a point.
  const goTo = (p: PlaceSuggestion) => {
    const map = mapRef.current;
    if (!map) return;
    const e = p.extent;
    if (e && Math.abs(e[2] - e[0]) > 0.0004 && Math.abs(e[3] - e[1]) > 0.0004) {
      map.fitBounds([[e[0], e[1]], [e[2], e[3]]], { padding: 40, maxZoom: 18.5, duration: 1400 });
    } else map.flyTo({ center: [p.lng, p.lat], zoom: 17.5, duration: 1400 });
  };

  const goToCoords = () => {
    const p = readLatLng(latText, lngText);
    if ('error' in p) { setCoordError(p.error); return; }
    setCoordError(null);
    mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: Math.max(18, mapRef.current.getZoom()), duration: 1400 });
  };

  const locate = () => navigator.geolocation?.getCurrentPosition(
    p => mapRef.current?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 18 }),
    () => toast.error('Could not get your location.'), { enableHighAccuracy: true });

  const save = async (remove = false) => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const a = anchorForCenter({ lat: c.lat, lng: c.lng }, center, rotation, DEFAULT_MPP * scale);
    setBusy('save');
    const { error } = await supabase.from('buildings').update(remove
      ? { origin_lat: null, origin_lng: null }
      : { origin_lat: a.originLat, origin_lng: a.originLng, rotation_deg: Math.round(rotation * 10) / 10, meters_per_pixel: a.metersPerPixel }).eq('id', b.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(remove ? 'Removed from the world map' : 'Saved — visitors get the outdoor view after you publish');
    onSaved();
  };

  const turn = (d: number) => setRotation(r => ((r + d) % 360 + 360) % 360);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <PlaceSearch near={near} onPick={goTo} onLocate={locate} className="flex-1"
          placeholder="Search a place, address or coordinates — e.g. Unity Park, Addis Ababa" />
        <Button type="button" variant="outline" size="icon" onClick={locate} aria-label="Use my location" title="Use my location"><LocateFixed className="h-4 w-4" /></Button>
      </div>

      <div className="relative h-[460px] overflow-hidden rounded-2xl border">
        <div ref={box} className="absolute inset-0" />
        <Crosshair className="pointer-events-none absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow" />
        <div className="absolute left-3 top-3 flex gap-1 rounded-xl border bg-card/95 p-1 shadow">
          {([['satellite', Satellite, 'Satellite'], ['streets', MapIcon, 'Map']] as const).map(([id, Icon, label]) => (
            <button key={id} onClick={() => setBase(id)} aria-pressed={base === id} className={cn('flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium', base === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        {!geo?.walls.length && !geo?.rooms.length && (
          <div className="absolute inset-x-0 bottom-0 bg-card/95 p-3 text-center text-sm text-muted-foreground">Upload a plan in the map editor first — then line it up here.</div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Drag the map until the yellow plan sits on the real site, then turn and size it to match — or type its coordinates.</p>

      <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); goToCoords(); }}>
        <label className="min-w-[9rem] flex-1 space-y-1 text-xs font-medium">
          Latitude
          <Input value={latText} onChange={e => setLatText(e.target.value)} inputMode="decimal" placeholder="9.010800" aria-invalid={!!coordError} className="h-9 tabular-nums" />
        </label>
        <label className="min-w-[9rem] flex-1 space-y-1 text-xs font-medium">
          Longitude
          <Input value={lngText} onChange={e => setLngText(e.target.value)} inputMode="decimal" placeholder="38.761300" aria-invalid={!!coordError} className="h-9 tabular-nums" />
        </label>
        <Button type="submit" variant="outline" className="h-9"><Crosshair className="mr-1.5 h-4 w-4" /> Go</Button>
        <p className={cn('basis-full text-[11px]', coordError ? 'text-destructive' : 'text-muted-foreground')}>
          {coordError ?? "The plan's centre goes at the crosshair. Paste “9.0108, 38.7613” into either box, or use N/S/E/W."}
        </p>
      </form>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs"><span className="font-medium">Rotation</span><span className="tabular-nums text-muted-foreground">{Math.round(rotation)}°</span></div>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => turn(-1)} aria-label="Turn left 1°"><RotateCcw className="h-3.5 w-3.5" /></Button>
            <Slider value={[rotation]} min={0} max={359} step={0.5} onValueChange={([v]) => setRotation(v)} aria-label="Rotation" />
            <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => turn(1)} aria-label="Turn right 1°"><RotateCw className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs"><span className="font-medium">Size</span><span className="tabular-nums text-muted-foreground">{Math.round(scale * 100)}%</span></div>
          <Slider value={[scale]} min={0.5} max={1.5} step={0.005} onValueChange={([v]) => setScale(v)} aria-label="Size" />
          <p className="text-[11px] text-muted-foreground">100% = the plan's own scale. Adjust only if it doesn't match.</p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs"><span className="font-medium">Plan visibility</span><span className="tabular-nums text-muted-foreground">{Math.round(opacity * 100)}%</span></div>
          <Slider value={[opacity]} min={0.15} max={1} step={0.05} onValueChange={([v]) => setOpacity(v)} aria-label="Plan visibility" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save()} disabled={busy === 'save' || !bounds}>{busy === 'save' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} {saved ? 'Save new position' : 'Place venue here'}</Button>
        {saved && <Button variant="ghost" className="text-destructive" onClick={() => save(true)} disabled={busy === 'save'}><Trash2 className="mr-1.5 h-4 w-4" /> Remove from map</Button>}
      </div>
    </div>
  );
}
