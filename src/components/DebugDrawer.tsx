import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { ConfidenceSnapshot } from '@/lib/ConfidenceEngine';

interface DebugDrawerProps {
  headingDeg: number;
  headingCardinal: string;
  stepCount: number;
  isWalking: boolean;
  isStationary: boolean;
  accelVariance: number;
  sensorMode: 'pdr';
  confidenceSnapshot?: ConfidenceSnapshot | null;
  sensorPermission?: 'prompt' | 'granted' | 'denied' | 'unavailable';
  rawEventCount?: number;
  lastEventMsAgo?: number | null;
  isNavigating?: boolean;
  pathLength?: number;
  onTestSensors?: () => void;
  onStopTestSensors?: () => void;
  isTestingSensors?: boolean;
}

// ─── Confidence bar ───────────────────────────────────────────────────────────

const ConfBar: React.FC<{ value: number; level?: string }> = ({ value, level }) => {
  const pct = Math.round(value * 100);
  const color = level === 'HIGH'
    ? 'hsl(133 60% 45%)'
    : level === 'MEDIUM'
    ? 'hsl(38 90% 52%)'
    : level === 'LOW'
    ? 'hsl(0 72% 55%)'
    : 'hsl(133 60% 45%)';
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'hsl(150 15% 88%)' }}>
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-mono font-bold tabular-nums min-w-[34px] text-right" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
};

// ─── Row ─────────────────────────────────────────────────────────────────────

const Row: React.FC<{ label: string; value: React.ReactNode; accent?: string }> = ({ label, value, accent }) => (
  <div className="flex items-center justify-between gap-3 py-1.5 border-b border-border/20 last:border-0">
    <span className="text-[11px] text-muted-foreground leading-none">{label}</span>
    <span className={`text-[11px] font-mono font-bold tabular-nums leading-none ${accent ?? 'text-foreground'}`}>
      {value}
    </span>
  </div>
);

// ─── Component ───────────────────────────────────────────────────────────────

const DebugDrawer: React.FC<DebugDrawerProps> = ({
  headingDeg, headingCardinal,
  stepCount, isWalking, isStationary,
  accelVariance, sensorMode,
  confidenceSnapshot,
  sensorPermission = 'prompt',
  rawEventCount = 0,
  lastEventMsAgo = null,
  isNavigating = false,
  pathLength = 0,
  onTestSensors,
  onStopTestSensors,
  isTestingSensors = false,
}) => {
  const [open, setOpen] = useState(false);
  const conf = confidenceSnapshot;

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="glass w-10 h-10 rounded-xl flex items-center justify-center shadow-lg tap-scale transition-all"
        title="Debug"
        style={open ? { background: 'hsl(152 70% 22%)', border: 'none' } : {}}
      >
        {/* Bug icon */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke={open ? '#fff' : 'hsl(160 15% 50%)'} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2l1.88 1.88M16 2l-1.88 1.88M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/>
          <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/>
          <path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 19c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17 19c2.1.1 3.8 1.9 3.8 4"/>
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="debug-panel"
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed w-64 rounded-2xl shadow-xl z-[100] overflow-y-auto"
            style={{
              top: 'max(16px, env(safe-area-inset-top, 0px) + 16px)',
              right: 16,
              background: 'hsl(0 0% 100% / 0.97)',
              border: '1px solid hsl(150 12% 88%)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              maxHeight: 'calc(100vh - 100px)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30"
              style={{ background: 'hsl(152 70% 22%)' }}>
              <div className="flex items-center gap-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2l1.88 1.88M16 2l-1.88 1.88M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/>
                  <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/>
                </svg>
                <span className="text-[10px] font-black uppercase tracking-widest text-white">Debug</span>
              </div>
              <button onClick={() => setOpen(false)}
                className="w-6 h-6 rounded-lg flex items-center justify-center"
                style={{ background: 'hsl(152 50% 32%)' }}>
                <X className="w-3 h-3 text-white/80" />
              </button>
            </div>

            {/* Sensor rows */}
            <div className="px-4 pt-2.5 pb-1">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Sensors</p>
              <Row
                label="Heading"
                value={<>{headingDeg.toFixed(1)}°<span className="text-muted-foreground font-normal ml-1">{headingCardinal}</span></>}
              />
              <Row label="Steps" value={stepCount} />
              <Row
                label="Walking"
                value={isWalking ? 'Yes' : 'No'}
                accent={isWalking ? 'text-emerald-500' : undefined}
              />
              <Row
                label="Stationary"
                value={isStationary ? 'Yes' : 'No'}
                accent={isStationary ? 'text-red-500' : undefined}
              />
              <Row label="Accel Var" value={accelVariance.toFixed(3)} />
              <Row
                label="Mode"
                value={sensorMode.toUpperCase()}
                accent="text-primary"
              />
              <Row
                label="Permission"
                value={sensorPermission}
                accent={
                  sensorPermission === 'granted' ? 'text-emerald-500' :
                  sensorPermission === 'unavailable' || sensorPermission === 'denied' ? 'text-red-500' :
                  undefined
                }
              />
              <Row
                label="Raw events"
                value={rawEventCount}
                accent={rawEventCount === 0 ? 'text-red-500' : 'text-emerald-500'}
              />
              <Row
                label="Last event"
                value={lastEventMsAgo === null ? 'never' : `${lastEventMsAgo}ms ago`}
                accent={lastEventMsAgo === null ? 'text-red-500' : undefined}
              />
              <Row
                label="Navigating"
                value={isNavigating ? 'Yes' : 'No'}
                accent={isNavigating ? 'text-emerald-500' : 'text-red-500'}
              />
              <Row
                label="Path pts"
                value={pathLength}
                accent={pathLength < 2 ? 'text-red-500' : 'text-emerald-500'}
              />
            </div>

            {(onTestSensors || onStopTestSensors) && (
              <button
                type="button"
                onClick={() => (isTestingSensors ? onStopTestSensors?.() : onTestSensors?.())}
                className="mt-2 w-full rounded-md py-2 text-[12px] font-semibold"
                style={{
                  background: isTestingSensors ? 'hsl(0 72% 55%)' : 'hsl(133 60% 45%)',
                  color: 'white',
                }}
              >
                {isTestingSensors ? 'Stop Sensor Test' : 'Test Sensors (no route needed)'}
              </button>
            )}

            {/* Confidence section */}
            {conf && (
              <div className="px-4 pt-2 pb-3 border-t border-border/30 mt-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2">Confidence</p>

                {/* Score + overall bar */}
                <div className="mb-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-muted-foreground">Score</span>
                    <span className={`text-[11px] font-mono font-black ${
                      conf.level === 'HIGH' ? 'text-emerald-500' :
                      conf.level === 'MEDIUM' ? 'text-amber-500' : 'text-red-500'
                    }`}>
                      {Math.round(conf.score * 100)}% ({conf.level})
                    </span>
                  </div>
                  <ConfBar value={conf.score} level={conf.level} />
                </div>

                {/* Factor rows */}
                {[
                  { label: 'Step Freq',   val: conf.factors.stepConsistency },
                  { label: 'Heading',     val: conf.factors.headingStability },
                  { label: 'Route Prox',  val: conf.factors.routeProximity },
                  { label: 'Sensor',      val: conf.factors.sensorNoise },
                ].map(f => (
                  <div key={f.label} className="flex items-center gap-3 py-1 border-b border-border/15 last:border-0">
                    <span className="text-[11px] text-muted-foreground w-20 shrink-0">{f.label}</span>
                    <ConfBar value={f.val} />
                  </div>
                ))}

                {/* Drift & Corrections */}
                <div className="mt-2 pt-2 border-t border-border/20">
                  <Row
                    label="Drift"
                    value={`(${conf.driftVector.dx.toFixed(1)}, ${conf.driftVector.dy.toFixed(1)})`}
                  />
                  <Row label="Corrections" value={conf.correctionCount} />
                </div>

                {conf.isFloorTransition && (
                  <div className="flex items-center gap-2 mt-2 px-3 py-1.5 rounded-xl"
                    style={{ background: 'hsl(133 60% 48% / 0.1)', border: '1px solid hsl(133 60% 48% / 0.2)' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <span className="text-[10px] font-bold text-primary">Floor transition active</span>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default DebugDrawer;