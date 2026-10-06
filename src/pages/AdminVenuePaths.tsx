/**
 * AdminVenuePaths — draw the real walkable path network (venue_nodes +
 * venue_paths) for a venue on a satellite map.
 *
 * This is the missing piece the routing fix depends on: HybridNavigationBrain
 * already prefers this curated graph over the live Overpass/OSM fetch, but
 * it only had 4 placeholder demo nodes, so almost every route still fell
 * through to the slow/unreliable external fetch. Once real paths are drawn
 * here for a venue, routing across it becomes instant and doesn't depend on
 * OpenStreetMap coverage at all.
 *
 * Modes:
 *  - Add node:  click empty map     → name + kind, then insert a venue_node
 *  - Connect:   click two endpoints → insert a venue_path between them
 *               (endpoints can be venue_nodes OR outdoor POIs)
 *  - Delete:    click a node/path   → remove it (cascades to its paths)
 *  - (default) click a node/path    → inspect/edit it in the side panel
 */
import React, { useState, useEffect, useCallback, useMemo, useRef, useReducer } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AdminHeader from '@/components/admin/AdminHeader';
import AdminPillButton from '@/components/admin/AdminPillButton';
import AdminField, { ADMIN_INPUT_CLS } from '@/components/admin/AdminField';
import { AdminButtonPrimary, AdminButtonGhost } from '@/components/admin/AdminButtons';
import BaseMap from '@/components/BaseMap';
import MapTypeSwitcher from '@/components/MapTypeSwitcher';
import { DEFAULT_MAP_STYLE_ID, MAP_STYLE_STORAGE_KEY, type MapStyleId } from '@/lib/mapStyles';
import { Route, Plus, Link2, Trash2, MousePointer2, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePOILoader } from '@/hooks/usePOILoader';
import type { GeoCoord } from '@/lib/geo/GeoTypes';

interface SupaBuilding { id: string; name: string; origin_lat: number | null; origin_lng: number | null; }
interface SupaNode { id: string; building_id: string; name: string; lat: number; lng: number; kind: 'junction' | 'entrance' | 'landmark'; }
interface SupaPath { id: string; building_id: string; from_node: string | null; from_poi: string | null; to_node: string | null; to_poi: string | null; path_type: 'main' | 'secondary' | 'steps'; }

type Tool = 'select' | 'add-node' | 'connect' | 'delete';
type EndpointRef = { kind: 'node' | 'poi'; id: string; lat: number; lng: number };

const DEFAULT_CENTER: GeoCoord = { lat: 9.0192, lng: 38.7628 }; // Unity Park, Addis Ababa

interface AdminVenuePathsProps {
  embedded?: boolean;
}

const AdminVenuePaths: React.FC<AdminVenuePathsProps> = ({ embedded = false }) => {
  const [buildings, setBuildings] = useState<SupaBuilding[]>([]);
  const [buildingId, setBuildingId] = useState<string>('');
  const [nodes, setNodes] = useState<SupaNode[]>([]);
  const [paths, setPaths] = useState<SupaPath[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [tool, setTool] = useState<Tool>('select');
  const [connectFrom, setConnectFrom] = useState<EndpointRef | null>(null);
  const [selected, setSelected] = useState<{ type: 'node' | 'path'; id: string } | null>(null);
  const [newNodeAt, setNewNodeAt] = useState<GeoCoord | null>(null);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeKind, setNewNodeKind] = useState<SupaNode['kind']>('junction');

  const { pois: allOutdoorPois } = usePOILoader(buildingId);
  const outdoorPois = useMemo(
    () => allOutdoorPois.filter(p => p.isOutdoor && p.lat != null && p.lng != null),
    [allOutdoorPois],
  );

  const [map, setMap] = useState<MLMap | null>(null);
  const [, bumpTick] = useReducer((x: number) => x + 1, 0);
  const hasFitRef = useRef(false);

  const [mapStyleId, setMapStyleId] = useState<MapStyleId>(() => {
    try { return (localStorage.getItem(MAP_STYLE_STORAGE_KEY) as MapStyleId) || DEFAULT_MAP_STYLE_ID; }
    catch { return DEFAULT_MAP_STYLE_ID; }
  });
  useEffect(() => {
    try { localStorage.setItem(MAP_STYLE_STORAGE_KEY, mapStyleId); } catch { /* ignore */ }
  }, [mapStyleId]);

  // ── Load buildings once ──────────────────────────────────────────────
  useEffect(() => {
    supabase.from('buildings').select('id, name, origin_lat, origin_lng').order('name').then(({ data, error }) => {
      if (error) { toast.error('Failed to load buildings'); return; }
      setBuildings(data || []);
      if ((data || []).length && !buildingId) setBuildingId(data![0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const building = useMemo(() => buildings.find(b => b.id === buildingId) ?? null, [buildings, buildingId]);

  const refresh = useCallback(async () => {
    if (!buildingId) return;
    setLoading(true);
    const [nodesRes, pathsRes] = await Promise.all([
      supabase.from('venue_nodes').select('*').eq('building_id', buildingId),
      supabase.from('venue_paths').select('*').eq('building_id', buildingId),
    ]);
    if (nodesRes.error) toast.error('Failed to load nodes: ' + nodesRes.error.message);
    if (pathsRes.error) toast.error('Failed to load paths: ' + pathsRes.error.message);
    setNodes((nodesRes.data ?? []) as SupaNode[]);
    setPaths((pathsRes.data ?? []) as SupaPath[]);
    setLoading(false);
  }, [buildingId]);

  useEffect(() => { hasFitRef.current = false; setSelected(null); setConnectFrom(null); void refresh(); }, [refresh]);

  // Re-fit the camera once when a building's data first loads.
  useEffect(() => {
    if (!map || hasFitRef.current) return;
    if (building?.origin_lat != null && building?.origin_lng != null) {
      map.jumpTo({ center: [building.origin_lng, building.origin_lat], zoom: 18 });
      hasFitRef.current = true;
    }
  }, [map, building]);

  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const poiById = useMemo(() => new Map(outdoorPois.map(p => [p.id, p])), [outdoorPois]);

  const project = useCallback((lat: number, lng: number) => {
    if (!map) return { x: 0, y: 0 };
    const pt = map.project([lng, lat]);
    return { x: pt.x, y: pt.y };
  }, [map]);

  const endpointGeo = useCallback((kind: 'node' | 'poi', id: string): GeoCoord | null => {
    if (kind === 'node') { const n = nodeById.get(id); return n ? { lat: n.lat, lng: n.lng } : null; }
    const p = poiById.get(id); return (p && p.lat != null && p.lng != null) ? { lat: p.lat, lng: p.lng } : null;
  }, [nodeById, poiById]);

  // ── Map interactions ──────────────────────────────────────────────────
  const handleMapClick = useCallback((coord: GeoCoord) => {
    if (tool === 'add-node') {
      setNewNodeAt(coord);
      setNewNodeName('');
      setNewNodeKind('junction');
    }
  }, [tool]);

  const commitNewNode = useCallback(async () => {
    if (!newNodeAt || !buildingId) return;
    setSaving(true);
    const { error } = await supabase.from('venue_nodes').insert({
      building_id: buildingId, name: newNodeName.trim(), lat: newNodeAt.lat, lng: newNodeAt.lng, kind: newNodeKind,
    });
    setSaving(false);
    if (error) { toast.error('Failed to add node: ' + error.message); return; }
    setNewNodeAt(null);
    toast.success('Node added');
    void refresh();
  }, [newNodeAt, newNodeName, newNodeKind, buildingId, refresh]);

  const handleEndpointClick = useCallback(async (ref: EndpointRef) => {
    if (tool === 'delete') {
      if (ref.kind === 'node') {
        setSaving(true);
        const { error } = await supabase.from('venue_nodes').delete().eq('id', ref.id);
        setSaving(false);
        if (error) { toast.error('Failed to delete: ' + error.message); return; }
        toast.success('Node deleted (its paths were removed too)');
        void refresh();
      }
      return;
    }
    if (tool === 'connect') {
      if (!connectFrom) { setConnectFrom(ref); return; }
      if (connectFrom.kind === ref.kind && connectFrom.id === ref.id) { setConnectFrom(null); return; }
      setSaving(true);
      const row: Partial<SupaPath> & { building_id: string } = { building_id: buildingId, path_type: 'main' };
      if (connectFrom.kind === 'node') row.from_node = connectFrom.id; else row.from_poi = connectFrom.id;
      if (ref.kind === 'node') row.to_node = ref.id; else row.to_poi = ref.id;
      const { error } = await supabase.from('venue_paths').insert(row);
      setSaving(false);
      setConnectFrom(null);
      if (error) { toast.error('Failed to connect: ' + error.message); return; }
      toast.success('Path connected');
      void refresh();
      return;
    }
    // 'select' tool
    if (ref.kind === 'node') setSelected({ type: 'node', id: ref.id });
  }, [tool, connectFrom, buildingId, refresh]);

  const handlePathClick = useCallback(async (path: SupaPath) => {
    if (tool === 'delete') {
      setSaving(true);
      const { error } = await supabase.from('venue_paths').delete().eq('id', path.id);
      setSaving(false);
      if (error) { toast.error('Failed to delete: ' + error.message); return; }
      toast.success('Path deleted');
      void refresh();
      return;
    }
    if (tool === 'select') setSelected({ type: 'path', id: path.id });
  }, [tool, refresh]);

  const updateSelectedNode = useCallback(async (patch: Partial<Pick<SupaNode, 'name' | 'kind'>>) => {
    if (!selected || selected.type !== 'node') return;
    setSaving(true);
    const { error } = await supabase.from('venue_nodes').update(patch).eq('id', selected.id);
    setSaving(false);
    if (error) { toast.error('Failed to update: ' + error.message); return; }
    void refresh();
  }, [selected, refresh]);

  const updateSelectedPath = useCallback(async (pathType: SupaPath['path_type']) => {
    if (!selected || selected.type !== 'path') return;
    setSaving(true);
    const { error } = await supabase.from('venue_paths').update({ path_type: pathType }).eq('id', selected.id);
    setSaving(false);
    if (error) { toast.error('Failed to update: ' + error.message); return; }
    void refresh();
  }, [selected, refresh]);

  const selectedNode = selected?.type === 'node' ? nodeById.get(selected.id) : null;
  const selectedPath = selected?.type === 'path' ? paths.find(p => p.id === selected.id) : null;

  const TOOLS: { id: Tool; label: string; icon: typeof MousePointer2 }[] = [
    { id: 'select', label: 'Select', icon: MousePointer2 },
    { id: 'add-node', label: 'Add node', icon: Plus },
    { id: 'connect', label: 'Connect', icon: Link2 },
    { id: 'delete', label: 'Delete', icon: Trash2 },
  ];

  const content = (
    <>
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={buildingId} onValueChange={setBuildingId}>
            <SelectTrigger className={`${ADMIN_INPUT_CLS} w-56`}><SelectValue placeholder="Building" /></SelectTrigger>
            <SelectContent>
              {buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <AdminPillButton key={id} icon={Icon} variant={tool === id ? 'solid' : 'ghost'}
              onClick={() => { setTool(id); setConnectFrom(null); setSelected(null); }}
              style={tool === id ? undefined : { background: 'hsl(var(--secondary))', color: 'hsl(var(--foreground))' }}>
              {label}
            </AdminPillButton>
          ))}
          {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-1" />}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {tool === 'add-node' && 'Click anywhere on the map to place a junction, entrance, or landmark node.'}
          {tool === 'connect' && (connectFrom ? 'Click the second endpoint (a node or a POI marker) to connect it.' : 'Click a node or POI marker, then click a second one to connect them.')}
          {tool === 'delete' && 'Click a node or path to remove it.'}
          {tool === 'select' && 'Click a node or path to view/edit it.'}
        </p>
      </div>

      <div className="relative mt-3" style={{ height: '60vh', minHeight: 420 }}>
        <BaseMap
          styleId={mapStyleId}
          initialCenter={building?.origin_lat != null && building?.origin_lng != null
            ? { lat: building.origin_lat, lng: building.origin_lng } : DEFAULT_CENTER}
          initialZoom={17}
          onMapInstance={setMap}
          onMove={bumpTick}
          onClick={handleMapClick}
        >
          <div className="absolute top-2 right-2 z-10" style={{ pointerEvents: 'auto' }}>
            <MapTypeSwitcher value={mapStyleId} onChange={setMapStyleId} variant="compact" />
          </div>
          <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
            {/* Paths */}
            {paths.map(p => {
              const a = p.from_node ? endpointGeo('node', p.from_node) : endpointGeo('poi', p.from_poi!);
              const b = p.to_node ? endpointGeo('node', p.to_node) : endpointGeo('poi', p.to_poi!);
              if (!a || !b) return null;
              const pa = project(a.lat, a.lng), pb = project(b.lat, b.lng);
              return (
                <line key={p.id} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                  stroke={selected?.type === 'path' && selected.id === p.id ? '#ffb703' : '#1a7a45'}
                  strokeWidth={p.path_type === 'main' ? 5 : 3}
                  strokeDasharray={p.path_type === 'steps' ? '6 4' : undefined}
                  strokeLinecap="round"
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onClick={() => handlePathClick(p)}
                />
              );
            })}
            {/* Venue nodes */}
            {nodes.map(n => {
              const pt = project(n.lat, n.lng);
              const isConnectSrc = connectFrom?.kind === 'node' && connectFrom.id === n.id;
              const isSelected = selected?.type === 'node' && selected.id === n.id;
              return (
                <g key={n.id} style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onClick={() => handleEndpointClick({ kind: 'node', id: n.id, lat: n.lat, lng: n.lng })}>
                  <circle cx={pt.x} cy={pt.y} r={isSelected || isConnectSrc ? 9 : 7}
                    fill={isConnectSrc ? '#ffb703' : isSelected ? '#ffb703' : '#1a7a45'}
                    stroke="white" strokeWidth={2} />
                  {n.name && (
                    <text x={pt.x} y={pt.y - 13} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1a2e1a"
                      style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3 }}>{n.name}</text>
                  )}
                </g>
              );
            })}
            {/* POI markers (connection targets only) */}
            {outdoorPois.map(p => {
              if (p.lat == null || p.lng == null) return null;
              const pt = project(p.lat, p.lng);
              const isConnectSrc = connectFrom?.kind === 'poi' && connectFrom.id === p.id;
              return (
                <g key={p.id} style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onClick={() => handleEndpointClick({ kind: 'poi', id: p.id, lat: p.lat as number, lng: p.lng as number })}>
                  <rect x={pt.x - 5} y={pt.y - 5} width={10} height={10} fill={isConnectSrc ? '#ffb703' : '#3a6ea5'} stroke="white" strokeWidth={2} />
                  <text x={pt.x} y={pt.y - 11} textAnchor="middle" fontSize={10} fontWeight={700} fill="#1a2e1a"
                    style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3 }}>{p.name}</text>
                </g>
              );
            })}
          </svg>

          {/* New-node popover */}
          {newNodeAt && (
            <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
              <div className="absolute rounded-2xl shadow-xl p-3 space-y-2 bg-card border border-border"
                style={{
                  left: Math.min(project(newNodeAt.lat, newNodeAt.lng).x + 12, (map?.getContainer().clientWidth ?? 300) - 220),
                  top: Math.min(project(newNodeAt.lat, newNodeAt.lng).y + 12, (map?.getContainer().clientHeight ?? 300) - 160),
                  width: 210, pointerEvents: 'auto',
                }}>
                <Input placeholder="Name (optional)" value={newNodeName} onChange={e => setNewNodeName(e.target.value)} className={ADMIN_INPUT_CLS} />
                <Select value={newNodeKind} onValueChange={(v) => setNewNodeKind(v as SupaNode['kind'])}>
                  <SelectTrigger className={ADMIN_INPUT_CLS}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="junction">Junction</SelectItem>
                    <SelectItem value="entrance">Entrance</SelectItem>
                    <SelectItem value="landmark">Landmark</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex gap-2 justify-end">
                  <AdminButtonGhost onClick={() => setNewNodeAt(null)} className="h-9 px-3"><X className="w-4 h-4" /></AdminButtonGhost>
                  <AdminButtonPrimary onClick={commitNewNode} loading={saving} className="h-9 px-3">Add</AdminButtonPrimary>
                </div>
              </div>
            </div>
          )}
        </BaseMap>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Side panel for the selected node/path */}
      {(selectedNode || selectedPath) && (
        <div className="px-4 py-3 border-t border-border mt-1">
          {selectedNode && (
            <div className="flex items-end gap-2 flex-wrap">
              <AdminField label="Name" className="flex-1 min-w-[160px]">
                <Input value={selectedNode.name} onChange={e => updateSelectedNode({ name: e.target.value })} className={ADMIN_INPUT_CLS} />
              </AdminField>
              <AdminField label="Kind" className="w-40">
                <Select value={selectedNode.kind} onValueChange={(v) => updateSelectedNode({ kind: v as SupaNode['kind'] })}>
                  <SelectTrigger className={ADMIN_INPUT_CLS}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="junction">Junction</SelectItem>
                    <SelectItem value="entrance">Entrance</SelectItem>
                    <SelectItem value="landmark">Landmark</SelectItem>
                  </SelectContent>
                </Select>
              </AdminField>
              <AdminButtonGhost onClick={() => setSelected(null)} className="h-11">Done</AdminButtonGhost>
            </div>
          )}
          {selectedPath && (
            <div className="flex items-end gap-2 flex-wrap">
              <AdminField label="Path type" className="w-48">
                <Select value={selectedPath.path_type} onValueChange={(v) => updateSelectedPath(v as SupaPath['path_type'])}>
                  <SelectTrigger className={ADMIN_INPUT_CLS}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main">Main</SelectItem>
                    <SelectItem value="secondary">Secondary</SelectItem>
                    <SelectItem value="steps">Steps</SelectItem>
                  </SelectContent>
                </Select>
              </AdminField>
              <AdminButtonGhost onClick={() => setSelected(null)} className="h-11">Done</AdminButtonGhost>
            </div>
          )}
        </div>
      )}
    </>
  );

  if (embedded) return <div className="pb-8">{content}</div>;

  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--background))' }}>
      <AdminHeader icon={Route} title="Venue Paths" subtitle="Draw real outdoor walking paths" />
      {content}
    </div>
  );
};

export default AdminVenuePaths;