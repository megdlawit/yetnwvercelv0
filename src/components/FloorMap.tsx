import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { Floor, NavNode, Room } from '@/data/types';
import { NavigationState } from '@/hooks/useNavigationSimulation';
import { NavSnapshot } from '@/lib/NavigationController';
import { POI } from '@/data/poi';
import BlueDot, { type BlueDotViewport } from './BlueDot';
import type { HybridPosition } from '@/lib/geo/HybridPositioningEngine';
import FloorPhotoPin from './FloorPhotoPin';
import { FloorIsoBlock, roomToBlock } from './FloorIsoBlock';
import { ISO, toIso, isoRectCorners } from './floorMapIso';

interface FloorMapProps {
  floor: Floor;
  path: NavNode[] | null;
  startNodeId: string | null;
  endNodeId: string | null;
  onRoomClick: (room: Room) => void;
  navState?: NavigationState & { heading?: number; isWalking?: boolean };
  navSnapshot?: NavSnapshot;
  hybridPosition?: HybridPosition | null;
  pois?: POI[];
  onPOIClick?: (poi: POI) => void;
  nearbyPoiIds?: Set<string>;
  selectedPoiId?: string | null;
  registerControls?: (controls: { zoomIn: () => void; zoomOut: () => void; recenter: () => void }) => void;
  /**
   * Fired once when the user zooms/pinches far enough out on the indoor
   * floor plan that they clearly want back out to the outdoor map. Mirrors
   * the outdoor map's zoom-to-enter gesture in reverse.
   */
  onZoomOutExit?: () => void;
  /** Building name shown in the "zoom out to exit" hint pill. */
  buildingName?: string;
}

const NODE_BLOCK = 72;

const FloorMap: React.FC<FloorMapProps> = ({
  floor, path, startNodeId, endNodeId, onRoomClick, navState, navSnapshot,
  pois = [], onPOIClick, nearbyPoiIds, selectedPoiId, hybridPosition, registerControls,
  onZoomOutExit, buildingName,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pad = 80;
  const [viewBox, setViewBox] = useState({
    x: -pad, y: -pad,
    w: floor.width * 1.42 + pad * 2,
    h: floor.height * 0.72 + pad * 2 + ISO.extrude,
  });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const pinchStateRef = useRef<{ distance: number; viewBox: typeof viewBox } | null>(null);

  const isLive = navState?.isNavigating || navState?.isPaused || navState?.isComplete;
  const hasRooms = floor.rooms.length > 0;

  const namedNodes = useMemo(() =>
    hasRooms ? [] : floor.nodes.filter(n => !n.isHallway && n.name),
    [floor.nodes, hasRooms],
  );

  const floorPOIs = useMemo(() => {
    const nodeMap = new Map(floor.nodes.map(n => [n.id, n]));
    return pois
      .map(p => ({ poi: p, node: nodeMap.get(p.nodeId) }))
      .filter((x): x is { poi: POI; node: NavNode } => !!x.node);
  }, [pois, floor.nodes]);

  const parkingNodes = useMemo(() =>
    floor.nodes.filter(n =>
      n.name?.toLowerCase().includes('entrance') ||
      n.name?.toLowerCase().includes('parking') ||
      (n as { type?: string }).type === 'entrance',
    ).slice(0, 4),
    [floor.nodes],
  );

  const resetViewBox = useCallback(() => ({
    x: -pad,
    y: -pad,
    w: floor.width * 1.42 + pad * 2,
    h: floor.height * 0.72 + pad * 2 + ISO.extrude,
  }), [floor.width, floor.height, pad]);

  const handleNodeClick = useCallback((node: NavNode) => {
    onRoomClick({
      id: node.id, floorId: node.floorId, name: node.name, nodeId: node.id,
      x: node.x - 30, y: node.y - 20, width: 60, height: 40, type: 'office',
    });
  }, [onRoomClick]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const s = e.deltaY > 0 ? 1.1 : 0.9;
    setViewBox(prev => {
      const cx = prev.x + prev.w / 2, cy = prev.y + prev.h / 2;
      return { x: cx - (prev.w * s) / 2, y: cy - (prev.h * s) / 2, w: prev.w * s, h: prev.h * s };
    });
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = ((e.clientX - panStart.x) / rect.width) * viewBox.w;
    const dy = ((e.clientY - panStart.y) / rect.height) * viewBox.h;
    setViewBox(prev => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
    setPanStart({ x: e.clientX, y: e.clientY });
  }, [isPanning, panStart, viewBox.w, viewBox.h]);

  const handlePointerUp = useCallback(() => setIsPanning(false), []);

  const zoomIn = useCallback(() => {
    setViewBox(prev => {
      const s = 0.8, cx = prev.x + prev.w / 2, cy = prev.y + prev.h / 2;
      return { x: cx - (prev.w * s) / 2, y: cy - (prev.h * s) / 2, w: prev.w * s, h: prev.h * s };
    });
  }, []);

  const zoomOut = useCallback(() => {
    setViewBox(prev => {
      const s = 1.2, cx = prev.x + prev.w / 2, cy = prev.y + prev.h / 2;
      return { x: cx - (prev.w * s) / 2, y: cy - (prev.h * s) / 2, w: prev.w * s, h: prev.h * s };
    });
  }, []);

  const resetView = useCallback(() => setViewBox(resetViewBox()), [resetViewBox]);

  // ── Zoom out far enough on the floor plan → treat it as "take me back
  // outside", mirroring the outdoor map's zoom-in-to-enter gesture. Needs a
  // short dwell past the threshold (not an instant trigger) so a single
  // enthusiastic scroll/pinch doesn't kick someone out of the building by
  // accident, and hysteresis (EXIT_RATIO vs a lower re-arm point) so it
  // doesn't fire repeatedly while hovering near the edge. ──────────────────
  const baseViewBoxW = floor.width * 1.42 + pad * 2;
  const EXIT_RATIO = 1.6;
  const zoomOutRatio = viewBox.w / baseViewBoxW;
  const zoomOutProgress = Math.max(0, Math.min(1, (zoomOutRatio - 1) / (EXIT_RATIO - 1)));
  const exitDwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitArmedRef = useRef(true);

  useEffect(() => {
    if (zoomOutRatio >= EXIT_RATIO && exitArmedRef.current) {
      if (!exitDwellTimer.current) {
        exitDwellTimer.current = setTimeout(() => {
          exitDwellTimer.current = null;
          exitArmedRef.current = false; // don't refire until re-armed below
          onZoomOutExit?.();
        }, 260);
      }
    } else if (exitDwellTimer.current) {
      clearTimeout(exitDwellTimer.current);
      exitDwellTimer.current = null;
    }
    // Re-arm once the user has zoomed back in a comfortable margin, so the
    // gesture works again next time they zoom out.
    if (zoomOutRatio < EXIT_RATIO * 0.85) exitArmedRef.current = true;
    return () => {
      if (exitDwellTimer.current) {
        clearTimeout(exitDwellTimer.current);
        exitDwellTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomOutRatio]);

  // Reset the gesture state whenever the floor changes underneath us.
  useEffect(() => {
    exitArmedRef.current = true;
    if (exitDwellTimer.current) { clearTimeout(exitDwellTimer.current); exitDwellTimer.current = null; }
  }, [floor.id]);

  const recenter = useCallback(() => {
    if (isLive && navState?.currentPosition) {
      const p = toIso(navState.currentPosition.x, navState.currentPosition.y, ISO.extrude);
      setViewBox(prev => ({ ...prev, x: p.x - prev.w / 2, y: p.y - prev.h / 2 }));
    } else {
      resetView();
    }
  }, [isLive, navState?.currentPosition, resetView]);

  useEffect(() => {
    registerControls?.({ zoomIn, zoomOut, recenter });
  }, [registerControls, zoomIn, zoomOut, recenter]);

  useEffect(() => {
    setViewBox(resetViewBox());
  }, [floor.id, resetViewBox]);

  const getTouchDistance = (touches: React.TouchList) => {
    const [t1, t2] = [touches[0], touches[1]];
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      setIsPanning(false);
      pinchStateRef.current = { distance: getTouchDistance(e.touches), viewBox };
    }
  }, [viewBox]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStateRef.current) {
      e.preventDefault();
      const newDistance = getTouchDistance(e.touches);
      const { distance: startDistance, viewBox: startViewBox } = pinchStateRef.current;
      if (startDistance === 0) return;
      const scale = startDistance / newDistance;
      const cx = startViewBox.x + startViewBox.w / 2;
      const cy = startViewBox.y + startViewBox.h / 2;
      const w = startViewBox.w * scale;
      const h = startViewBox.h * scale;
      setViewBox({ x: cx - w / 2, y: cy - h / 2, w, h });
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) pinchStateRef.current = null;
  }, []);

  const completedPath = isLive && path && navState ? path.slice(0, navState.currentNodeIndex + 1) : null;
  const remainingPath = isLive && path && navState ? path.slice(navState.currentNodeIndex) : null;
  const activePath = path;

  const isoLine = (nodes: NavNode[]) =>
    nodes.map(n => {
      const p = toIso(n.x, n.y, ISO.extrude + 1);
      return `${p.x},${p.y}`;
    }).join(' ');

  const isoViewport: BlueDotViewport = {
    projectIndoor: (x, y) => {
      const p = toIso(x, y, ISO.extrude + 2);
      return { cx: p.x, cy: p.y };
    },
    metersPerPixel: 0.05,
  };

  const mainCorridorY = useMemo(() => {
    const hallway = floor.nodes.filter(n => n.isHallway);
    if (hallway.length === 0) return floor.height * 0.45;
    return hallway.reduce((s, n) => s + n.y, 0) / hallway.length;
  }, [floor.nodes, floor.height]);

  const destNode = activePath && activePath.length > 0 ? activePath[activePath.length - 1] : null;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{ background: `linear-gradient(180deg, #d4e8f4 0%, #e8f2fa 40%, #f0ebe3 100%)` }}
    >
      <svg
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        preserveAspectRatio="xMidYMid meet"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ touchAction: 'none' }}
      >
        <defs>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ISO.skyTop} />
            <stop offset="100%" stopColor={ISO.skyBottom} />
          </linearGradient>
          <filter id="pinShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.22)" />
          </filter>
          <filter id="routeGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Sky + clouds */}
        <rect x={viewBox.x - 200} y={viewBox.y - 200} width={viewBox.w + 400} height={viewBox.h + 400} fill="url(#skyGrad)" />
        {[
          { cx: floor.width * 0.15, cy: floor.height * 0.05, rx: 48, ry: 16 },
          { cx: floor.width * 0.55, cy: floor.height * 0.02, rx: 62, ry: 18 },
          { cx: floor.width * 0.85, cy: floor.height * 0.08, rx: 40, ry: 14 },
        ].map((c, i) => {
          const p = toIso(c.cx, c.cy, 0);
          return <ellipse key={i} cx={p.x} cy={p.y - 40} rx={c.rx} ry={c.ry} fill={ISO.cloud} opacity={0.9} />;
        })}

        {/* Ground plate — warm parchment base (matches outdoor map aesthetic) */}
        {(() => {
          const g = isoRectCorners(-20, -10, floor.width + 40, floor.height + 30, 0);
          return (
            <path
              d={`M ${g[0].x} ${g[0].y} L ${g[1].x} ${g[1].y} L ${g[2].x} ${g[2].y} L ${g[3].x} ${g[3].y} Z`}
              fill="#f0ebe3"
              stroke="#e0d8cc"
              strokeWidth={1.5}
            />
          );
        })()}

        {/* Main corridor — warm cream artery matching the outdoor path style */}
        {(() => {
          const y = mainCorridorY;
          const a = toIso(10, y - 14, ISO.extrude);
          const b = toIso(floor.width - 10, y - 14, ISO.extrude);
          const c = toIso(floor.width - 10, y + 14, ISO.extrude);
          const d = toIso(10, y + 14, ISO.extrude);
          return (
            <>
              {/* Border */}
              <path
                d={`M ${toIso(10, y - 17, ISO.extrude).x} ${toIso(10, y - 17, ISO.extrude).y} L ${toIso(floor.width - 10, y - 17, ISO.extrude).x} ${toIso(floor.width - 10, y - 17, ISO.extrude).y} L ${toIso(floor.width - 10, y + 17, ISO.extrude).x} ${toIso(floor.width - 10, y + 17, ISO.extrude).y} L ${toIso(10, y + 17, ISO.extrude).x} ${toIso(10, y + 17, ISO.extrude).y} Z`}
                fill="#d0c8b8"
                opacity={0.7}
              />
              {/* Fill */}
              <path
                d={`M ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y} L ${d.x} ${d.y} Z`}
                fill="#e6ddd0"
                opacity={0.95}
              />
            </>
          );
        })()}

        {/* Walkable corridors from edges — cream paths matching outdoor style */}
        {/* Border pass first */}
        {floor.edges.map(edge => {
          const from = floor.nodes.find(n => n.id === edge.fromNodeId);
          const to = floor.nodes.find(n => n.id === edge.toNodeId);
          if (!from || !to) return null;
          const a = toIso(from.x, from.y, ISO.extrude + 0.5);
          const b = toIso(to.x, to.y, ISO.extrude + 0.5);
          return (
            <line
              key={`eb-${edge.id}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="#c8bfaf"
              strokeWidth={22}
              strokeLinecap="round"
              opacity={0.7}
            />
          );
        })}
        {/* Fill pass */}
        {floor.edges.map(edge => {
          const from = floor.nodes.find(n => n.id === edge.fromNodeId);
          const to = floor.nodes.find(n => n.id === edge.toNodeId);
          if (!from || !to) return null;
          const a = toIso(from.x, from.y, ISO.extrude + 0.5);
          const b = toIso(to.x, to.y, ISO.extrude + 0.5);
          return (
            <line
              key={`ef-${edge.id}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="#ede5d8"
              strokeWidth={18}
              strokeLinecap="round"
              opacity={0.98}
            />
          );
        })}

        {/* 3D blocks — rooms */}
        {hasRooms && floor.rooms.map(room => {
          const block = roomToBlock(room);
          const highlight = room.nodeId === startNodeId ? 'start' as const
            : room.nodeId === endNodeId ? 'end' as const
            : 'none' as const;
          return (
            <FloorIsoBlock
              key={room.id}
              {...block}
              highlight={highlight}
              onClick={() => onRoomClick(room)}
            />
          );
        })}

        {/* 3D blocks — cloud nodes without rooms */}
        {!hasRooms && namedNodes.map(node => {
          const isStart = node.id === startNodeId;
          const isEnd = node.id === endNodeId;
          const highlight = isStart ? 'start' as const : isEnd ? 'end' as const : 'none' as const;
          const bx = node.x - NODE_BLOCK / 2;
          const by = node.y - NODE_BLOCK / 2;
          return (
            <FloorIsoBlock
              key={node.id}
              x={bx}
              y={by}
              w={NODE_BLOCK}
              h={NODE_BLOCK}
              id={node.id}
              label={node.name}
              highlight={highlight}
              onClick={() => handleNodeClick(node)}
            />
          );
        })}

        {/* Parking diamonds */}
        {parkingNodes.map(node => {
          const p = toIso(node.x, node.y, ISO.extrude + 3);
          return (
            <g key={`park-${node.id}`}>
              <rect
                x={p.x - 9}
                y={p.y - 9}
                width={18}
                height={18}
                rx={2}
                fill={ISO.parking}
                stroke="white"
                strokeWidth={1.5}
                transform={`rotate(45 ${p.x} ${p.y})`}
              />
              <text
                x={p.x}
                y={p.y + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={9}
                fontWeight={800}
                fill="white"
                style={{ pointerEvents: 'none' }}
              >
                P
              </text>
            </g>
          );
        })}

        {/* Completed route */}
        {isLive && completedPath && completedPath.length > 1 && (
          <polyline
            points={isoLine(completedPath)}
            fill="none"
            stroke={ISO.routeDone}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.7}
          />
        )}

        {/* Active route — green dashed */}
        {isLive && remainingPath && remainingPath.length > 1 && (
          <>
            <polyline
              points={isoLine(remainingPath)}
              fill="none"
              stroke={ISO.routeGlow}
              strokeWidth={12}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#routeGlow)"
            />
            <polyline
              points={isoLine(remainingPath)}
              fill="none"
              stroke={ISO.route}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="10 7"
              opacity={0.95}
            >
              <animate attributeName="stroke-dashoffset" from="0" to="-17" dur="0.9s" repeatCount="indefinite" />
            </polyline>
          </>
        )}

        {/* Preview route when not navigating */}
        {!isLive && activePath && activePath.length > 1 && (
          <>
            <polyline
              points={isoLine(activePath)}
              fill="none"
              stroke={ISO.routeGlow}
              strokeWidth={10}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#routeGlow)"
            />
            <polyline
              points={isoLine(activePath)}
              fill="none"
              stroke={ISO.route}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="10 7"
              opacity={0.95}
            />
          </>
        )}

        {/* Destination teardrop pin */}
        {destNode && (
          <g transform={`translate(${toIso(destNode.x, destNode.y, ISO.extrude + 4).x} ${toIso(destNode.x, destNode.y, ISO.extrude + 4).y})`}>
            <ellipse cx={0} cy={14} rx={10} ry={3} fill="black" opacity={0.12} />
            <path
              d="M 0 -18 C 10 -18 16 -10 16 0 C 16 10 0 22 0 22 C 0 22 -16 10 -16 0 C -16 -10 -10 -18 0 -18 Z"
              fill={ISO.destPin}
              stroke="white"
              strokeWidth={2.5}
            />
            <circle r={5} fill="white" />
          </g>
        )}

        {/* Photo POI markers */}
        {floorPOIs.length > 0 && onPOIClick && floorPOIs.map(({ poi, node }) => (
          <FloorPhotoPin
            key={poi.id}
            poi={poi}
            node={node}
            onClick={onPOIClick}
            isNearby={nearbyPoiIds?.has(poi.id)}
            isSelected={selectedPoiId === poi.id}
          />
        ))}

        {/* User position */}
        {isLive && navState && (() => {
          const headingRad = (navState as NavigationState & { heading?: number }).heading;
          const headingDeg = headingRad != null ? (headingRad * 180 / Math.PI) : NaN;
          const pos: HybridPosition = hybridPosition ?? {
            lat: null, lng: null,
            x: navState.currentPosition.x,
            y: navState.currentPosition.y,
            floor: null,
            heading: headingDeg,
            accuracy: 2,
            environment: 'indoor',
            indoor: null,
            geo: null,
            accuracyM: 2,
            blending: false,
            source: 'pdr',
            timestamp: Date.now(),
          };
          return (
            <BlueDot
              position={pos}
              viewport={isoViewport}
              dotRadius={9}
              showCone={isFinite(headingDeg)}
              showAccuracy
              isWalking={(navState as NavigationState & { isWalking?: boolean }).isWalking ?? false}
            />
          );
        })()}
      </svg>

      {/* ── Zoom-out-to-exit hint — mirrors the outdoor map's tap/dwell-to-enter pill ── */}
      <AnimatePresence>
        {zoomOutProgress > 0.15 && onZoomOutExit && (
          <motion.div
            key="zoom-out-exit-hint"
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: Math.min(1, 0.35 + zoomOutProgress * 0.65), y: 0, scale: 0.94 + zoomOutProgress * 0.06 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="absolute z-30 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full pl-4 pr-3 py-2.5 shadow-xl pointer-events-none"
            style={{ top: 16, background: zoomOutProgress >= 0.99 ? 'hsl(152 70% 22%)' : 'rgba(20,20,20,0.72)' }}
          >
            <span className="text-sm font-bold text-white">
              {zoomOutProgress >= 0.99
                ? 'Leaving building…'
                : `Keep zooming out to leave${buildingName ? ` ${buildingName}` : ''}`}
            </span>
            <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
              <ArrowUpRight className="w-3.5 h-3.5 text-white rotate-90" />
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FloorMap;