import React, { useMemo } from 'react';
import type { GeoCoord } from './geo/GeoTypes';
import type {
  CustomLayer,
  StoresLayer,
  RoutesLayer,
  BuildingsLayer,
  ParkingLayer,
  EntrancesLayer,
  EventsLayer,
  NavPathsLayer,
} from './customLayers';

interface Projector {
  project: (p: GeoCoord) => { x: number; y: number };
}

interface CustomLayerRendererProps {
  layers: CustomLayer[];
  projector: Projector;
  /** SVG viewBox size (square) */
  size?: number;
}

// ─── Store Pins ───────────────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  retail: '#7c3aed', food: '#f59e0b', culture: '#2563eb', default: '#6b7280',
};

function StoreLayer({ layer, project }: { layer: StoresLayer; project: Projector['project'] }) {
  return (
    <g id="layer-stores">
      {layer.features.map(store => {
        const { x, y } = project({ lat: store.lat, lng: store.lng });
        const dot = CAT_COLORS[store.category] ?? CAT_COLORS.default;
        return (
          <g key={store.id} transform={`translate(${x} ${y})`}>
            {/* Pin shadow */}
            <ellipse cx={0} cy={14} rx={5} ry={2.5} fill="rgba(0,0,0,0.18)" />
            {/* Pin body */}
            <path
              d="M0,-22 C-8,-22 -12,-16 -12,-10 C-12,0 0,14 0,14 C0,14 12,0 12,-10 C12,-16 8,-22 0,-22 Z"
              fill={store.isOpen ? layer.color : '#9ca3af'}
              stroke="white"
              strokeWidth={2}
            />
            {/* Category dot */}
            <circle cx={0} cy={-10} r={5} fill="white" />
            <circle cx={0} cy={-10} r={3} fill={store.isOpen ? dot : '#9ca3af'} />
            {/* Closed indicator */}
            {!store.isOpen && (
              <text x={0} y={4} textAnchor="middle" fontSize={6} fill="white" fontWeight={700}>✕</text>
            )}
            {/* Name label */}
            <g transform="translate(0 17)">
              <rect x={-28} y={0} width={56} height={13} rx={4} fill="white" opacity={0.92} />
              <text x={0} y={9.5} textAnchor="middle" fontSize={7.5} fontWeight={700}
                fill={store.isOpen ? '#1f2937' : '#9ca3af'}
                style={{ fontFamily: 'system-ui, sans-serif' }}>
                {store.name.length > 11 ? store.name.slice(0, 10) + '…' : store.name}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}

// ─── Route Polylines ──────────────────────────────────────────────────────────
const ROUTE_DASH: Record<string, string> = {
  delivery: '10 5', nav: '6 3', service: '4 8',
};

function RouteLayer({ layer, project }: { layer: RoutesLayer; project: Projector['project'] }) {
  return (
    <g id="layer-routes">
      <defs>
        <marker id="routeArrowCustom" markerWidth="6" markerHeight="6"
          refX="3" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 Z" fill={layer.color} opacity={0.85} />
        </marker>
      </defs>
      {layer.features.map(route => {
        const pts = route.waypoints.map(p => project(p));
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        return (
          <g key={route.id}>
            {/* Glow / halo */}
            <path d={d} fill="none" stroke={layer.color} strokeWidth={8}
              strokeDasharray={ROUTE_DASH[route.mode]} opacity={0.15}
              strokeLinecap="round" strokeLinejoin="round" />
            {/* Main line */}
            <path d={d} fill="none" stroke={layer.color}
              strokeWidth={route.isActive ? 4 : 2.5}
              strokeDasharray={ROUTE_DASH[route.mode]}
              strokeLinecap="round" strokeLinejoin="round"
              markerMid="url(#routeArrowCustom)"
              markerEnd="url(#routeArrowCustom)"
              opacity={route.isActive ? 1 : 0.55}>
              {route.isActive && (
                <animate attributeName="stroke-dashoffset"
                  from="0" to="-30" dur="1.2s" repeatCount="indefinite" />
              )}
            </path>
            {/* Route name at midpoint */}
            {(() => {
              const mid = pts[Math.floor(pts.length / 2)];
              return (
                <g transform={`translate(${mid.x} ${mid.y - 14})`}>
                  <rect x={-30} y={-9} width={60} height={13} rx={5}
                    fill={layer.color} opacity={0.9} />
                  <text x={0} y={0} textAnchor="middle" dominantBaseline="central"
                    fontSize={7} fontWeight={700} fill="white"
                    style={{ fontFamily: 'system-ui, sans-serif' }}>
                    {route.name}
                  </text>
                </g>
              );
            })()}
          </g>
        );
      })}
    </g>
  );
}

// ─── Building Polygons ────────────────────────────────────────────────────────
const USE_FILL: Record<string, string> = {
  commercial: '#dbeafe', civic: '#e0e7ff', cultural: '#fce7f3', utility: '#f3f4f6',
};

function BuildingsLayer_({ layer, project }: { layer: BuildingsLayer; project: Projector['project'] }) {
  return (
    <g id="layer-buildings">
      {layer.features.map(bld => {
        const pts = bld.polygon.map(p => project(p));
        const poly = pts.map(p => `${p.x},${p.y}`).join(' ');
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        return (
          <g key={bld.id}>
            <polygon points={poly}
              fill={USE_FILL[bld.use] ?? '#f3f4f6'}
              stroke={layer.color} strokeWidth={2.5}
              opacity={0.82} />
            {/* Floors badge */}
            <g transform={`translate(${cx} ${cy})`}>
              <rect x={-20} y={-18} width={40} height={12} rx={4} fill={layer.color} opacity={0.9} />
              <text x={0} y={-10} textAnchor="middle" dominantBaseline="central"
                fontSize={7} fontWeight={700} fill="white"
                style={{ fontFamily: 'system-ui, sans-serif' }}>
                {bld.name.slice(0, 14)}
              </text>
              {/* Floor count dot */}
              <circle cx={0} cy={4} r={9} fill="white" stroke={layer.color} strokeWidth={1.5} />
              <text x={0} y={4} textAnchor="middle" dominantBaseline="central"
                fontSize={7} fontWeight={800} fill={layer.color}
                style={{ fontFamily: 'system-ui, sans-serif' }}>
                {bld.floors}F
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}

// ─── Parking Zones ────────────────────────────────────────────────────────────
function ParkingLayerRenderer({ layer, project }: { layer: ParkingLayer; project: Projector['project'] }) {
  return (
    <g id="layer-parking">
      {layer.features.map(zone => {
        const pts = zone.polygon.map(p => project(p));
        const poly = pts.map(p => `${p.x},${p.y}`).join(' ');
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const fillColor = zone.type === 'vip' ? '#fef3c7' : '#e0f2fe';
        const strokeColor = zone.type === 'vip' ? '#d97706' : layer.color;
        const avail = zone.available;
        const pct = avail != null ? Math.round((avail / zone.capacity) * 100) : null;
        const availColor = pct == null ? '#6b7280' : pct > 40 ? '#16a34a' : pct > 15 ? '#d97706' : '#dc2626';
        return (
          <g key={zone.id}>
            <polygon points={poly} fill={fillColor} stroke={strokeColor}
              strokeWidth={2} strokeDasharray={zone.type === 'vip' ? '6 3' : 'none'} opacity={0.75} />
            {/* P badge */}
            <g transform={`translate(${cx} ${cy})`}>
              <circle r={14} fill={strokeColor} opacity={0.95} />
              <text x={0} y={1} textAnchor="middle" dominantBaseline="central"
                fontSize={13} fontWeight={900} fill="white"
                style={{ fontFamily: 'system-ui, sans-serif' }}>P</text>
            </g>
            {/* Availability pill */}
            {avail != null && (
              <g transform={`translate(${cx} ${cy + 22})`}>
                <rect x={-22} y={-8} width={44} height={14} rx={6}
                  fill="white" stroke={availColor} strokeWidth={1.5} />
                <text x={0} y={0} textAnchor="middle" dominantBaseline="central"
                  fontSize={7.5} fontWeight={700} fill={availColor}
                  style={{ fontFamily: 'system-ui, sans-serif' }}>
                  {avail}/{zone.capacity}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

// ─── Entrance Markers ─────────────────────────────────────────────────────────
function EntrancesLayerRenderer({ layer, project }: { layer: EntrancesLayer; project: Projector['project'] }) {
  return (
    <g id="layer-entrances">
      {layer.features.map(ent => {
        const { x, y } = project({ lat: ent.lat, lng: ent.lng });
        const color = ent.isMainEntrance ? '#16a34a' : layer.color;
        const size = ent.isMainEntrance ? 14 : 10;
        return (
          <g key={ent.id} transform={`translate(${x} ${y})`}>
            {/* Glow ring for main entrance */}
            {ent.isMainEntrance && (
              <circle r={20} fill={color} opacity={0.12}>
                <animate attributeName="r" values="16;24;16" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.15;0;0.15" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
            {/* Hexagonal badge */}
            <circle r={size} fill={color} stroke="white" strokeWidth={2} />
            {/* Door icon — simplified SVG path */}
            <g transform={`translate(${-size * 0.4} ${-size * 0.5}) scale(${size * 0.09})`}>
              <rect x={1} y={0} width={7} height={10} rx={1} fill="none" stroke="white" strokeWidth={1.8} />
              <circle cx={7} cy={5} r={0.8} fill="white" />
            </g>
            {/* Accessibility icon overlay */}
            {ent.isAccessible && (
              <g transform={`translate(${size - 4} ${-size + 4})`}>
                <circle r={5} fill="#2563eb" stroke="white" strokeWidth={1} />
                <text x={0} y={0.5} textAnchor="middle" dominantBaseline="central"
                  fontSize={5} fill="white" fontWeight={700}>♿</text>
              </g>
            )}
            {/* Label */}
            <g transform="translate(0 18)">
              <rect x={-30} y={-7} width={60} height={12} rx={4}
                fill={ent.isMainEntrance ? color : 'white'}
                stroke={color} strokeWidth={ent.isMainEntrance ? 0 : 1}
                opacity={0.92} />
              <text x={0} y={0} textAnchor="middle" dominantBaseline="central"
                fontSize={7} fontWeight={700}
                fill={ent.isMainEntrance ? 'white' : '#1f2937'}
                style={{ fontFamily: 'system-ui, sans-serif' }}>
                {ent.name}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}

// ─── Event Beacons ────────────────────────────────────────────────────────────
const EVT_EMOJI: Record<string, string> = {
  performance: '🎭', exhibit: '🖼', food: '🍽', sport: '⚽', workshop: '🎓',
};

function EventsLayerRenderer({ layer, project }: { layer: EventsLayer; project: Projector['project'] }) {
  return (
    <g id="layer-events">
      {layer.features.map(evt => {
        const { x, y } = project({ lat: evt.lat, lng: evt.lng });
        const color = evt.isLive ? '#dc2626' : '#f97316';
        const emoji = EVT_EMOJI[evt.category] ?? '📍';

        // Format time
        const start = new Date(evt.startTime);
        const end = new Date(evt.endTime);
        const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const timeLabel = `${fmt(start)} – ${fmt(end)}`;

        return (
          <g key={evt.id} transform={`translate(${x} ${y})`}>
            {/* Ripple rings */}
            {evt.isLive && [0, 1, 2].map(i => (
              <circle key={i} r={14 + i * 10} fill="none" stroke={color}
                strokeWidth={2} opacity={0}>
                <animate attributeName="r" values={`${14 + i * 10};${30 + i * 10};${14 + i * 10}`}
                  dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5"
                  dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" />
              </circle>
            ))}
            {/* Badge circle */}
            <circle r={14} fill={color} stroke="white" strokeWidth={2.5} />
            {/* Emoji */}
            <text x={0} y={1} textAnchor="middle" dominantBaseline="central" fontSize={11}>{emoji}</text>
            {/* LIVE badge */}
            {evt.isLive && (
              <g transform="translate(10 -12)">
                <rect x={-10} y={-6} width={20} height={10} rx={4} fill="#dc2626" />
                <text x={0} y={0} textAnchor="middle" dominantBaseline="central"
                  fontSize={6} fontWeight={900} fill="white"
                  style={{ fontFamily: 'system-ui, sans-serif', letterSpacing: '0.05em' }}>
                  LIVE
                </text>
              </g>
            )}
            {/* Name + time bubble */}
            <g transform="translate(0 -30)">
              <rect x={-38} y={-18} width={76} height={22} rx={6}
                fill="white" stroke={color} strokeWidth={1.5}
                style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.12))' }} />
              <text x={0} y={-9} textAnchor="middle" dominantBaseline="central"
                fontSize={7.5} fontWeight={700} fill="#111827"
                style={{ fontFamily: 'system-ui, sans-serif' }}>
                {evt.name.length > 14 ? evt.name.slice(0, 13) + '…' : evt.name}
              </text>
              <text x={0} y={-1} textAnchor="middle" dominantBaseline="central"
                fontSize={6} fill="#6b7280"
                style={{ fontFamily: 'system-ui, sans-serif' }}>
                {timeLabel}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}

// ─── Navigation Paths ─────────────────────────────────────────────────────────
const DIFF_COLOR: Record<string, string> = {
  easy: '#16a34a', moderate: '#d97706', hard: '#dc2626',
};

function NavPathsLayerRenderer({ layer, project }: { layer: NavPathsLayer; project: Projector['project'] }) {
  return (
    <g id="layer-navpaths">
      <defs>
        <marker id="navArrow" markerWidth="8" markerHeight="8"
          refX="4" refY="4" orient="auto">
          <path d="M0,1 L0,7 L7,4 Z" fill={layer.color} opacity={0.7} />
        </marker>
      </defs>
      {layer.features.map(path => {
        const pts = path.waypoints.map(p => project(p));
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        const color = DIFF_COLOR[path.difficulty] ?? layer.color;
        const mid = pts[Math.floor(pts.length / 2)];
        const distLabel = path.distanceM >= 1000
          ? `${(path.distanceM / 1000).toFixed(1)}km`
          : `${path.distanceM}m`;

        return (
          <g key={path.id}>
            {/* Shadow / halo */}
            <path d={d} fill="none" stroke={color} strokeWidth={10}
              strokeLinecap="round" strokeLinejoin="round" opacity={0.08} />
            {/* Main path */}
            <path d={d} fill="none" stroke={color} strokeWidth={4}
              strokeDasharray="12 6"
              strokeLinecap="round" strokeLinejoin="round"
              markerMid="url(#navArrow)"
              markerEnd="url(#navArrow)"
              opacity={0.85}>
              <animate attributeName="stroke-dashoffset"
                from="0" to="-36" dur="1.5s" repeatCount="indefinite" />
            </path>
            {/* Start dot */}
            <circle cx={pts[0].x} cy={pts[0].y} r={6}
              fill={color} stroke="white" strokeWidth={2} />
            {/* End dot */}
            <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={5}
              fill="white" stroke={color} strokeWidth={2.5} />
            {/* Midpoint label pill */}
            <g transform={`translate(${mid.x} ${mid.y - 16})`}>
              <rect x={-32} y={-9} width={64} height={14} rx={5}
                fill="white" stroke={color} strokeWidth={1.5}
                style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.1))' }} />
              <text x={-8} y={0} textAnchor="middle" dominantBaseline="central"
                fontSize={6.5} fontWeight={700} fill="#1f2937"
                style={{ fontFamily: 'system-ui, sans-serif' }}>
                {path.name.length > 12 ? path.name.slice(0, 11) + '…' : path.name}
              </text>
              <text x={20} y={0} textAnchor="middle" dominantBaseline="central"
                fontSize={6.5} fontWeight={700} fill={color}
                style={{ fontFamily: 'system-ui, sans-serif' }}>
                {distLabel}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}

// ─── Main renderer ────────────────────────────────────────────────────────────
const CustomLayerRenderer: React.FC<CustomLayerRendererProps> = ({ layers, projector }) => {
  const visibleLayers = useMemo(() => layers.filter(l => l.visible), [layers]);

  if (visibleLayers.length === 0) return null;

  return (
    <g id="custom-layers">
      {visibleLayers.map(layer => {
        switch (layer.type) {
          case 'stores':
            return <StoreLayer key={layer.id} layer={layer as StoresLayer} project={projector.project} />;
          case 'routes':
            return <RouteLayer key={layer.id} layer={layer as RoutesLayer} project={projector.project} />;
          case 'buildings':
            return <BuildingsLayer_ key={layer.id} layer={layer as BuildingsLayer} project={projector.project} />;
          case 'parking':
            return <ParkingLayerRenderer key={layer.id} layer={layer as ParkingLayer} project={projector.project} />;
          case 'entrances':
            return <EntrancesLayerRenderer key={layer.id} layer={layer as EntrancesLayer} project={projector.project} />;
          case 'events':
            return <EventsLayerRenderer key={layer.id} layer={layer as EventsLayer} project={projector.project} />;
          case 'navpaths':
            return <NavPathsLayerRenderer key={layer.id} layer={layer as NavPathsLayer} project={projector.project} />;
          default:
            return null;
        }
      })}
    </g>
  );
};

export default CustomLayerRenderer;