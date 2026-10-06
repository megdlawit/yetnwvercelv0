/**
 * PositionDebugOverlay — Sprint 1 debug panel for the Hybrid Positioning Engine.
 *
 * Shows:
 *  • Current environment
 *  • GPS accuracy
 *  • Speed
 *  • Raw vs snapped position
 *  • Heading
 *  • Rejection flags (accuracy / speed / jump)
 *  • Last known good age
 *  • Position source
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bug, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { PositionDebugSnapshot } from '@/lib/geo/HybridPositioningEngine';
import type { Environment } from '@/lib/geo/GeoTypes';

interface PositionDebugOverlayProps {
  debug: PositionDebugSnapshot;
  /** Optional legacy debug info from PDR/heading tracker. */
  legacyDebug?: {
    headingDeg?: number;
    headingCardinal?: string;
    stepCount?: number;
    isWalking?: boolean;
    accelVariance?: number;
    sensorMode?: string;
  };
}

// Environment badge
const ENV_COLORS: Record<Environment, string> = {
  indoor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  outdoor: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  transitioning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  unknown: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};

const ENV_DOTS: Record<Environment, string> = {
  indoor: 'bg-emerald-400',
  outdoor: 'bg-sky-400',
  transitioning: 'bg-amber-400',
  unknown: 'bg-zinc-400',
};

function cardinal(deg: number): string {
  if (!isFinite(deg)) return '—';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function fmtAge(ms: number): string {
  if (ms < 1000) return 'now';
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s ago`;
  return `${(ms / 60_000).toFixed(0)}m ago`;
}

function fmtCoord(v: number | null): string {
  if (v == null) return '—';
  return v.toFixed(6);
}

function fmtM(v: number | null): string {
  if (v == null) return '—';
  return `${v.toFixed(1)}m`;
}

function fmtSpeed(v: number | null): string {
  if (v == null) return '—';
  return `${v.toFixed(2)} m/s`;
}

const Row: React.FC<{
  label: string;
  value: React.ReactNode;
  warn?: boolean;
  ok?: boolean;
}> = ({ label, value, warn, ok }) => (
  <div className="flex items-center justify-between py-0.5">
    <span className="text-zinc-500 text-[10px] font-medium">{label}</span>
    <span className={`text-[10px] font-mono font-semibold ${warn ? 'text-red-400' : ok ? 'text-emerald-400' : 'text-zinc-200'}`}>
      {value}
    </span>
  </div>
);

const Divider = () => <div className="border-t border-zinc-700/50 my-1.5" />;

const PositionDebugOverlay: React.FC<PositionDebugOverlayProps> = ({ debug, legacyDebug }) => {
  const [open, setOpen] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);

  const hasRejection = debug.jumpRejected || debug.accuracyRejected || debug.speedRejected;

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`
          relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold
          border transition-all duration-200
          ${open
            ? 'bg-zinc-800 border-zinc-600 text-zinc-200'
            : 'bg-zinc-900/80 border-zinc-700/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
          }
          backdrop-blur-sm shadow-lg
        `}
      >
        <Bug className="w-3 h-3" />
        <span>Position</span>
        {hasRejection && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute bottom-10 right-0 w-64 rounded-2xl overflow-hidden shadow-2xl z-50"
            style={{
              background: 'hsl(220 14% 8% / 0.97)',
              border: '1px solid hsl(220 14% 18%)',
              backdropFilter: 'blur(12px)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 pt-3 pb-2">
              <div className="flex items-center gap-2">
                <Bug className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-[11px] font-bold tracking-widest uppercase text-zinc-400">
                  Position Debug
                </span>
              </div>
              <button onClick={() => setOpen(false)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="px-3 pb-3 space-y-0">
              {/* Environment */}
              <div className="flex items-center justify-between py-1.5">
                <span className="text-zinc-500 text-[10px] font-medium">Environment</span>
                <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${ENV_COLORS[debug.environment]}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${ENV_DOTS[debug.environment]} ${debug.environment === 'transitioning' ? 'animate-pulse' : ''}`} />
                  {debug.environment.toUpperCase()}
                </div>
              </div>

              <Divider />

              {/* GPS */}
              <div className="text-[9px] font-bold tracking-widest uppercase text-zinc-600 mb-0.5">GPS</div>
              <Row
                label="Accuracy"
                value={fmtM(debug.gpsAccuracyM)}
                warn={(debug.gpsAccuracyM ?? 0) > 30}
                ok={(debug.gpsAccuracyM ?? 999) <= 10}
              />
              <Row
                label="Speed"
                value={fmtSpeed(debug.speedMs)}
              />
              <Row
                label="Heading"
                value={isFinite(debug.heading) ? `${debug.heading.toFixed(1)}° ${cardinal(debug.heading)}` : '—'}
              />

              <Divider />

              {/* Position */}
              <div className="text-[9px] font-bold tracking-widest uppercase text-zinc-600 mb-0.5">Position</div>
              <Row label="Source" value={debug.positionSource.toUpperCase()} />
              <Row label="Raw lat" value={fmtCoord(debug.rawLat)} />
              <Row label="Raw lng" value={fmtCoord(debug.rawLng)} />
              {debug.isSnapped && (
                <>
                  <Row
                    label="Snap dist"
                    value={fmtM(debug.snapDistanceM)}
                    ok
                  />
                  <Row label="Snap lat" value={fmtCoord(debug.snappedLat)} />
                  <Row label="Snap lng" value={fmtCoord(debug.snappedLng)} />
                </>
              )}
              {!debug.isSnapped && (
                <Row label="Snapped" value="No snap" />
              )}
              <Row
                label="Last good"
                value={fmtAge(debug.lastGoodAge)}
                warn={debug.lastGoodAge > 10_000}
              />

              {/* Rejections */}
              {hasRejection && (
                <>
                  <Divider />
                  <div className="text-[9px] font-bold tracking-widest uppercase text-zinc-600 mb-0.5">Rejections</div>
                  {debug.accuracyRejected && (
                    <div className="flex items-center gap-1.5 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                      <span className="text-[10px] text-red-400 font-semibold">Accuracy too poor</span>
                    </div>
                  )}
                  {debug.speedRejected && (
                    <div className="flex items-center gap-1.5 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                      <span className="text-[10px] text-red-400 font-semibold">Speed too high</span>
                    </div>
                  )}
                  {debug.jumpRejected && (
                    <div className="flex items-center gap-1.5 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      <span className="text-[10px] text-amber-400 font-semibold">Jump rejected</span>
                    </div>
                  )}
                </>
              )}

              {/* Legacy PDR section (collapsible) */}
              {legacyDebug && (
                <>
                  <Divider />
                  <button
                    onClick={() => setShowLegacy(s => !s)}
                    className="flex items-center justify-between w-full py-0.5 text-zinc-500 hover:text-zinc-400 transition-colors"
                  >
                    <span className="text-[9px] font-bold tracking-widest uppercase">PDR / Sensor</span>
                    {showLegacy ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>

                  <AnimatePresence>
                    {showLegacy && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        {legacyDebug.headingDeg != null && (
                          <Row
                            label="PDR Heading"
                            value={`${legacyDebug.headingDeg.toFixed(1)}° ${legacyDebug.headingCardinal ?? ''}`}
                          />
                        )}
                        {legacyDebug.stepCount != null && (
                          <Row label="Steps" value={String(legacyDebug.stepCount)} />
                        )}
                        {legacyDebug.isWalking != null && (
                          <Row
                            label="Walking"
                            value={legacyDebug.isWalking ? 'Yes' : 'No'}
                            ok={legacyDebug.isWalking}
                          />
                        )}
                        {legacyDebug.accelVariance != null && (
                          <Row label="Accel Var" value={legacyDebug.accelVariance.toFixed(3)} />
                        )}
                        {legacyDebug.sensorMode && (
                          <Row label="Mode" value={legacyDebug.sensorMode.toUpperCase()} />
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PositionDebugOverlay;
