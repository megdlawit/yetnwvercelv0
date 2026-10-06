// One floor (or zone) of a venue as the 2D plan or the 3D world — the same
// spatial data either way. Loads that floor's geometry itself; three.js is
// lazy-loaded only when 3D is shown.

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Minus, Maximize } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { NavEdge, NavNode, Room, Wall } from '@/data/types';
import { parsePolygon, roomOutline, type FeatureKind, type MapFeature } from '@/lib/venue/features';
import type { VenueTheme } from '@/lib/venue/themes';
import { useSvgViewport } from '@/hooks/useSvgViewport';
import FeatureGlyph from '@/components/venue/FeatureGlyph';
import { cn } from '@/lib/utils';
import { DEFAULT_LAYERS, type IndoorLayerId } from '@/lib/venue/mapSettings';

const Venue3D = lazy(() => import('@/components/venue/Venue3D'));
const PX_PER_METER = 40;

export interface Geometry { walls: Wall[]; rooms: Room[]; nodes: NavNode[]; edges: NavEdge[]; features: MapFeature[] }

export function useFloorGeometry(buildingId: string, floorId: string | null) {
  const [geo, setGeo] = useState<Geometry | null>(null);
  useEffect(() => {
    let live = true;
    setGeo(null);
    if (!floorId) return;
    (async () => {
      const [w, r, n, e, f] = await Promise.all([
        supabase.from('walls').select('*').eq('floor_id', floorId),
        supabase.from('rooms').select('*').eq('floor_id', floorId),
        supabase.from('nodes').select('*').eq('floor_id', floorId),
        supabase.from('edges').select('*').eq('building_id', buildingId),
        supabase.from('map_features').select('*').eq('floor_id', floorId),
      ]);
      if (!live) return;
      const nodes = (n.data ?? []).map(x => ({ id: x.id, floorId: x.floor_id, name: x.name ?? '', x: x.x, y: x.y, isHallway: x.is_hallway }));
      const ids = new Set(nodes.map(x => x.id));
      setGeo({
        walls: (w.data ?? []).map(x => ({ x1: x.x1, y1: x.y1, x2: x.x2, y2: x.y2 })),
        rooms: (r.data ?? []).map(x => ({
          id: x.id, floorId: x.floor_id, name: x.name ?? '', nodeId: x.node_id ?? '', x: x.x, y: x.y, width: x.width, height: x.height,
          type: x.type as Room['type'], polygon: parsePolygon(x.polygon),
        })),
        nodes,
        edges: (e.data ?? []).filter(x => ids.has(x.from_node) && ids.has(x.to_node)).map(x => ({ id: x.id, fromNodeId: x.from_node, toNodeId: x.to_node, weight: x.weight })),
        features: (f.data ?? []).map(x => ({ id: x.id, kind: x.kind as FeatureKind, x: x.x, y: x.y, rotationDeg: x.rotation_deg, width: x.width, depth: x.depth, label: x.label })),
      });
    })().catch(err => console.error('Venue preview load failed:', err));
    return () => { live = false; };
  }, [buildingId, floorId]);
  return geo;
}

export default function VenueViewer({ buildingId, floorId, level, theme, mode, className, emptyText, wallHeight, layers }: {
  buildingId: string; floorId: string | null; level: number; theme: VenueTheme; mode: '2d' | '3d'; className?: string; emptyText?: string;
  /** The Indoor 3D map look (wall height, which details show). */
  wallHeight?: number; layers?: Partial<Record<IndoorLayerId, boolean>>;
}) {
  const geo = useFloorGeometry(buildingId, floorId);
  const [selected, setSelected] = useState<string | null>(null);
  const loading = <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> {mode === '3d' ? 'Building 3D world…' : 'Loading plan…'}</div>;

  return (
    <div className={cn('relative', className)}>
      {!floorId || (geo && geo.walls.length + geo.rooms.length === 0) ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">{emptyText ?? 'Nothing drawn here yet — open the map editor to upload a plan.'}</div>
      ) : !geo ? loading : mode === '3d' ? (
        <Suspense fallback={loading}>
          <Venue3D {...geo} level={level} selectedNodeId={selected} onSelectNode={setSelected} pxPerMeter={PX_PER_METER} showPaths={false} theme={theme} className="h-full"
            wallHeight={wallHeight} layers={layers} />
        </Suspense>
      ) : (
        <Plan geo={geo} theme={theme} layers={layers} />
      )}
    </div>
  );
}

function Plan({ geo, theme, layers }: { geo: Geometry; theme: VenueTheme; layers?: Partial<Record<IndoorLayerId, boolean>> }) {
  const show = { ...DEFAULT_LAYERS, ...layers };
  const viewport = useSvgViewport();
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const k = 1 / viewport.scale;
  const roomName = useMemo(() => new Map(geo.rooms.filter(r => r.nodeId).map(r => [r.nodeId, r.name] as const)), [geo.rooms]);
  const places = geo.nodes.filter(n => !n.isHallway && (roomName.get(n.id) || n.name.trim()));

  const bounds = useMemo(() => {
    const xs: number[] = [], ys: number[] = [];
    geo.walls.forEach(w => { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); });
    geo.rooms.forEach(r => { xs.push(r.x, r.x + r.width); ys.push(r.y, r.y + r.height); });
    return xs.length ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } : null;
  }, [geo]);
  const { fitTo, size } = viewport;
  const fit = () => bounds && fitTo(bounds, 28);
  useEffect(() => { if (size.w > 0) fit(); }, [bounds, size.w > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const vb = viewport.viewBox;
  return (
    <div ref={viewport.ref} className="h-full w-full touch-none select-none" style={{ background: theme.ground + '55' }}>
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className={cn('h-full w-full', drag ? 'cursor-grabbing' : 'cursor-grab')}
        onPointerDown={e => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ x: e.clientX, y: e.clientY }); }}
        onPointerMove={e => { if (!drag) return; viewport.panByScreen(e.clientX - drag.x, e.clientY - drag.y); setDrag({ x: e.clientX, y: e.clientY }); }}
        onPointerUp={() => setDrag(null)}>
        {show.rooms && geo.rooms.map(r => (
          <polygon key={r.id} points={roomOutline(r).map(p => `${p.x},${p.y}`).join(' ')} fill={theme.slab} stroke={theme.path} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {show.walls && <path d={geo.walls.map(w => `M${w.x1} ${w.y1}L${w.x2} ${w.y2}`).join('')} stroke="#334155" strokeOpacity={0.8} strokeWidth={2.2} strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke" />}
        {show.paths && <path d={geo.edges.map(e => { const a = geo.nodes.find(n => n.id === e.fromNodeId), z = geo.nodes.find(n => n.id === e.toNodeId); return a && z ? `M${a.x} ${a.y}L${z.x} ${z.y}` : ''; }).join('')}
          stroke={theme.primary} strokeOpacity={0.35} strokeWidth={5} strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke" />}
        {geo.features.filter(f => f.kind !== 'label' && show.objects).map(f => <g key={f.id} className="pointer-events-none"><FeatureGlyph f={f} pxPerMeter={PX_PER_METER} k={k} selected={false} /></g>)}
        {places.map(n => (
          <g key={n.id} className="pointer-events-none">
            <circle cx={n.x} cy={n.y} r={4.5 * k} fill={theme.primary} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            {show.labels && viewport.scale > 0.35 && (
              <text x={n.x} y={n.y - 8 * k} textAnchor="middle" fontSize={10.5 * k} stroke="#fff" strokeWidth={3 * k} paintOrder="stroke" fill="#1f2937">{roomName.get(n.id) || n.name}</text>
            )}
          </g>
        ))}
      </svg>
      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-xl border bg-card/95 shadow">
        <button onClick={() => viewport.zoomBy(1.3)} className="p-2 hover:bg-muted" aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
        <button onClick={() => viewport.zoomBy(1 / 1.3)} className="border-t p-2 hover:bg-muted" aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
        <button onClick={fit} className="border-t p-2 hover:bg-muted" aria-label="Fit to view"><Maximize className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
