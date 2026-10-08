/**
 * MapControls — the round white map buttons of the Indoor design, top to
 * bottom: compass (red north needle), +, −, recenter, layers, 3D, my location.
 * Also the one-time ink "drag to explore" hint pill with the tapping hand.
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus, Layers, Box } from 'lucide-react';
import { CTL_BTN } from '@/components/indoor/theme';
import { cn } from '@/lib/utils';

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

interface MapControlsProps {
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onRecenter?: () => void;
  onToggleLayers?: () => void;
  onToggleCompass?: () => void;
  onToggleGPS?: () => void;
  /** Called when the person taps the crosshair "My location" button. */
  onMyLocation?: () => void;
  showLayersPanel?: boolean;
  onOpenLayers?: () => void;
  showDragHint?: boolean;
  onDismissHint?: () => void;
  /** Show the "3D" tilt toggle (only meaningful on the outdoor map). */
  show3DToggle?: boolean;
  is3D?: boolean;
  onToggle3D?: () => void;
  /** Current map camera bearing in degrees — spins the compass needle to match, Google-Maps-style. */
  bearing?: number;
  /** Tapping the compass snaps the camera back to north-up (only meaningful on the real-map outdoor view). */
  onResetNorth?: () => void;
  /** Room and place names on the indoor map: shown or not (the button appears when this is given). */
  showNames?: boolean;
  onToggleNames?: () => void;
}

const MapControls: React.FC<MapControlsProps> = ({
  onZoomIn, onZoomOut, onRecenter,
  onToggleLayers, showLayersPanel = false, onOpenLayers,
  showDragHint = true, onDismissHint,
  show3DToggle = false, is3D = false, onToggle3D,
  onMyLocation,
  bearing = 0,
  onResetNorth,
  showNames = false,
  onToggleNames,
}) => {
  const [hintDismissed, setHintDismissed] = useState(false);

  const handleDismissHint = () => {
    setHintDismissed(true);
    onDismissHint?.();
  };
  // The gesture hint is a one-time nudge: it fades on its own after a few seconds.
  useEffect(() => {
    if (!showDragHint || hintDismissed) return;
    const t = setTimeout(() => setHintDismissed(true), 5000);
    return () => clearTimeout(t);
  }, [showDragHint, hintDismissed]);

  const turned = Math.abs(bearing) > 0.5;
  return (
    <div className="flex flex-col items-end gap-2 lg:gap-2.5">
      {/* Compass — mirrors the map's rotation; tap to snap back north */}
      <button onClick={onResetNorth} aria-label="Reset north"
        className={cn(CTL_BTN, 'relative', !onResetNorth && '!hidden lg:!grid', turned && 'ring-2 ring-lime')}>
        <span className="relative grid place-items-center transition-transform duration-75" style={{ transform: `rotate(${-bearing}deg)` }}>
          <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l3.2 9H8.8z" fill="#d9483b" /><path d="M12 21l-3.2-9h6.4z" fill="#b9c0bb" /></svg>
          <b className="absolute -top-[13px] text-[8.5px] font-bold text-ink">N</b>
        </span>
      </button>

      {/* Zoom (desktop — phones pinch) */}
      <button onClick={onZoomIn} aria-label="Zoom in" className={cn(CTL_BTN, '!hidden lg:!grid')}><Plus className="h-5 w-5" strokeWidth={2.2} /></button>
      <button onClick={onZoomOut} aria-label="Zoom out" className={cn(CTL_BTN, '!hidden lg:!grid')}><Minus className="h-5 w-5" strokeWidth={2.2} /></button>

      {/* Recenter */}
      <button onClick={onRecenter} aria-label="Recenter map" className={CTL_BTN}>
        <Svg><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx={12} cy={12} r={7} /><circle cx={12} cy={12} r={2.5} /></Svg>
      </button>

      {/* Layers */}
      <button onClick={onOpenLayers} aria-label="Toggle map layers" aria-pressed={showLayersPanel} className={CTL_BTN}>
        <Layers className="h-5 w-5" />
      </button>

      {/* 3D tilt — outdoor map only */}
      {show3DToggle && (
        <button onClick={onToggle3D} aria-pressed={is3D} aria-label={is3D ? 'Switch to flat 2D view' : 'Switch to 3D view'} className={CTL_BTN}>
          <Box className="h-5 w-5" />
        </button>
      )}

      {/* Names — rooms and places, off by default on phones where space is short */}
      {onToggleNames && (
        <button onClick={onToggleNames} aria-pressed={showNames} aria-label={showNames ? 'Hide room names' : 'Show room names'}
          title={showNames ? 'Hide names' : 'Show names'} className={cn(CTL_BTN, showNames && '!bg-ink !text-white')}>
          <span className="text-[13px] font-extrabold leading-none tracking-tight">Aa</span>
        </button>
      )}

      {/* My location */}
      <button onClick={onMyLocation} aria-label="My location" className={CTL_BTN}>
        <Svg><path d="M3 11l19-9-9 19-2-8-8-2z" /></Svg>
      </button>

      {/* One-time gesture hint */}
      <AnimatePresence>
        {showDragHint && !hintDismissed && (
          <motion.button
            initial={{ opacity: 0, y: 20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            transition={{ delay: 0.5, duration: 0.3 }}
            onClick={handleDismissHint}
            className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+112px)] left-1/2 z-[80] flex lg:bottom-7 lg:left-[calc(50%+208px)] max-w-[calc(100vw-32px)] items-center gap-2.5 rounded-full bg-ink/[.92] py-2 pl-2.5 pr-3.5 font-inter text-xs font-semibold text-white shadow-[0_12px_30px_rgba(15,61,38,.28)] lg:py-2.5 lg:pl-3 lg:pr-[18px] lg:text-[13.5px]"
          >
            <span className="grid h-6 w-6 flex-none animate-[tap_1.6s_ease-in-out_infinite] place-items-center rounded-full bg-lime text-ink lg:h-7 lg:w-7">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1a1.5 1.5 0 0 1 3 0v2m0-1a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4.3 14a1.5 1.5 0 0 1 2.4-1.8L9 14" /></svg>
            </span>
            <span className="whitespace-nowrap"><span className="lg:hidden">Drag · pinch to zoom · tap a place</span><span className="hidden lg:inline">Drag to rotate · scroll to zoom · tap a place</span></span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MapControls;