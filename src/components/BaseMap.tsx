/**
 * BaseMap — thin reusable MapLibre GL wrapper.
 *
 * Mounts a real interactive map (pan/pinch-zoom handled natively by
 * MapLibre) and hands the live `maplibregl.Map` instance up to the parent
 * via `onMapInstance` once it's loaded. The parent is responsible for
 * anything domain-specific (fitting bounds, registering imperative zoom
 * controls, drawing overlays) — this component only owns the map lifecycle
 * and style switching.
 *
 * Children are rendered in an absolutely-positioned layer on top of the
 * map canvas (used for the SVG marker/route overlay) — pointer events
 * pass through to the map by default so dragging/pinching still works;
 * individual overlay elements opt back in with `pointerEvents: 'auto'`.
 */
import React, { useEffect, useRef } from 'react';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoCoord } from '@/lib/geo/GeoTypes';
import { getMapStyle, type MapStyleId } from '@/lib/mapStyles';

export interface BaseMapProps {
  styleId: MapStyleId;
  initialCenter: GeoCoord;
  initialZoom?: number;
  /** Camera tilt in degrees (0 = flat top-down, up to ~60 for a 3D look). */
  pitch?: number;
  /** Fired once, after the map + style have finished loading. */
  onMapInstance?: (map: MLMap) => void;
  /** Fired on every move/zoom/rotate frame — use to re-sync overlay positions. */
  onMove?: () => void;
  onClick?: (coord: GeoCoord) => void;
  className?: string;
  children?: React.ReactNode;
}

const BaseMap: React.FC<BaseMapProps> = ({
  styleId,
  initialCenter,
  initialZoom = 17,
  pitch = 0,
  onMapInstance,
  onMove,
  onClick,
  className,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  // Stable refs so the mount effect (which must run only once) always sees
  // the latest callbacks/center without needing them in its dep array.
  const onMapInstanceRef = useRef(onMapInstance);
  const onMoveRef = useRef(onMove);
  const onClickRef = useRef(onClick);
  onMapInstanceRef.current = onMapInstance;
  onMoveRef.current = onMove;
  onClickRef.current = onClick;

  // ── Mount once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyle(styleId).style,
      center: [initialCenter.lng, initialCenter.lat],
      zoom: initialZoom,
      pitch,
      // MapLibre's default maxPitch (60) is fairly conservative — bumping it
      // lets the "3D" toggle use a steeper, more dramatic angle (closer to
      // Snap Map / Google Maps 3D) instead of a mild tilt.
      maxPitch: 75,
      attributionControl: { compact: true },
      // Full Google-Maps-style camera control: two-finger twist (touch) or
      // right-click/ctrl-drag (desktop) rotates the bearing a full 360°;
      // two-finger vertical drag tilts independently via touchPitch. Kept
      // separate from pitchWithRotate so the dedicated "3D" toggle button
      // still controls tilt on its own without fighting the rotate gesture.
      dragRotate: true,
      pitchWithRotate: false,
      touchPitch: true,
    });
    mapRef.current = map;

    const handleMove = () => onMoveRef.current?.();
    map.on('move', handleMove);
    map.on('zoom', handleMove);
    map.on('rotate', handleMove);
    map.on('load', () => onMapInstanceRef.current?.(map));

    const handleClick = (e: maplibregl.MapMouseEvent) =>
      onClickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    map.on('click', handleClick);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver?.disconnect();
      map.off('move', handleMove);
      map.off('zoom', handleMove);
      map.off('rotate', handleMove);
      map.off('click', handleClick);
      map.remove();
      mapRef.current = null;
    };
    // Intentionally mount-once: initialCenter/initialZoom only apply on
    // first mount, callers re-fit the view explicitly (e.g. on data change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Style switching (keeps the same map instance — no remount) ─────────
  useEffect(() => {
    mapRef.current?.setStyle(getMapStyle(styleId).style);
  }, [styleId]);

  // ── Pitch toggle (e.g. a "3D" button) — animates the existing camera ───
  useEffect(() => {
    if (mapRef.current) mapRef.current.easeTo({ pitch, duration: 500 });
  }, [pitch]);

  return (
    <div className={className ?? 'absolute inset-0'}>
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
        {children}
      </div>
    </div>
  );
};

export default BaseMap;