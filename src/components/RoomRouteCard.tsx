/**
 * RoomRouteCard — floating "Directions" card for room-to-room indoor
 * navigation, shown once both a start room and a destination room have
 * been tapped on the floor plan. Mirrors the Google Maps pattern of
 * picking two points and getting a single, obvious "Navigate" action —
 * previously this flow depended on POICard / the bottom-sheet's buried
 * start/end pickers, so plain room-to-room routing had no visible
 * "Navigate" affordance of its own.
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Navigation, ArrowUpDown, Clock, Ban } from 'lucide-react';

interface RoomRouteCardProps {
  visible: boolean;
  fromName: string;
  toName: string;
  /** Human-readable ETA, e.g. "1m 20s" — undefined while unknown. */
  timeLabel?: string;
  /** Whether a walkable route was actually found between the two rooms. */
  hasRoute: boolean;
  /** True when the route crosses floors (stairs/elevator). */
  crossFloor?: boolean;
  onNavigate: () => void;
  onSwap: () => void;
  onClose: () => void;
}

const RoomRouteCard: React.FC<RoomRouteCardProps> = ({
  visible, fromName, toName, timeLabel, hasRoute, crossFloor, onNavigate, onSwap, onClose,
}) => {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="room-route-card"
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="fixed bottom-[7.5rem] inset-x-4 z-40 lg:left-[416px] lg:right-auto lg:bottom-6 lg:w-[380px]"
        >
          <div
            className="rounded-3xl overflow-hidden bg-white shadow-2xl border border-border/20"
            style={{ boxShadow: '0 8px 32px -4px hsl(152 40% 10% / 0.2)' }}
          >
            {/* Route summary: From → To */}
            <div className="flex items-start gap-3 px-4 pt-4 pb-2">
              <div className="flex flex-col items-center pt-1">
                <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40" />
                <span className="w-px h-6 bg-border/70 my-0.5" />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'hsl(var(--primary))' }} />
              </div>
              <div className="flex-1 min-w-0 space-y-2.5">
                <p className="text-xs font-semibold text-muted-foreground truncate">{fromName}</p>
                <p className="text-sm font-bold text-foreground truncate">{toName}</p>
              </div>
              <button
                onClick={onSwap}
                aria-label="Swap start and destination"
                className="h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted flex-shrink-0 tap-scale"
              >
                <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>

            {/* Status row */}
            <div className="px-4 pb-1">
              {hasRoute ? (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
                  <Clock className="w-3 h-3" />
                  <span>{timeLabel ? `${timeLabel} walk` : 'Route ready'}</span>
                  {crossFloor && <span className="text-muted-foreground/70">· via stairs/elevator</span>}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-orange-500">
                  <Ban className="w-3 h-3" />
                  <span>No walkable route found between these rooms</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 px-4 pb-4 pt-2">
              <button
                onClick={onNavigate}
                disabled={!hasRoute}
                className="flex-1 h-10 rounded-2xl text-xs font-bold text-white flex items-center justify-center gap-1.5 tap-scale disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'hsl(var(--accent-green))', boxShadow: '0 2px 12px hsl(var(--accent-green) / 0.4)' }}
              >
                <Navigation className="w-3.5 h-3.5" /> Navigate
              </button>
              <button
                onClick={onClose}
                aria-label="Cancel route selection"
                className="h-10 w-10 rounded-2xl bg-muted/60 flex items-center justify-center hover:bg-muted border border-border/50"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default RoomRouteCard;
