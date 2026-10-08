import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { publishVenue } from '@/components/venue/dashboard/useVenue';
import { NavNode, NavEdge, Room, Wall } from '@/data/types';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { generateQRCodeDataURL, downloadQRCode } from '@/lib/QRCodeGenerator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft, MousePointer2, MapPin, Route, Eraser, QrCode, Download, Pencil,
  Loader2, UploadCloud, Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Trash2,
  SquarePlus, Ruler, PenLine, Square, Box, Columns2, Grid3x3, Magnet, AlertTriangle,
  CheckCircle2, Layers3, Crosshair, Hand, DoorOpen, Pentagon, Shapes, Type, LandPlot,
  Scissors, ArrowRightToLine, Split, Merge, CopyPlus, RotateCw, Scaling, Move, Globe, ExternalLink,
  BetweenHorizontalStart, GraduationCap, Trees, Sprout, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

import { useEditorHistory } from '@/hooks/useEditorHistory';
import { useSvgViewport, type Bounds } from '@/hooks/useSvgViewport';
import { snapPoint, type SnapKind } from '@/lib/venue/snap';
import { fromPlan, validate, issueText, pathsThroughWalls, repairPathsThroughWalls, autoScenery, groundBounds, sceneryRing, type Issue, type PlanRows, type PathRepair } from '@ethi/indoor-core';
import { useUnderlay, UnderlayImage, UnderlayOverlay, UnderlayPanel } from '@/components/venue/editor/PlanUnderlay';
import { WallFields, OpeningFields, ConnectorFields, RoomFields, FloorFields, type Extra } from '@/components/venue/editor/Inspector3D';
import { closedLoop } from '@/components/venue/editor/loops';
import {
  type Pt, type Seg, projectOnSegment, splitAt, trimAt, extendTo, joinSegs, offsetSeg, sideOf,
  polygonArea, polygonCentroid, pointInPolygon, bbox, rotatePt, scalePt, segLen,
} from '@/lib/cad/geometry';
import { FEATURE_KINDS, SCENERY_KINDS, roomOutline, parsePolygon, type FeatureKind, type MapFeature } from '@/lib/venue/features';
import { roomTypeFromName } from '@/lib/cad/commitVenue';
import CadImportDialog from '@/components/venue/CadImportDialog';
import EditorTour, { type EditorState } from '@/components/venue/EditorTour';
import AddFloorsDialog from '@/components/venue/AddFloorsDialog';
import PlaceDetailsEditor from '@/components/venue/PlaceDetailsEditor';
import FeatureGlyph from '@/components/venue/FeatureGlyph';
import type { FloorLayer } from '@/components/venue/Venue3D';
import { themeOf } from '@/lib/venue/themes';
import MapAssistant from '@/components/venue/editor/MapAssistant';
import { healthOf, importSummary, type Change, type Chip, type Highlight, type Plan, type Thing } from '@/lib/assistant/engine';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

// three.js is large; only load it when someone opens the 3D view.
const Venue3D = lazy(() => import('@/components/venue/Venue3D'));

type Tool =
  | 'select' | 'hand' | 'wall' | 'door' | 'room' | 'add-edge' | 'add-node' | 'object' | 'scenery' | 'text'
  | 'measure' | 'area' | 'trim' | 'extend' | 'split' | 'join' | 'offset' | 'delete';
type ViewMode = '2d' | '3d' | 'split';

const ROOM_TYPES: Room['type'][] = ['office', 'meeting', 'entrance', 'stairs', 'elevator', 'restroom', 'reception', 'utility'];
// The editor's working scale (the CAD importer's default). Used to show
// distances in metres and to scale the 3D view.
const PX_PER_METER = 40;
const SNAP_PX = 10;  // snap radius on screen
const PICK_PX = 7;   // how close a click must be to a wall to hit it
const WRITE_CONCURRENCY = 8;
const TOUR_SEEN_KEY = 'yetnew_editor_tour_seen';

type NodeRow = Tables<'nodes'>;
type EdgeRow = Tables<'edges'>;
type RoomRow = Tables<'rooms'>;
type WallRow = Tables<'walls'>;
type FeatureRow = Tables<'map_features'>;
type EWall = Wall & { id: string };

const toNode = (n: NodeRow): NavNode => ({ id: n.id, floorId: n.floor_id, name: n.name, x: n.x, y: n.y, isHallway: n.is_hallway });
const toEdge = (e: EdgeRow): NavEdge => ({ id: e.id, fromNodeId: e.from_node, toNodeId: e.to_node, weight: e.weight });
const toRoom = (r: RoomRow): Room => ({
  id: r.id, floorId: r.floor_id, name: r.name, nodeId: r.node_id ?? '',
  x: r.x, y: r.y, width: r.width, height: r.height, type: r.type as Room['type'], polygon: parsePolygon(r.polygon),
});
const toWall = (w: WallRow): EWall => ({ id: w.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 });
const toFeature = (f: FeatureRow): MapFeature => ({
  id: f.id, kind: f.kind as FeatureKind, x: f.x, y: f.y, rotationDeg: f.rotation_deg, width: f.width, depth: f.depth, label: f.label,
});
const dist = (a: Pt, b: Pt) => Math.round(Math.hypot(a.x - b.x, a.y - b.y));
const meters = (px: number) => (px / PX_PER_METER).toFixed(1);
const sqm = (px2: number) => (px2 / PX_PER_METER / PX_PER_METER).toFixed(1);
const polyJson = (p?: Pt[]) => (p ? p.map(q => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10]) : null);
const roundPt = (p: Pt) => ({ x: Math.round(p.x), y: Math.round(p.y) });

// Supabase returns errors instead of throwing; undo/redo needs them thrown.
async function run<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}
async function eachLimited<T>(items: T[], f: (t: T) => Promise<unknown>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(WRITE_CONCURRENCY, items.length) }, async () => {
    while (i < items.length) await f(items[i++]);
  }));
}

// Grid spacing in world units that lands near `targetPx` on screen: 1/2/5 × 10^n.
function niceStep(scale: number, targetPx = 28) {
  const raw = targetPx / scale;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw) ?? raw;
}

type ToolDef = { id: Tool; icon: typeof MousePointer2; label: string; key?: string; hint: string };
const TOOL_GROUPS: ToolDef[][] = [
  [
    { id: 'select', icon: MousePointer2, label: 'Select', key: 'V', hint: 'Click to select · Shift+click to add · drag empty space to box-select · drag a selection to move it' },
    { id: 'hand', icon: Hand, label: 'Pan', key: 'H', hint: 'Drag to move around the plan (or hold Space with any tool)' },
  ],
  [
    { id: 'wall', icon: PenLine, label: 'Wall', key: 'W', hint: 'Click to start a wall, click to end it — keeps going from there · Esc to stop' },
    { id: 'door', icon: DoorOpen, label: 'Door', key: 'O', hint: 'Click on a wall to put a door in it' },
    { id: 'room', icon: Pentagon, label: 'Room', key: 'R', hint: 'Click the corners of a room · click the first corner or press Enter to finish' },
    { id: 'add-edge', icon: Route, label: 'Path', key: 'E', hint: 'Click two places to connect them with a walkable path' },
    { id: 'add-node', icon: MapPin, label: 'POI', key: 'N', hint: 'Click to add a place visitors can navigate to' },
    { id: 'object', icon: Shapes, label: 'Object', key: 'B', hint: 'Choose an object, then click to place it' },
    { id: 'scenery', icon: Trees, label: 'Scenery', key: 'G', hint: 'Pick a tree, lawn, pond, fountain, lamp… then click to place it · select it and press Del (or use Delete) to remove it' },
    { id: 'text', icon: Type, label: 'Text', key: 'T', hint: 'Click to add a text label' },
  ],
  [
    { id: 'measure', icon: Ruler, label: 'Measure', key: 'M', hint: 'Click two points to measure the distance' },
    { id: 'area', icon: LandPlot, label: 'Area', key: 'A', hint: 'Click the corners of an area · Enter or click the first corner to finish' },
  ],
  [
    { id: 'trim', icon: Scissors, label: 'Trim', hint: 'Click the part of a wall to cut away between the walls that cross it' },
    { id: 'extend', icon: ArrowRightToLine, label: 'Extend', hint: 'Click near the end of a wall to extend it to the next wall' },
    { id: 'split', icon: Split, label: 'Split', hint: 'Click a wall to split it in two at that point' },
    { id: 'join', icon: Merge, label: 'Join', hint: 'Click two walls in line with each other to join them into one' },
    { id: 'offset', icon: BetweenHorizontalStart, label: 'Offset', hint: 'Click a wall to copy it parallel at the offset distance, on the side you click' },
  ],
  [{ id: 'delete', icon: Eraser, label: 'Delete', key: 'D', hint: 'Click anything to delete it' }],
];
const ALL_TOOLS = TOOL_GROUPS.flat();
const DRAW_TOOLS: Tool[] = ['wall', 'door', 'room', 'add-node', 'object', 'scenery', 'text', 'measure', 'area'];
const WALL_PICK_TOOLS: Tool[] = ['trim', 'extend', 'split', 'join', 'offset', 'delete'];

const SHORTCUTS: [string, string][] = [
  ['Ctrl Z', 'Undo'], ['Ctrl Shift Z', 'Redo'], ['Ctrl A', 'Select all'], ['Ctrl D', 'Duplicate'],
  ['Del', 'Delete selection'], ['F', 'Fit plan'], ['1 · 2 · 3', '2D · 3D · Split'],
  ['G', 'Grid'], ['S', 'Snap'], ['Alt', 'Hold to skip snapping'], ['Space + drag', 'Pan (any tool)'], ['Enter', 'Finish room / area'], ['Esc', 'Cancel'],
];

const SNAP_LABEL: Record<SnapKind, string> = {
  node: 'Place', endpoint: 'Endpoint', midpoint: 'Midpoint', wall: 'On wall', grid: 'Grid',
};

// ── Selection ────────────────────────────────────────────────────────────────
type Sel = { nodes: string[]; walls: string[]; features: string[]; rooms: string[] };
const NO_SEL: Sel = { nodes: [], walls: [], features: [], rooms: [] };
const selCount = (s: Sel) => s.nodes.length + s.walls.length + s.features.length + s.rooms.length;
type SelKey = keyof Sel;
const toggleIn = (s: Sel, key: SelKey, id: string): Sel =>
  ({ ...s, [key]: s[key].includes(id) ? s[key].filter(x => x !== id) : [...s[key], id] });

// A snapshot of geometry, for transforms and their undo.
interface Snap { nodes: NavNode[]; walls: EWall[]; features: MapFeature[]; rooms: Room[] }
type TransformOp = { kind: 'move'; dx: number; dy: number } | { kind: 'rotate'; c: Pt; deg: number } | { kind: 'scale'; c: Pt; f: number };

function transformSnap(s: Snap, op: TransformOp): Snap {
  const P = (p: Pt): Pt => op.kind === 'move' ? { x: p.x + op.dx, y: p.y + op.dy } : op.kind === 'rotate' ? rotatePt(p, op.c, op.deg) : scalePt(p, op.c, op.f);
  const R = (p: Pt) => { const q = P(p); return { x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 }; };
  return {
    nodes: s.nodes.map(n => ({ ...n, ...roundPt(P(n)) })),
    walls: s.walls.map(w => { const a = R({ x: w.x1, y: w.y1 }), b = R({ x: w.x2, y: w.y2 }); return { ...w, x1: a.x, y1: a.y, x2: b.x, y2: b.y }; }),
    features: s.features.map(f => ({
      ...f, ...R(f),
      rotationDeg: op.kind === 'rotate' ? (f.rotationDeg + op.deg) % 360 : f.rotationDeg,
      width: op.kind === 'scale' && f.width != null ? f.width * op.f : f.width,
      depth: op.kind === 'scale' && f.depth != null ? f.depth * op.f : f.depth,
    })),
    rooms: s.rooms.map(r => {
      if (op.kind === 'move' && !r.polygon) return { ...r, x: r.x + op.dx, y: r.y + op.dy };
      if (op.kind === 'scale' && !r.polygon) { const a = P({ x: r.x, y: r.y }); return { ...r, x: a.x, y: a.y, width: r.width * op.f, height: r.height * op.f }; }
      const poly = roomOutline(r).map(R);
      const b = bbox(poly);
      return { ...r, polygon: poly, x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
    }),
  };
}

type Interaction =
  | { kind: 'pan'; lastX: number; lastY: number; startX: number; startY: number }
  | { kind: 'marquee'; start: Pt; startX: number; startY: number; additive: boolean; roomId: string | null }
  | { kind: 'move'; grab: Pt; before: Snap; delta: Pt }
  | { kind: 'place'; startX: number; startY: number };

const FloorEditor = () => {
  const { buildingId, floorId } = useParams<{ buildingId: string; floorId: string }>();
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const snapKindRef = useRef<HTMLSpanElement>(null);
  const snapMarkRef = useRef<SVGGElement>(null);
  const previewLineRef = useRef<SVGLineElement>(null);
  const previewLabelRef = useRef<SVGTextElement>(null);

  const [floorMeta, setFloorMeta] = useState<{ name: string; level: number } | null>(null);
  const [floors, setFloors] = useState<{ id: string; name: string; level: number }[]>([]);
  const [building, setBuilding] = useState<{ name: string; isPublished: boolean; theme: string | null; institutionId: string | null } | null>(null);
  const [nodes, setNodes] = useState<NavNode[]>([]);
  const [edges, setEdges] = useState<NavEdge[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [walls, setWalls] = useState<EWall[]>([]);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [otherFloors, setOtherFloors] = useState<FloorLayer[]>([]);
  // Places on the other floors — what a stair / lift place can be linked to.
  const [otherNodes, setOtherNodes] = useState<(NavNode & { floorName: string })[]>([]);
  const [linkTarget, setLinkTarget] = useState('');
  const [linkKind, setLinkKind] = useState<'stairs' | 'elevator' | 'ramp' | 'escalator'>('stairs');
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<ViewMode>('2d');
  const [tool, setTool] = useState<Tool>('select');
  const [sel, setSel] = useState<Sel>(NO_SEL);
  const [edgeStart, setEdgeStart] = useState<string | null>(null);
  const [wallStart, setWallStart] = useState<Pt | null>(null);
  const [poly, setPoly] = useState<Pt[]>([]);           // room / area being drawn
  const [areaDone, setAreaDone] = useState<Pt[] | null>(null);
  const [measure, setMeasure] = useState<{ a: Pt; b: Pt | null } | null>(null);
  const [joinFirst, setJoinFirst] = useState<string | null>(null);
  const [hoverWall, setHoverWall] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ a: Pt; b: Pt } | null>(null);
  const [objectKind, setObjectKind] = useState<FeatureKind>('stairs');
  const [sceneryKind, setSceneryKind] = useState<FeatureKind>('tree');
  const [offsetM, setOffsetM] = useState(0.2);
  const [dragging, setDragging] = useState<null | 'pan' | 'move'>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [gridOn, setGridOn] = useState(true);
  const [snapOn, setSnapOn] = useState(true);
  const [focus3D, setFocus3D] = useState(0);
  const [layers, setLayers] = useState({ walls: true, rooms: true, objects: true, edges: true, labels: true, distances: false });
  const [nodeDialog, setNodeDialog] = useState<{ open: boolean; node: NavNode | null }>({ open: false, node: null });
  const [nodeForm, setNodeForm] = useState({ name: '', isHallway: false });
  const [roomDialog, setRoomDialog] = useState<{ open: boolean; nodeId: string | null }>({ open: false, nodeId: null });
  const [roomForm, setRoomForm] = useState({ name: '', type: 'office' as Room['type'], width: 100, height: 80 });
  const [textDialog, setTextDialog] = useState<{ open: boolean; at: Pt | null; text: string }>({ open: false, at: null, text: '' });
  const [qrPreview, setQrPreview] = useState<{ open: boolean; nodeId: string; dataUrl: string } | null>(null);
  // "Upload Map" in the dashboard opens the editor with ?import=1.
  const [searchParams] = useSearchParams();
  const [importOpen, setImportOpen] = useState(() => searchParams.get('import') === '1');
  const [tour, setTour] = useState<{ open: boolean; justBuilt: boolean }>({ open: false, justBuilt: false });
  const [addFloors, setAddFloors] = useState<{ open: boolean; file: File | null }>({ open: false, file: null });
  const closeTour = () => { setTour({ open: false, justBuilt: false }); try { localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch { /* private mode */ } };
  const [publishAsk, setPublishAsk] = useState(false);
  const [xform, setXform] = useState({ dx: 1, dy: 0, deg: 90, f: 1.5 });
  // The 3D columns of walls, objects, rooms and floors (20261006090000), by row id.
  const [extras, setExtras] = useState<Record<string, Extra>>({});
  // Every floor's rows as loaded — the other floors in the 3D preview and the plan checks.
  const [allRows, setAllRows] = useState<PlanRows | null>(null);

  const history = useEditorHistory();
  // The map assistant: where they last clicked ("here"), what it's showing, and its greeting.
  const lastClick = useRef<Pt | null>(null);
  const [aiMark, setAiMark] = useState<(Highlight & { mode: 'preview' | 'flash' }) | null>(null);
  const [greeting, setGreeting] = useState<{ key: number; reply: string; chips: Chip[] } | null>(null);
  const greetAfterLoad = useRef(false);
  // The full toolbar is there for people who want it; the simple one is the default.
  const [allTools, setAllTools] = useState(() => { try { return localStorage.getItem('yetnew-editor-all-tools') === '1'; } catch { return false; } });
  // Side-panel buttons speak through the map assistant ("Fix everything", "Make Gallery walkable").
  const [assistantAsk, setAssistantAsk] = useState<{ key: number; text: string } | null>(null);
  const askMap = (text: string) => setAssistantAsk({ key: Date.now() + Math.random(), text });
  const toggleAllTools = () =>setAllTools(v => { try { localStorage.setItem('yetnew-editor-all-tools', v ? '0' : '1'); } catch { /* private mode */ } return !v; });
  const viewport = useSvgViewport();
  const k = 1 / viewport.scale; // world units per screen pixel

  // Commands run long after the render that created them (undo can happen
  // minutes later), so they read current data through refs, not closures.
  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const edgesRef = useRef(edges); edgesRef.current = edges;
  const roomsRef = useRef(rooms); roomsRef.current = rooms;
  const wallsRef = useRef(walls); wallsRef.current = walls;
  const featuresRef = useRef(features); featuresRef.current = features;
  const selRef = useRef(sel); selRef.current = sel;
  const interaction = useRef<Interaction | null>(null);
  const needsFit = useRef(true);
  const loadedOnce = useRef(false);
  // While someone walks through the 3D view, W/A/S/D move them, not pick tools.
  const walking = useRef(false);
  const onThreeMode = useCallback((m: string) => { walking.current = m === 'walk'; }, []);

  // The one selected place — directly, or through one selected room. Drives
  // the place inspector and the 3D highlight.
  const selectedNodeId = sel.nodes.length === 1 && selCount(sel) === 1 ? sel.nodes[0]
    : sel.rooms.length === 1 && selCount(sel) === 1 ? rooms.find(r => r.id === sel.rooms[0])?.nodeId || null : null;
  const selectOnly = (key: SelKey, id: string) => setSel({ ...NO_SEL, [key]: [id] });
  const underlay = useUnderlay(buildingId, floorId, history, () => {
    const xs: number[] = [], ys: number[] = [];
    for (const w of wallsRef.current) { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); }
    for (const n of nodesRef.current) { xs.push(n.x); ys.push(n.y); }
    return xs.length ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } : null;
  });
  const setSelectedNodeId = (id: string | null) => setSel(id ? { ...NO_SEL, nodes: [id] } : NO_SEL);

  // ── Loading ────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!buildingId || !floorId) return;
    setLoading(true);
    try {
      const [bRes, fRes, allFloors, nodesRes, edgesRes, roomsRes, wallsRes, featRes] = await Promise.all([
        supabase.from('buildings').select('*').eq('id', buildingId).maybeSingle(),
        supabase.from('floors').select('name, level').eq('id', floorId).maybeSingle(),
        supabase.from('floors').select('*').eq('building_id', buildingId).order('level'),
        supabase.from('nodes').select('*').eq('building_id', buildingId),
        supabase.from('edges').select('*').eq('building_id', buildingId),
        supabase.from('rooms').select('*').eq('building_id', buildingId),
        supabase.from('walls').select('*').eq('building_id', buildingId),
        supabase.from('map_features').select('*').eq('building_id', buildingId),
      ]);
      if (bRes.data) setBuilding({ name: bRes.data.name, isPublished: bRes.data.is_published, theme: bRes.data.theme ?? null, institutionId: bRes.data.institution_id ?? null });
      if (fRes.data) setFloorMeta({ name: fRes.data.name, level: fRes.data.level });
      const floorList = allFloors.data || [];
      setFloors(floorList);
      for (const [what, res] of [['places', nodesRes], ['paths', edgesRes], ['rooms', roomsRes], ['walls', wallsRes]] as const) {
        if (res.error) { console.error(`${what} fetch error:`, res.error); toast.error(`Failed to load ${what}`); }
      }
      // map_features is new; a database without that migration just has no objects yet.
      if (featRes.error) console.warn('map_features not available yet:', featRes.error.message);

      const allNodes: NodeRow[] = nodesRes.data || [];
      const nodeRows = allNodes.filter(n => n.floor_id === floorId);
      const floorName = new Map(floorList.map(f => [f.id, f.name] as const));
      setOtherNodes(allNodes.filter(n => n.floor_id !== floorId).map(n => ({ ...toNode(n), floorName: floorName.get(n.floor_id) ?? 'Other floor' })));
      const nodeIds = new Set(nodeRows.map(n => n.id));
      const allRooms = ((roomsRes.data || []) as RoomRow[]).map(toRoom);
      const allWalls = (wallsRes.data || []) as WallRow[];
      const allFeatures = (featRes.data || []) as FeatureRow[];
      setNodes(nodeRows.map(toNode));
      // edges are fetched per building; keep the ones touching this floor
      setEdges(((edgesRes.data || []) as EdgeRow[]).filter(e => nodeIds.has(e.from_node) || nodeIds.has(e.to_node)).map(toEdge));
      setRooms(allRooms.filter(r => r.floorId === floorId));
      setWalls(allWalls.filter(w => w.floor_id === floorId).map(toWall));
      setFeatures(allFeatures.filter(f => f.floor_id === floorId).map(toFeature));
      // 3D details (absent until the indoor 3D migration has run — then everything uses defaults).
      const pickCols = (row: Record<string, unknown>, cols: string[]) => Object.fromEntries(cols.filter(c => c in row).map(c => [c, row[c]]));
      const ex: Record<string, Extra> = {};
      for (const w of allWalls) ex[w.id] = pickCols(w, ['thickness_m', 'height_m', 'material']);
      for (const x of allFeatures) ex[x.id] = pickCols(x, ['wall_id', 'offset_m', 'height_m', 'sill_m', 'from_floor_id', 'to_floor_id', 'step_count', 'landing', 'accessible', 'label_am']);
      for (const x of (roomsRes.data || []) as RoomRow[]) ex[x.id] = pickCols(x, ['name_am', 'floor_material', 'has_ceiling']);
      for (const x of floorList as Record<string, unknown>[]) ex[x.id as string] = pickCols(x, ['elevation_m', 'ceiling_height_m', 'name_am', 'sort_order']);
      setExtras(ex);
      setAllRows({
        building: { id: buildingId, name: bRes.data?.name ?? '' },
        floors: floorList.map(x => ({ ...(x as Record<string, unknown>), id: x.id, name: x.name, level: x.level })) as PlanRows['floors'],
        walls: allWalls as PlanRows['walls'], rooms: (roomsRes.data || []) as PlanRows['rooms'], map_features: allFeatures as PlanRows['map_features'],
        nodes: allNodes as PlanRows['nodes'], edges: (edgesRes.data || []) as PlanRows['edges'],
      });
      // The rest of the building, for the stacked 3D view.
      setOtherFloors(floorList.filter(f => f.id !== floorId).map(f => ({
        id: f.id, name: f.name, level: f.level,
        walls: allWalls.filter(w => w.floor_id === f.id).map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })),
        rooms: allRooms.filter(r => r.floorId === f.id),
        features: allFeatures.filter(x => x.floor_id === f.id).map(toFeature),
      })));
      needsFit.current = true;
    } catch (err) {
      console.error('Load error:', err);
      toast.error('Failed to load floor data');
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, [buildingId, floorId]);

  useEffect(() => { loadData(); }, [loadData]);
  // Switching floor: earlier commands refer to the other floor's rows.
  useEffect(() => { history.clear(); setSel(NO_SEL); }, [floorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Viewport ───────────────────────────────────────────────────────────────
  const contentBounds = useMemo<Bounds | null>(() => {
    const xs: number[] = [], ys: number[] = [];
    for (const w of walls) { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); }
    for (const r of rooms) { xs.push(r.x, r.x + r.width); ys.push(r.y, r.y + r.height); }
    for (const n of nodes) { xs.push(n.x); ys.push(n.y); }
    for (const f of features) { xs.push(f.x); ys.push(f.y); }
    if (xs.length === 0) return null;
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }, [walls, rooms, nodes, features]);

  const fitToContent = useCallback(() => {
    viewport.fitTo(contentBounds ?? { minX: 0, minY: 0, maxX: 800, maxY: 500 });
  }, [viewport, contentBounds]);

  // Runs once the canvas has its real size: after loading, and after the
  // canvas is resized by switching between 2D and Split.
  const pendingCenter = useRef<Pt | null>(null);
  useEffect(() => {
    if (!loading && needsFit.current && viewport.size.w > 0) {
      needsFit.current = false;
      const c = pendingCenter.current;
      pendingCenter.current = null;
      if (c) viewport.centerOn(c.x, c.y, 1); else fitToContent();
    }
  }, [loading, viewport.size.w, fitToContent, viewport]);
  const prevView = useRef(view);
  useEffect(() => {
    if (prevView.current !== view && view !== '3d') needsFit.current = true;
    prevView.current = view;
  }, [view]);

  const svgPoint = useCallback((clientX: number, clientY: number): Pt => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM()?.inverse();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const p = pt.matrixTransform(ctm);
    return { x: p.x, y: p.y };
  }, []);

  const gridStep = niceStep(viewport.scale);
  const snapAt = (raw: Pt, alt: boolean, excludeNodeId?: string): Pt & { kind: SnapKind | null } => {
    if (!snapOn || alt) return { x: Math.round(raw.x), y: Math.round(raw.y), kind: null };
    const s = snapPoint(raw, { walls: wallsRef.current, nodes: nodesRef.current, excludeNodeId }, { tolerance: SNAP_PX * k, grid: gridOn ? gridStep : null });
    return { x: Math.round(s.x), y: Math.round(s.y), kind: s.kind };
  };

  // ── Hit testing ────────────────────────────────────────────────────────────
  const wallAt = (p: Pt, tolPx = PICK_PX): EWall | null => {
    let best: { w: EWall; d: number } | null = null;
    for (const w of wallsRef.current) {
      const d = projectOnSegment(p, w).d;
      if (d <= tolPx * k && (!best || d < best.d)) best = { w, d };
    }
    return best?.w ?? null;
  };
  const roomAt = (p: Pt): Room | null => {
    const hits = roomsRef.current.filter(r => pointInPolygon(p, roomOutline(r)));
    return hits.sort((a, b) => polygonArea(roomOutline(a)) - polygonArea(roomOutline(b)))[0] ?? null;
  };

  // ── Writing geometry (shared by moves, transforms and their undo) ─────────
  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map(x => [x.id, x] as const));

  const takeSnap = (s: Sel): Snap => {
    // A room and its place move together.
    const roomIds = new Set(s.rooms);
    const nodeIds = new Set(s.nodes);
    for (const r of roomsRef.current) {
      if (nodeIds.has(r.nodeId)) roomIds.add(r.id);
      if (roomIds.has(r.id) && r.nodeId) nodeIds.add(r.nodeId);
    }
    return {
      nodes: nodesRef.current.filter(n => nodeIds.has(n.id)),
      walls: wallsRef.current.filter(w => s.walls.includes(w.id)),
      features: featuresRef.current.filter(f => s.features.includes(f.id)),
      rooms: roomsRef.current.filter(r => roomIds.has(r.id)),
    };
  };

  const applyLocal = (s: Snap) => {
    const n = byId(s.nodes), w = byId(s.walls), f = byId(s.features), r = byId(s.rooms);
    if (n.size) setNodes(p => p.map(x => n.get(x.id) ?? x));
    if (w.size) setWalls(p => p.map(x => w.get(x.id) ?? x));
    if (f.size) setFeatures(p => p.map(x => f.get(x.id) ?? x));
    if (r.size) setRooms(p => p.map(x => r.get(x.id) ?? x));
  };

  const writeSnap = async (s: Snap) => {
    applyLocal(s);
    // Paths touching moved places get their length recomputed.
    const moved = new Set(s.nodes.map(n => n.id));
    const pos = byId([...nodesRef.current.filter(n => !moved.has(n.id)), ...s.nodes]);
    const reweighed = edgesRef.current
      .filter(e => moved.has(e.fromNodeId) || moved.has(e.toNodeId))
      .map(e => { const a = pos.get(e.fromNodeId), b = pos.get(e.toNodeId); return a && b ? { ...e, weight: dist(a, b) } : e; });
    if (reweighed.length) { const m = byId(reweighed); setEdges(p => p.map(e => m.get(e.id) ?? e)); }
    await eachLimited(s.nodes, n => run(supabase.from('nodes').update({ x: n.x, y: n.y }).eq('id', n.id)));
    await eachLimited(s.walls, w => run(supabase.from('walls').update({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }).eq('id', w.id)));
    await eachLimited(s.features, f => run(supabase.from('map_features').update({ x: f.x, y: f.y, rotation_deg: f.rotationDeg, width: f.width, depth: f.depth }).eq('id', f.id)));
    await eachLimited(s.rooms, r => run(supabase.from('rooms').update({ x: r.x, y: r.y, width: r.width, height: r.height, polygon: polyJson(r.polygon) }).eq('id', r.id)));
    await eachLimited(reweighed, e => run(supabase.from('edges').update({ weight: e.weight }).eq('id', e.id)));
  };

  const commitTransform = async (before: Snap, after: Snap, label: string) => {
    try {
      await writeSnap(after);
      history.push({ label, undo: () => writeSnap(before), redo: () => writeSnap(after) });
    } catch (err) {
      console.error(`${label} failed:`, err);
      toast.error(`Couldn't save: ${label}`);
    }
  };

  const selectionCenter = (s: Snap): Pt => {
    const pts: Pt[] = [...s.nodes, ...s.features, ...s.walls.flatMap(w => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]), ...s.rooms.flatMap(r => roomOutline(r))];
    const b = bbox(pts);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  };

  const transformSelection = (makeOp: (center: Pt) => TransformOp, label: string) => {
    const before = takeSnap(selRef.current);
    if (!before.nodes.length && !before.walls.length && !before.features.length && !before.rooms.length) return;
    commitTransform(before, transformSnap(before, makeOp(selectionCenter(before))), label);
  };

  // ── Inserting and deleting rows (with undo) ────────────────────────────────
  // Rows are re-inserted with their original ids on undo, so anything that
  // points at them (paths, rooms) stays valid.
  interface Rows { nodes: NodeRow[]; edges: EdgeRow[]; rooms: RoomRow[]; walls: WallRow[]; features: FeatureRow[] }
  const insertRows = async (r: Partial<Rows>) => {
    if (r.nodes?.length) { await run(supabase.from('nodes').insert(r.nodes)); setNodes(p => [...p, ...r.nodes!.map(toNode)]); }
    if (r.walls?.length) { await run(supabase.from('walls').insert(r.walls)); setWalls(p => [...p, ...r.walls!.map(toWall)]); }
    if (r.features?.length) { await run(supabase.from('map_features').insert(r.features)); setFeatures(p => [...p, ...r.features!.map(toFeature)]); }
    if (r.rooms?.length) { await run(supabase.from('rooms').insert(r.rooms)); setRooms(p => [...p, ...r.rooms!.map(toRoom)]); }
    if (r.edges?.length) { await run(supabase.from('edges').insert(r.edges)); setEdges(p => [...p, ...r.edges!.map(toEdge)]); }
  };
  const deleteRows = async (r: Partial<Rows>) => {
    const ids = <T extends { id: string }>(x?: T[]) => (x ?? []).map(y => y.id);
    const e = ids(r.edges), ro = ids(r.rooms), n = ids(r.nodes), w = ids(r.walls), f = ids(r.features);
    // paths first (they reference places), then rooms, then places
    if (e.length) { await run(supabase.from('edges').delete().in('id', e)); setEdges(p => p.filter(x => !e.includes(x.id))); }
    if (ro.length) { await run(supabase.from('rooms').delete().in('id', ro)); setRooms(p => p.filter(x => !ro.includes(x.id))); }
    if (n.length) { await run(supabase.from('nodes').delete().in('id', n)); setNodes(p => p.filter(x => !n.includes(x.id))); }
    if (w.length) { await run(supabase.from('walls').delete().in('id', w)); setWalls(p => p.filter(x => !w.includes(x.id))); }
    if (f.length) { await run(supabase.from('map_features').delete().in('id', f)); setFeatures(p => p.filter(x => !f.includes(x.id))); }
    setSel(s => ({ nodes: s.nodes.filter(x => !n.includes(x)), walls: s.walls.filter(x => !w.includes(x)), features: s.features.filter(x => !f.includes(x)), rooms: s.rooms.filter(x => !ro.includes(x)) }));
  };

  const createRows = async (r: Partial<Rows>, label: string) => {
    try {
      await insertRows(r);
      history.push({ label, undo: () => deleteRows(r), redo: () => insertRows(r) });
      return true;
    } catch (err) {
      console.error(`${label} failed:`, err);
      if (/map_features_kind_check/.test(String((err as Error)?.message ?? err))) {
        toast.error('This scenery needs a database update', { description: 'Run migration 20261008090000_scenery_kinds.sql in the Supabase SQL editor, then try again.', duration: 9000 });
      } else toast.error(`Couldn't ${label.toLowerCase()}`);
      return false;
    }
  };

  const deleteSelection = async (s: Sel) => {
    if (selCount(s) === 0) return;
    try {
      const none = '00000000-0000-0000-0000-000000000000';
      const list = (ids: string[]) => (ids.length ? ids : [none]).join(',');
      const nodeRows = s.nodes.length ? await run(supabase.from('nodes').select('*').in('id', s.nodes)) : [];
      const edgeRows = s.nodes.length ? await run(supabase.from('edges').select('*').or(`from_node.in.(${list(s.nodes)}),to_node.in.(${list(s.nodes)})`)) : [];
      const roomRows = s.rooms.length || s.nodes.length ? await run(supabase.from('rooms').select('*').or(`id.in.(${list(s.rooms)}),node_id.in.(${list(s.nodes)})`)) : [];
      const wallRows = s.walls.length ? await run(supabase.from('walls').select('*').in('id', s.walls)) : [];
      const featRows = s.features.length ? await run(supabase.from('map_features').select('*').in('id', s.features)) : [];
      const rows: Rows = { nodes: nodeRows, edges: edgeRows, rooms: roomRows, walls: wallRows, features: featRows };
      await deleteRows(rows);
      const n = selCount(s);
      history.push({ label: n === 1 ? 'Delete' : `Delete ${n} items`, undo: () => insertRows(rows), redo: () => deleteRows(rows) });
    } catch (err) {
      console.error('Delete failed:', err);
      toast.error('Failed to delete');
    }
  };

  const newRowBase = () => ({ building_id: buildingId!, floor_id: floorId!, source: 'manual' });
  const stamp = () => ({ created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  const wallRow = (s: Seg) => ({ id: crypto.randomUUID(), ...newRowBase(), ...stamp(), x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
    thickness_m: null, height_m: null, material: 'plaster' } as WallRow);

  // Replace some walls with others in one undoable step (trim, split, join, extend).
  const replaceWalls = async (removeIds: string[], add: Seg[], label: string) => {
    if (!buildingId || !floorId) return;
    try {
      const removed = await run(supabase.from('walls').select('*').in('id', removeIds));
      const added = add.map(wallRow);
      await deleteRows({ walls: removed });
      await insertRows({ walls: added });
      history.push({
        label,
        undo: async () => { await deleteRows({ walls: added }); await insertRows({ walls: removed }); },
        redo: async () => { await deleteRows({ walls: removed }); await insertRows({ walls: added }); },
      });
    } catch (err) {
      console.error(`${label} failed:`, err);
      toast.error(`Couldn't ${label.toLowerCase()}`);
    }
  };

  const addNode = async (x: number, y: number, name = `Place ${nodesRef.current.length + 1}`) => {
    if (!buildingId || !floorId) return;
    const row = { id: crypto.randomUUID(), ...newRowBase(), ...stamp(), name, x, y, is_hallway: false, type: 'normal' } as NodeRow;
    if (await createRows({ nodes: [row] }, 'Add place')) selectOnly('nodes', row.id);
  };

  const addEdge = async (fromId: string, toId: string) => {
    if (!buildingId) return;
    const a = nodesRef.current.find(n => n.id === fromId), b = nodesRef.current.find(n => n.id === toId);
    if (!a || !b) return;
    if (edgesRef.current.some(e => (e.fromNodeId === fromId && e.toNodeId === toId) || (e.fromNodeId === toId && e.toNodeId === fromId))) {
      toast.error('These places are already connected');
      return;
    }
    const row = { id: crypto.randomUUID(), building_id: buildingId, from_node: fromId, to_node: toId, weight: dist(a, b), source: 'manual', ...stamp() } as EdgeRow;
    // A path can't go through a wall: send it round, through a doorway — or refuse.
    const model = modelRef.current;
    if (model) {
      const rows: PlanRows = { ...model.rows, edges: [...model.rows.edges, { id: row.id, from_node: fromId, to_node: toId }] };
      const fix = repairPathsThroughWalls(rows, { pxPerMeter: PX_PER_METER, newId: () => crypto.randomUUID(), edgeIds: [row.id] });
      if (fix.dropped.length) {
        toast.error("Paths can't go through walls", { description: 'There is no doorway between these places. Add a door in the wall (Door tool), then connect them again.', duration: 7000 });
        return;
      }
      if (fix.rerouted.length) {
        if (await createRows(repairRows(fix), 'Add path')) {
          toast('That path went through a wall', { description: 'It now goes round the wall and through the doorway.', duration: 5000 });
        }
        return;
      }
    }
    await createRows({ edges: [row] }, 'Add path');
  };

  /** Rows for a repair: the new corner points (hallway) and the paths through them. */
  const repairRows = (fix: PathRepair): Partial<Rows> => ({
    nodes: fix.nodes.map(n => ({ id: n.id, ...newRowBase(), floor_id: n.floor_id, ...stamp(), name: '', x: n.x, y: n.y, is_hallway: true, type: 'hallway' } as NodeRow)),
    edges: fix.edges.map(e => ({ id: e.id, building_id: buildingId!, from_node: e.from_node, to_node: e.to_node, weight: e.weight, source: 'manual', ...stamp() } as EdgeRow)),
  });

  /** Map health: send every path on this floor that crosses a wall round it, through a doorway (one undo). */
  const fixPathsThroughWalls = async () => {
    const model = modelRef.current;
    if (!model || !blockedRef.current.size) return;
    const fix = repairPathsThroughWalls(model.rows, { pxPerMeter: PX_PER_METER, newId: () => crypto.randomUUID(), edgeIds: [...blockedRef.current] });
    const noDoor = fix.dropped.length
      ? `${fix.dropped.length} path${fix.dropped.length > 1 ? 's have' : ' has'} no doorway to use — add a door in the wall (Door tool), or delete ${fix.dropped.length > 1 ? 'them' : 'it'}.`
      : undefined;
    if (!fix.rerouted.length) { toast.error('No doorway to go through', { description: noDoor, duration: 7000 }); return; }
    try {
      const old = await run(supabase.from('edges').select('*').in('id', fix.rerouted)) as EdgeRow[];
      const add = repairRows(fix);
      const apply = async () => { await deleteRows({ edges: old }); await insertRows(add); };
      await apply();
      history.push({ label: 'Fix paths through walls', undo: async () => { await deleteRows(add); await insertRows({ edges: old }); }, redo: apply });
      toast.success(`${fix.rerouted.length} path${fix.rerouted.length > 1 ? 's' : ''} now go${fix.rerouted.length > 1 ? '' : 'es'} through the doorways`, { description: noDoor, duration: 6000 });
    } catch (err) {
      console.error('Fix paths through walls failed:', err);
      toast.error("Couldn't fix the paths");
    }
  };

  // A stair / lift / ramp connection: a path between places on two floors.
  // Routing treats any floor change as a fixed cost, so the stored length is nominal.
  const linkToFloor = async (fromId: string, toId: string, kind: 'stairs' | 'elevator' | 'ramp' | 'escalator') => {
    if (!buildingId || !toId) return;
    if (edgesRef.current.some(e => (e.fromNodeId === fromId && e.toNodeId === toId) || (e.fromNodeId === toId && e.toNodeId === fromId))) {
      toast.error('Already linked');
      return;
    }
    const row = {
      id: crypto.randomUUID(), building_id: buildingId, from_node: fromId, to_node: toId, weight: 15 * PX_PER_METER, source: 'manual', ...stamp(),
      connection: kind, accessible: kind === 'elevator' || kind === 'ramp',
    } as EdgeRow;
    if (await createRows({ edges: [row] }, `Link floors (${kind})`)) setLinkTarget('');
  };

  const deleteEdge = async (edgeId: string) => {
    try {
      const rows = await run(supabase.from('edges').select('*').eq('id', edgeId));
      if (!rows.length) return;
      await deleteRows({ edges: rows });
      history.push({ label: 'Delete path', undo: () => insertRows({ edges: rows }), redo: () => deleteRows({ edges: rows }) });
    } catch (err) {
      console.error('Delete edge error:', err);
      toast.error('Failed to delete path');
    }
  };

  const addWall = (a: Pt, b: Pt) => {
    if (!buildingId || !floorId || dist(a, b) < 2) return;
    const loop = closedLoop(wallsRef.current, a, b);
    createRows({ walls: [wallRow({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })] }, 'Draw wall').then(ok => {
      if (!ok || !loop) return;
      // A closed shape of walls: offer to make it a room (unless one is already there).
      const c = polygonCentroid(loop);
      if (roomsRef.current.some(rm => pointInPolygon(c, roomOutline(rm)))) return;
      toast('These walls close a room', { action: { label: 'Make a room', onClick: () => addRoomFromPolygon(loop) }, duration: 8000 });
    });
  };

  const addFeature = (kind: FeatureKind, p: Pt, rotationDeg = 0, label: string | null = null) => {
    if (!buildingId || !floorId) return;
    const row = { id: crypto.randomUUID(), ...newRowBase(), ...stamp(), kind, x: p.x, y: p.y, rotation_deg: rotationDeg, width: null, depth: null, label } as FeatureRow;
    createRows({ features: [row] }, `Add ${FEATURE_KINDS[kind].label.toLowerCase()}`).then(ok => { if (ok) selectOnly('features', row.id); });
  };

  /** The automatic trees round the building, made into real ones the venue can move and delete (one undo). */
  const sceneryFromRing = async () => {
    const model = modelRef.current;
    if (!model || !floorId || !buildingId) return;
    const b = groundBounds(model.venue, floorId);
    if (!b) { toast.info('Draw the building first — the trees go round it.'); return; }
    const rows = sceneryRing(b).map(t => ({
      id: crypto.randomUUID(), ...newRowBase(), ...stamp(), kind: 'tree', x: Math.round(t.at.x * PX_PER_METER), y: Math.round(t.at.z * PX_PER_METER),
      rotation_deg: 0, width: Math.round(t.size * PX_PER_METER), depth: Math.round(t.size * PX_PER_METER), label: null,
    } as FeatureRow));
    if (await createRows({ features: rows }, 'Make the trees editable')) {
      toast.success(`${rows.length} trees are now yours to edit`, { description: 'Select any of them to move or delete it, or add more scenery.' });
    }
  };

  const addRoomFromPolygon = (pts: Pt[]) => {
    if (!buildingId || !floorId || pts.length < 3 || polygonArea(pts) < 0.25 * PX_PER_METER * PX_PER_METER) {
      toast.error('A room needs at least 3 corners and some area');
      return;
    }
    const b = bbox(pts), c = roundPt(polygonCentroid(pts));
    const name = `Room ${roomsRef.current.length + 1}`;
    // Every room gets a place at its centre, so visitors can navigate to it.
    const node = { id: crypto.randomUUID(), ...newRowBase(), ...stamp(), name, x: c.x, y: c.y, is_hallway: false, type: 'room' } as NodeRow;
    const room = {
      id: crypto.randomUUID(), ...newRowBase(), ...stamp(), node_id: node.id, name, type: 'office',
      x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY, polygon: polyJson(pts),
    } as RoomRow;
    createRows({ nodes: [node], rooms: [room] }, 'Draw room').then(ok => { if (ok) selectOnly('rooms', room.id); });
  };

  const duplicateSelection = () => {
    if (!buildingId || !floorId) return;
    const n = selCount(selRef.current);
    if (!n) return;
    const s = takeSnap(selRef.current);
    const off = PX_PER_METER; // 1 m down-right
    const nodeMap = new Map(s.nodes.map(x => [x.id, crypto.randomUUID()] as const));
    const rows: Rows = {
      nodes: s.nodes.map(x => ({ id: nodeMap.get(x.id)!, ...newRowBase(), ...stamp(), name: x.name, x: x.x + off, y: x.y + off, is_hallway: x.isHallway, type: x.isHallway ? 'hallway' : 'normal' } as NodeRow)),
      walls: s.walls.map(w => wallRow({ x1: w.x1 + off, y1: w.y1 + off, x2: w.x2 + off, y2: w.y2 + off })),
      features: s.features.map(f => ({ id: crypto.randomUUID(), ...newRowBase(), ...stamp(), kind: f.kind, x: f.x + off, y: f.y + off, rotation_deg: f.rotationDeg, width: f.width, depth: f.depth, label: f.label } as FeatureRow)),
      rooms: s.rooms.map(r => ({
        id: crypto.randomUUID(), ...newRowBase(), ...stamp(), node_id: nodeMap.get(r.nodeId) ?? null, name: r.name, type: r.type,
        x: r.x + off, y: r.y + off, width: r.width, height: r.height, polygon: polyJson(r.polygon?.map(p => ({ x: p.x + off, y: p.y + off }))),
      } as RoomRow)),
      edges: edgesRef.current.filter(e => nodeMap.has(e.fromNodeId) && nodeMap.has(e.toNodeId)).map(e => ({
        id: crypto.randomUUID(), building_id: buildingId, from_node: nodeMap.get(e.fromNodeId)!, to_node: nodeMap.get(e.toNodeId)!, weight: e.weight, source: 'manual', ...stamp(),
      } as EdgeRow)),
    };
    createRows(rows, n === 1 ? 'Duplicate' : `Duplicate ${n} items`).then(ok => {
      if (ok) setSel({ nodes: rows.nodes.map(x => x.id), walls: rows.walls.map(x => x.id), features: rows.features.map(x => x.id), rooms: rows.rooms.map(x => x.id) });
    });
  };

  // ── Field edits (inspector), each undoable ────────────────────────────────
  const updateNodeFields = async (nodeId: string, f: { name: string; isHallway: boolean }) => {
    await run(supabase.from('nodes').update({ name: f.name, is_hallway: f.isHallway }).eq('id', nodeId));
    setNodes(p => p.map(n => (n.id === nodeId ? { ...n, name: f.name, isHallway: f.isHallway } : n)));
  };

  const saveNodeEdit = async () => {
    const node = nodeDialog.node;
    if (!node) return;
    const before = { name: node.name, isHallway: node.isHallway }, after = { ...nodeForm };
    try {
      await updateNodeFields(node.id, after);
      history.push({ label: `Edit ${after.name || 'place'}`, undo: () => updateNodeFields(node.id, before), redo: () => updateNodeFields(node.id, after) });
      setNodeDialog({ open: false, node: null });
    } catch (err) {
      console.error('Update node error:', err);
      toast.error('Failed to update place');
    }
  };

  const editFeature = async (id: string, patch: Partial<MapFeature>, label: string) => {
    const before = featuresRef.current.find(f => f.id === id);
    if (!before) return;
    const apply = (f: MapFeature) => async () => {
      await run(supabase.from('map_features').update({ kind: f.kind, x: f.x, y: f.y, rotation_deg: f.rotationDeg, width: f.width, depth: f.depth, label: f.label }).eq('id', f.id));
      setFeatures(p => p.map(x => (x.id === f.id ? f : x)));
    };
    const after = { ...before, ...patch };
    try { await apply(after)(); history.push({ label, undo: apply(before), redo: apply(after) }); }
    catch (err) { console.error(err); toast.error('Failed to update object'); }
  };

  const editRoom = async (id: string, patch: Partial<Pick<Room, 'name' | 'type'>>, label: string) => {
    const before = roomsRef.current.find(r => r.id === id);
    if (!before) return;
    const apply = (r: Room) => async () => {
      await run(supabase.from('rooms').update({ name: r.name, type: r.type }).eq('id', r.id));
      setRooms(p => p.map(x => (x.id === r.id ? { ...x, name: r.name, type: r.type } : x)));
      // keep the room's place named like the room
      if (r.nodeId && patch.name !== undefined) {
        await run(supabase.from('nodes').update({ name: r.name }).eq('id', r.nodeId));
        setNodes(p => p.map(n => (n.id === r.nodeId ? { ...n, name: r.name } : n)));
      }
    };
    const after = { ...before, ...patch };
    try { await apply(after)(); history.push({ label, undo: apply(before), redo: apply(after) }); }
    catch (err) { console.error(err); toast.error('Failed to update room'); }
  };

  /** Change 3D columns of a wall / object / room / floor, undoably. */
  const editExtra = async (table: 'walls' | 'map_features' | 'rooms' | 'floors', id: string, patch: Extra, label: string) => {
    const before = Object.fromEntries(Object.keys(patch).map(key => [key, extras[id]?.[key] ?? null]));
    const apply = (vals: Extra) => async () => {
      const { error } = await supabase.from(table).update(vals as never).eq('id', id);
      if (error) throw new Error(/column|schema cache/i.test(error.message) ? 'Run the indoor 3D migration (20261006090000) to save 3D details.' : error.message);
      setExtras(p => ({ ...p, [id]: { ...p[id], ...vals } }));
    };
    try { await apply(patch)(); history.push({ label, undo: apply(before), redo: apply(patch) }); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save'); }
  };

  const addPlaceToRoom = async (room: Room) => {
    const c = roundPt(polygonCentroid(roomOutline(room)));
    const node = { id: crypto.randomUUID(), ...newRowBase(), ...stamp(), name: room.name, x: c.x, y: c.y, is_hallway: false, type: 'room' } as NodeRow;
    const link = (nodeId: string | null) => async () => {
      await run(supabase.from('rooms').update({ node_id: nodeId }).eq('id', room.id));
      setRooms(p => p.map(r => (r.id === room.id ? { ...r, nodeId: nodeId ?? '' } : r)));
    };
    try {
      await insertRows({ nodes: [node] });
      await link(node.id)();
      history.push({
        label: 'Add place to room',
        undo: async () => { await link(null)(); await deleteRows({ nodes: [node] }); },
        redo: async () => { await insertRows({ nodes: [node] }); await link(node.id)(); },
      });
    } catch (err) { console.error(err); toast.error('Failed to add a place'); }
  };

  // ── The map assistant's changes ────────────────────────────────────────────
  /** Writes one assistant change (new places, paths, objects; removed paths) as one undo step. */
  const applyChange = async (c: Change, label: string): Promise<boolean> => {
    if (!buildingId || !floorId) return false;
    const nodeRow = (n: Change['nodes'][number]) => ({ id: n.id, ...newRowBase(), floor_id: n.floor_id, ...stamp(), name: n.name, x: n.x, y: n.y, is_hallway: n.hallway, type: n.hallway ? 'hallway' : 'normal' } as NodeRow);
    const add: Rows = {
      nodes: c.nodes.filter(n => n.floor_id === floorId).map(nodeRow),
      edges: c.edges.map(e => ({ id: e.id, building_id: buildingId, from_node: e.from_node, to_node: e.to_node, weight: e.weight, source: 'manual', ...stamp(), ...(e.connection ? { connection: e.connection, accessible: !!e.accessible } : {}) } as EdgeRow)),
      features: c.features.map(f => ({ id: f.id, ...newRowBase(), floor_id: f.floor_id, ...stamp(), kind: f.kind, x: f.x, y: f.y, rotation_deg: 0, width: null, depth: null, label: f.label } as FeatureRow)),
      rooms: [], walls: [],
    };
    // Places on other floors (the far end of a floor link) aren't drawn here.
    const elsewhere = c.nodes.filter(n => n.floor_id !== floorId).map(nodeRow);
    const roomBefore = new Map(c.roomPlaces.map(l => [l.roomId, roomsRef.current.find(r => r.id === l.roomId)?.nodeId || null] as const));
    const link = (to: 'after' | 'before') => async () => {
      for (const l of c.roomPlaces) {
        const nodeId = to === 'after' ? l.nodeId : roomBefore.get(l.roomId) ?? null;
        await run(supabase.from('rooms').update({ node_id: nodeId }).eq('id', l.roomId));
        setRooms(p => p.map(r => (r.id === l.roomId ? { ...r, nodeId: nodeId ?? '' } : r)));
      }
    };
    const shared = (more: Partial<PlanRows>, less: { nodes: string[]; edges: string[] }) => setAllRows(p => p && ({
      ...p,
      nodes: [...p.nodes.filter(n => !less.nodes.includes(n.id)), ...(more.nodes ?? [])],
      edges: [...p.edges.filter(e => !less.edges.includes(e.id)), ...(more.edges ?? [])],
    }));
    try {
      const gone: Rows = {
        edges: c.removeEdges.length ? await run(supabase.from('edges').select('*').in('id', c.removeEdges)) : [],
        nodes: c.removeNodes.length ? await run(supabase.from('nodes').select('*').in('id', c.removeNodes)) : [],
        rooms: [], walls: [], features: [],
      };
      const forward = async () => {
        await deleteRows(gone);
        if (elsewhere.length) await run(supabase.from('nodes').insert(elsewhere));
        await insertRows(add);
        await link('after')();
        shared({ nodes: elsewhere.map(n => ({ id: n.id, floor_id: n.floor_id, name: n.name, x: n.x, y: n.y, is_hallway: n.is_hallway })), edges: add.edges.filter(e => (e as { connection?: string }).connection).map(e => ({ id: e.id, from_node: e.from_node, to_node: e.to_node, connection: (e as { connection?: string }).connection ?? null })) }, { nodes: [], edges: c.removeEdges });
      };
      const back = async () => {
        await link('before')();
        await deleteRows(add);
        if (elsewhere.length) await run(supabase.from('nodes').delete().in('id', elsewhere.map(n => n.id)));
        await insertRows(gone);
        shared({}, { nodes: elsewhere.map(n => n.id), edges: add.edges.map(e => e.id) });
      };
      await forward();
      history.push({ label, undo: back, redo: forward });
      return true;
    } catch (err) {
      console.error(`${label} failed:`, err);
      return false;
    }
  };

  const selOf = (t: Thing): Sel => ({ ...NO_SEL, [t.kind === 'room' ? 'rooms' : t.kind === 'place' ? 'nodes' : 'features']: [t.id] });

  /** Carries out what the map assistant decided. */
  const applyAssistant = async (p: Plan): Promise<boolean> => {
    if (p.change) {
      const ok = await applyChange(p.change, p.label ?? 'Map change');
      if (ok && p.select) selectOnly(p.select.kind, p.select.id);
      return ok;
    }
    const e = p.edit;
    if (!e) return true;
    try {
      switch (e.op) {
        case 'undo': await history.undo(); return true;
        case 'show':
          setSel(selOf(e.thing));
          viewport.centerOn(e.thing.at.x, e.thing.at.y, 1);
          return true;
        case 'move': {
          const before = takeSnap(selOf(e.thing));
          await commitTransform(before, transformSnap(before, { kind: 'move', dx: e.dx, dy: e.dy }), `Move ${e.thing.name}`);
          setSel(selOf(e.thing));
          return true;
        }
        case 'rename':
          if (e.thing.kind === 'room') await editRoom(e.thing.id, { name: e.name }, `Rename to ${e.name}`);
          else if (e.thing.kind === 'object') await editFeature(e.thing.id, { label: e.name }, `Rename to ${e.name}`);
          else {
            const n = nodesRef.current.find(x => x.id === e.thing.id);
            if (!n) return false;
            const before = { name: n.name, isHallway: n.isHallway }, after = { name: e.name, isHallway: n.isHallway };
            await updateNodeFields(n.id, after);
            history.push({ label: `Rename to ${e.name}`, undo: () => updateNodeFields(n.id, before), redo: () => updateNodeFields(n.id, after) });
          }
          return true;
        case 'remove': await deleteSelection(selOf(e.thing)); return true;
      }
    } catch (err) {
      console.error('Assistant edit failed:', err);
      return false;
    }
  };

  const saveRoom = async () => {
    if (!roomDialog.nodeId || !floorId || !buildingId) return;
    const node = nodesRef.current.find(n => n.id === roomDialog.nodeId);
    if (!node) return;
    const existing = roomsRef.current.find(r => r.nodeId === roomDialog.nodeId);
    const fields = {
      name: roomForm.name, type: roomForm.type, width: roomForm.width, height: roomForm.height,
      x: node.x - roomForm.width / 2, y: node.y - roomForm.height / 2,
    };
    try {
      if (existing) {
        type F = typeof fields & { polygon?: Pt[] };
        const before: F = { name: existing.name, type: existing.type, width: existing.width, height: existing.height, x: existing.x, y: existing.y, polygon: existing.polygon };
        const apply = (f: F) => async () => {
          await run(supabase.from('rooms').update({ ...f, polygon: polyJson(f.polygon) }).eq('id', existing.id));
          setRooms(p => p.map(r => (r.id === existing.id ? { ...r, ...f } : r)));
        };
        // Setting the size by numbers turns a drawn polygon back into a rectangle.
        const after: F = { ...fields, polygon: undefined };
        await apply(after)();
        history.push({ label: `Edit room ${fields.name}`, undo: apply(before), redo: apply(after) });
      } else {
        const row = { id: crypto.randomUUID(), ...newRowBase(), ...stamp(), node_id: node.id, polygon: null, ...fields } as RoomRow;
        await createRows({ rooms: [row] }, `Add room ${row.name}`);
      }
      setRoomDialog({ open: false, nodeId: null });
    } catch (err) {
      console.error('Save room error:', err);
      toast.error('Failed to save room');
    }
  };

  // Publishing sends visitors a copy of the venue as it is now; to take it
  // offline, use Publish Settings in the dashboard.
  const togglePublish = async () => {
    if (!buildingId || !building) return;
    try { await publishVenue(buildingId); }
    catch (err) { toast.error(`Couldn't publish: ${err instanceof Error ? err.message : err}`); return; }
    setBuilding({ ...building, isPublished: true });
    toast.success('Published — visitors now see your latest map');
  };

  // ── Pointer interaction ────────────────────────────────────────────────────
  const hideSnapMark = () => {
    snapMarkRef.current?.setAttribute('visibility', 'hidden');
    if (snapKindRef.current) snapKindRef.current.textContent = '';
  };
  const showSnapMark = (p: Pt & { kind: SnapKind | null }) => {
    const g = snapMarkRef.current;
    if (!g) return;
    if (!p.kind || p.kind === 'grid') { hideSnapMark(); if (p.kind === 'grid' && snapKindRef.current) snapKindRef.current.textContent = 'Grid'; return; }
    g.setAttribute('visibility', 'visible');
    g.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${k})`);
    if (snapKindRef.current) snapKindRef.current.textContent = SNAP_LABEL[p.kind];
  };

  // Select-tool press on an item: select it (Shift toggles) and get ready to drag the selection.
  const pressItem = (e: React.PointerEvent, key: SelKey, id: string) => {
    const s = selRef.current;
    const next = e.shiftKey ? toggleIn(s, key, id) : s[key].includes(id) ? s : { ...NO_SEL, [key]: [id] };
    selRef.current = next;
    setSel(next);
    if (!next[key].includes(id)) return;
    // A lone place drags by its own (snapped) position; anything else by the cursor.
    const lone = key === 'nodes' && selCount(next) === 1 ? nodesRef.current.find(n => n.id === id) : null;
    interaction.current = { kind: 'move', grab: lone ? { x: lone.x, y: lone.y } : svgPoint(e.clientX, e.clientY), before: takeSnap(next), delta: { x: 0, y: 0 } };
    svgRef.current?.setPointerCapture(e.pointerId);
    setDragging('move');
  };

  const onCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = svgPoint(e.clientX, e.clientY);
    lastClick.current = roundPt(p); // "here", for the map assistant
    const wantsPan = e.button === 1 || (e.button === 0 && (spaceHeld || tool === 'hand'));
    if (wantsPan) {
      interaction.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging('pan');
      return;
    }
    if (e.button !== 0) return;

    if (tool === 'select') {
      // places and objects handle their own presses; here: walls, rooms, or empty space
      const w = layers.walls ? wallAt(p) : null;
      if (w) return pressItem(e, 'walls', w.id);
      // Rooms fill most of a plan, so pressing in one only drags it if it's
      // already selected; otherwise a drag draws a selection box and a plain
      // click selects the room (decided on release).
      const r = layers.rooms ? roomAt(p) : null;
      if (r && selRef.current.rooms.includes(r.id) && !e.shiftKey) return pressItem(e, 'rooms', r.id);
      interaction.current = { kind: 'marquee', start: p, startX: e.clientX, startY: e.clientY, additive: e.shiftKey, roomId: r?.id ?? null };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (WALL_PICK_TOOLS.includes(tool)) {
      const w = wallAt(p);
      if (tool === 'delete') {
        if (w) deleteSelection({ ...NO_SEL, walls: [w.id] });
        else { const r = roomAt(p); if (r) deleteSelection({ ...NO_SEL, rooms: [r.id] }); }
        return;
      }
      if (!w) return;
      const others = wallsRef.current.filter(x => x.id !== w.id);
      if (tool === 'split') {
        const parts = splitAt(w, p, 2);
        if (parts) replaceWalls([w.id], parts, 'Split wall'); else toast.info('Click further from the end of the wall');
      } else if (tool === 'trim') {
        const keep = trimAt(w, p, others);
        if (keep) replaceWalls([w.id], keep, 'Trim wall'); else toast.info('Nothing crosses this wall to trim against');
      } else if (tool === 'extend') {
        const ext = extendTo(w, p, others);
        if (ext) replaceWalls([w.id], [ext], 'Extend wall'); else toast.info('No wall to extend to in that direction');
      } else if (tool === 'join') {
        if (!joinFirst) { setJoinFirst(w.id); }
        else if (joinFirst !== w.id) {
          const a = wallsRef.current.find(x => x.id === joinFirst);
          const j = a ? joinSegs(a, w, 0.5 * PX_PER_METER) : null;
          if (a && j) replaceWalls([a.id, w.id], [j], 'Join walls'); else toast.error('Those walls aren\'t in line with each other');
          setJoinFirst(null);
        }
      } else if (tool === 'offset') {
        createRows({ walls: [wallRow(offsetSeg(w, sideOf(w, p) * offsetM * PX_PER_METER))] }, 'Offset wall');
      }
      return;
    }

    if (DRAW_TOOLS.includes(tool) || tool === 'add-edge') {
      interaction.current = { kind: 'place', startX: e.clientX, startY: e.clientY };
    }
  };

  const onItemPointerDown = (e: React.PointerEvent, key: SelKey, id: string) => {
    if (e.button !== 0 || spaceHeld || tool === 'hand') return; // let pans through
    if (tool !== 'select') return; // other tools act on click (or treat it as a canvas click)
    e.stopPropagation();
    pressItem(e, key, id);
  };

  const onCanvasPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const raw = svgPoint(e.clientX, e.clientY);
    const it = interaction.current;
    const snapping = DRAW_TOOLS.includes(tool) || it?.kind === 'move';
    const lone = it?.kind === 'move' && it.before.nodes.length === 1 && selCount(selRef.current) === 1 ? it.before.nodes[0].id : undefined;
    const p = snapping ? snapAt(raw, e.altKey, lone) : { ...raw, kind: null };
    if (snapping) showSnapMark(p); else hideSnapMark();
    if (cursorRef.current) cursorRef.current.textContent = `${meters(p.x)}, ${meters(p.y)} m`;

    // Rubber band for path / wall / measure / room / area, updated without re-rendering.
    const line = previewLineRef.current;
    if (line) { line.setAttribute('x2', String(p.x)); line.setAttribute('y2', String(p.y)); }
    const anchor = tool === 'wall' ? wallStart : tool === 'measure' && measure && !measure.b ? measure.a
      : (tool === 'room' || tool === 'area') && poly.length ? poly[poly.length - 1] : null;
    const label = previewLabelRef.current;
    if (label && anchor) {
      label.setAttribute('x', String((anchor.x + p.x) / 2));
      label.setAttribute('y', String((anchor.y + p.y) / 2 - 8 * k));
      label.textContent = `${meters(dist(anchor, p))} m`;
    }

    if (WALL_PICK_TOOLS.includes(tool) && !it) {
      const w = wallAt(raw);
      if ((w?.id ?? null) !== hoverWall) setHoverWall(w?.id ?? null);
    }

    if (it?.kind === 'pan') {
      viewport.panByScreen(e.clientX - it.lastX, e.clientY - it.lastY);
      it.lastX = e.clientX; it.lastY = e.clientY;
    } else if (it?.kind === 'move') {
      const delta = { x: Math.round(p.x - it.grab.x), y: Math.round(p.y - it.grab.y) };
      if (delta.x === it.delta.x && delta.y === it.delta.y) return;
      it.delta = delta;
      applyLocal(transformSnap(it.before, { kind: 'move', dx: delta.x, dy: delta.y }));
    } else if (it?.kind === 'marquee') {
      setMarquee({ a: it.start, b: raw });
    }
  };

  const onCanvasPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const it = interaction.current;
    interaction.current = null;
    setDragging(null);
    setMarquee(null);
    if (!it) return;
    const still = (sx: number, sy: number) => Math.hypot(e.clientX - sx, e.clientY - sy) < 4;
    if (it.kind === 'move') {
      if (it.delta.x || it.delta.y) {
        const n = selCount(selRef.current);
        commitTransform(it.before, transformSnap(it.before, { kind: 'move', dx: it.delta.x, dy: it.delta.y }), n === 1 ? 'Move' : `Move ${n} items`);
      }
    } else if (it.kind === 'marquee') {
      if (still(it.startX, it.startY)) {
        if (it.roomId) setSel(it.additive ? toggleIn(selRef.current, 'rooms', it.roomId) : { ...NO_SEL, rooms: [it.roomId] });
        else if (!it.additive) setSel(NO_SEL);
        return;
      }
      const b = bbox([it.start, svgPoint(e.clientX, e.clientY)]);
      const inside = (q: Pt) => q.x >= b.minX && q.x <= b.maxX && q.y >= b.minY && q.y <= b.maxY;
      const hit: Sel = {
        nodes: nodesRef.current.filter(inside).map(n => n.id),
        walls: layers.walls ? wallsRef.current.filter(w => inside({ x: w.x1, y: w.y1 }) && inside({ x: w.x2, y: w.y2 })).map(w => w.id) : [],
        features: layers.objects ? featuresRef.current.filter(inside).map(f => f.id) : [],
        rooms: layers.rooms ? roomsRef.current.filter(r => roomOutline(r).every(inside)).map(r => r.id) : [],
      };
      const cur = selRef.current;
      setSel(it.additive ? {
        nodes: [...new Set([...cur.nodes, ...hit.nodes])], walls: [...new Set([...cur.walls, ...hit.walls])],
        features: [...new Set([...cur.features, ...hit.features])], rooms: [...new Set([...cur.rooms, ...hit.rooms])],
      } : hit);
    } else if (it.kind === 'pan' && still(it.startX, it.startY) && tool === 'hand') {
      setSel(NO_SEL);
    } else if (it.kind === 'place' && still(it.startX, it.startY)) {
      const p = snapAt(svgPoint(e.clientX, e.clientY), e.altKey);
      const pt = { x: p.x, y: p.y };
      if (tool === 'add-node') addNode(p.x, p.y);
      else if (tool === 'wall') {
        if (wallStart) addWall(wallStart, pt);
        setWallStart(pt); // keep drawing from the end point
      } else if (tool === 'measure') {
        setMeasure(m => (!m || m.b ? { a: pt, b: null } : { a: m.a, b: pt }));
      } else if (tool === 'room' || tool === 'area') {
        if (tool === 'area' && areaDone) setAreaDone(null);
        // clicking the first corner closes the shape
        if (poly.length >= 3 && Math.hypot(pt.x - poly[0].x, pt.y - poly[0].y) <= SNAP_PX * k) finishPoly(poly);
        else if (!poly.length || dist(poly[poly.length - 1], pt) > 0) setPoly([...poly, pt]);
      } else if (tool === 'door') {
        // Doors sit in a wall, turned to follow it.
        const w = wallAt(pt, SNAP_PX * 2);
        if (!w) { toast.info('Click on a wall to put the door in it'); return; }
        const pr = projectOnSegment(pt, w);
        addFeature('door', roundPt(pr.pt), (Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180) / Math.PI);
      } else if (tool === 'object') {
        addFeature(objectKind, pt);
      } else if (tool === 'scenery') {
        addFeature(sceneryKind, pt);
      } else if (tool === 'text') {
        setTextDialog({ open: true, at: pt, text: '' });
      }
    }
  };

  const finishPoly = (pts = poly) => {
    const clean = pts.filter((q, i) => i === 0 || dist(q, pts[i - 1]) > 0);
    if (clean.length < 3) { toast.info('Add at least 3 corners'); return; }
    if (tool === 'room') addRoomFromPolygon(clean);
    else if (tool === 'area') setAreaDone(clean);
    setPoly([]);
  };

  const onNodeClick = (e: React.MouseEvent, nodeId: string) => {
    if (DRAW_TOOLS.includes(tool)) return; // treated as a canvas click (snaps to the place)
    e.stopPropagation();
    if (tool === 'add-edge') {
      if (!edgeStart) setEdgeStart(nodeId);
      else if (edgeStart !== nodeId) { addEdge(edgeStart, nodeId); setEdgeStart(null); }
    } else if (tool === 'delete') {
      deleteSelection({ ...NO_SEL, nodes: [nodeId] });
    }
  };

  const onFeaturePointerDown = (e: React.PointerEvent, id: string) => {
    if (tool === 'delete' && e.button === 0) { e.stopPropagation(); deleteSelection({ ...NO_SEL, features: [id] }); return; }
    onItemPointerDown(e, 'features', id);
  };

  const onEdgeClick = (e: React.MouseEvent, edgeId: string) => {
    e.stopPropagation();
    if (tool === 'delete') deleteEdge(edgeId);
  };

  const cancelDrawing = () => {
    setEdgeStart(null); setWallStart(null); setMeasure(null); setPoly([]); setAreaDone(null); setJoinFirst(null); setHoverWall(null); hideSnapMark();
  };
  const chooseTool = (t: Tool) => { setTool(t); cancelDrawing(); };

  // Selection coming from the 3D view; stable so the memoised 3D view
  // doesn't re-render on every 2D pointer move.
  const selectFrom3D = useCallback((id: string | null) => setSel(id ? { ...NO_SEL, nodes: [id] } : NO_SEL), []);

  const showIn2D = (nodeId: string) => {
    const n = nodesRef.current.find(x => x.id === nodeId);
    if (!n) return;
    setSelectedNodeId(nodeId);
    if (view === '3d') {
      pendingCenter.current = { x: n.x, y: n.y };
      setView('split');
    } else {
      viewport.centerOn(n.x, n.y, 1);
    }
  };
  const showIn3D = (nodeId: string) => {
    if (view === '2d') setView('split');
    setSelectedNodeId(nodeId);
    setFocus3D(f => f + 1);
  };

  // ── Keyboard ───────────────────────────────────────────────────────────────
  const keyActions = useRef({ history, fitToContent, viewport, deleteSelection, chooseTool, cancelDrawing, finishPoly, duplicateSelection, tool, view });
  keyActions.current = { history, fitToContent, viewport, deleteSelection, chooseTool, cancelDrawing, finishPoly, duplicateSelection, tool, view };

  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const keyTools = Object.fromEntries(ALL_TOOLS.filter(t => t.key).map(t => [t.key!.toLowerCase(), t.id]));
    const views: Record<string, ViewMode> = { '1': '2d', '2': '3d', '3': 'split' };
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target) || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (walking.current && keyActions.current.view !== '2d') return;
      const a = keyActions.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') { e.preventDefault(); (e.shiftKey ? a.history.redo : a.history.undo)(); return; }
      if (mod && key === 'y') { e.preventDefault(); a.history.redo(); return; }
      if (mod && key === 'd') { e.preventDefault(); a.duplicateSelection(); return; }
      if (mod && key === 'a') {
        e.preventDefault();
        setSel({ nodes: nodesRef.current.map(n => n.id), walls: wallsRef.current.map(w => w.id), features: featuresRef.current.map(f => f.id), rooms: roomsRef.current.map(r => r.id) });
        return;
      }
      if (mod) return;
      if (e.code === 'Space') { e.preventDefault(); setSpaceHeld(true); return; }
      if (keyTools[key]) a.chooseTool(keyTools[key]);
      else if (views[key]) setView(views[key]);
      else if (key === 'f') a.fitToContent();
      else if (key === 'g') setGridOn(v => !v);
      else if (key === 's') setSnapOn(v => !v);
      else if (key === '=' || key === '+') a.viewport.zoomBy(1.25);
      else if (key === '-') a.viewport.zoomBy(0.8);
      else if (key === 'enter' && (a.tool === 'room' || a.tool === 'area')) a.finishPoly();
      else if (key === 'delete' || key === 'backspace') a.deleteSelection(selRef.current);
      else if (key === 'escape') { a.cancelDrawing(); setSel(NO_SEL); }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  // ── Dialog openers ─────────────────────────────────────────────────────────
  const openNodeEdit = (node: NavNode) => {
    setNodeForm({ name: node.name, isHallway: node.isHallway });
    setNodeDialog({ open: true, node });
  };

  const openRoomCreate = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    const existing = rooms.find(r => r.nodeId === nodeId);
    setRoomForm({
      name: existing?.name || node?.name || '',
      type: existing?.type || (roomTypeFromName(node?.name ?? '') as Room['type']),
      width: existing?.width || 100,
      height: existing?.height || 80,
    });
    setRoomDialog({ open: true, nodeId });
  };

  const handleQRPreview = async (nodeId: string) => {
    if (!buildingId || !floorId) return;
    const dataUrl = await generateQRCodeDataURL({ nodeId, buildingId, floorId });
    setQrPreview({ open: true, nodeId, dataUrl });
  };

  const handleQRDownload = () => {
    if (!qrPreview || !buildingId || !floorId) return;
    downloadQRCode({ nodeId: qrPreview.nodeId, buildingId, floorId });
  };

  // ── Derived render data ────────────────────────────────────────────────────
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n] as const)), [nodes]);
  const roomByNode = useMemo(() => new Map(rooms.map(r => [r.nodeId, r] as const)), [rooms]);
  // A real plan can have thousands of wall segments: draw them as one path.
  const wallPath = useMemo(() => walls.map(w => `M${w.x1} ${w.y1}L${w.x2} ${w.y2}`).join(''), [walls]);
  const highlightWallPath = useMemo(() => {
    const ids = new Set([...sel.walls, ...(hoverWall ? [hoverWall] : []), ...(joinFirst ? [joinFirst] : [])]);
    return ids.size ? walls.filter(w => ids.has(w.id)).map(w => `M${w.x1} ${w.y1}L${w.x2} ${w.y2}`).join('') : '';
  }, [walls, sel.walls, hoverWall, joinFirst]);
  const plainWalls = useMemo<Wall[]>(() => walls.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })), [walls]);
  const editorModel = useMemo(() => {
    if (!allRows || !floorId) return null;
    const ex = (id: string) => extras[id] ?? {};
    const here = new Set(nodes.map(n => n.id));
    const rows: PlanRows = {
      ...allRows,
      floors: allRows.floors.map(fl => ({ ...fl, ...ex(fl.id) })),
      walls: [...allRows.walls.filter(w => w.floor_id !== floorId), ...walls.map(w => ({ id: w.id, floor_id: floorId, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, ...ex(w.id) }))],
      rooms: [...allRows.rooms.filter(rm => rm.floor_id !== floorId), ...rooms.map(rm => ({ id: rm.id, floor_id: floorId, name: rm.name, x: rm.x, y: rm.y, width: rm.width, height: rm.height, type: rm.type, node_id: rm.nodeId || null, polygon: polyJson(rm.polygon), ...ex(rm.id) }))],
      map_features: [...allRows.map_features.filter(x => x.floor_id !== floorId), ...features.map(x => ({ id: x.id, floor_id: floorId, kind: x.kind, x: x.x, y: x.y, rotation_deg: x.rotationDeg, width: x.width, depth: x.depth, label: x.label, ...ex(x.id) }))],
      nodes: [...allRows.nodes.filter(n => n.floor_id !== floorId), ...nodes.map(n => ({ id: n.id, floor_id: floorId, name: n.name, x: n.x, y: n.y, is_hallway: n.isHallway }))],
      edges: [...allRows.edges.filter(e => !here.has(e.from_node) && !here.has(e.to_node)), ...edges.map(e => ({ id: e.id, from_node: e.fromNodeId, to_node: e.toNodeId, connection: (allRows.edges.find(x => x.id === e.id)?.connection) ?? null }))],
    };
    return { rows, venue: fromPlan(rows, { pxPerMeter: PX_PER_METER }) };
  }, [allRows, floorId, extras, walls, rooms, features, nodes, edges]);
  const modelRef = useRef(editorModel);
  modelRef.current = editorModel;
  const blockedEdges = useMemo(
    () => new Set(editorModel ? pathsThroughWalls(editorModel.rows, PX_PER_METER, edges.map(e => e.id), editorModel.venue) : []),
    [editorModel, edges],
  );
  const blockedRef = useRef(blockedEdges);
  blockedRef.current = blockedEdges;
  // The plan checks for this floor (rooms, doors, paths, stairs).
  const floorIssues = useMemo<Issue[]>(() => (editorModel ? validate(editorModel.venue, editorModel.rows, PX_PER_METER).filter(i => i.floorId === floorId) : []), [editorModel, floorId]);
  const showIssue = (i: Issue) => {
    const id = i.ids[0];
    if (i.kind.startsWith('room')) selectOnly('rooms', id);
    else if (i.kind === 'door-off-wall' || i.kind.startsWith('stairs')) { if (features.some(x => x.id === id)) selectOnly('features', id); }
    else if (nodes.some(n => n.id === id)) showIn2D(id);
  };
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const selectedRoom = selectedNodeId ? roomByNode.get(selectedNodeId) ?? null : null;
  const edgeStartNode = edgeStart ? nodeById.get(edgeStart) ?? null : null;
  const selSet = useMemo(() => ({ nodes: new Set(sel.nodes), features: new Set(sel.features), rooms: new Set(sel.rooms) }), [sel]);

  // Map health: what stops visitors being routed. Recomputed on every edit.
  const health = useMemo(() => {
    const adj = new Map<string, string[]>(nodes.map(n => [n.id, []]));
    for (const e of edges) {
      if (adj.has(e.fromNodeId) && adj.has(e.toNodeId)) { adj.get(e.fromNodeId)!.push(e.toNodeId); adj.get(e.toNodeId)!.push(e.fromNodeId); }
    }
    // a link to another floor counts as a way in, too
    const linked = new Set(edges.flatMap(e => [e.fromNodeId, e.toNodeId]));
    const unconnected = nodes.filter(n => !n.isHallway && !linked.has(n.id));
    const seen = new Set<string>();
    const networks: string[][] = [];
    for (const n of nodes) {
      if (seen.has(n.id) || (adj.get(n.id)?.length ?? 0) === 0) continue;
      const comp: string[] = [];
      const stack = [n.id];
      seen.add(n.id);
      while (stack.length) {
        const id = stack.pop()!;
        comp.push(id);
        for (const m of adj.get(id) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
      }
      networks.push(comp);
    }
    networks.sort((a, b) => b.length - a.length);
    const roomsWithoutPlace = rooms.filter(r => !r.nodeId || !adj.has(r.nodeId));
    return { unconnected, networks, roomsWithoutPlace };
  }, [nodes, edges, rooms]);

  // What the map assistant sees: the whole plan, the selection, the last click, the view.
  const viewRef = useRef(viewport.viewBox); viewRef.current = viewport.viewBox;
  const assistantState = useCallback(() => {
    const m = modelRef.current;
    if (!m || !floorId) return null;
    const v = viewRef.current;
    return { floorId, rows: m.rows, selection: { nodes: selRef.current.nodes, rooms: selRef.current.rooms, features: selRef.current.features }, click: lastClick.current, view: { x: v.x + v.w / 2, y: v.y + v.h / 2 } };
  }, [floorId]);
  const mapHealth = useMemo(() => {
    if (!editorModel || !floorId) return [];
    try { return healthOf({ floorId, rows: editorModel.rows, selection: { nodes: [], rooms: [], features: [] }, click: null, view: { x: 0, y: 0 }, last: null, lastChange: null }); }
    catch (err) { console.error('map health failed', err); return []; }
  }, [editorModel, floorId]);
  // After an import, the map says what it found and what to fix first.
  useEffect(() => {
    if (!greetAfterLoad.current || loading || !editorModel || !floorId) return;
    greetAfterLoad.current = false;
    const s = { floorId, rows: editorModel.rows, selection: { nodes: [], rooms: [], features: [] }, click: null, view: { x: 0, y: 0 }, last: null, lastChange: null };
    setGreeting({ key: Date.now(), ...importSummary(s) });
  }, [loading, editorModel, floorId]);
  const selectedName = sel.rooms.length === 1 ? rooms.find(r => r.id === sel.rooms[0])?.name || null
    : sel.nodes.length === 1 ? nodes.find(n => n.id === sel.nodes[0])?.name || null
    : sel.features.length === 1 ? (() => { const f = features.find(x => x.id === sel.features[0]); return f ? f.label || FEATURE_KINDS[f.kind]?.label || null : null; })() : null;

  const nodeColor = (node: NavNode) => {
    const type = roomByNode.get(node.id)?.type;
    if (type === 'stairs') return 'hsl(var(--destructive))';
    if (type === 'elevator') return 'hsl(217 91% 50%)';
    if (type === 'entrance') return 'hsl(142 71% 45%)';
    if (node.isHallway) return 'hsl(var(--muted-foreground))';
    return 'hsl(var(--primary))';
  };

  const toolDef = ALL_TOOLS.find(t => t.id === tool)!;
  const hint = tool === 'add-edge' && edgeStart ? 'Now click the place to connect to · Esc to cancel'
    : tool === 'join' && joinFirst ? 'Now click the wall to join it with · Esc to cancel'
    : (tool === 'room' || tool === 'area') && poly.length ? `${poly.length} corner${poly.length > 1 ? 's' : ''} · click the first corner or press Enter to finish · Esc to cancel`
    : toolDef.hint;

  const canvasCursor = dragging === 'move' ? 'cursor-move' : dragging === 'pan' ? 'cursor-grabbing'
    : spaceHeld || tool === 'hand' ? 'cursor-grab'
    : DRAW_TOOLS.includes(tool) ? 'cursor-crosshair'
    : WALL_PICK_TOOLS.includes(tool) && hoverWall ? 'cursor-pointer' : 'cursor-default';

  const tourState = useMemo<EditorState>(() => ({
    view, tool,
    counts: { walls: walls.length, rooms: rooms.length, nodes: nodes.length, edges: edges.length, features: features.length },
    hasSelection: selCount(sel) > 0,
  }), [view, tool, walls.length, rooms.length, nodes.length, edges.length, features.length, sel]);
  // First time in the editor: offer the tour (not over an import that's opening).
  useEffect(() => {
    if (loading || importOpen) return;
    let seen = false;
    try { seen = localStorage.getItem(TOUR_SEEN_KEY) === '1'; } catch { /* private mode */ }
    if (seen) return;
    const t = setTimeout(() => setTour(cur => (cur.open ? cur : { open: true, justBuilt: false })), 700);
    return () => clearTimeout(t);
  }, [loading, importOpen]);

  // Only the first load takes over the page: a reload after an import must
  // not unmount the open import dialog.
  if (loading && !loadedOnce.current) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading floor editor…
      </div>
    );
  }

  const vb = viewport.viewBox;
  const isEmpty = nodes.length === 0 && walls.length === 0 && rooms.length === 0 && features.length === 0;
  const show2D = view !== '3d';
  const show3D = view !== '2d';
  const issues = health.unconnected.length + Math.max(0, health.networks.length - 1) + health.roomsWithoutPlace.length
    + floorIssues.filter(i => i.kind !== 'graph-disconnected' && i.kind !== 'place-unroutable' && i.kind !== 'path-through-wall').length + (blockedEdges.size ? 1 : 0);
  const nSel = selCount(sel);
  const singleWall = sel.walls.length === 1 && nSel === 1 ? walls.find(w => w.id === sel.walls[0]) : undefined;
  const singleFeature = sel.features.length === 1 && nSel === 1 ? features.find(f => f.id === sel.features[0]) : undefined;
  const singleRoom = sel.rooms.length === 1 && nSel === 1 ? rooms.find(r => r.id === sel.rooms[0]) : undefined;
  const transformPanel = <TransformPanel xform={xform} setXform={setXform} onApply={transformSelection} />;

  const LAYER_ROWS: { key: keyof typeof layers; label: string; count?: number; swatch: string }[] = [
    { key: 'walls', label: 'Walls', count: walls.length, swatch: 'bg-foreground/70' },
    { key: 'rooms', label: 'Rooms', count: rooms.length, swatch: 'bg-[hsl(var(--nav-room))] border' },
    { key: 'objects', label: 'Doors & objects', count: features.length, swatch: 'bg-amber-600' },
    { key: 'edges', label: 'Paths', count: edges.length, swatch: 'bg-primary/50' },
    { key: 'labels', label: 'Place names', count: nodes.filter(n => !n.isHallway).length, swatch: 'bg-primary' },
    { key: 'distances', label: 'Distances', swatch: 'bg-muted-foreground/50' },
  ];

  const rubberAnchor = edgeStartNode ?? (tool === 'wall' ? wallStart : null) ?? (tool === 'measure' && measure && !measure.b ? measure.a : null)
    ?? ((tool === 'room' || tool === 'area') && poly.length ? poly[poly.length - 1] : null);

  const sectionTitle = 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

  return (
    <div className="h-screen bg-background flex flex-col text-foreground">
      {/* ── Top bar ── */}
      <header className="h-12 border-b bg-card px-2 flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8 rounded-lg">
          <Link to={`/dashboard?venue=${buildingId}`} aria-label="Back to dashboard"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <nav className="flex items-center gap-1.5 text-sm min-w-0">
          <a href="/dashboard" className="font-semibold text-primary hover:underline" title="Back to dashboard">Yet New</a>
          <span className="text-muted-foreground">/</span>
          <a href={`/dashboard?venue=${buildingId}`} className="truncate max-w-[16ch] hover:underline" title="Venue dashboard">{building?.name || 'Venue'}</a>
          <span className="text-muted-foreground">/</span>
          <span className="truncate max-w-[16ch] text-muted-foreground">{floorMeta?.name || 'Floor'}</span>
          {building && (
            <span className={cn('ml-1 rounded-full px-2 py-0.5 text-[10px] font-medium', building.isPublished ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
              {building.isPublished ? 'Published' : 'Draft'}
            </span>
          )}
        </nav>

        <div className="mx-auto flex items-center rounded-lg bg-muted p-0.5" role="tablist" aria-label="View" data-tour="editor-views">
          {([['2d', Square, '2D'], ['3d', Box, '3D'], ['split', Columns2, 'Split']] as const).map(([id, Icon, label], i) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button role="tab" aria-selected={view === id} onClick={() => setView(id)}
                  className={cn('flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    view === id ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              </TooltipTrigger>
              <TooltipContent>{label} view <kbd className="ml-1 font-mono text-[10px]">{i + 1}</kbd></TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo" data-tour="editor-history"><Undo2 className="h-4 w-4" /></Button>
            </TooltipTrigger>
            <TooltipContent>{history.undoLabel ? `Undo ${history.undoLabel}` : 'Nothing to undo'} <kbd className="ml-1 font-mono text-[10px]">Ctrl Z</kbd></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo"><Redo2 className="h-4 w-4" /></Button>
            </TooltipTrigger>
            <TooltipContent>{history.redoLabel ? `Redo ${history.redoLabel}` : 'Nothing to redo'} <kbd className="ml-1 font-mono text-[10px]">Ctrl Shift Z</kbd></TooltipContent>
          </Tooltip>
          <div className="w-px h-5 bg-border mx-1" />
          <Button variant="ghost" size="sm" className="h-8 rounded-lg text-primary" onClick={() => setTour({ open: true, justBuilt: false })} data-tour="editor-help">
            <GraduationCap className="h-4 w-4 sm:mr-1.5" /> <span className="hidden sm:inline">Guide</span>
          </Button>
          <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={() => setImportOpen(true)} data-tour="editor-import">
            <UploadCloud className="h-4 w-4 mr-1.5" /> Import
          </Button>
          <Button variant="outline" size="sm" className="h-8 rounded-lg" asChild>
            <a href={`/venue/${buildingId}?preview=1`} target="_blank" rel="noreferrer"><Globe className="h-4 w-4 mr-1.5" /> Preview</a>
          </Button>
          <Button size="sm" className="h-8 rounded-lg" onClick={() => setPublishAsk(true)} data-tour="editor-publish">
            {building?.isPublished ? 'Publish changes' : 'Publish'}
          </Button>
        </div>
      </header>

      {/* ── Tool bar ── */}
      <div className={cn('h-11 border-b bg-card/60 px-2 flex items-center gap-1 shrink-0 overflow-x-auto', !show2D && 'opacity-50 pointer-events-none')}>
        {!allTools && (() => {
          const pick = (id: Tool) => ALL_TOOLS.find(t => t.id === id)!;
          const addTools = (['add-node', 'room', 'wall', 'door', 'add-edge', 'object', 'scenery', 'text'] as Tool[]).map(pick);
          const adding = addTools.find(t => t.id === tool);
          const btn = (active: boolean) => cn('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
            active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground');
          return (
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={btn(!!adding)} aria-label="Add" data-tour="tool-add">
                    {adding ? <adding.icon className="h-4 w-4" /> : <SquarePlus className="h-4 w-4" />} {adding ? `Adding: ${adding.label === 'POI' ? 'Place' : adding.label}` : 'Add'}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {addTools.map(t => (
                    <DropdownMenuItem key={t.id} onSelect={() => chooseTool(t.id)} className="gap-2">
                      <t.icon className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1">{t.id === 'add-node' ? 'Place' : t.id === 'add-edge' ? 'Walking path' : t.label}</span>
                      {t.key && <kbd className="font-mono text-[10px] text-muted-foreground">{t.key}</kbd>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {(['select', 'hand'] as Tool[]).map(pick).map(t => (
                <button key={t.id} onClick={() => chooseTool(t.id)} aria-pressed={tool === t.id} aria-label={t.label} data-tour={`tool-${t.id}`} className={btn(tool === t.id)}>
                  <t.icon className="h-4 w-4" /> <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
              <button onClick={() => void history.undo()} disabled={!history.canUndo} className={cn(btn(false), 'disabled:opacity-40')} aria-label="Undo last change">
                <Undo2 className="h-4 w-4" /> <span className="hidden sm:inline">Undo</span>
              </button>
              <span className="mx-1 h-5 w-px bg-border" />
              <button onClick={toggleAllTools} className={btn(false)} title="Walls, measuring, trim, split, join, offset…">
                <Shapes className="h-4 w-4" /> More tools
              </button>
              <span className="ml-2 hidden items-center gap-1 text-xs text-muted-foreground lg:flex"><Sparkles className="h-3.5 w-3.5 text-primary" /> Or just tell the map what to change, below — press <kbd className="font-mono">/</kbd></span>
            </div>
          );
        })()}
        {allTools && (
          <button onClick={toggleAllTools} className="mr-1 shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted" title="Back to the simple toolbar">Simple</button>
        )}
        {allTools && TOOL_GROUPS.map((group, gi) => (
          <div key={gi} className="flex items-center gap-0.5 pr-1 mr-0.5 border-r last:border-r-0">
            {group.map(t => (
              <Tooltip key={t.id}>
                <TooltipTrigger asChild>
                  <button onClick={() => chooseTool(t.id)} aria-pressed={tool === t.id} aria-label={t.label} data-tour={`tool-${t.id}`}
                    className={cn('flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
                      tool === t.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                    <t.icon className="h-4 w-4" /> <span className={gi === 3 ? 'hidden 2xl:inline' : 'hidden xl:inline'}>{t.label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs"><b>{t.label}</b> — {t.hint} {t.key && <kbd className="ml-1 font-mono text-[10px]">{t.key}</kbd>}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        ))}
        {tool === 'object' && (
          <select value={objectKind} onChange={e => setObjectKind(e.target.value as FeatureKind)} aria-label="Object to place"
            className="ml-1 rounded-md border bg-background px-2 py-1 text-xs">
            {(Object.keys(FEATURE_KINDS) as FeatureKind[]).filter(kd => FEATURE_KINDS[kd].placeable && kd !== 'door' && (!SCENERY_KINDS.includes(kd) || kd === 'tree' || kd === 'bench')).map(kd => <option key={kd} value={kd}>{FEATURE_KINDS[kd].label}</option>)}
          </select>
        )}
        {tool === 'offset' && (
          <label className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground">Distance
            <Input type="number" step="0.05" min="0.01" value={offsetM} onChange={e => setOffsetM(Math.max(0.01, Number(e.target.value)))} className="h-7 w-20 text-xs" /> m
          </label>
        )}
        {(allTools || tool !== 'select') && <div className="ml-2 hidden lg:block text-xs text-muted-foreground truncate">{hint}</div>}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* ── Left: project, layers, health ── */}
        <aside className={cn('border-r bg-card overflow-y-auto shrink-0 hidden md:block', allTools ? 'w-56' : 'w-52')}>
          {!allTools ? (
            // The simple side: floors, what to show, and whether the map is ready.
            <div className="flex h-full flex-col gap-5 p-3">
              <section>
                <p className="mb-2 truncate text-sm font-semibold">{building?.name || 'Venue'}</p>
                <ul className="space-y-1">
                  {floors.map(f => (
                    <li key={f.id}>
                      <Link to={`/admin/floors/${buildingId}/${f.id}/editor`}
                        className={cn('block truncate rounded-lg px-3 py-2 text-sm',
                          f.id === floorId ? 'bg-primary text-primary-foreground font-medium shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                        {f.name}
                      </Link>
                    </li>
                  ))}
                </ul>
                <button onClick={() => setAddFloors({ open: true, file: null })}
                  className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-primary hover:bg-primary/10">
                  <SquarePlus className="h-4 w-4" /> Add a floor
                </button>
              </section>

              <section className="space-y-2.5" data-tour="editor-layers">
                <p className={sectionTitle}>Show</p>
                {([['labels', 'Names'], ['edges', 'Walking paths']] as const).map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center justify-between text-sm">
                    {label}
                    <Switch checked={layers[key]} onCheckedChange={v => setLayers(p => ({ ...p, [key]: v }))} aria-label={`Show ${label.toLowerCase()}`} />
                  </label>
                ))}
              </section>

              {!isEmpty && (
                <section data-tour="editor-health">
                  {mapHealth.length === 0 ? (
                    <div className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                      <p className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="h-4 w-4" /> Ready for visitors</p>
                      <p className="mt-0.5 text-xs opacity-80">Every place can be reached.</p>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-amber-500/10 p-3 text-sm">
                      <p className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" /> {mapHealth.length} thing{mapHealth.length === 1 ? ' needs' : 's need'} a look</p>
                      <Button size="sm" className="mt-2 h-8 w-full rounded-full" onClick={() => askMap('Fix everything')}>Fix everything</Button>
                      <button className="mt-1 w-full text-center text-xs text-muted-foreground hover:text-foreground" onClick={() => askMap("What's wrong?")}>What's wrong?</button>
                    </div>
                  )}
                </section>
              )}
            </div>
          ) : (<>
          <section className="p-3 border-b">
            <h4 className={cn(sectionTitle, 'mb-2')}>Project</h4>
            <p className="text-sm font-medium truncate mb-1.5">{building?.name || 'Venue'}</p>
            <ul className="space-y-0.5">
              {floors.map(f => (
                <li key={f.id}>
                  <Link to={`/admin/floors/${buildingId}/${f.id}/editor`}
                    className={cn('flex items-center justify-between rounded-md px-2 py-1 text-xs',
                      f.id === floorId ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted')}>
                    <span className="truncate">{f.name}</span>
                    <span className="tabular-nums opacity-70">L{f.level}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <button onClick={() => setAddFloors({ open: true, file: null })}
              className="mt-1.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10">
              <SquarePlus className="h-3.5 w-3.5" /> Add floors
            </button>
          </section>

          <section className="p-3 border-b" data-tour="editor-layers">
            <h4 className={cn(sectionTitle, 'mb-2 flex items-center gap-1.5')}><Layers3 className="h-3.5 w-3.5" /> Layers</h4>
            <ul className="space-y-1">
              {LAYER_ROWS.map(l => (
                <li key={l.key}>
                  <label className="flex items-center gap-2 rounded-md px-1 py-1 text-xs cursor-pointer hover:bg-muted">
                    <input type="checkbox" checked={layers[l.key]} onChange={e => setLayers(p => ({ ...p, [l.key]: e.target.checked }))}
                      className="accent-[hsl(var(--primary))]" />
                    <span className={cn('h-2.5 w-2.5 rounded-sm', l.swatch)} />
                    <span className="flex-1">{l.label}</span>
                    {l.count !== undefined && <span className="tabular-nums text-muted-foreground">{l.count}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <UnderlayPanel s={underlay} sectionTitle={sectionTitle} />
          <section className="p-3" data-tour="editor-health">
            <h4 className={cn(sectionTitle, 'mb-2')}>Map health</h4>
            {isEmpty ? (
              <p className="text-xs text-muted-foreground">Nothing to check yet.</p>
            ) : issues === 0 ? (
              <p className="text-xs flex items-center gap-1.5 text-primary"><CheckCircle2 className="h-4 w-4" /> Every place can be reached</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {health.unconnected.length > 0 && (
                  <li>
                    <button className="w-full text-left flex gap-1.5 rounded-md p-1.5 hover:bg-muted" onClick={() => showIn2D(health.unconnected[0].id)}>
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-px" />
                      <span><b>{health.unconnected.length}</b> place{health.unconnected.length > 1 ? 's have' : ' has'} no path — visitors can't be routed there. <span className="text-primary">Show</span></span>
                    </button>
                  </li>
                )}
                {health.networks.length > 1 && (
                  <li>
                    <button className="w-full text-left flex gap-1.5 rounded-md p-1.5 hover:bg-muted" onClick={() => showIn2D(health.networks[1][0])}>
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-px" />
                      <span>Paths form <b>{health.networks.length}</b> separate networks that don't reach each other. <span className="text-primary">Show</span></span>
                    </button>
                  </li>
                )}
                {health.roomsWithoutPlace.length > 0 && (
                  <li>
                    <button className="w-full text-left flex gap-1.5 rounded-md p-1.5 hover:bg-muted" onClick={() => selectOnly('rooms', health.roomsWithoutPlace[0].id)}>
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-px" />
                      <span><b>{health.roomsWithoutPlace.length}</b> room{health.roomsWithoutPlace.length > 1 ? 's' : ''} without a place to navigate to. <span className="text-primary">Show</span></span>
                    </button>
                  </li>
                )}
                {blockedEdges.size > 0 && (
                  <li className="flex gap-1.5 rounded-md p-1.5 bg-destructive/5">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-px" />
                    <span>
                      <b>{blockedEdges.size}</b> path{blockedEdges.size > 1 ? 's go' : ' goes'} through a wall (shown in red). Nobody can walk {blockedEdges.size > 1 ? 'them' : 'it'}.{' '}
                      <button className="text-primary font-medium hover:underline" onClick={fixPathsThroughWalls}>Fix — go through doors</button>
                    </span>
                  </li>
                )}
                {floorIssues.filter(i => i.kind !== 'graph-disconnected' && i.kind !== 'place-unroutable' && i.kind !== 'path-through-wall').slice(0, 8).map((i, n) => (
                  <li key={`${i.kind}-${i.ids[0]}-${n}`}>
                    <button className="w-full text-left flex gap-1.5 rounded-md p-1.5 hover:bg-muted" onClick={() => showIssue(i)}>
                      <AlertTriangle className={cn('h-3.5 w-3.5 shrink-0 mt-px', i.severity === 'error' ? 'text-destructive' : 'text-amber-600')} />
                      <span>{issueText(i, 'en')} <span className="text-primary">Show</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          </>)}
        </aside>

        {/* ── Views ── */}
        <main className="flex-1 min-w-0 flex">
          <div ref={viewport.ref} data-tour="editor-canvas" className={cn('relative overflow-hidden bg-muted/40 select-none', show2D ? 'flex-1' : 'hidden', view === 'split' && 'border-r')}>
            <UnderlayOverlay s={underlay} toEditor={svgPoint} />
            {/* The Scenery tool's tray: pick, then click the plan. */}
            {tool === 'scenery' && (
              <div className="absolute left-3 top-3 z-10 w-[244px] rounded-2xl border bg-card/95 p-2 shadow-lg backdrop-blur"
                onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
                <p className="flex items-center gap-1.5 px-1 pb-1.5 text-xs font-semibold"><Trees className="h-3.5 w-3.5 text-primary" /> Scenery <span className="font-normal text-muted-foreground">· pick, then click the plan</span></p>
                <div role="radiogroup" aria-label="Scenery to place" className="grid grid-cols-4 gap-1">
                  {SCENERY_KINDS.map(kd => {
                    const def = FEATURE_KINDS[kd];
                    const d = Math.max(12, Math.min(34, (def.d / Math.max(def.w, 0.01)) * 34));
                    return (
                      <button key={kd} role="radio" aria-checked={sceneryKind === kd} aria-label={def.label} title={def.label} onClick={() => setSceneryKind(kd)}
                        className={cn('flex flex-col items-center gap-0.5 rounded-lg px-0.5 py-1.5 text-[10px] leading-tight transition-colors',
                          sceneryKind === kd ? 'bg-primary/15 font-semibold text-foreground ring-1 ring-primary/50' : 'text-muted-foreground hover:bg-muted')}>
                        <svg viewBox="-22 -22 44 44" className="h-7 w-7" aria-hidden>
                          <FeatureGlyph f={{ id: kd, kind: kd, x: 0, y: 0, rotationDeg: 0, width: 34, depth: kd === 'lamp' ? 4 : d, label: null }} pxPerMeter={PX_PER_METER} k={1} selected={false} />
                        </svg>
                        <span className="w-full truncate text-center">{def.label.replace(' / pool', '')}</span>
                      </button>
                    );
                  })}
                </div>
                {editorModel && floorId && autoScenery(editorModel.venue, floorId) ? (
                  <button onClick={() => void sceneryFromRing()} className="mt-1.5 flex w-full items-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Sprout className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>Visitors see automatic trees round the building. <b className="font-semibold text-foreground">Make them editable</b></span>
                  </button>
                ) : (
                  <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">To remove scenery: select it and press Del, or use the Delete tool.</p>
                )}
              </div>
            )}
            <svg
              ref={svgRef}
              viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
              className={cn('w-full h-full touch-none', canvasCursor)}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerUp}
              onPointerLeave={() => { hideSnapMark(); if (hoverWall) setHoverWall(null); }}
              onDoubleClick={() => {
                if (tool === 'wall') setWallStart(null);
                // the double-click's two clicks each added a corner; drop the duplicate
                if ((tool === 'room' || tool === 'area') && poly.length) finishPoly(poly);
              }}
            >
              <defs>
                <pattern id="editor-grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
                  <circle cx={0} cy={0} r={1.1 * k} fill="hsl(var(--muted-foreground) / 0.35)" />
                </pattern>
              </defs>
              {gridOn && <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#editor-grid)" />}
              <UnderlayImage s={underlay} k={k} />

              {layers.rooms && rooms.map(room => {
                const outline = roomOutline(room);
                const isSel = selSet.rooms.has(room.id) || (!!room.nodeId && room.nodeId === selectedNodeId);
                return (
                  <g key={room.id}>
                    <polygon points={outline.map(p => `${p.x},${p.y}`).join(' ')}
                      fill={isSel ? 'hsl(var(--primary) / 0.12)' : 'hsl(var(--nav-room) / 0.85)'}
                      stroke={isSel ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
                      strokeWidth={isSel ? 2 : 1} vectorEffect="non-scaling-stroke" />
                    {/* Room name in the corner, CAD-style, so it never collides
                        with the place marker and its label in the middle. */}
                    {room.width * viewport.scale > 64 && room.height * viewport.scale > 28 && (
                      <text x={room.x + 7 * k} y={room.y + 15 * k} fontSize={10 * k}
                        className="fill-muted-foreground pointer-events-none uppercase tracking-wide">
                        {room.name}
                      </text>
                    )}
                  </g>
                );
              })}

              {layers.walls && (
                <>
                  <path d={wallPath} fill="none" stroke="hsl(var(--foreground) / 0.75)"
                    strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" className="pointer-events-none" />
                  {highlightWallPath && (
                    <path d={highlightWallPath} fill="none" stroke={tool === 'delete' ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'}
                      strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" className="pointer-events-none" />
                  )}
                </>
              )}

              {layers.objects && features.map(f => (
                <g key={f.id} onPointerDown={e => onFeaturePointerDown(e, f.id)}
                  className={tool === 'select' ? 'cursor-move' : tool === 'delete' ? 'cursor-pointer' : undefined}>
                  <FeatureGlyph f={f} pxPerMeter={PX_PER_METER} k={k} selected={selSet.features.has(f.id)} />
                </g>
              ))}

              {layers.edges && edges.map(edge => {
                const from = nodeById.get(edge.fromNodeId), to = nodeById.get(edge.toNodeId);
                if (!from || !to) return null;
                const blocked = blockedEdges.has(edge.id);
                return (
                  <g key={edge.id} className={tool === 'delete' ? 'group cursor-pointer' : 'pointer-events-none'}
                    onPointerDown={tool === 'delete' ? e => e.stopPropagation() : undefined}
                    onClick={e => onEdgeClick(e, edge.id)}>
                    {tool === 'delete' && <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" />}
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke={blocked ? 'hsl(var(--destructive))' : 'hsl(var(--primary) / 0.5)'} strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke"
                      strokeDasharray={blocked ? '5 5' : undefined}
                      className={tool === 'delete' ? 'group-hover:stroke-destructive' : undefined}>
                      {blocked && <title>This path goes through a wall — fix it in Map health</title>}
                    </line>
                    {layers.distances && (
                      <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 5 * k} textAnchor="middle" fontSize={9 * k}
                        className="fill-muted-foreground pointer-events-none">
                        {meters(edge.weight)} m
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Finished measurement */}
              {measure?.b && (
                <g className="pointer-events-none">
                  <line x1={measure.a.x} y1={measure.a.y} x2={measure.b.x} y2={measure.b.y}
                    stroke="hsl(32 95% 50%)" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
                  {[measure.a, measure.b].map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3.5 * k} fill="hsl(32 95% 50%)" />)}
                  <text x={(measure.a.x + measure.b.x) / 2} y={(measure.a.y + measure.b.y) / 2 - 8 * k} textAnchor="middle" fontSize={12 * k}
                    stroke="hsl(var(--background))" strokeWidth={3 * k} paintOrder="stroke" className="fill-foreground font-semibold">
                    {meters(dist(measure.a, measure.b))} m
                  </text>
                </g>
              )}

              {/* Finished area measurement */}
              {areaDone && (() => {
                const c = polygonCentroid(areaDone);
                let perim = 0;
                for (let i = 0; i < areaDone.length; i++) {
                  const a = areaDone[i], b = areaDone[(i + 1) % areaDone.length];
                  perim += Math.hypot(a.x - b.x, a.y - b.y);
                }
                return (
                  <g className="pointer-events-none">
                    <polygon points={areaDone.map(p => `${p.x},${p.y}`).join(' ')} fill="hsl(32 95% 50% / 0.15)" stroke="hsl(32 95% 50%)" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
                    <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="central" fontSize={13 * k}
                      stroke="hsl(var(--background))" strokeWidth={3 * k} paintOrder="stroke" className="fill-foreground font-semibold">
                      {sqm(polygonArea(areaDone))} m²
                    </text>
                    <text x={c.x} y={c.y + 16 * k} textAnchor="middle" fontSize={10 * k}
                      stroke="hsl(var(--background))" strokeWidth={3 * k} paintOrder="stroke" className="fill-muted-foreground">
                      perimeter {meters(perim)} m
                    </text>
                  </g>
                );
              })()}

              {/* Room / area being drawn */}
              {poly.length > 0 && (
                <g className="pointer-events-none">
                  <polyline points={poly.map(p => `${p.x},${p.y}`).join(' ')} fill={tool === 'room' ? 'hsl(var(--primary) / 0.08)' : 'hsl(32 95% 50% / 0.08)'}
                    stroke={tool === 'room' ? 'hsl(var(--primary))' : 'hsl(32 95% 50%)'} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  {poly.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={(i === 0 ? 5 : 3.5) * k} fill={i === 0 ? 'hsl(var(--background))' : 'hsl(var(--primary))'} stroke="hsl(var(--primary))" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
                </g>
              )}

              {/* Rubber band (end follows the cursor) */}
              {rubberAnchor && (() => {
                const color = tool === 'wall' ? 'hsl(var(--foreground))' : tool === 'measure' || tool === 'area' ? 'hsl(32 95% 50%)' : 'hsl(var(--primary))';
                return (
                  <g className="pointer-events-none">
                    <line ref={previewLineRef} x1={rubberAnchor.x} y1={rubberAnchor.y} x2={rubberAnchor.x} y2={rubberAnchor.y}
                      stroke={color} strokeWidth={tool === 'wall' ? 3 : 2} strokeDasharray={tool === 'wall' ? undefined : '6 4'} vectorEffect="non-scaling-stroke" />
                    {tool !== 'room' && tool !== 'area' && <circle cx={rubberAnchor.x} cy={rubberAnchor.y} r={4 * k} fill={color} />}
                    {(tool === 'wall' || tool === 'measure' || tool === 'room' || tool === 'area') && (
                      <text ref={previewLabelRef} textAnchor="middle" fontSize={11 * k} stroke="hsl(var(--background))" strokeWidth={3 * k}
                        paintOrder="stroke" className="fill-foreground font-medium" />
                    )}
                  </g>
                );
              })()}

              {nodes.map(node => {
                const selected = selSet.nodes.has(node.id) || node.id === selectedNodeId;
                const r = (node.isHallway ? 4.5 : 7) * k;
                return (
                  <g key={node.id}
                    className={tool === 'select' ? 'cursor-move' : tool === 'add-edge' || tool === 'delete' ? 'cursor-pointer' : undefined}
                    onPointerDown={e => onItemPointerDown(e, 'nodes', node.id)}
                    onClick={e => onNodeClick(e, node.id)}
                    onDoubleClick={() => tool === 'select' && openNodeEdit(node)}
                  >
                    {selected && <circle cx={node.x} cy={node.y} r={r + 6 * k} fill="hsl(var(--primary) / 0.2)" />}
                    {edgeStart === node.id && <circle cx={node.x} cy={node.y} r={r + 6 * k} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
                    <circle cx={node.x} cy={node.y} r={Math.max(r, 9 * k)} fill="transparent" />
                    <circle cx={node.x} cy={node.y} r={r}
                      fill={tool === 'delete' ? 'hsl(var(--destructive))' : nodeColor(node)}
                      stroke="hsl(var(--background))" strokeWidth={2} vectorEffect="non-scaling-stroke"
                      style={{ filter: 'drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.3))' }} />
                    {layers.labels && !node.isHallway && node.name && (
                      <text x={node.x} y={node.y - r - 5 * k} textAnchor="middle" fontSize={11 * k}
                        stroke="hsl(var(--background))" strokeWidth={3 * k} paintOrder="stroke" strokeLinejoin="round"
                        className="fill-foreground font-medium pointer-events-none">
                        {node.name}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* The map assistant showing a route (preview), or what it just changed (flash) */}
              {aiMark && (
                <g className="pointer-events-none" key={JSON.stringify(aiMark.route[0] ?? aiMark.spots[0] ?? aiMark.removed[0] ?? null) + aiMark.mode}>
                  {aiMark.route.length > 0 && (() => {
                    const d = aiMark.route.map(sg => `M${sg.a.x} ${sg.a.y}L${sg.b.x} ${sg.b.y}`).join('');
                    return (
                      <>
                        <path d={d} stroke="hsl(var(--primary) / 0.28)" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" fill="none" vectorEffect="non-scaling-stroke" className="ma-glow" />
                        <path d={d} stroke="hsl(var(--primary))" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" vectorEffect="non-scaling-stroke" pathLength={1} className="ma-draw" />
                        {aiMark.mode === 'preview' && <path d={d} stroke="hsl(var(--background))" strokeWidth={1.5} strokeDasharray="2 10" strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke" className="ma-march" />}
                      </>
                    );
                  })()}
                  {aiMark.removed.map((sg, i) => (
                    <line key={i} x1={sg.a.x} y1={sg.a.y} x2={sg.b.x} y2={sg.b.y} stroke="hsl(var(--destructive))" strokeWidth={5} strokeDasharray="7 6" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="ma-blink" />
                  ))}
                  {aiMark.spots.map((p, i) => (
                    <g key={i} transform={`translate(${p.x} ${p.y})`}>
                      <circle r={20 * k} fill="hsl(var(--primary) / 0.25)" className="ma-ping" />
                      <circle r={9 * k} fill="none" stroke="hsl(var(--primary))" strokeWidth={2.5} vectorEffect="non-scaling-stroke" className="ma-pop" />
                    </g>
                  ))}
                </g>
              )}

              {marquee && (
                <rect x={Math.min(marquee.a.x, marquee.b.x)} y={Math.min(marquee.a.y, marquee.b.y)}
                  width={Math.abs(marquee.b.x - marquee.a.x)} height={Math.abs(marquee.b.y - marquee.a.y)}
                  fill="hsl(var(--primary) / 0.08)" stroke="hsl(var(--primary))" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" className="pointer-events-none" />
              )}

              {/* Snap indicator, positioned imperatively on pointer move */}
              <g ref={snapMarkRef} visibility="hidden" className="pointer-events-none">
                <rect x={-6} y={-6} width={12} height={12} fill="none" stroke="hsl(32 95% 50%)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                <circle r={2} fill="hsl(32 95% 50%)" />
              </g>
            </svg>

            {!isEmpty && (
              <MapAssistant getState={assistantState} apply={applyAssistant} undo={() => void history.undo()}
                onHighlight={h => {
                  setAiMark(h);
                  // Bring what it's showing into view, above the conversation.
                  const pts = h ? [...h.route.flatMap(s => [s.a, s.b]), ...h.removed.flatMap(s => [s.a, s.b]), ...h.spots] : [];
                  if (h?.mode === 'preview' && pts.length) {
                    const b = bbox(pts);
                    viewport.centerOn((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0, { bottom: 300 });
                  }
                }}
                health={mapHealth} selectedName={selectedName} greeting={greeting} ask={assistantAsk}
                floorName={floorMeta?.name ?? ''} floors={floors.map(f => f.name)} />
            )}

            {isEmpty && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="pointer-events-auto rounded-2xl border bg-card/95 backdrop-blur p-6 text-center shadow-lg max-w-sm">
                  <UploadCloud className="h-8 w-8 mx-auto mb-3 text-primary" />
                  <h2 className="font-semibold">Bring the map you already have</h2>
                  <p className="text-sm text-muted-foreground mt-1 mb-4">
                    Import DWG, DXF, IFC, SVG, PDF or a 3D model and we'll build walls, rooms, doors, walkable paths and a 3D world from it. Or draw by hand with <kbd className="font-mono text-xs">W</kbd> and <kbd className="font-mono text-xs">R</kbd>.
                  </p>
                  <Button onClick={() => setImportOpen(true)}><UploadCloud className="h-4 w-4 mr-1.5" /> Import a map</Button>
                </div>
              </div>
            )}
          </div>

          {show3D && (
            <div className="flex-1 min-w-0 relative bg-muted/30">
              <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Building 3D world…</div>}>
                <Venue3D walls={plainWalls} rooms={rooms} nodes={nodes} edges={edges} features={features}
                  level={floorMeta?.level ?? 0} otherFloors={otherFloors}
                  selectedNodeId={selectedNodeId} onSelectNode={selectFrom3D}
                  pxPerMeter={PX_PER_METER} focusNonce={focus3D} onModeChange={onThreeMode} theme={themeOf(building?.theme)}
                  model={editorModel?.venue ?? null} floorId={floorId} />
              </Suspense>
            </div>
          )}
        </main>

        {/* ── Inspector ── */}
        {!allTools ? (
          <aside className="w-64 border-l bg-card overflow-y-auto shrink-0 hidden lg:block" data-tour="editor-inspector">
            {(() => {
              const main = new Set(health.networks[0] ?? []);
              const walk = (nodeId: string | null | undefined, name: string) => nodeId && main.has(nodeId) ? (
                <p className="flex items-center gap-1.5 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4 shrink-0" /> Visitors can walk here</p>
              ) : (
                <div className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm">
                  <p className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4 shrink-0" /> Visitors can't reach it yet</p>
                  <Button size="sm" className="mt-2 h-8 w-full rounded-full" onClick={() => askMap(`Make ${name} walkable`)}><Route className="mr-1.5 h-3.5 w-3.5" /> Connect it</Button>
                </div>
              );
              const nameField = (value: string, onSave: (v: string) => void, key: string) => (
                <Input defaultValue={value} key={key} aria-label="Name" placeholder="Give it a name" className="h-10 text-base font-semibold"
                  onBlur={e => e.target.value.trim() && e.target.value !== value && onSave(e.target.value.trim())}
                  onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
              );
              const remove = (label = 'Delete') => (
                <Button variant="ghost" className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => deleteSelection(sel)}><Trash2 className="mr-1.5 h-4 w-4" /> {label}</Button>
              );
              const renamePlace = async (n: NavNode, name: string) => {
                const before = { name: n.name, isHallway: n.isHallway }, after = { name, isHallway: n.isHallway };
                try { await updateNodeFields(n.id, after); history.push({ label: `Rename to ${name}`, undo: () => updateNodeFields(n.id, before), redo: () => updateNodeFields(n.id, after) }); }
                catch { toast.error("Couldn't rename"); }
              };

              if (singleRoom) {
                const place = singleRoom.nodeId ? nodeById.get(singleRoom.nodeId) : undefined;
                return (
                  <div className="space-y-4 p-4">
                    {nameField(singleRoom.name, v => editRoom(singleRoom.id, { name: v }, 'Rename room'), `rn-${singleRoom.id}-${singleRoom.name}`)}
                    {!place && <label className="block text-xs text-muted-foreground">What is it?
                      <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm capitalize text-foreground" value={singleRoom.type}
                        onChange={e => editRoom(singleRoom.id, { type: e.target.value as Room['type'] }, 'Change room type')}>
                        {ROOM_TYPES.map(t => <option key={t} value={t}>{t === 'office' ? 'Room' : t}</option>)}
                      </select>
                    </label>}
                    {walk(singleRoom.nodeId, singleRoom.name)}
                    {place && buildingId && (
                      <PlaceDetailsEditor buildingId={buildingId} institutionId={building?.institutionId ?? null}
                        node={{ id: place.id, floorId: place.floorId, name: place.name || singleRoom.name }} roomType={singleRoom.type} />
                    )}
                    {remove('Delete room')}
                  </div>
                );
              }
              if (selectedNode) {
                if (selectedNode.isHallway) return (
                  <div className="space-y-4 p-4">
                    <p className="font-semibold">Walking path point</p>
                    <p className="text-sm text-muted-foreground">A corner of a walking path. Drag it to reshape the path.</p>
                    {remove()}
                  </div>
                );
                return (
                  <div className="space-y-4 p-4">
                    {nameField(selectedNode.name, v => void renamePlace(selectedNode, v), `pn-${selectedNode.id}-${selectedNode.name}`)}
                    {walk(selectedNode.id, selectedNode.name || 'this place')}
                    {buildingId && (
                      <PlaceDetailsEditor buildingId={buildingId} institutionId={building?.institutionId ?? null}
                        node={{ id: selectedNode.id, floorId: selectedNode.floorId, name: selectedNode.name }} roomType={selectedRoom?.type} />
                    )}
                    <Button variant="outline" className="w-full" onClick={() => handleQRPreview(selectedNode.id)}><QrCode className="mr-1.5 h-4 w-4" /> QR code</Button>
                    {remove()}
                  </div>
                );
              }
              if (singleFeature) {
                const def = FEATURE_KINDS[singleFeature.kind];
                const connector = singleFeature.kind === 'stairs' || singleFeature.kind === 'elevator';
                return (
                  <div className="space-y-4 p-4">
                    <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className="h-2.5 w-2.5 rounded-full" style={{ background: def.color }} /> {def.label}</p>
                    {nameField(singleFeature.label ?? '', v => editFeature(singleFeature.id, { label: v }, 'Rename'), `fn-${singleFeature.id}-${singleFeature.label}`)}
                    {connector && floors.length > 1 && (
                      <Button variant="outline" className="w-full" onClick={() => askMap(`Connect the floors via the ${singleFeature.kind}`)}><Layers3 className="mr-1.5 h-4 w-4" /> Connect floors through it</Button>
                    )}
                    <p className="text-xs text-muted-foreground">Drag it on the map to move it.</p>
                    {remove()}
                  </div>
                );
              }
              if (singleWall) return (
                <div className="space-y-4 p-4">
                  <p className="font-semibold">Wall <span className="font-normal text-muted-foreground">· {meters(segLen(singleWall))} m</span></p>
                  {remove('Delete wall')}
                </div>
              );
              if (nSel > 1) return (
                <div className="space-y-4 p-4">
                  <p className="font-semibold">{nSel} things selected</p>
                  <p className="text-sm text-muted-foreground">Drag them to move them together.</p>
                  {remove(`Delete all ${nSel}`)}
                </div>
              );
              return (
                <div className="space-y-5 p-4">
                  <div className="rounded-2xl bg-muted/60 p-4 text-center">
                    <MousePointer2 className="mx-auto mb-2 h-7 w-7 text-primary/70" />
                    <p className="text-sm font-medium">Click anything on the map to edit it</p>
                  </div>
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><Sparkles className="h-4 w-4 text-primary" /> Or just tell the map</p>
                    <div className="flex flex-col gap-1.5">
                      {['Add a restroom here', 'Add an entrance here', 'Make the route wheelchair accessible', "What's wrong?"].map(t => (
                        <button key={t} onClick={() => askMap(t)} className="rounded-xl border px-3 py-2 text-left text-sm hover:border-primary/40 hover:bg-primary/5">"{t}"</button>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Need sizes, 3D settings or shortcuts? <button className="text-primary hover:underline" onClick={toggleAllTools}>More tools</button></p>
                </div>
              );
            })()}
          </aside>
        ) : (
        <aside className="w-72 border-l bg-card overflow-y-auto shrink-0 hidden lg:block" data-tour="editor-inspector">
          {selectedNode && !singleRoom ? (
            <div className="p-4 space-y-5">
              <div className="flex items-start gap-3">
                <div className="mt-1 h-3 w-3 rounded-full shrink-0" style={{ background: nodeColor(selectedNode) }} />
                <div className="min-w-0">
                  <h3 className="font-semibold truncate">{selectedNode.name || 'Unnamed place'}</h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedNode.isHallway ? 'Path point' : 'Destination'} · {floorMeta?.name || 'This floor'} · {meters(selectedNode.x)}, {meters(selectedNode.y)} m
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={() => openNodeEdit(selectedNode)}><Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit</Button>
                <Button size="sm" variant="outline" onClick={() => openRoomCreate(selectedNode.id)}><SquarePlus className="h-3.5 w-3.5 mr-1.5" /> {selectedRoom ? 'Room' : 'Add room'}</Button>
                <Button size="sm" variant="outline" onClick={() => showIn2D(selectedNode.id)}><Crosshair className="h-3.5 w-3.5 mr-1.5" /> Show in 2D</Button>
                <Button size="sm" variant="outline" onClick={() => showIn3D(selectedNode.id)}><Box className="h-3.5 w-3.5 mr-1.5" /> Show in 3D</Button>
                <Button size="sm" variant="outline" onClick={() => handleQRPreview(selectedNode.id)}><QrCode className="h-3.5 w-3.5 mr-1.5" /> QR code</Button>
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => deleteSelection({ ...NO_SEL, nodes: [selectedNode.id] })}><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete</Button>
              </div>

              {/* The visitor-facing details: photos, description, promotion */}
              {!selectedNode.isHallway && buildingId && (
                <PlaceDetailsEditor buildingId={buildingId} institutionId={building?.institutionId ?? null}
                  node={{ id: selectedNode.id, floorId: selectedNode.floorId, name: selectedNode.name }} roomType={selectedRoom?.type} />
              )}

              {selectedRoom && (
                <section className="rounded-lg border p-3">
                  <h4 className={cn(sectionTitle, 'mb-1.5')}>Room</h4>
                  <p className="text-sm font-medium">{selectedRoom.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{selectedRoom.type} · {sqm(polygonArea(roomOutline(selectedRoom)))} m²</p>
                </section>
              )}

              <section>
                <h4 className={cn(sectionTitle, 'mb-1.5')}>Paths</h4>
                {(() => {
                  const list = edges.filter(e => e.fromNodeId === selectedNode.id || e.toNodeId === selectedNode.id);
                  if (list.length === 0) return <p className="text-xs text-amber-600 dark:text-amber-400">No paths — visitors can't be routed here. Use the Path tool (E).</p>;
                  return (
                    <ul className="space-y-0.5">
                      {list.map(e => {
                        const otherId = e.fromNodeId === selectedNode.id ? e.toNodeId : e.fromNodeId;
                        const other = nodeById.get(otherId);
                        const upstairs = other ? null : otherNodes.find(n => n.id === otherId);
                        return (
                          <li key={e.id}>
                            <button className="w-full flex items-center justify-between text-xs rounded px-1.5 py-1 hover:bg-muted text-left"
                              onClick={() => other ? setSelectedNodeId(other.id) : upstairs && navigate(`/admin/floors/${buildingId}/${upstairs.floorId}/editor`)}>
                              <span className="truncate">{other ? other.name || 'Path point' : `${upstairs?.name || 'Path point'} · ${upstairs?.floorName ?? 'other floor'}`}</span>
                              <span className="text-muted-foreground tabular-nums">{other ? `${meters(e.weight)} m` : 'floor change'}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  );
                })()}
              </section>

              {otherNodes.length > 0 && (
                <section className="space-y-1.5">
                  <h4 className={sectionTitle}>Link to another floor</h4>
                  <p className="text-[11px] text-muted-foreground">For stairs, lifts and ramps: connect this place to where it arrives on another floor.</p>
                  <select value={linkKind} onChange={e => setLinkKind(e.target.value as typeof linkKind)} aria-label="Connection type"
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-xs">
                    <option value="stairs">Stairs (not step-free)</option>
                    <option value="elevator">Elevator (step-free)</option>
                    <option value="ramp">Ramp (step-free)</option>
                    <option value="escalator">Escalator (not step-free)</option>
                  </select>
                  <div className="flex gap-1.5">
                    <select value={linkTarget} onChange={e => setLinkTarget(e.target.value)} aria-label="Place on another floor"
                      className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-xs">
                      <option value="">Choose a place…</option>
                      {floors.filter(f => f.id !== floorId).map(f => (
                        <optgroup key={f.id} label={f.name}>
                          {otherNodes.filter(n => n.floorId === f.id).map(n => <option key={n.id} value={n.id}>{n.name || `Path point (${meters(n.x)}, ${meters(n.y)} m)`}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <Button size="sm" variant="outline" className="h-8" disabled={!linkTarget} onClick={() => linkToFloor(selectedNode.id, linkTarget, linkKind)}>Link</Button>
                  </div>
                </section>
              )}
            </div>
          ) : singleRoom ? (
            <div className="p-4 space-y-4">
              <div>
                <p className={cn(sectionTitle, 'mb-1')}>Room</p>
                <Input defaultValue={singleRoom.name} key={`rn-${singleRoom.id}-${singleRoom.name}`}
                  onBlur={e => e.target.value !== singleRoom.name && editRoom(singleRoom.id, { name: e.target.value }, 'Rename room')}
                  onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
              </div>
              <label className="block text-xs text-muted-foreground">Type
                <select className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm capitalize text-foreground" value={singleRoom.type}
                  onChange={e => editRoom(singleRoom.id, { type: e.target.value as Room['type'] }, 'Change room type')}>
                  {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                {sqm(polygonArea(roomOutline(singleRoom)))} m² · {roomOutline(singleRoom).length} corners
              </p>
              <div className="grid grid-cols-2 gap-2">
                {singleRoom.nodeId ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => showIn3D(singleRoom.nodeId)}><Box className="h-3.5 w-3.5 mr-1.5" /> Show in 3D</Button>
                    <Button size="sm" variant="outline" onClick={() => handleQRPreview(singleRoom.nodeId)}><QrCode className="h-3.5 w-3.5 mr-1.5" /> QR code</Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" className="col-span-2" onClick={() => addPlaceToRoom(singleRoom)}><MapPin className="h-3.5 w-3.5 mr-1.5" /> Add a place to navigate to</Button>
                )}
                <Button size="sm" variant="outline" onClick={duplicateSelection}><CopyPlus className="h-3.5 w-3.5 mr-1.5" /> Duplicate</Button>
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => deleteSelection(sel)}><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete</Button>
              </div>
              {/* The room's place: what visitors see when they find it */}
              {singleRoom.nodeId && buildingId && (() => {
                const place = nodeById.get(singleRoom.nodeId);
                return place ? (
                  <PlaceDetailsEditor buildingId={buildingId} institutionId={building?.institutionId ?? null}
                    node={{ id: place.id, floorId: place.floorId, name: place.name || singleRoom.name }} roomType={singleRoom.type} />
                ) : null;
              })()}
              <RoomFields x={extras[singleRoom.id] ?? {}} onPatch={(p, l) => editExtra('rooms', singleRoom.id, p, l)} />
              {transformPanel}
            </div>
          ) : singleFeature ? (
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: FEATURE_KINDS[singleFeature.kind].color }} />
                <h3 className="font-semibold">{FEATURE_KINDS[singleFeature.kind].label}</h3>
              </div>
              <label className="block text-xs text-muted-foreground">Kind
                <select className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground" value={singleFeature.kind}
                  onChange={e => editFeature(singleFeature.id, { kind: e.target.value as FeatureKind, width: null, depth: null }, 'Change object')}>
                  {(Object.keys(FEATURE_KINDS) as FeatureKind[]).map(kd => <option key={kd} value={kd}>{FEATURE_KINDS[kd].label}</option>)}
                </select>
              </label>
              <label className="block text-xs text-muted-foreground">{singleFeature.kind === 'label' ? 'Text' : 'Label (optional)'}
                <Input className="mt-1" defaultValue={singleFeature.label ?? ''} key={`fl-${singleFeature.id}-${singleFeature.label}`}
                  onBlur={e => (e.target.value || null) !== singleFeature.label && editFeature(singleFeature.id, { label: e.target.value || null }, 'Edit label')}
                  onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
              </label>
              {singleFeature.kind !== 'label' && (
                <div className="grid grid-cols-3 gap-2">
                  {([['Rotation °', 'rotationDeg', 1], ['Width m', 'width', PX_PER_METER], ['Depth m', 'depth', PX_PER_METER]] as const).map(([lbl, key, div]) => {
                    const val = key === 'rotationDeg' ? singleFeature.rotationDeg : (singleFeature[key] ?? FEATURE_KINDS[singleFeature.kind][key === 'width' ? 'w' : 'd'] * PX_PER_METER);
                    return (
                      <label key={key} className="text-[11px] text-muted-foreground">{lbl}
                        <Input type="number" step={key === 'rotationDeg' ? 15 : 0.1} className="mt-1 h-8 text-xs" defaultValue={+(val / div).toFixed(2)}
                          key={`${key}-${singleFeature.id}-${val}`}
                          onBlur={e => {
                            const v = Number(e.target.value) * div;
                            if (Number.isFinite(v) && Math.abs(v - val) > 1e-6) editFeature(singleFeature.id, { [key]: v }, `Change ${lbl.split(' ')[0].toLowerCase()}`);
                          }}
                          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                      </label>
                    );
                  })}
                </div>
              )}
              {(singleFeature.kind === 'door' || singleFeature.kind === 'arch' || singleFeature.kind === 'window') && (
                <OpeningFields kind={singleFeature.kind} x={extras[singleFeature.id] ?? {}} onPatch={(p, l) => editExtra('map_features', singleFeature.id, p, l)}
                  anchored={!!editorModel?.venue.openings.find(o => o.id === singleFeature.id)?.wallId} />
              )}
              {(singleFeature.kind === 'stairs' || singleFeature.kind === 'elevator') && floorId && (
                <ConnectorFields kind={singleFeature.kind} x={extras[singleFeature.id] ?? {}} floors={floors} floorId={floorId}
                  onPatch={(p, l) => editExtra('map_features', singleFeature.id, p, l)} />
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={duplicateSelection}><CopyPlus className="h-3.5 w-3.5 mr-1.5" /> Duplicate</Button>
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => deleteSelection(sel)}><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete</Button>
              </div>
            </div>
          ) : singleWall ? (
            <div className="p-4 space-y-4">
              <h3 className="font-semibold">Wall</h3>
              <p className="text-xs text-muted-foreground">
                {meters(segLen(singleWall))} m long · {((Math.atan2(singleWall.y2 - singleWall.y1, singleWall.x2 - singleWall.x1) * 180) / Math.PI).toFixed(0)}°
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={() => {
                  const parts = splitAt(singleWall, { x: (singleWall.x1 + singleWall.x2) / 2, y: (singleWall.y1 + singleWall.y2) / 2 }, 2);
                  if (parts) replaceWalls([singleWall.id], parts, 'Split wall');
                }}><Split className="h-3.5 w-3.5 mr-1.5" /> Split in half</Button>
                <Button size="sm" variant="outline" onClick={duplicateSelection}><CopyPlus className="h-3.5 w-3.5 mr-1.5" /> Duplicate</Button>
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive col-span-2" onClick={() => deleteSelection(sel)}><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Trim, Extend, Join and Offset are in the toolbar.</p>
              <WallFields x={extras[singleWall.id] ?? {}} ceiling={editorModel?.venue.floors.find(fl => fl.id === floorId)?.ceilingHeight ?? 2.8}
                onPatch={(p, l) => editExtra('walls', singleWall.id, p, l)} />
              {transformPanel}
            </div>
          ) : nSel > 1 ? (
            <div className="p-4 space-y-4">
              <h3 className="font-semibold">{nSel} items selected</h3>
              <p className="text-xs text-muted-foreground">
                {[sel.walls.length && `${sel.walls.length} walls`, sel.rooms.length && `${sel.rooms.length} rooms`, sel.features.length && `${sel.features.length} objects`, sel.nodes.length && `${sel.nodes.length} places`].filter(Boolean).join(' · ')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={duplicateSelection}><CopyPlus className="h-3.5 w-3.5 mr-1.5" /> Duplicate</Button>
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => deleteSelection(sel)}><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete</Button>
              </div>
              {transformPanel}
            </div>
          ) : (
            <div className="p-4 space-y-5">
              <div className="text-center py-6">
                <MousePointer2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Select anything in 2D or 3D</p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">Drag on empty space to select several</p>
              </div>
              {floorId && <FloorFields x={extras[floorId] ?? {}} level={floorMeta?.level ?? 0} onPatch={(p, l) => editExtra('floors', floorId, p, l)} />}
              <section>
                <h4 className={cn(sectionTitle, 'mb-2')}>Shortcuts</h4>
                <dl className="space-y-1.5">
                  {[...ALL_TOOLS.filter(t => t.key).map(t => [t.key!, t.label] as [string, string]), ...SHORTCUTS].map(([key, label]) => (
                    <div key={`${key}-${label}`} className="flex items-center justify-between text-xs">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{key}</kbd></dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>
          )}
        </aside>
        )}
      </div>

      {/* ── Status bar ── */}
      <footer className="h-8 border-t bg-card px-2 flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => viewport.zoomBy(0.8)} aria-label="Zoom out" disabled={!show2D}><ZoomOut className="h-3.5 w-3.5" /></Button>
        <span className="w-10 text-center tabular-nums">{Math.round(viewport.scale * 100)}%</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => viewport.zoomBy(1.25)} aria-label="Zoom in" disabled={!show2D}><ZoomIn className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fitToContent} aria-label="Fit plan to screen" disabled={!show2D}><Maximize className="h-3.5 w-3.5" /></Button>
        <div className="w-px h-4 bg-border mx-1.5" />
        <button onClick={() => setGridOn(v => !v)} className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted', gridOn && 'text-foreground')}>
          <Grid3x3 className="h-3.5 w-3.5" /> Grid {gridOn ? 'on' : 'off'}
        </button>
        <button onClick={() => setSnapOn(v => !v)} className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted', snapOn && 'text-foreground')}>
          <Magnet className="h-3.5 w-3.5" /> Snap {snapOn ? 'on' : 'off'}
        </button>
        <span className="px-1.5">Units: m</span>
        <span className="ml-auto flex items-center gap-3 tabular-nums">
          {nSel > 0 && <span className="text-primary font-medium">{nSel} selected</span>}
          <span ref={snapKindRef} className="text-[hsl(32_95%_45%)] font-medium" />
          <span ref={cursorRef}>—</span>
          <span className="hidden sm:inline">{nodes.length} places · {edges.length} paths · {walls.length} walls · {features.length} objects</span>
        </span>
      </footer>

      {/* Place edit dialog */}
      <Dialog open={nodeDialog.open} onOpenChange={v => !v && setNodeDialog({ open: false, node: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit place</DialogTitle>
            <DialogDescription>Name it the way visitors would search for it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Place name" value={nodeForm.name} autoFocus
              onChange={e => setNodeForm(p => ({ ...p, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && saveNodeEdit()} />
            <label className="flex items-center justify-between text-sm">
              <span>Path point only <span className="text-muted-foreground">(not a destination)</span></span>
              <Switch checked={nodeForm.isHallway} onCheckedChange={v => setNodeForm(p => ({ ...p, isHallway: v }))} />
            </label>
          </div>
          <DialogFooter>
            <Button onClick={saveNodeEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Room dialog */}
      <Dialog open={roomDialog.open} onOpenChange={v => !v && setRoomDialog({ open: false, nodeId: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedRoom ? 'Edit room' : 'Add room'}</DialogTitle>
            <DialogDescription>A rectangular room centred on this place. To draw any shape, use the Room tool (R).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Room name" value={roomForm.name} onChange={e => setRoomForm(p => ({ ...p, name: e.target.value }))} />
            <div>
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <select className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm capitalize"
                value={roomForm.type} onChange={e => setRoomForm(p => ({ ...p, type: e.target.value as Room['type'] }))}>
                {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground">Width (m)</label>
                <Input type="number" step="0.5" value={+(roomForm.width / PX_PER_METER).toFixed(2)}
                  onChange={e => setRoomForm(p => ({ ...p, width: Math.round(Number(e.target.value) * PX_PER_METER) }))} />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground">Depth (m)</label>
                <Input type="number" step="0.5" value={+(roomForm.height / PX_PER_METER).toFixed(2)}
                  onChange={e => setRoomForm(p => ({ ...p, height: Math.round(Number(e.target.value) * PX_PER_METER) }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={saveRoom}>{selectedRoom ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Text label dialog */}
      <Dialog open={textDialog.open} onOpenChange={v => !v && setTextDialog({ open: false, at: null, text: '' })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add text</DialogTitle>
            <DialogDescription>A label on the map, shown in 2D and 3D.</DialogDescription>
          </DialogHeader>
          <Input autoFocus placeholder="e.g. Sculpture garden" value={textDialog.text}
            onChange={e => setTextDialog(p => ({ ...p, text: e.target.value }))}
            onKeyDown={e => {
              if (e.key === 'Enter' && textDialog.text.trim() && textDialog.at) {
                addFeature('label', textDialog.at, 0, textDialog.text.trim());
                setTextDialog({ open: false, at: null, text: '' });
              }
            }} />
          <DialogFooter>
            <Button disabled={!textDialog.text.trim()} onClick={() => {
              if (textDialog.at) addFeature('label', textDialog.at, 0, textDialog.text.trim());
              setTextDialog({ open: false, at: null, text: '' });
            }}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish */}
      <AlertDialog open={publishAsk} onOpenChange={setPublishAsk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{building?.isPublished ? 'Publish your changes?' : `Publish ${building?.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {building?.isPublished
                ? 'Visitors will see the map, places and content exactly as they are now.'
                : issues > 0
                  ? `Visitors will be able to open the map, search and navigate. Map health found ${issues} issue${issues > 1 ? 's' : ''} — some places may not be reachable yet.`
                  : 'Visitors will be able to open the map, search and navigate.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={togglePublish}>{building?.isPublished ? 'Publish changes' : 'Publish'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {buildingId && floorId && (
        <CadImportDialog
          open={importOpen} onOpenChange={setImportOpen}
          buildingId={buildingId} floorId={floorId} pxPerMeter={PX_PER_METER}
          onImported={async () => {
            // An import replaces earlier imported rows wholesale; undoing edits
            // made before it would target rows that no longer exist.
            history.clear();
            greetAfterLoad.current = true;
            await loadData();
          }}
          onViewIn3D={() => setView('split')}
          onStartTour={() => setTour({ open: true, justBuilt: true })}
          onImportAsFloors={file => setAddFloors({ open: true, file })}
        />
      )}

      {buildingId && (
        <AddFloorsDialog open={addFloors.open} onOpenChange={o => setAddFloors(s => ({ open: o, file: o ? s.file : null }))}
          buildingId={buildingId} initialFile={addFloors.file} pxPerMeter={PX_PER_METER}
          floors={floors.map(f => ({ ...f, hasMap: f.id === floorId ? !isEmpty : true }))}
          onDone={async made => {
            history.clear();
            await loadData();
            const here = made.find(m => m.id === floorId) ?? made[0];
            if (here && here.id !== floorId) toast.success(`${made.length} floor${made.length > 1 ? 's' : ''} added`, { action: { label: `Open ${here.name}`, onClick: () => navigate(`/admin/floors/${buildingId}/${here.id}/editor`) } });
          }} />
      )}

      <EditorTour open={tour.open} justBuilt={tour.justBuilt} state={tourState} onClose={closeTour} />

      {/* QR Preview dialog */}
      {qrPreview && (
        <Dialog open={qrPreview.open} onOpenChange={v => !v && setQrPreview(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>QR code — {nodeById.get(qrPreview.nodeId)?.name || 'place'}</DialogTitle>
              <DialogDescription>Print and place this here. Scanning it sets the visitor's location to this place.</DialogDescription>
            </DialogHeader>
            <div className="flex justify-center">
              <img src={qrPreview.dataUrl} alt="QR Code" className="w-48 h-48" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleQRDownload}>
                <Download className="h-4 w-4 mr-1.5" /> Download PNG
              </Button>
              <Button variant="outline" asChild>
                <a href={`/venue/${buildingId}?from=${qrPreview.nodeId}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1.5" /> Open in View Map</a>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

/** Move / rotate / scale by numbers, for precise edits of a selection. */
function TransformPanel({ xform, setXform, onApply }: {
  xform: { dx: number; dy: number; deg: number; f: number };
  setXform: React.Dispatch<React.SetStateAction<{ dx: number; dy: number; deg: number; f: number }>>;
  onApply: (makeOp: (center: Pt) => TransformOp, label: string) => void;
}) {
  const num = (key: keyof typeof xform, step: number) => (
    <Input type="number" step={step} value={xform[key]} className="h-7 text-xs"
      onChange={e => setXform(p => ({ ...p, [key]: Number(e.target.value) }))} />
  );
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Transform</h4>
      <div className="flex items-center gap-1.5 text-xs">
        <Move className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {num('dx', 0.5)}{num('dy', 0.5)}<span className="text-muted-foreground">m</span>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
          onClick={() => onApply(() => ({ kind: 'move', dx: xform.dx * PX_PER_METER, dy: xform.dy * PX_PER_METER }), 'Move')}>Move</Button>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <RotateCw className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {num('deg', 15)}<span className="text-muted-foreground">°</span>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onApply(c => ({ kind: 'rotate', c, deg: xform.deg }), 'Rotate')}>Rotate</Button>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <Scaling className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {num('f', 0.1)}<span className="text-muted-foreground">×</span>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!(xform.f > 0)} onClick={() => onApply(c => ({ kind: 'scale', c, f: xform.f }), 'Scale')}>Scale</Button>
      </div>
    </section>
  );
}

export default FloorEditor;
