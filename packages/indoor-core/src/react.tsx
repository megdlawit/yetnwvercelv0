// React binding for IndoorViewer3D (import from '@ethi/indoor-core/react').
// The viewer is created once per mount; prop changes become method calls,
// so nothing is rebuilt unless the venue or theme itself changes.

import { forwardRef, useEffect, useRef, type CSSProperties, type ForwardedRef } from 'react';
import type { IndoorVenue, Lang } from './model';
import type { Path3D } from './path3d';
import type { Layers } from './render/buildFloor';
import type { ViewerTheme } from './render/theme';
import { IndoorViewer3D, type PlaceTag, type Pose, type Selection, type ViewMode } from './render/viewer';

export interface IndoorViewer3DProps {
  venue: IndoorVenue;
  floorId?: string;
  mode?: ViewMode;
  theme?: Partial<ViewerTheme>;
  lang?: Lang;
  layers?: Partial<Layers>;
  places?: PlaceTag[] | null;
  roomLabels?: boolean;
  route?: Path3D | null;
  /** Metres of the route already walked. */
  progress?: number;
  position?: Pose | null;
  destination?: Pose | null;
  selectedId?: string | null;
  /** Bump to fly the camera to the selection. */
  focusNonce?: number;
  cinematic?: boolean;
  reducedMotion?: boolean;
  shadows?: boolean;
  onSelect?: (sel: Selection | null) => void;
  onFloorChange?: (floorId: string) => void;
  onModeChange?: (mode: ViewMode) => void;
  className?: string;
  style?: CSSProperties;
}

/** Hand the viewer to the parent's ref once it exists (after mount, not during render). */
function assign(ref: ForwardedRef<IndoorViewer3D | null>, v: IndoorViewer3D | null) {
  if (typeof ref === 'function') ref(v);
  else if (ref) ref.current = v;
}

/** Changes only when the value really changed (skips the first run: the constructor already applied it). */
function useOnChange<T>(value: T, apply: (v: T) => void, viewer: React.MutableRefObject<IndoorViewer3D | null>) {
  const last = useRef(value);
  useEffect(() => {
    if (!viewer.current || Object.is(last.current, value)) return;
    last.current = value;
    apply(value);
  });
}

export const IndoorViewer3DView = forwardRef<IndoorViewer3D | null, IndoorViewer3DProps>(function IndoorViewer3DView(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<IndoorViewer3D | null>(null);

  useEffect(() => {
    const v = new IndoorViewer3D(host.current!, {
      venue: props.venue, floorId: props.floorId, mode: props.mode, theme: props.theme, lang: props.lang, layers: props.layers,
      places: props.places, roomLabels: props.roomLabels, cinematic: props.cinematic, reducedMotion: props.reducedMotion, shadows: props.shadows,
      onSelect: props.onSelect, onFloorChange: props.onFloorChange, onModeChange: props.onModeChange,
    });
    viewer.current = v;
    assign(ref, v);
    if (props.route) v.setRoute(props.route);
    if (props.progress != null) v.setProgress(props.progress);
    if (props.position) v.setPosition(props.position);
    if (props.destination) v.setDestination(props.destination);
    if (props.selectedId) v.setSelected(props.selectedId);
    return () => { assign(ref, null); v.dispose(); viewer.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { viewer.current?.setCallbacks({ onSelect: props.onSelect, onFloorChange: props.onFloorChange, onModeChange: props.onModeChange }); });
  useOnChange(props.venue, v => viewer.current!.setVenue(v), viewer);
  useOnChange(props.theme, v => viewer.current!.setTheme(v ?? {}), viewer);
  useOnChange(props.layers, v => viewer.current!.setLayers(v ?? {}), viewer);
  useOnChange(props.lang, v => viewer.current!.setLang(v ?? 'en'), viewer);
  useOnChange(props.places, v => viewer.current!.setPlaces(v ?? null), viewer);
  useOnChange(props.roomLabels, v => viewer.current!.setRoomLabels(!!v), viewer);
  useOnChange(props.floorId, v => { if (v) viewer.current!.setFloor(v); }, viewer);
  useOnChange(props.mode, v => { if (v) viewer.current!.setMode(v); }, viewer);
  useOnChange(props.route, v => viewer.current!.setRoute(v ?? null), viewer);
  useOnChange(props.progress, v => viewer.current!.setProgress(v ?? -1), viewer);
  useOnChange(props.position, v => viewer.current!.setPosition(v ?? null), viewer);
  useOnChange(props.destination, v => viewer.current!.setDestination(v ?? null), viewer);
  useOnChange(props.selectedId, v => viewer.current!.setSelected(v ?? null), viewer);
  useOnChange(props.focusNonce, () => viewer.current!.setSelected(props.selectedId ?? null, { focus: true }), viewer);

  return <div ref={host} className={props.className} style={{ position: 'relative', width: '100%', height: '100%', ...props.style }} />;
});

export type { Selection, PlaceTag, Pose, ViewMode } from './render/viewer';
