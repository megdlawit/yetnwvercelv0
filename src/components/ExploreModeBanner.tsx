import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Compass, X, Sparkles } from 'lucide-react';
import { POIWithDistance } from '@/hooks/usePOIProximity';
import { getPOIIcon } from '@/data/poi';

interface ExploreModeBannerProps {
  active: boolean;
  nearbyCount: number;
  nearbyPOIs: POIWithDistance[];
  onExit: () => void;
}

const ExploreModeBanner: React.FC<ExploreModeBannerProps> = ({ active, nearbyCount, nearbyPOIs, onExit }) => {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 44, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="absolute top-0 left-0 right-0 z-40 overflow-hidden"
        >
          <div className="h-11 bg-primary flex items-center justify-between px-4 gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary-foreground/80" />
              <span className="text-sm font-bold text-primary-foreground">Explore Mode</span>
              {nearbyCount > 0 && (
                <span className="bg-primary-foreground/20 text-primary-foreground text-[11px] font-bold px-2 py-0.5 rounded-full">
                  {nearbyCount} nearby
                </span>
              )}
            </div>
            <button
              onClick={onExit}
              className="w-7 h-7 rounded-lg bg-primary-foreground/15 flex items-center justify-center hover:bg-primary-foreground/25"
            >
              <X className="w-3.5 h-3.5 text-primary-foreground" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const NavigationModeToggle: React.FC<{
  mode: 'navigate' | 'explore';
  onToggle: () => void;
}> = ({ mode, onToggle }) => (
  <motion.button
    onClick={onToggle}
    whileTap={{ scale: 0.97 }}
    className="bg-card rounded-2xl px-3 py-2 flex items-center gap-2 shadow-lg border border-border/40 hover:border-primary/30 transition-colors"
    style={{ boxShadow: '0 2px 12px -2px hsl(220 25% 10% / 0.1)' }}
  >
    {mode === 'navigate'
      ? <><Compass className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-xs font-semibold text-foreground">Navigate</span></>
      : <><Sparkles className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-semibold text-primary">Explore</span></>
    }
  </motion.button>
);

export default ExploreModeBanner;
