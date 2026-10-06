import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Compass } from 'lucide-react';

interface StatusPillProps {
  isNavigating: boolean;
  isWalking: boolean;
  isStationary: boolean;
  sensorMode: 'pdr';
  headingDeg: number;
  headingCardinal: string;
}

const StatusPill: React.FC<StatusPillProps> = ({
  isNavigating,
  isWalking,
  isStationary,
  sensorMode,
  headingDeg,
  headingCardinal,
}) => {
  if (!isNavigating) return null;

  const statusColor = isWalking ? 'bg-primary' : isStationary ? 'bg-destructive' : 'bg-amber-400';
  const statusLabel = isWalking ? 'Walking' : isStationary ? 'Stopped' : 'Calibrating';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.9 }}
        className="bg-card rounded-2xl px-3 py-2 flex items-center gap-2.5 shadow-lg border border-border/40"
        style={{ boxShadow: '0 2px 12px -2px hsl(220 25% 10% / 0.1)' }}
      >
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span className={`absolute inline-flex h-full w-full rounded-full ${statusColor} opacity-60 animate-ping`} />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${statusColor}`} />
        </span>
        <span className="text-xs font-semibold text-foreground">{statusLabel}</span>
        <span className="w-px h-3.5 bg-border/60" />
        <Compass className="w-3.5 h-3.5 text-muted-foreground" style={{ transform: `rotate(${headingDeg}deg)` }} />
        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          {headingDeg.toFixed(0)}°
        </span>
      </motion.div>
    </AnimatePresence>
  );
};

export default StatusPill;
