import { useState, useMemo, useEffect, useCallback, useRef, useReducer } from "react";
import type { ComponentType, CSSProperties, ReactNode, SVGProps } from "react";
import { lazy, Suspense, useMemo as useMemo3 } from "react";
import type { LandmarkArea, LandmarkItem, LandmarkLine } from "@/components/landmarks/LandmarkMap";
import type { LandmarkKind } from "@/lib/landmarks/landmarks";
// three.js only loads with the map.
const LandmarkMap = lazy(() => import("@/components/landmarks/LandmarkMap"));
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  Layers,
  Map,
  MapPin,
  Navigation,
  ParkingCircle,
  Plus,
  Route,
  Settings,
  Store,
  Theater,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { Map as MLMap } from "maplibre-gl";
import BaseMap from "@/components/BaseMap";
import MapTypeSwitcher from "@/components/MapTypeSwitcher";
import { DEFAULT_MAP_STYLE_ID, MAP_STYLE_STORAGE_KEY, type MapStyleId } from "@/lib/mapStyles";
import { ADMIN_LAYERS_STORAGE_KEY } from "@/lib/customLayers";

// ─── Design tokens ────────────────────────────────────────────────────────────
const G = {
  primary:       "#144d2d",
  primaryDark:   "#0f3a22",
  primaryMid:    "#1f6a3b",
  primaryBg:     "#eef8f1",
  primaryBorder: "#c7e5cf",
  accent:        "#39c764",
  text:          "#102217",
  textMid:       "#365244",
  textMuted:     "#6c8073",
  border:        "#dfe9e2",
  surface:       "#ffffff",
  surfaceAlt:    "#f6faf7",
  danger:        "#dc2626",
  dangerBg:      "#fef2f2",
};

// ─── Layer type catalogue ─────────────────────────────────────────────────────
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const LAYER_TYPES = {
  stores:    { icon: Store, label: "Stores", color: "#7c3aed", bg: "#f5f3ff", desc: "Retail, food and service locations" },
  routes:    { icon: Truck, label: "Delivery Routes", color: "#d97706", bg: "#fffbeb", desc: "Vehicle and delivery paths" },
  buildings: { icon: Building2, label: "Buildings", color: "#1d4ed8", bg: "#eff6ff", desc: "Structures with floor info" },
  parking:   { icon: ParkingCircle, label: "Parking Areas", color: "#0891b2", bg: "#ecfeff", desc: "Visitor and VIP parking zones" },
  entrances: { icon: DoorOpen, label: "Entrances", color: "#16a34a", bg: "#f0fdf4", desc: "Gates and accessible entry points" },
  events:    { icon: Theater, label: "Events", color: "#dc2626", bg: "#fef2f2", desc: "Live events and scheduled shows" },
  navpaths:  { icon: Navigation, label: "Navigation Paths", color: "#1a7a45", bg: "#f0fdf4", desc: "Walkways and guided routes" },
} as const;

type LayerType = keyof typeof LAYER_TYPES;

// ─── Seed data ────────────────────────────────────────────────────────────────
const PARK = { lat: 9.0192, lng: 38.7628 };
const off = (dLat: number, dLng: number) => ({ lat: PARK.lat + dLat, lng: PARK.lng + dLng });
const rect = (cLat: number, cLng: number, dLat: number, dLng: number) => [
  off(cLat - dLat, cLng - dLng), off(cLat - dLat, cLng + dLng),
  off(cLat + dLat, cLng + dLng), off(cLat + dLat, cLng - dLng),
];
const now = Date.now();

const INITIAL_LAYERS: Layer[] = [
  {
    id: "layer-stores", name: "Store Locations", type: "stores", color: "#7c3aed", visible: false,
    features: [
      { id: "s1", name: "Gift Shop",    category: "retail",  ...off(0.0008,  0.0006),  isOpen: true  },
      { id: "s2", name: "Café Selam",   category: "food",    ...off(-0.0005, 0.0012),  isOpen: true  },
      { id: "s3", name: "Souvenir Hub", category: "retail",  ...off(0.0003, -0.0008),  isOpen: false },
    ],
  },
  {
    id: "layer-routes", name: "Delivery Routes", type: "routes", color: "#d97706", visible: false,
    features: [
      { id: "r1", name: "Morning Supply Run", isActive: true,  mode: "delivery", waypoints: [off(-0.0018,-0.0020), off(-0.0002,0.0000), off(0.0012,0.0002)] },
      { id: "r2", name: "Staff Service Route", isActive: false, mode: "service",  waypoints: [off(0.0018,-0.0018), off(0.0010,-0.0005), off(-0.0015,0.0018)] },
    ],
  },
  {
    id: "layer-buildings", name: "Buildings", type: "buildings", color: "#1d4ed8", visible: false,
    features: [
      { id: "b1", name: "Main Exhibition Hall", floors: 3, use: "cultural", polygon: rect(0.0005, 0.0008, 0.0004, 0.0007) },
      { id: "b2", name: "Admin Block",          floors: 2, use: "civic",    polygon: rect(-0.0008,-0.0006, 0.0003, 0.0005) },
    ],
  },
  {
    id: "layer-parking", name: "Parking Areas", type: "parking", color: "#0891b2", visible: false,
    features: [
      { id: "p1", name: "Visitor Parking A", capacity: 120, available: 43, type: "surface", polygon: rect(-0.0018, 0.0014, 0.0005, 0.0008) },
      { id: "p2", name: "VIP Parking",        capacity: 30,  available: 8,  type: "vip",     polygon: rect(-0.0022, 0.0002, 0.0003, 0.0005) },
    ],
  },
  {
    id: "layer-entrances", name: "Indoor Entrances", type: "entrances", color: "#16a34a", visible: false,
    features: [
      { id: "e1", name: "Main Gate",      ...off(-0.0016, 0.0000), isAccessible: true,  isMainEntrance: true  },
      { id: "e2", name: "North Entrance", ...off( 0.0016, 0.0000), isAccessible: true,  isMainEntrance: false },
      { id: "e3", name: "East Gate",      ...off( 0.0000, 0.0020), isAccessible: false, isMainEntrance: false },
    ],
  },
  {
    id: "layer-events", name: "Events", type: "events", color: "#dc2626", visible: false,
    features: [
      { id: "ev1", name: "Cultural Show",  category: "performance", isLive: true,  ...off(0.0014,-0.0004), startTime: new Date(now - 30*60000).toISOString(), endTime: new Date(now + 60*60000).toISOString() },
      { id: "ev2", name: "Food Festival",  category: "food",        isLive: false, ...off(0.0005, 0.0014), startTime: new Date(now + 2*3600000).toISOString(),  endTime: new Date(now + 5*3600000).toISOString() },
    ],
  },
  {
    id: "layer-navpaths", name: "Navigation Paths", type: "navpaths", color: "#1a7a45", visible: false,
    features: [
      { id: "np1", name: "Main Promenade",  difficulty: "easy",     distanceM: 480, waypoints: [off(-0.0016,0.0000), off(0.0000,0.0000), off(0.0016,0.0000)] },
      { id: "np2", name: "Garden Loop",     difficulty: "easy",     distanceM: 680, waypoints: [off(0,0), off(0.0012,0.0000), off(0,-0.0014), off(-0.0012,0.0000), off(0,0)] },
    ],
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface Layer {
  id: string;
  name: string;
  type: LayerType;
  color: string;
  visible: boolean;
  features: any[];
}

// ─── Mini map (real OpenStreetMap base + same overlay drawing as LayerSVG) ───
function MiniMap({ layers }: { layers: Layer[] }) {
  const [map, setMap] = useState<MLMap | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAutoFitRef = useRef(false);
  const [mapStyleId, setMapStyleId] = useState<MapStyleId>(() => {
    try { return (localStorage.getItem(MAP_STYLE_STORAGE_KEY) as MapStyleId) || DEFAULT_MAP_STYLE_ID; }
    catch { return DEFAULT_MAP_STYLE_ID; }
  });
  useEffect(() => {
    try { localStorage.setItem(MAP_STYLE_STORAGE_KEY, mapStyleId); } catch { /* ignore */ }
  }, [mapStyleId]);

  // Re-render the overlay svg in step with the map's pan/zoom.
  const [, bumpTick] = useReducer((x: number) => x + 1, 0);
  const rafPending = useRef(false);
  const scheduleSync = useCallback(() => {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => { rafPending.current = false; bumpTick(); });
  }, []);

  const visible = layers.filter(l => l.visible);

  const allPoints = useMemo(() => {
    const pts: {lat:number;lng:number}[] = [];
    for (const l of layers) {
      if (l.type==="stores"||l.type==="entrances"||l.type==="events") for (const f of l.features) pts.push({lat:f.lat,lng:f.lng});
      else if (l.type==="routes"||l.type==="navpaths") for (const f of l.features) pts.push(...f.waypoints);
      else if (l.type==="buildings"||l.type==="parking") for (const f of l.features) pts.push(...f.polygon);
    }
    return pts;
  }, [layers]);

  // Fit to data once when the map is ready (re-run if layers arrive late).
  useEffect(() => {
    if (!map || hasAutoFitRef.current) return;
    const pts = allPoints.length ? allPoints : [PARK];
    hasAutoFitRef.current = true;
    if (pts.length === 1) { map.jumpTo({ center: [pts[0].lng, pts[0].lat], zoom: 17 }); return; }
    let south=Infinity, west=Infinity, north=-Infinity, east=-Infinity;
    for (const p of pts) { if (p.lat<south) south=p.lat; if (p.lat>north) north=p.lat; if (p.lng<west) west=p.lng; if (p.lng>east) east=p.lng; }
    map.fitBounds([[west,south],[east,north]], { padding: 36, maxZoom: 19, duration: 0 });
  }, [map, allPoints]);

  const project = useCallback((p: {lat:number;lng:number}) => {
    if (!map) return { x: 0, y: 0 };
    const pt = map.project([p.lng, p.lat]);
    return { x: pt.x, y: pt.y };
  }, [map]);

  return (
    <div ref={containerRef} style={{ position:"relative", width:"100%", aspectRatio:"1", borderRadius:8, overflow:"hidden" }}>
      <BaseMap styleId={mapStyleId} initialCenter={PARK} initialZoom={16} onMapInstance={setMap} onMove={scheduleSync} />
      {map && (
        <svg width="100%" height="100%" style={{ position:"absolute", inset:0, pointerEvents:"none" }}>
          {visible.map(layer => <LayerSVG key={layer.id} layer={layer} project={project}/>)}
        </svg>
      )}
      {visible.length===0 && (
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
          <span style={{fontSize:12,fontWeight:500,color:"#6b7280",fontFamily:"system-ui",background:"rgba(255,255,255,0.92)",padding:"4px 12px",borderRadius:8}}>
            No layers visible — toggle layers on to preview
          </span>
        </div>
      )}
      <div style={{position:"absolute",top:8,right:8}}>
        <MapTypeSwitcher value={mapStyleId} onChange={setMapStyleId} variant="compact"/>
      </div>
      <div style={{position:"absolute",bottom:6,left:0,right:0,textAlign:"center",pointerEvents:"none"}}>
        <span style={{fontSize:9.5,color:"#6b7280",fontFamily:"system-ui",letterSpacing:"1.5px",background:"rgba(255,255,255,0.88)",padding:"1px 8px",borderRadius:4}}>
          UNITY PARK · ADDIS ABABA
        </span>
      </div>
    </div>
  );
}

function LayerSVG({ layer, project }: {layer:Layer;project:(p:{lat:number;lng:number})=>{x:number;y:number}}) {
  const c = layer.color;
  switch(layer.type){
    case "stores": return (<g>{layer.features.map(f=>{const{x,y}=project({lat:f.lat,lng:f.lng});return(<g key={f.id} transform={`translate(${x} ${y})`}><ellipse cx={0} cy={10} rx={4} ry={2} fill="rgba(0,0,0,0.15)"/><path d="M0,-16 C-6,-16 -9,-11 -9,-7 C-9,0 0,10 0,10 C0,10 9,0 9,-7 C9,-11 6,-16 0,-16 Z" fill={f.isOpen?c:"#9ca3af"} stroke="white" strokeWidth="1.5"/><circle cx={0} cy={-7} r={3.5} fill="white"/><g transform="translate(0 13)"><rect x="-22" y="0" width="44" height="10" rx="3" fill="white" opacity="0.9"/><text x={0} y="7.5" textAnchor="middle" fontSize="6.5" fontWeight="600" fill={f.isOpen?"#1f2937":"#9ca3af"} fontFamily="system-ui">{f.name.length>10?f.name.slice(0,9)+"…":f.name}</text></g></g>);})}</g>);
    case "routes": return (<g><defs><marker id={`arr-${layer.id}`} markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto"><path d="M0,0 L0,5 L5,2.5 Z" fill={c} opacity="0.8"/></marker></defs>{layer.features.map(f=>{const pts=f.waypoints.map((p:any)=>project(p));const d=pts.map((p:any,i:number)=>`${i===0?"M":"L"} ${p.x} ${p.y}`).join(" ");return(<path key={f.id} d={d} fill="none" stroke={c} strokeWidth="3" strokeDasharray={f.isActive?"8 4":"4 6"} strokeLinecap="round" strokeLinejoin="round" markerMid={`url(#arr-${layer.id})`} opacity={f.isActive?0.9:0.5}/>);})}</g>);
    case "buildings": return (<g>{layer.features.map(f=>{const pts=f.polygon.map((p:any)=>project(p));const d=pts.map((p:any,i:number)=>`${i===0?"M":"L"} ${p.x} ${p.y}`).join(" ")+" Z";const cx=pts.reduce((a:number,p:any)=>a+p.x,0)/pts.length;const cy=pts.reduce((a:number,p:any)=>a+p.y,0)/pts.length;return(<g key={f.id}><path d={d} fill={c} fillOpacity="0.18" stroke={c} strokeWidth="1.5"/><text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize="7.5" fontWeight="600" fill={c} fontFamily="system-ui">{f.name.length>14?f.name.slice(0,13)+"…":f.name}</text></g>);})}</g>);
    case "parking": return (<g>{layer.features.map(f=>{const pts=f.polygon.map((p:any)=>project(p));const d=pts.map((p:any,i:number)=>`${i===0?"M":"L"} ${p.x} ${p.y}`).join(" ")+" Z";const cx=pts.reduce((a:number,p:any)=>a+p.x,0)/pts.length;const cy=pts.reduce((a:number,p:any)=>a+p.y,0)/pts.length;return(<g key={f.id}><path d={d} fill={c} fillOpacity="0.14" stroke={c} strokeWidth="1.5" strokeDasharray="4 3"/><circle cx={cx} cy={cy} r="11" fill={c}/><text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="800" fill="white" fontFamily="system-ui">P</text></g>);})}</g>);
    case "entrances": return (<g>{layer.features.map(f=>{const{x,y}=project({lat:f.lat,lng:f.lng});return(<g key={f.id} transform={`translate(${x} ${y})`}><rect x="-9" y="-11" width="18" height="22" rx="4" fill={f.isMainEntrance?c:"white"} stroke={c} strokeWidth="1.8"/><path d="M-3 -7 H5 V7 H-3 Z M5 0 H8" fill="none" stroke={f.isMainEntrance?"white":c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></g>);})}</g>);
    case "events": return (<g>{layer.features.map(f=>{const{x,y}=project({lat:f.lat,lng:f.lng});const col=f.isLive?"#dc2626":"#f97316";return(<g key={f.id} transform={`translate(${x} ${y})`}>{f.isLive&&[0,1].map((i:number)=>(<circle key={i} r={13+i*9} fill="none" stroke={col} strokeWidth="1.5" opacity="0"><animate attributeName="r" values={`${13+i*9};${24+i*9};${13+i*9}`} dur="2.2s" begin={`${i*0.7}s`} repeatCount="indefinite"/><animate attributeName="opacity" values="0.4;0;0.4" dur="2.2s" begin={`${i*0.7}s`} repeatCount="indefinite"/></circle>))}<circle r="12" fill={col} stroke="white" strokeWidth="2"/><path d="M-5 -4 H5 M-3 -4 V5 M3 -4 V5" stroke="white" strokeWidth="1.7" strokeLinecap="round"/><path d="M-6 4 C-3 7 3 7 6 4" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></g>);})}</g>);
    case "navpaths": return (<g><defs><marker id={`nav-${layer.id}`} markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0,0.5 L0,6.5 L6.5,3.5 Z" fill={c} opacity="0.65"/></marker></defs>{layer.features.map(f=>{const pts=f.waypoints.map((p:any)=>project(p));const d=pts.map((p:any,i:number)=>`${i===0?"M":"L"} ${p.x} ${p.y}`).join(" ");const dc={easy:"#16a34a",moderate:"#d97706",hard:"#dc2626"}[f.difficulty as string]??c;return(<g key={f.id}><path d={d} fill="none" stroke={dc} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity="0.08"/><path d={d} fill="none" stroke={dc} strokeWidth="3" strokeDasharray="10 5" strokeLinecap="round" strokeLinejoin="round" markerMid={`url(#nav-${layer.id})`} opacity="0.85"><animate attributeName="stroke-dashoffset" from="0" to="-30" dur="1.4s" repeatCount="indefinite"/></path><circle cx={pts[0]?.x} cy={pts[0]?.y} r="5" fill={dc} stroke="white" strokeWidth="1.5"/></g>);})}</g>);
    default: return null;
  }
}

// ─── Shared style helpers ─────────────────────────────────────────────────────
const lbl: CSSProperties = { display:"block", fontSize:11, fontWeight:700, color:G.textMuted, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.04em" };
const inp: CSSProperties = { display:"block", width:"100%", fontSize:13, padding:"10px 11px", border:`1.5px solid ${G.border}`, borderRadius:10, boxSizing:"border-box", outline:"none", background:"white", color:G.text, transition:"border-color 0.15s, box-shadow 0.15s" };

// ─── Feature editors ──────────────────────────────────────────────────────────
function FeatureRow({ children, onDelete, accent }: {children:ReactNode;onDelete:()=>void;accent:string}) {
  return (
    <div style={{border:`1.5px solid ${accent}25`,borderRadius:14,overflow:"hidden",background:"white",boxShadow:"0 1px 10px rgba(15, 58, 34, 0.04)"}}>
      {children}
      <div style={{padding:"0 12px 10px",display:"flex",justifyContent:"flex-end"}}>
        <button onClick={onDelete} style={{fontSize:11,color:G.danger,background:G.dangerBg,border:"none",borderRadius:999,padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontWeight:700}}>
          <Trash2 style={{width:13,height:13}} /> Remove
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: {label:string;children:ReactNode}) {
  return <div><label style={lbl}>{label}</label>{children}</div>;
}

function StoreEditor({ features, color, onChange }: any) {
  const update = (id:string,patch:any) => onChange(features.map((f:any)=>f.id===id?{...f,...patch}:f));
  const remove = (id:string) => onChange(features.filter((f:any)=>f.id!==id));
  const add = () => onChange([...features,{id:"s"+Date.now(),name:"New Store",category:"retail",lat:PARK.lat+(Math.random()-0.5)*0.003,lng:PARK.lng+(Math.random()-0.5)*0.005,isOpen:true}]);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {features.map((f:any)=>(
        <FeatureRow key={f.id} onDelete={()=>remove(f.id)} accent={color}>
          <div style={{padding:"12px 12px 8px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{gridColumn:"1/-1"}}><Field label="Store name"><input style={inp} value={f.name} onChange={e=>update(f.id,{name:e.target.value})}/></Field></div>
            <Field label="Category"><select style={inp} value={f.category} onChange={e=>update(f.id,{category:e.target.value})}>{["retail","food","culture","service"].map(c=><option key={c}>{c}</option>)}</select></Field>
            <Field label="Status"><select style={inp} value={f.isOpen?"open":"closed"} onChange={e=>update(f.id,{isOpen:e.target.value==="open"})}><option value="open">Open</option><option value="closed">Closed</option></select></Field>
            <Field label="Latitude"><input style={inp} type="number" step="0.0001" value={f.lat.toFixed(5)} onChange={e=>update(f.id,{lat:parseFloat(e.target.value)})}/></Field>
            <Field label="Longitude"><input style={inp} type="number" step="0.0001" value={f.lng.toFixed(5)} onChange={e=>update(f.id,{lng:parseFloat(e.target.value)})}/></Field>
          </div>
        </FeatureRow>
      ))}
      <AddItemButton color={color} label="Add Store" onClick={add}/>
    </div>
  );
}

function RoutesEditor({ features, color, onChange }: any) {
  const update = (id:string,patch:any) => onChange(features.map((f:any)=>f.id===id?{...f,...patch}:f));
  const remove = (id:string) => onChange(features.filter((f:any)=>f.id!==id));
  const add = () => onChange([...features,{id:"r"+Date.now(),name:"New Route",isActive:true,mode:"delivery",waypoints:[off(-0.001,-0.001),off(0.001,0.001)]}]);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {features.map((f:any)=>(
        <FeatureRow key={f.id} onDelete={()=>remove(f.id)} accent={color}>
          <div style={{padding:"12px 12px 8px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{gridColumn:"1/-1"}}><Field label="Route name"><input style={inp} value={f.name} onChange={e=>update(f.id,{name:e.target.value})}/></Field></div>
            <Field label="Mode"><select style={inp} value={f.mode} onChange={e=>update(f.id,{mode:e.target.value})}>{["delivery","service","emergency","supply"].map(m=><option key={m}>{m}</option>)}</select></Field>
            <Field label="Status"><select style={inp} value={f.isActive?"active":"inactive"} onChange={e=>update(f.id,{isActive:e.target.value==="active"})}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
            <div style={{gridColumn:"1/-1"}}>
              <label style={lbl}>Waypoints ({f.waypoints.length})</label>
              <div style={{fontSize:11,color:"#9ca3af",background:"#f9fafb",borderRadius:8,padding:"8px 10px",border:"1px solid #e5e7eb"}}>
                {f.waypoints.map((wp:any,i:number)=><span key={i} style={{marginRight:8}}>{i+1}. ({wp.lat.toFixed(4)}, {wp.lng.toFixed(4)})</span>)}
              </div>
            </div>
          </div>
        </FeatureRow>
      ))}
      <AddItemButton color={color} label="Add Route" onClick={add}/>
    </div>
  );
}

function BuildingsEditor({ features, color, onChange }: any) {
  const update = (id:string,patch:any) => onChange(features.map((f:any)=>f.id===id?{...f,...patch}:f));
  const remove = (id:string) => onChange(features.filter((f:any)=>f.id!==id));
  const add = () => onChange([...features,{id:"b"+Date.now(),name:"New Building",floors:1,use:"civic",polygon:rect((Math.random()-0.5)*0.002,(Math.random()-0.5)*0.003,0.0004,0.0006)}]);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {features.map((f:any)=>(
        <FeatureRow key={f.id} onDelete={()=>remove(f.id)} accent={color}>
          <div style={{padding:"12px 12px 8px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{gridColumn:"1/-1"}}><Field label="Building name"><input style={inp} value={f.name} onChange={e=>update(f.id,{name:e.target.value})}/></Field></div>
            <Field label="Floors"><input style={inp} type="number" min="1" value={f.floors} onChange={e=>update(f.id,{floors:parseInt(e.target.value)})}/></Field>
            <Field label="Use"><select style={inp} value={f.use} onChange={e=>update(f.id,{use:e.target.value})}>{["cultural","civic","commercial","residential","utility"].map(u=><option key={u}>{u}</option>)}</select></Field>
          </div>
        </FeatureRow>
      ))}
      <AddItemButton color={color} label="Add Building" onClick={add}/>
    </div>
  );
}

function ParkingEditor({ features, color, onChange }: any) {
  const update = (id:string,patch:any) => onChange(features.map((f:any)=>f.id===id?{...f,...patch}:f));
  const remove = (id:string) => onChange(features.filter((f:any)=>f.id!==id));
  const add = () => onChange([...features,{id:"p"+Date.now(),name:"New Parking",capacity:50,available:50,type:"surface",polygon:rect((Math.random()-0.5)*0.002,(Math.random()-0.5)*0.003,0.0005,0.0008)}]);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {features.map((f:any)=>(
        <FeatureRow key={f.id} onDelete={()=>remove(f.id)} accent={color}>
          <div style={{padding:"12px 12px 8px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{gridColumn:"1/-1"}}><Field label="Area name"><input style={inp} value={f.name} onChange={e=>update(f.id,{name:e.target.value})}/></Field></div>
            <Field label="Total capacity"><input style={inp} type="number" min="1" value={f.capacity} onChange={e=>update(f.id,{capacity:parseInt(e.target.value)})}/></Field>
            <Field label="Available now"><input style={inp} type="number" min="0" value={f.available} onChange={e=>update(f.id,{available:parseInt(e.target.value)})}/></Field>
            <Field label="Type"><select style={inp} value={f.type} onChange={e=>update(f.id,{type:e.target.value})}>{["surface","covered","vip","staff"].map(t=><option key={t}>{t}</option>)}</select></Field>
          </div>
        </FeatureRow>
      ))}
      <AddItemButton color={color} label="Add Parking Area" onClick={add}/>
    </div>
  );
}

function EntrancesEditor({ features, color, onChange }: any) {
  const update = (id:string,patch:any) => onChange(features.map((f:any)=>f.id===id?{...f,...patch}:f));
  const remove = (id:string) => onChange(features.filter((f:any)=>f.id!==id));
  const add = () => onChange([...features,{id:"e"+Date.now(),name:"New Entrance",...off((Math.random()-0.5)*0.003,(Math.random()-0.5)*0.005),isAccessible:false,isMainEntrance:false}]);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {features.map((f:any)=>(
        <FeatureRow key={f.id} onDelete={()=>remove(f.id)} accent={color}>
          <div style={{padding:"12px 12px 8px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{gridColumn:"1/-1"}}><Field label="Entrance name"><input style={inp} value={f.name} onChange={e=>update(f.id,{name:e.target.value})}/></Field></div>
            <Field label="Latitude"><input style={inp} type="number" step="0.0001" value={f.lat.toFixed(5)} onChange={e=>update(f.id,{lat:parseFloat(e.target.value)})}/></Field>
            <Field label="Longitude"><input style={inp} type="number" step="0.0001" value={f.lng.toFixed(5)} onChange={e=>update(f.id,{lng:parseFloat(e.target.value)})}/></Field>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#374151",cursor:"pointer"}}>
              <input type="checkbox" checked={f.isMainEntrance} onChange={e=>update(f.id,{isMainEntrance:e.target.checked})}/>Main entrance
            </label>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#374151",cursor:"pointer"}}>
              <input type="checkbox" checked={f.isAccessible} onChange={e=>update(f.id,{isAccessible:e.target.checked})}/>♿ Accessible
            </label>
          </div>
        </FeatureRow>
      ))}
      <AddItemButton color={color} label="Add Entrance" onClick={add}/>
    </div>
  );
}

function EventsEditor({ features, color, onChange }: any) {
  const update = (id:string,patch:any) => onChange(features.map((f:any)=>f.id===id?{...f,...patch}:f));
  const remove = (id:string) => onChange(features.filter((f:any)=>f.id!==id));
  const add = () => onChange([...features,{id:"ev"+Date.now(),name:"New Event",category:"performance",isLive:false,lat:PARK.lat+(Math.random()-0.5)*0.003,lng:PARK.lng+(Math.random()-0.5)*0.005,startTime:new Date(now+3600000).toISOString(),endTime:new Date(now+7200000).toISOString()}]);
  const fmtTime = (iso:string) => { try{return new Date(iso).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}catch{return ""} };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {features.map((f:any)=>(
        <FeatureRow key={f.id} onDelete={()=>remove(f.id)} accent={color}>
          <div style={{padding:"12px 12px 8px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{gridColumn:"1/-1"}}><Field label="Event name"><input style={inp} value={f.name} onChange={e=>update(f.id,{name:e.target.value})}/></Field></div>
            <Field label="Category"><select style={inp} value={f.category} onChange={e=>update(f.id,{category:e.target.value})}>{["performance","exhibit","food","sport","workshop"].map(c=><option key={c}>{c}</option>)}</select></Field>
            <div style={{display:"flex",alignItems:"center",gap:8,paddingTop:20}}>
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#374151",cursor:"pointer"}}>
                <input type="checkbox" checked={f.isLive} onChange={e=>update(f.id,{isLive:e.target.checked})}/>Live now
              </label>
            </div>
            <Field label="Start time"><input style={inp} type="datetime-local" value={f.startTime.slice(0,16)} onChange={e=>update(f.id,{startTime:new Date(e.target.value).toISOString()})}/></Field>
            <Field label="End time"><input style={inp} type="datetime-local" value={f.endTime.slice(0,16)} onChange={e=>update(f.id,{endTime:new Date(e.target.value).toISOString()})}/></Field>
            <Field label="Latitude"><input style={inp} type="number" step="0.0001" value={f.lat.toFixed(5)} onChange={e=>update(f.id,{lat:parseFloat(e.target.value)})}/></Field>
            <Field label="Longitude"><input style={inp} type="number" step="0.0001" value={f.lng.toFixed(5)} onChange={e=>update(f.id,{lng:parseFloat(e.target.value)})}/></Field>
          </div>
        </FeatureRow>
      ))}
      <AddItemButton color={color} label="Add Event" onClick={add}/>
    </div>
  );
}

function NavPathsEditor({ features, color, onChange }: any) {
  const update = (id:string,patch:any) => onChange(features.map((f:any)=>f.id===id?{...f,...patch}:f));
  const remove = (id:string) => onChange(features.filter((f:any)=>f.id!==id));
  const add = () => onChange([...features,{id:"np"+Date.now(),name:"New Path",difficulty:"easy",distanceM:200,waypoints:[off(-0.001,0),off(0,0),off(0.001,0)]}]);
  const diffColor:Record<string,string> = {easy:"#16a34a",moderate:"#d97706",hard:"#dc2626"};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {features.map((f:any)=>(
        <FeatureRow key={f.id} onDelete={()=>remove(f.id)} accent={color}>
          <div style={{padding:"12px 12px 8px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{gridColumn:"1/-1"}}><Field label="Path name"><input style={inp} value={f.name} onChange={e=>update(f.id,{name:e.target.value})}/></Field></div>
            <Field label="Difficulty">
              <select style={{...inp,color:diffColor[f.difficulty]??"#111"}} value={f.difficulty} onChange={e=>update(f.id,{difficulty:e.target.value})}>
                {["easy","moderate","hard"].map(d=><option key={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Distance (m)"><input style={inp} type="number" min="1" value={f.distanceM} onChange={e=>update(f.id,{distanceM:parseInt(e.target.value)})}/></Field>
            <div style={{gridColumn:"1/-1"}}>
              <label style={lbl}>Waypoints ({f.waypoints.length})</label>
              <div style={{fontSize:11,color:"#9ca3af",background:"#f9fafb",borderRadius:8,padding:"8px 10px",border:"1px solid #e5e7eb",lineHeight:1.8}}>
                {f.waypoints.map((wp:any,i:number)=><span key={i} style={{marginRight:8,whiteSpace:"nowrap"}}>⬤ {wp.lat.toFixed(4)}, {wp.lng.toFixed(4)}</span>)}
              </div>
            </div>
          </div>
        </FeatureRow>
      ))}
      <AddItemButton color={color} label="Add Path" onClick={add}/>
    </div>
  );
}

function FeatureEditor({ layer, onChange }: {layer:Layer;onChange:(l:Layer)=>void}) {
  const update = (features:any[]) => onChange({...layer,features});
  switch(layer.type){
    case "stores":    return <StoreEditor    features={layer.features} color={layer.color} onChange={update}/>;
    case "routes":    return <RoutesEditor   features={layer.features} color={layer.color} onChange={update}/>;
    case "buildings": return <BuildingsEditor features={layer.features} color={layer.color} onChange={update}/>;
    case "parking":   return <ParkingEditor  features={layer.features} color={layer.color} onChange={update}/>;
    case "entrances": return (<g>{layer.features.map(f=>{const{x,y}=project({lat:f.lat,lng:f.lng});return(<g key={f.id} transform={`translate(${x} ${y})`}><rect x="-9" y="-11" width="18" height="22" rx="4" fill={f.isMainEntrance?c:"white"} stroke={c} strokeWidth="1.8"/><path d="M-3 -7 H5 V7 H-3 Z M5 0 H8" fill="none" stroke={f.isMainEntrance?"white":c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></g>);})}</g>);
    case "events":    return <EventsEditor   features={layer.features} color={layer.color} onChange={update}/>;
    case "navpaths":  return <NavPathsEditor  features={layer.features} color={layer.color} onChange={update}/>;
    default:          return <div style={{color:"#9ca3af",fontSize:13}}>No editor for this type.</div>;
  }
}

// ─── Add Layer Modal ──────────────────────────────────────────────────────────
function AddLayerModal({ onClose, onAdd }: {onClose:()=>void;onAdd:(l:Layer)=>void}) {
  const [step, setStep] = useState<"pick"|"configure">("pick");
  const [selectedType, setSelectedType] = useState<LayerType|null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3ac65a");

  const handlePickType = (type: LayerType) => {
    setSelectedType(type);
    setName(LAYER_TYPES[type].label);
    setColor(LAYER_TYPES[type].color);
    setStep("configure");
  };

  const handleCreate = () => {
    if (!selectedType || !name.trim()) return;
    const newLayer: Layer = {
      id: "layer-" + Date.now(),
      name: name.trim(),
      type: selectedType,
      color,
      visible: true,
      features: [],
    };
    onAdd(newLayer);
    onClose();
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"flex-end",zIndex:2000}} onClick={onClose}>
      <div style={{background:"white",borderRadius:"24px 24px 0 0",width:"100%",maxHeight:"85vh",display:"flex",flexDirection:"column",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
        {/* Handle */}
        <div style={{display:"flex",justifyContent:"center",padding:"12px 0 8px"}}>
          <div style={{width:40,height:4,borderRadius:2,background:"#e5e7eb"}}/>
        </div>

        {/* Header */}
        <div style={{padding:"0 20px 16px",borderBottom:"1px solid #f0f0f0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            {step==="configure"&&<button onClick={()=>setStep("pick")} style={{background:"none",border:"none",color:G.textMuted,fontSize:13,cursor:"pointer",padding:"0 0 4px",display:"flex",alignItems:"center",gap:5}}><ArrowLeft style={{width:13,height:13}} /> Back</button>}
            <div style={{fontWeight:700,fontSize:17,color:G.text}}>
              {step==="pick" ? "Choose Layer Type" : `Configure ${selectedType ? LAYER_TYPES[selectedType].label : ""}`}
            </div>
            <div style={{fontSize:12,color:"#9ca3af",marginTop:2}}>
              {step==="pick" ? "Select what kind of layer to add" : "Set a name and color for your layer"}
            </div>
          </div>
          <button onClick={onClose} style={{width:32,height:32,borderRadius:"50%",background:"#f3f4f6",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} aria-label="Close"><X style={{width:15,height:15}} /></button>
        </div>

        <div style={{overflowY:"auto",flex:1}}>
          {step==="pick" ? (
            <div style={{padding:"16px 20px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {(Object.entries(LAYER_TYPES) as [LayerType, typeof LAYER_TYPES[LayerType]][]).map(([type,meta])=>{
                const TypeIcon = meta.icon as IconComponent;
                return (
                <button key={type} onClick={()=>handlePickType(type)} style={{
                  background:"white",border:`2px solid ${meta.color}30`,borderRadius:14,padding:"14px 12px",
                  cursor:"pointer",textAlign:"left",transition:"all 0.15s",
                  display:"flex",flexDirection:"column",gap:6
                }}>
                  <div style={{width:40,height:40,borderRadius:10,background:meta.bg,display:"flex",alignItems:"center",justifyContent:"center",color:meta.color}}>
                    <TypeIcon style={{width:19,height:19}} />
                  </div>
                  <div style={{fontSize:13,fontWeight:700,color:G.text}}>{meta.label}</div>
                  <div style={{fontSize:11,color:"#9ca3af",lineHeight:1.4}}>{meta.desc}</div>
                </button>
              )})}
            </div>
          ) : (
            <div style={{padding:"20px 20px 24px",display:"flex",flexDirection:"column",gap:16}}>
              {/* Type badge */}
              {selectedType && (
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:LAYER_TYPES[selectedType].bg,borderRadius:12,border:`1.5px solid ${LAYER_TYPES[selectedType].color}30`}}>
                  {(() => {
                    const SelectedIcon = LAYER_TYPES[selectedType].icon as IconComponent;
                    return <SelectedIcon style={{width:21,height:21,color:LAYER_TYPES[selectedType].color,flexShrink:0}} />;
                  })()}
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:LAYER_TYPES[selectedType].color}}>{LAYER_TYPES[selectedType].label}</div>
                    <div style={{fontSize:11,color:"#9ca3af"}}>{LAYER_TYPES[selectedType].desc}</div>
                  </div>
                </div>
              )}
              {/* Name */}
              <div>
                <label style={lbl}>Layer Name</label>
                <input
                  style={{...inp,fontSize:15,padding:"10px 12px"}}
                  value={name}
                  onChange={e=>setName(e.target.value)}
                  placeholder="e.g. Visitor Entrances"
                  autoFocus
                />
              </div>
              {/* Color */}
              <div>
                <label style={lbl}>Layer Color</label>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <input type="color" value={color} onChange={e=>setColor(e.target.value)} style={{width:52,height:44,border:"1.5px solid #e5e7eb",borderRadius:10,cursor:"pointer",padding:3}}/>
                  <input style={{...inp,fontFamily:"monospace",flex:1}} value={color} onChange={e=>setColor(e.target.value)} placeholder="#000000"/>
                  <div style={{width:44,height:44,borderRadius:10,background:color,flexShrink:0,border:"1.5px solid rgba(0,0,0,0.08)"}}/>
                </div>
              </div>
              {/* Quick color palette */}
              <div>
                <label style={lbl}>Quick Colors</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["#7c3aed","#d97706","#1d4ed8","#0891b2","#16a34a","#dc2626","#1a7a45","#db2777","#ea580c"].map(c=>(
                    <button key={c} onClick={()=>setColor(c)} style={{width:32,height:32,borderRadius:8,background:c,border:color===c?"3px solid #111":"2px solid rgba(0,0,0,0.1)",cursor:"pointer",transition:"transform 0.1s",flexShrink:0}}/>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {step==="configure" && (
          <div style={{padding:"12px 20px 24px",borderTop:"1px solid #f0f0f0"}}>
            <button onClick={handleCreate} disabled={!name.trim()} style={{
              width:"100%",padding:"14px",borderRadius:14,border:"none",cursor:name.trim()?"pointer":"not-allowed",
              background:name.trim()?G.primary:"#e5e7eb",color:"white",fontWeight:700,fontSize:15,
              display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"background 0.15s"
            }}>
              <Check style={{width:17,height:17}} /> Create Layer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Export Modal ─────────────────────────────────────────────────────────────
function ExportModal({ layers, onClose }: {layers:Layer[];onClose:()=>void}) {
  const json = JSON.stringify(layers, null, 2);
  const [copied, setCopied] = useState(false);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"flex-end",zIndex:1000}} onClick={onClose}>
      <div style={{background:"white",borderRadius:"20px 20px 0 0",padding:"24px 20px",width:"100%",maxHeight:"70vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <span style={{fontWeight:700,fontSize:16,color:G.text}}>Export Layers JSON</span>
          <button onClick={onClose} style={{background:"#f3f4f6",border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center"}} aria-label="Close"><X style={{width:15,height:15}} /></button>
        </div>
        <div style={{fontSize:11,color:"#9ca3af",marginBottom:10}}>Paste into <code>src/lib/customLayers.ts</code> as the <code>DEFAULT_CUSTOM_LAYERS</code> value.</div>
        <textarea readOnly value={json} style={{flex:1,fontSize:11,fontFamily:"monospace",border:"1px solid #e5e7eb",borderRadius:8,padding:12,resize:"none",color:"#374151",background:"#fafafa"}}/>
        <button onClick={()=>{navigator.clipboard?.writeText(json).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000)})}} style={{marginTop:12,background:copied?"#16a34a":G.primary,color:"white",border:"none",borderRadius:10,padding:"12px 20px",fontWeight:700,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          {copied ? <><Check style={{width:15,height:15}} /> Copied</> : <><Copy style={{width:15,height:15}} /> Copy to Clipboard</>}
        </button>
      </div>
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
function Toggle({ on, onChange, color }: {on:boolean;onChange:()=>void;color:string}) {
  return (
    <button onClick={e=>{e.stopPropagation();onChange();}} style={{
      width:44,height:25,borderRadius:12,border:"none",cursor:"pointer",
      background:on?color:"#e5e7eb",position:"relative",flexShrink:0,transition:"background 0.18s",
    }}>
      <div style={{position:"absolute",top:3,left:on?22:3,width:19,height:19,borderRadius:"50%",background:"white",transition:"left 0.18s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
    </button>
  );
}

// ─── Add item button ──────────────────────────────────────────────────────────
function AddItemButton({ color, label, onClick }: {color:string;label:string;onClick:()=>void}) {
  return (
    <button onClick={onClick} style={{
      marginTop:4,display:"flex",alignItems:"center",justifyContent:"center",gap:6,
      fontSize:12,fontWeight:700,color,border:`1.5px dashed ${color}60`,
      background:color+"0a",borderRadius:10,padding:"9px 14px",cursor:"pointer",width:"100%",
    }}>
      <Plus style={{width:14,height:14}} /> {label}
    </button>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
// ─── The 3D preview (the home map's look) ─────────────────────────────────────
type LL = { lat: number; lng: number };
const KIND_OF: Partial<Record<LayerType, LandmarkKind>> = { stores: "bag", events: "flag", entrances: "pin", buildings: "crown", parking: "pin" };

/** Visible layers as the 3D map's landmarks, areas and paths (metres from the park centre). */
function useLayerScene(layers: Layer[]) {
  return useMemo3(() => {
    const k = Math.cos((PARK.lat * Math.PI) / 180);
    const P = (p: LL) => ({ x: (p.lng - PARK.lng) * k * 111320, y: (PARK.lat - p.lat) * 110540 });
    const items: LandmarkItem[] = [], lines: LandmarkLine[] = [], areas: LandmarkArea[] = [];
    for (const l of layers) {
      if (!l.visible) continue;
      for (const ft of l.features) {
        const id = `${l.id}::${ft.id}`;
        if (Array.isArray(ft.waypoints)) { lines.push({ id, points: ft.waypoints.map(P), color: l.color, width: l.type === "navpaths" ? 1.2 : 0.9 }); continue; }
        if (Array.isArray(ft.polygon) && ft.polygon.length >= 3) {
          const pts = ft.polygon.map(P);
          areas.push({ id, points: pts, color: l.color });
          const c = pts.reduce((a: { x: number; y: number }, p: { x: number; y: number }) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
          items.push({ id, name: ft.name ?? l.name, x: c.x, y: c.y, color: l.color, kind: KIND_OF[l.type] ?? "pin", sub: l.name, muted: true });
          continue;
        }
        if (typeof ft.lat === "number" && typeof ft.lng === "number") {
          const p = P(ft);
          const kind: LandmarkKind = l.type === "entrances" && ft.isMainEntrance ? "crown" : KIND_OF[l.type] ?? "pin";
          items.push({ id, name: ft.name ?? l.name, x: p.x, y: p.y, color: l.type === "events" && ft.isLive ? "#dc2626" : l.color, kind, sub: l.name, muted: l.type === "stores" && ft.isOpen === false });
        }
      }
    }
    return { items, lines, areas };
  }, [layers]);
}

interface AdminLayersDashboardProps {
  embedded?: boolean;
}

export default function AdminLayersDashboard({ embedded = false }: AdminLayersDashboardProps) {

  const [layers, setLayers] = useState<Layer[]>(() => {
    try {
      const saved = localStorage.getItem(ADMIN_LAYERS_STORAGE_KEY);
      if (saved) return JSON.parse(saved) as Layer[];
    } catch { /* ignore */ }
    return INITIAL_LAYERS;
  });
  useEffect(() => {
    try { localStorage.setItem(ADMIN_LAYERS_STORAGE_KEY, JSON.stringify(layers)); }
    catch { /* ignore */ }
  }, [layers]);
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [editorTab, setEditorTab] = useState<"features"|"settings">("features");
  const [showExport, setShowExport] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMap, setShowMap] = useState(false);

  const selected = layers.find(l=>l.id===selectedId);
  const activeLayers = layers.filter(l=>l.visible);
  const totalFeatures = layers.reduce((n,l)=>n+l.features.length,0);
  const scene = useLayerScene(layers);

  const toggleVisible = (id:string) => setLayers(ls=>ls.map(l=>l.id===id?{...l,visible:!l.visible}:l));
  const updateLayer = (updated:Layer) => setLayers(ls=>ls.map(l=>l.id===updated.id?updated:l));
  const deleteLayer = (id:string) => { setLayers(ls=>ls.filter(l=>l.id!==id)); if(selectedId===id)setSelectedId(null); };
  const addLayer = (l:Layer) => { setLayers(ls=>[...ls,l]); setSelectedId(l.id); };

  return (
    <div style={{fontFamily:"Plus Jakarta Sans, Inter, system-ui, -apple-system, sans-serif",minHeight:"100vh",background:"hsl(var(--background))",display:"flex",flexDirection:"column"}}>
      {!embedded && (
        <div style={{background:G.primaryDark,padding:"12px 16px 18px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 10px 30px rgba(15,58,34,0.16)"}}>
          <Link to="/admin" aria-label="Back to admin" style={{width:38,height:38,borderRadius:999,background:"rgba(255,255,255,0.12)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <ArrowLeft style={{width:18,height:18,color:"white"}} />
          </Link>
          <div style={{width:42,height:42,borderRadius:14,background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.22)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Layers style={{width:20,height:20,color:"white"}} />
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{color:"white",fontWeight:800,fontSize:18,lineHeight:1}}>Custom Layers</div>
            <div style={{color:"rgba(255,255,255,0.62)",fontSize:12,marginTop:3}}>Unity Park Admin</div>
          </div>
          <button onClick={()=>setShowExport(true)} style={{background:"rgba(255,255,255,0.14)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:999,padding:"9px 13px",color:"white",fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:7}}>
            <Clipboard style={{width:14,height:14}} /> Export
          </button>
        </div>
      )}

      <div className="space-y-4 px-4 pt-5 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { icon: Layers, label: "Layers", value: layers.length },
            { icon: Eye, label: "Showing on the map", value: activeLayers.length },
            { icon: MapPin, label: "Features", value: totalFeatures },
          ].map(st => (
            <div key={st.label} className="flex min-w-[170px] flex-1 items-center gap-3 rounded-2xl border bg-card p-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><st.icon style={{ width: 16, height: 16 }} /></span>
              <span><span className="block text-xl font-black leading-none tabular-nums">{st.value}</span><span className="text-[11px] text-muted-foreground">{st.label}</span></span>
            </div>
          ))}
          <button onClick={()=>setShowExport(true)} className="flex h-10 items-center gap-1.5 rounded-xl border bg-card px-3 text-sm font-semibold hover:bg-muted">
            <Clipboard style={{ width: 15, height: 15 }} /> Export
          </button>
          <button onClick={()=>setShowAddModal(true)} className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
            <Plus style={{ width: 15, height: 15 }} /> Add layer
          </button>
        </div>
        <div className="relative">
          <Suspense fallback={<div className="flex h-[460px] items-center justify-center rounded-3xl bg-muted/50 text-sm text-muted-foreground">Building the 3D map…</div>}>
            <LandmarkMap items={scene.items} lines={scene.lines} areas={scene.areas} className="h-[460px] border"
              selectedId={null} onSelect={id => { if (id) { setSelectedId(id.split("::")[0]); setEditorTab("features"); } }}
              emptyText="Switch a layer on to see it here in 3D" />
          </Suspense>
          <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
            {activeLayers.map(l => (
              <span key={l.id} className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-card/90 px-2.5 py-1 text-[11px] font-semibold shadow backdrop-blur">
                <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />{l.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"18px 16px 24px"}}>
        <div style={{maxWidth:1040,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:12}}>
            <div>
              <div style={{fontSize:12,fontWeight:800,color:G.textMuted,letterSpacing:"0.05em",textTransform:"uppercase"}}>{layers.length} Layer{layers.length!==1?"s":""}</div>
              <div style={{fontSize:13,color:G.textMid,marginTop:2}}>Manage custom map data, visibility, and feature forms.</div>
            </div>
            <button onClick={()=>setShowAddModal(true)} style={{display:"flex",alignItems:"center",gap:7,background:G.primary,color:"white",border:"none",borderRadius:999,padding:"10px 14px",fontSize:12,fontWeight:800,cursor:"pointer",boxShadow:"0 8px 20px rgba(31,106,59,0.18)",whiteSpace:"nowrap"}}>
              <Plus style={{width:14,height:14}} /> Add Layer
            </button>
          </div>

          {layers.length===0 && (
            <div style={{padding:"54px 20px",textAlign:"center",background:"white",border:`1px solid ${G.border}`,borderRadius:16,boxShadow:"0 1px 14px rgba(15,58,34,0.05)"}}>
              <div style={{width:58,height:58,borderRadius:18,background:G.primaryBg,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}>
                <Layers style={{width:25,height:25,color:G.primary}} />
              </div>
              <div style={{fontSize:15,fontWeight:800,color:G.text,marginBottom:6}}>No layers yet</div>
              <div style={{fontSize:13,color:G.textMuted,marginBottom:20}}>Add your first layer to start organizing Unity Park map data.</div>
              <button onClick={()=>setShowAddModal(true)} style={{background:G.primary,color:"white",border:"none",borderRadius:999,padding:"12px 18px",fontWeight:800,fontSize:13,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:8}}><Plus style={{width:14,height:14}} /> Add First Layer</button>
            </div>
          )}

          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {layers.map((layer)=>{
              const meta = LAYER_TYPES[layer.type];
              const MetaIcon = meta.icon as IconComponent;
              const isSelected = selectedId===layer.id;
              return (
                <div key={layer.id} style={{background:"white",border:`1px solid ${isSelected?layer.color+"55":G.border}`,borderRadius:16,overflow:"hidden",boxShadow:isSelected?"0 12px 28px rgba(15,58,34,0.10)":"0 1px 12px rgba(15,58,34,0.05)"}}>
                  <div onClick={()=>{setSelectedId(isSelected?null:layer.id);setEditorTab("features");}} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 14px",cursor:"pointer",background:isSelected?G.primaryBg:"white",transition:"background 0.12s"}}>
                    <div style={{width:44,height:44,borderRadius:14,background:isSelected?layer.color+"18":meta.bg,border:`1.5px solid ${isSelected?layer.color+"55":"transparent"}`,display:"flex",alignItems:"center",justifyContent:"center",color:meta.color,flexShrink:0}}>
                      <MetaIcon style={{width:20,height:20}} />
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:800,color:isSelected?G.primary:G.text,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{layer.name}</div>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontSize:11,color:meta.color,background:meta.bg,padding:"3px 7px",borderRadius:999,fontWeight:800}}>{meta.label}</span>
                        <span style={{fontSize:11,color:G.textMuted}}>{layer.features.length} feature{layer.features.length!==1?"s":""}</span>
                      </div>
                    </div>
                    <Toggle on={layer.visible} onChange={()=>toggleVisible(layer.id)} color={layer.color}/>
                    {isSelected ? <ChevronUp style={{width:16,height:16,color:G.textMuted}} /> : <ChevronDown style={{width:16,height:16,color:G.textMuted}} />}
                  </div>

                  {isSelected && selected && (
                    <div style={{background:G.surfaceAlt,borderTop:`1px solid ${G.border}`}}>
                      <div style={{display:"flex",gap:6,padding:"12px 14px",borderBottom:`1px solid ${G.border}`,alignItems:"center"}}>
                        {(["features","settings"] as const).map(t=>(
                          <button key={t} onClick={()=>setEditorTab(t)} style={{fontSize:12,fontWeight:800,padding:"8px 12px",borderRadius:999,border:"none",cursor:"pointer",textTransform:"capitalize",background:editorTab===t?G.primary:"white",color:editorTab===t?"white":G.textMuted,display:"flex",alignItems:"center",gap:6,boxShadow:editorTab===t?"none":"0 1px 5px rgba(15,58,34,0.05)"}}>
                            {t==="features" ? <Route style={{width:13,height:13}} /> : <Settings style={{width:13,height:13}} />} {t}
                          </button>
                        ))}
                        <div style={{flex:1}}/>
                        <button onClick={e=>{e.stopPropagation();if(window.confirm(`Delete "${layer.name}"?`))deleteLayer(layer.id);}} style={{fontSize:12,fontWeight:800,padding:"8px 10px",borderRadius:999,border:"none",cursor:"pointer",background:G.dangerBg,color:G.danger,display:"flex",alignItems:"center",gap:6}}><Trash2 style={{width:13,height:13}} /> Delete</button>
                      </div>

                      <div style={{padding:"14px"}}>
                        {editorTab==="features" ? (
                          <FeatureEditor layer={selected} onChange={updateLayer}/>
                        ) : (
                          <div style={{display:"flex",flexDirection:"column",gap:14}}>
                            <Field label="Layer name"><input style={inp} value={selected.name} onChange={e=>updateLayer({...selected,name:e.target.value})}/></Field>
                            <div>
                              <label style={lbl}>Color</label>
                              <div style={{display:"flex",alignItems:"center",gap:10}}>
                                <input type="color" value={selected.color} onChange={e=>updateLayer({...selected,color:e.target.value})} style={{width:48,height:42,border:`1.5px solid ${G.border}`,borderRadius:12,cursor:"pointer",padding:3,background:"white"}}/>
                                <input style={{...inp,fontFamily:"monospace",flex:1}} value={selected.color} onChange={e=>updateLayer({...selected,color:e.target.value})} placeholder="#000000"/>
                                <div style={{width:42,height:42,borderRadius:12,background:selected.color,border:"1.5px solid rgba(0,0,0,0.08)",flexShrink:0}}/>
                              </div>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:12,padding:"13px 14px",background:"white",borderRadius:14,border:`1.5px solid ${G.border}`}}>
                              <div style={{width:36,height:36,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",background:selected.visible?selected.color+"18":"#f3f4f6",color:selected.visible?selected.color:G.textMuted}}>
                                {selected.visible ? <Eye style={{width:17,height:17}} /> : <EyeOff style={{width:17,height:17}} />}
                              </div>
                              <div style={{flex:1}}>
                                <div style={{fontSize:13,fontWeight:800,color:G.text}}>Visibility</div>
                                <div style={{fontSize:11,color:G.textMuted}}>Show this layer on the map preview</div>
                              </div>
                              <Toggle on={selected.visible} onChange={()=>toggleVisible(selected.id)} color={selected.color}/>
                            </div>
                            <div style={{padding:"13px 14px",background:G.primaryBg,borderRadius:14,border:`1.5px solid ${G.primaryBorder}`}}>
                              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,color:G.primaryMid}}>
                                <MetaIcon style={{width:17,height:17}} />
                                <span style={{fontSize:13,fontWeight:800}}>Type: {meta.label}</span>
                              </div>
                              <div style={{fontSize:11,color:G.textMid}}>Layer type is fixed at creation. All features inherit this type rendering on the map.</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {showAddModal && <AddLayerModal onClose={()=>setShowAddModal(false)} onAdd={addLayer}/>}
      {showExport && <ExportModal layers={layers} onClose={()=>setShowExport(false)}/>}
    </div>
  );
}
function StatBadge({ icon: Icon, label, value, accent }: {icon:IconComponent;label:string;value:number;accent?:boolean}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:7,background:"rgba(255,255,255,0.09)",border:"1px solid rgba(255,255,255,0.10)",borderRadius:999,padding:"7px 10px",whiteSpace:"nowrap"}}>
      <Icon style={{width:14,height:14,color:accent?G.accent:"rgba(255,255,255,0.72)"}} />
      <span style={{fontSize:12,color:accent?G.accent:"rgba(255,255,255,0.72)",fontWeight:700}}>{value} {label}</span>
    </div>
  );
}


