/**
 * MapLayersPanel — Mobile bottom-sheet, fully redesigned.
 *
 * What's improved vs the previous version:
 *   - Map Type switcher uses real OSM tile thumbnails (not SVG swatches)
 *   - Image upload tile in Map Type section → custom image overlay layer
 *   - Layer rows have colored left-accent bars, richer icon containers,
 *     live indicator dots for safety layers, and a count badge per group
 *   - Group headers carry a subtle icon + active-layer tally
 *   - Toggle uses an iOS-style pill instead of a plain checkbox
 *   - Custom layers show color swatch + feature count
 *   - Micro-mobility group gets an inline horizontal chip row (no divider)
 *   - Overall spacing tightened so more fits on smaller phones
 */
import React, { useRef, useState } from 'react';
import { motion, AnimatePresence, PanInfo, useMotionValue, useTransform } from 'framer-motion';
import {
  X, Bike, ParkingCircle, DoorOpen, Baby, AlertTriangle,
  Flame, Camera, Store, Truck, Building2, ParkingSquare,
  DoorClosed, CalendarDays, Route, Layers, ImagePlus,
  Navigation, ShieldAlert, Compass,
  BrickWall, LayoutGrid, Armchair, Tag, Layers3, Trees,
} from 'lucide-react';
import type { CustomLayer } from '@/lib/customLayers';
import type { MapStyleId } from '@/lib/mapStyles';
import MapTypeSwitcher, { type CustomImageLayer } from './MapTypeSwitcher';

const BRAND = 'hsl(152 68% 22%)';

// ─── Built-in layer definitions ───────────────────────────────────────────────
export interface MapLayer {
  id: string;
  label: string;
  group: 'move' | 'safety' | 'discover';
  Icon: React.FC<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  description?: string;
}

export const MAP_LAYERS: MapLayer[] = [
  {
    id: 'micro-mobility',
    label: 'Micro-Mobility',
    group: 'move',
    Icon: Bike,
    color: '#0ea5e9',
    description: 'Bikes & scooters',
  },
  {
    id: 'parking',
    label: 'Parking',
    group: 'move',
    Icon: ParkingCircle,
    color: '#6366f1',
    description: 'Lots & garages',
  },
  {
    id: 'entrances',
    label: 'Entrances & Gates',
    group: 'move',
    Icon: DoorOpen,
    color: '#f59e0b',
    description: 'All entry points',
  },
  {
    id: 'lost-child',
    label: 'Lost Child Zones',
    group: 'safety',
    Icon: Baby,
    color: '#ec4899',
    description: 'Safe meeting points',
  },
  {
    id: 'evacuation',
    label: 'Evacuation Routes',
    group: 'safety',
    Icon: AlertTriangle,
    color: '#ef4444',
    description: 'Emergency exits',
  },
  {
    id: 'crowd-heatmap',
    label: 'Crowd Heatmap',
    group: 'discover',
    Icon: Flame,
    color: '#f97316',
    description: 'Real-time density',
  },
  {
    id: 'photo-spots',
    label: 'Photo Spots',
    group: 'discover',
    Icon: Camera,
    color: '#8b5cf6',
    description: 'Best viewpoints',
  },
];

const GROUP_META: Record<
  'move' | 'safety' | 'discover',
  { label: string; Icon: React.FC<{ className?: string; style?: React.CSSProperties }> }
> = {
  move:     { label: 'Getting Around', Icon: Navigation },
  safety:   { label: 'Safety',          Icon: ShieldAlert },
  discover: { label: 'Discover',        Icon: Compass },
};

// ─── Indoor map layer icons (a venue's own 3D / 2D map) ───────────────────────
const INDOOR_LAYER_ICONS: Record<string, React.FC<{ className?: string; style?: React.CSSProperties }>> = {
  walls: BrickWall, rooms: LayoutGrid, objects: Armchair, labels: Tag, paths: Route, otherFloors: Layers3, scenery: Trees,
};

// ─── Custom layer icon map ────────────────────────────────────────────────────
const CUSTOM_LAYER_ICONS: Record<string, React.FC<{ className?: string }>> = {
  'layer-stores':    Store,
  'layer-routes':    Truck,
  'layer-buildings': Building2,
  'layer-parking':   ParkingSquare,
  'layer-entrances': DoorClosed,
  'layer-events':    CalendarDays,
  'layer-navpaths':  Route,
};

// ─── iOS-style toggle pill ───────────────────────────────────────────────────
const TogglePill: React.FC<{ active: boolean; color: string }> = ({ active, color }) => (
  <div
    className="relative flex-shrink-0 transition-all duration-200"
    style={{
      width: 44,
      height: 26,
      borderRadius: 13,
      background: active ? color : '#e0e0e0',
    }}
  >
    <div
      className="absolute top-[3px] transition-all duration-200"
      style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: 'white',
        boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
        left: active ? 21 : 3,
      }}
    />
  </div>
);

// ─── Layer row ────────────────────────────────────────────────────────────────
const LayerRow: React.FC<{
  id: string;
  label: string;
  description?: string;
  Icon: React.FC<{ className?: string; style?: React.CSSProperties }>;
  active: boolean;
  color: string;
  onToggle: () => void;
  badge?: React.ReactNode;
  isLast?: boolean;
  isLive?: boolean;
}> = ({ id, label, description, Icon, active, color, onToggle, badge, isLast, isLive }) => (
  <button
    key={id}
    onClick={onToggle}
    className="w-full flex items-center gap-3.5 pr-4 transition-colors active:bg-gray-50/80"
    style={{
      minHeight: 60,
      paddingLeft: 16,
      borderBottom: isLast ? 'none' : '1px solid #f2f2f2',
    }}
  >
    {/* Color accent bar */}
    <div
      className="self-stretch w-[3px] flex-shrink-0 rounded-full my-2 transition-all duration-200"
      style={{ background: active ? color : 'transparent' }}
    />

    {/* Icon container */}
    <div
      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200"
      style={
        active
          ? { background: color + '18', border: `1.5px solid ${color}40` }
          : { background: '#f5f5f5', border: '1.5px solid #ebebeb' }
      }
    >
      <Icon className="w-[18px] h-[18px]" style={{ color: active ? color : '#9ca3af' }} />
    </div>

    {/* Text block */}
    <div className="flex-1 text-left min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-[14.5px] font-semibold text-gray-800 leading-snug">{label}</span>
        {isLive && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none flex items-center gap-1"
            style={{ background: '#fee2e2', color: '#ef4444' }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"
            />
            LIVE
          </span>
        )}
        {badge}
      </div>
      {description && (
        <span className="text-[12px] text-gray-400 leading-none">{description}</span>
      )}
    </div>

    {/* Toggle */}
    <TogglePill active={active} color={color} />
  </button>
);

// ─── Group header ─────────────────────────────────────────────────────────────
const GroupHeader: React.FC<{
  group: 'move' | 'safety' | 'discover';
  activeCount: number;
}> = ({ group, activeCount }) => {
  const { label, Icon } = GROUP_META[group];
  return (
    <div className="flex items-center gap-2 px-5 pt-5 pb-2.5">
      <Icon className="w-3.5 h-3.5" style={{ color: '#9ca3af' }} />
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest flex-1">
        {label}
      </p>
      {activeCount > 0 && (
        <span
          className="text-[9px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: BRAND + '18', color: BRAND }}
        >
          {activeCount} on
        </span>
      )}
    </div>
  );
};

// ─── Component props ──────────────────────────────────────────────────────────
interface MapLayersPanelProps {
  open: boolean;
  activeLayers: Set<string>;
  onToggle: (id: string) => void;
  onClose: () => void;
  customLayers?: CustomLayer[];
  onToggleCustomLayer?: (id: string) => void;
  mapStyleId?: MapStyleId;
  onMapStyleChange?: (id: MapStyleId) => void;
  /** Custom image layers (uploaded by user) */
  customImageLayers?: CustomImageLayer[];
  onAddImageLayer?: (layer: CustomImageLayer) => void;
  activeImageLayerId?: string | null;
  onSelectImageLayer?: (id: string | null) => void;
  /** A venue's indoor map details (walls, rooms, 3D objects…), defaults set by the institution. */
  indoorLayers?: { id: string; label: string; description: string; color: string; on: boolean }[];
  onToggleIndoorLayer?: (id: string) => void;
}

// ─── Main panel ───────────────────────────────────────────────────────────────
const MapLayersPanel: React.FC<MapLayersPanelProps> = ({
  open,
  activeLayers,
  onToggle,
  onClose,
  customLayers = [],
  onToggleCustomLayer,
  mapStyleId = 'standard',
  onMapStyleChange,
  customImageLayers = [],
  onAddImageLayer,
  activeImageLayerId = null,
  onSelectImageLayer,
  indoorLayers,
  onToggleIndoorLayer,
}) => {
  const y = useMotionValue(0);
  const backdropOpacity = useTransform(y, [0, 300], [1, 0]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const grouped = MAP_LAYERS.reduce<Record<string, MapLayer[]>>((acc, l) => {
    if (!acc[l.group]) acc[l.group] = [];
    acc[l.group].push(l);
    return acc;
  }, {});

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > 80 || info.velocity.y > 500) onClose();
  }

  const totalActive = activeLayers.size;
  const activeCustomCount = customLayers.filter((l) => l.visible).length;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            style={{ opacity: backdropOpacity }}
            className="fixed inset-0 z-40 bg-black/40"
            onClick={onClose}
          />

          {/* Bottom sheet */}
          <motion.div
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.25 }}
            onDragEnd={handleDragEnd}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-white flex flex-col lg:bottom-auto lg:left-auto lg:right-4 lg:top-20 lg:w-[360px] lg:rounded-[24px]"
            onPointerDownCapture={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            aria-modal="true"
            role="dialog"
            aria-label="Map Layers"
            style={{
              y,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              boxShadow: '0 -8px 48px -4px rgba(0,0,0,0.22)',
              maxHeight: '82dvh',
              paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)',
              touchAction: 'none',
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing">
              <div className="w-10 h-[5px] rounded-full bg-gray-200" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-2 pb-3 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: BRAND + '16' }}
                >
                  <Layers className="w-[18px] h-[18px]" style={{ color: BRAND }} />
                </div>
                <div>
                  <span className="text-[17px] font-bold text-gray-900 tracking-tight block leading-tight">
                    Map Layers
                  </span>
                  <span className="text-[12px] text-gray-400 leading-none">
                    {totalActive > 0
                      ? `${totalActive} layer${totalActive > 1 ? 's' : ''} active`
                      : 'All layers off'}
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: '#f0f0f0' }}
                aria-label="Close"
              >
                <X className="w-4 h-4 text-gray-500" strokeWidth={2.5} />
              </button>
            </div>

            {/* Scrollable content */}
            <div
              ref={scrollRef}
              className="overflow-y-auto overscroll-contain flex-1"
              style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* ── Map type ── */}
              <div className="pt-1 pb-4">
                <div className="flex items-center gap-2 px-5 pb-3">
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                    Map Type
                  </p>
                  {(customImageLayers.length > 0 || activeImageLayerId) && (
                    <span
                      className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: BRAND + '18', color: BRAND }}
                    >
                      {customImageLayers.length} custom
                    </span>
                  )}
                </div>
                <MapTypeSwitcher
                  value={mapStyleId}
                  onChange={(id) => onMapStyleChange?.(id)}
                  customImageLayers={customImageLayers}
                  onAddImageLayer={onAddImageLayer}
                  activeImageLayerId={activeImageLayerId}
                  onSelectImageLayer={onSelectImageLayer}
                />
              </div>

              <div className="h-px bg-[#f0f0f0] mx-5" />

              {/* ── The venue's indoor map ── */}
              {indoorLayers && indoorLayers.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-5 pt-5 pb-2.5">
                    <Building2 className="w-3.5 h-3.5" style={{ color: '#9ca3af' }} />
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest flex-1">Indoor Map</p>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: BRAND + '18', color: BRAND }}>
                      {indoorLayers.filter(l => l.on).length} on
                    </span>
                  </div>
                  {indoorLayers.map((layer, idx, arr) => (
                    <LayerRow
                      key={layer.id}
                      id={layer.id}
                      label={layer.label}
                      description={layer.description}
                      Icon={INDOOR_LAYER_ICONS[layer.id] ?? Layers}
                      active={layer.on}
                      color={layer.color}
                      onToggle={() => onToggleIndoorLayer?.(layer.id)}
                      isLast={idx === arr.length - 1}
                    />
                  ))}
                  <div className="h-px bg-[#f0f0f0] mx-5 mt-1" />
                </>
              )}

              {/* ── Built-in layers by group ── */}
              {(['move', 'safety', 'discover'] as const).map((group) => {
                const layers = grouped[group] ?? [];
                const activeCount = layers.filter((l) => activeLayers.has(l.id)).length;
                return (
                  <div key={group}>
                    <GroupHeader group={group} activeCount={activeCount} />
                    {layers.map((layer, idx, arr) => (
                      <LayerRow
                        key={layer.id}
                        id={layer.id}
                        label={layer.label}
                        description={layer.description}
                        Icon={layer.Icon}
                        active={activeLayers.has(layer.id)}
                        color={layer.color}
                        onToggle={() => onToggle(layer.id)}
                        isLast={idx === arr.length - 1}
                        isLive={
                          layer.id === 'crowd-heatmap' && activeLayers.has(layer.id)
                        }
                      />
                    ))}
                    {group !== 'discover' && (
                      <div className="h-px bg-[#f0f0f0] mx-5 mt-1" />
                    )}
                  </div>
                );
              })}

              {/* ── Custom layers ── */}
              {customLayers.length > 0 && (
                <>
                  <div className="h-px bg-[#f0f0f0] mx-5 mt-1" />
                  <div className="flex items-center gap-2 px-5 pt-5 pb-2.5">
                    <Layers className="w-3.5 h-3.5 text-gray-400" />
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest flex-1">
                      Custom Layers
                    </p>
                    <span
                      className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: '#f3f4f6', color: '#6b7280' }}
                    >
                      {customLayers.length}
                    </span>
                    {activeCustomCount > 0 && (
                      <span
                        className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: BRAND + '18', color: BRAND }}
                      >
                        {activeCustomCount} on
                      </span>
                    )}
                  </div>

                  {customLayers.map((layer, idx) => {
                    const Icon = CUSTOM_LAYER_ICONS[layer.id] ?? Layers;
                    // Feature count badge
                    const featureCount =
                      'features' in layer ? (layer as { features: unknown[] }).features.length : 0;
                    return (
                      <LayerRow
                        key={layer.id}
                        id={layer.id}
                        label={layer.name}
                        description={featureCount > 0 ? `${featureCount} features` : undefined}
                        Icon={Icon}
                        active={layer.visible}
                        color={layer.color}
                        onToggle={() => onToggleCustomLayer?.(layer.id)}
                        isLast={idx === customLayers.length - 1}
                      />
                    );
                  })}
                </>
              )}

              {/* Bottom breathing room */}
              <div className="h-6" />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default MapLayersPanel;