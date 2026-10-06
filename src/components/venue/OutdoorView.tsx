// The outdoor world around a venue: a real map (streets or satellite) with
// 3D terrain, styled in the venue's theme, and the venue itself standing on
// it — walls extruded, rooms, paths and places. Other venues of the same
// institution (a museum inside the park…) appear as buildings you can step
// into. Zoom right in on a venue, or tap it, to switch to the indoor viewer.

import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Mountain, Satellite, Map as MapIcon, LogIn, Box } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VenueTheme } from '@/lib/venue/themes';
import type { FeatureCollection, venueGeoJSON } from '@/lib/venue/geoVenue';
import { insideRing } from '@/lib/venue/geoVenue';

type Pos = [number, number];
export interface OutdoorVenue {
  id: string; name: string; current: boolean; layout: string; floors: number;
  ring: Pos[];
  /** Full geometry for the venue being viewed; other venues just show their footprint. */
  geo?: ReturnType<typeof venueGeoJSON>;
  rotationDeg: number;
}

const STREETS = 'https://tiles.openfreemap.org/styles/liberty';
const SATELLITE: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: '© Esri, Maxar, Earthstar Geographics' } },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};
// Public elevation tiles (Mapzen Terrarium on AWS Open Data). maxzoom must not exceed the street
// tiles' (14): MapLibre can't place terrain under tiles overzoomed from a lower level.
const DEM = { type: 'raster-dem' as const, tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium' as const, tileSize: 256, maxzoom: 14, attribution: 'Elevation: Mapzen Terrarium' };
const ENTER_ZOOM = 20.4;

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
const merge = (cols: (FeatureCollection | undefined)[]): FeatureCollection => ({ type: 'FeatureCollection', features: cols.flatMap(c => c?.features ?? []) });

export default function OutdoorView({ venues, theme, selectedPlaceId, onSelectPlace, onEnterVenue, route, here, className, defaultTerrain }: {
  venues: OutdoorVenue[];
  theme: VenueTheme;
  selectedPlaceId?: string | null;
  onSelectPlace?: (id: string) => void;
  /** Step inside a venue (the current one → indoor 3D; another → open it). */
  onEnterVenue: (venueId: string) => void;
  route?: Pos[] | null;
  here?: Pos | null;
  className?: string;
  defaultTerrain?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const latest = useRef({ venues, theme, route, here, selectedPlaceId, onSelectPlace, onEnterVenue });
  latest.current = { venues, theme, route, here, selectedPlaceId, onSelectPlace, onEnterVenue };
  const [base, setBase] = useState<'streets' | 'satellite'>('streets');
  const [terrain, setTerrain] = useState(defaultTerrain ?? true);
  const [nearVenue, setNearVenue] = useState<OutdoorVenue | null>(null);
  const [failed, setFailed] = useState(false);
  const autoEntered = useRef(false);

  // ── Map lifecycle ──
  useEffect(() => {
    if (!box.current) return;
    const current = latest.current.venues.find(v => v.current) ?? latest.current.venues[0];
    let map: MLMap;
    try {
      map = new maplibregl.Map({
        container: box.current, style: STREETS, pitch: 55, bearing: current?.rotationDeg ?? 0, maxPitch: 75,
        center: current ? centroid(current.ring) : [38.76, 9.03], zoom: 17, attributionControl: { compact: true },
      });
    } catch (err) {
      console.error('Outdoor map failed to start:', err);
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'bottom-right');
    map.on('style.load', () => decorate(map));
    // No connection to the map servers: show the venue on a plain themed ground rather than nothing.
    let fellBack = false;
    const fallBack = () => {
      if (fellBack || map.isStyleLoaded()) return;
      fellBack = true;
      map.setStyle({ version: 8, sources: {}, layers: [{ id: 'ground', type: 'background', paint: { 'background-color': latest.current.theme.ground } }] });
    };
    const styleTimer = setTimeout(fallBack, 8000);
    map.on('error', e => { if (!map.isStyleLoaded() && /style|Failed to fetch|NetworkError/i.test(String(e.error?.message ?? e.error))) fallBack(); });
    map.once('style.load', () => clearTimeout(styleTimer));
    // Frame the venue as soon as there's a style (the 'load' event can wait on terrain tiles).
    map.once('style.load', () => {
      const all = latest.current.venues.find(v => v.current)?.ring ?? latest.current.venues.flatMap(v => v.ring);
      if (all.length) {
        const b = all.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(all[0], all[0]));
        map.fitBounds(b, { padding: 70, pitch: 55, bearing: current?.rotationDeg ?? 0, duration: 0, maxZoom: 19 });
      }
    });
    // Place names only once you're close; dots from further away.
    const labels = () => box.current?.classList.toggle('yn-far', map.getZoom() < 17.8);
    map.on('zoom', labels); labels();
    map.on('moveend', () => {
      const c = map.getCenter(), z = map.getZoom();
      const v = latest.current.venues.find(x => insideRing(x.ring, { lat: c.lat, lng: c.lng })) ?? null;
      setNearVenue(z >= 18.3 ? v : null);
      if (v && z >= ENTER_ZOOM && !autoEntered.current) { autoEntered.current = true; latest.current.onEnterVenue(v.id); }
      if (z < ENTER_ZOOM - 1) autoEntered.current = false;
    });
    const clickable = ['yn-footprints', 'yn-walls', 'yn-rooms'];
    map.on('click', e => {
      const hit = map.queryRenderedFeatures(e.point, { layers: clickable.filter(l => map.getLayer(l)) })[0];
      const venueId = hit?.properties?.venue as string | undefined;
      if (hit?.layer.id === 'yn-rooms' && hit.properties?.nodeId) latest.current.onSelectPlace?.(hit.properties.nodeId as string);
      else if (venueId && hit?.layer.id === 'yn-footprints') latest.current.onEnterVenue(venueId);
    });
    for (const l of clickable) {
      map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
    }
    return () => { clearTimeout(styleTimer); markers.current.forEach(m => m.remove()); markers.current = []; map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Our layers, re-added whenever the base style changes ──
  function decorate(map: MLMap) {
    const { theme: t } = latest.current;
    stylize(map, t);
    try {
      if (!map.getSource('dem')) map.addSource('dem', DEM);
      if (!map.getLayer('hillshade')) map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#3b4a3f' } });
      applyTerrain(map, terrainOn.current);
    } catch (err) { console.warn('Terrain unavailable:', err); }
    try { (map as unknown as { setSky?: (s: object) => void }).setSky?.({ 'sky-color': t.sky, 'horizon-color': '#ffffff', 'sky-horizon-blend': 0.5, 'fog-ground-blend': 1, 'atmosphere-blend': 0 }); } catch { /* older styles */ }

    const add = (id: string, data: FeatureCollection) => { if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: data as never }); };
    add('yn-footprints', empty); add('yn-rooms', empty); add('yn-paths', empty); add('yn-walls', empty); add('yn-route', empty);
    const layer = (spec: maplibregl.AddLayerObject) => { if (!map.getLayer(spec.id)) map.addLayer(spec); };
    layer({ id: 'yn-footprints', type: 'fill-extrusion', source: 'yn-footprints', paint: {
      'fill-extrusion-color': ['case', ['==', ['get', 'layout'], 'site'], t.ground, t.wall],
      'fill-extrusion-height': ['case', ['==', ['get', 'layout'], 'site'], 0.4, ['*', 3.5, ['get', 'floors']]],
      'fill-extrusion-opacity': 0.85,
    } });
    layer({ id: 'yn-rooms', type: 'fill', source: 'yn-rooms', paint: { 'fill-color': t.slab, 'fill-opacity': 0.92, 'fill-outline-color': t.path } });
    layer({ id: 'yn-paths', type: 'line', source: 'yn-paths', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': t.path, 'line-width': ['interpolate', ['linear'], ['zoom'], 16, 1.5, 20, 7], 'line-opacity': 0.85 } });
    layer({ id: 'yn-walls', type: 'fill-extrusion', source: 'yn-walls', paint: { 'fill-extrusion-color': t.wall, 'fill-extrusion-height': 3, 'fill-extrusion-opacity': 0.95 } });
    layer({ id: 'yn-route-casing', type: 'line', source: 'yn-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 10 } });
    layer({ id: 'yn-route', type: 'line', source: 'yn-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': t.route, 'line-width': 6 } });
    sync(map);
  }

  const terrainOn = useRef(terrain);
  useEffect(() => {
    terrainOn.current = terrain;
    const map = mapRef.current;
    if (map?.getSource('dem')) applyTerrain(map, terrain);
  }, [terrain]);

  const firstBase = useRef(true);
  useEffect(() => {
    if (firstBase.current) { firstBase.current = false; return; }
    mapRef.current?.setStyle(base === 'streets' ? STREETS : SATELLITE);
  }, [base]);

  // ── Data → sources and markers ──
  function sync(map: MLMap) {
    const { venues: vs, route: r, here: h, selectedPlaceId: sel } = latest.current;
    const set = (id: string, data: FeatureCollection) => (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data as never);
    set('yn-footprints', { type: 'FeatureCollection', features: vs.filter(v => !v.geo).map(v => ({ type: 'Feature', properties: { venue: v.id, layout: v.layout, floors: Math.max(1, v.floors) }, geometry: { type: 'Polygon', coordinates: [v.ring] } })) });
    set('yn-rooms', merge(vs.map(v => v.geo?.rooms)));
    set('yn-paths', merge(vs.map(v => v.geo?.paths)));
    set('yn-walls', merge(vs.map(v => v.geo?.walls)));
    set('yn-route', r && r.length > 1 ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r } }] } : empty);

    markers.current.forEach(m => m.remove());
    markers.current = [];
    for (const v of vs) {
      for (const f of v.geo?.places.features ?? []) {
        const id = f.properties.id as string, active = id === sel;
        const el = document.createElement('button');
        el.className = 'yn-place-marker';
        el.setAttribute('aria-label', String(f.properties.name));
        el.innerHTML = `<span style="display:block;width:${active ? 16 : 12}px;height:${active ? 16 : 12}px;border-radius:9999px;background:${latest.current.theme.primary};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>`
          + `<span class="yn-label" style="position:absolute;left:50%;top:-22px;transform:translateX(-50%);white-space:nowrap;font:600 11px/1.2 system-ui;color:${active ? '#fff' : '#1f2937'};background:${active ? latest.current.theme.primary : 'rgba(255,255,255,.92)'};padding:2px 6px;border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,.2)">${escapeHtml(String(f.properties.name))}</span>`;
        el.style.position = 'relative';
        el.onclick = e => { e.stopPropagation(); latest.current.onSelectPlace?.(id); };
        markers.current.push(new maplibregl.Marker({ element: el }).setLngLat(f.geometry.coordinates as Pos).addTo(map));
      }
      if (!v.current) {
        const el = document.createElement('button');
        el.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font:600 12px/1 system-ui;color:#fff;background:${latest.current.theme.accent};padding:7px 11px;border-radius:9999px;box-shadow:0 2px 8px rgba(0,0,0,.3)">${escapeHtml(v.name)} &nbsp;›</span>`;
        el.setAttribute('aria-label', `Enter ${v.name}`);
        el.onclick = e => { e.stopPropagation(); latest.current.onEnterVenue(v.id); };
        markers.current.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(centroid(v.ring)).addTo(map));
      }
    }
    if (h) {
      const el = document.createElement('div');
      el.innerHTML = '<span style="position:absolute;inset:-10px;border-radius:9999px;background:rgba(14,165,233,.35);animation:ping 1.4s cubic-bezier(0,0,.2,1) infinite"></span><span style="position:relative;display:block;width:16px;height:16px;border-radius:9999px;background:#0ea5e9;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.4)"></span>';
      el.style.position = 'relative';
      el.title = 'You are here';
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat(h).addTo(map));
    }
  }

  useEffect(() => { const m = mapRef.current; if (m?.isStyleLoaded() && m.getSource('yn-walls')) sync(m); }, [venues, route, here, selectedPlaceId, theme]);  

  if (failed) {
    return <div className={cn('flex items-center justify-center bg-muted/40 p-6 text-center text-sm text-muted-foreground', className)}>The outdoor map needs WebGL, which isn't available on this device. Use the 2D or 3D view instead.</div>;
  }

  return (
    <div className={cn('relative', className)}>
      <style>{'.yn-far .yn-label{display:none}'}</style>
      <div ref={box} className="absolute inset-0" />
      <div className="absolute left-3 top-3 flex gap-1 rounded-xl border bg-card/95 p-1 shadow-lg backdrop-blur">
        {([['streets', MapIcon, 'Map'], ['satellite', Satellite, 'Satellite']] as const).map(([id, Icon, label]) => (
          <button key={id} onClick={() => setBase(id)} aria-pressed={base === id}
            className={cn('flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium', base === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
        <button onClick={() => setTerrain(t => !t)} aria-pressed={terrain}
          className={cn('flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium', terrain ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
          <Mountain className="h-3.5 w-3.5" /> Terrain
        </button>
      </div>
      {nearVenue && (
        <button onClick={() => onEnterVenue(nearVenue.id)}
          className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-xl transition-transform hover:scale-105">
          {nearVenue.current ? <Box className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {nearVenue.current ? `Step inside ${nearVenue.name}` : `Enter ${nearVenue.name}`}
        </button>
      )}
    </div>
  );
}

/**
 * Turn 3D terrain on once elevation tiles have arrived, then re-place the
 * camera. Set any earlier and the camera is positioned as if the ground were
 * at sea level — at Addis's ~2,400 m it ends up underground and the map is blank.
 */
function applyTerrain(map: MLMap, on: boolean) {
  if (!on) { map.setTerrain(null); return; }
  const enable = () => {
    if (!map.getSource('dem') || map.getTerrain()) return;
    map.setTerrain({ source: 'dem', exaggeration: 1.3 });
    map.jumpTo({ bearing: map.getBearing() + 0.001 }); // forces the camera to re-read the ground height
  };
  if (map.isSourceLoaded('dem')) { enable(); return; }
  const onData = (e: maplibregl.MapSourceDataEvent) => {
    if (e.sourceId === 'dem' && map.isSourceLoaded('dem')) { map.off('sourcedata', onData); enable(); }
  };
  map.on('sourcedata', onData);
}

function centroid(ring: Pos[]): Pos {
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Tints the base map's parks, grass, woods and background with the venue theme. */
function stylize(map: MLMap, t: VenueTheme) {
  for (const l of map.getStyle()?.layers ?? []) {
    try {
      if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', t.sky);
      else if (l.type === 'fill' && /park|grass|garden|meadow|recreation/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', t.ground);
      else if (l.type === 'fill' && /wood|forest|tree|scrub/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', t.treeA);
    } catch { /* layer without that property */ }
  }
}
