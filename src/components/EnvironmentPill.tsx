import React from 'react';
import { motion } from 'framer-motion';
import { Building2, Trees, MapPin, Locate } from 'lucide-react';

type Environment = 'indoor' | 'outdoor' | 'transition' | 'unknown';
type GpsStatus = 'idle' | 'requesting' | 'tracking' | 'error';

interface EnvironmentPillProps {
  environment: Environment;
  gpsStatus: GpsStatus;
  onToggleGPS?: () => void;
}

const EnvironmentPill: React.FC<EnvironmentPillProps> = ({ environment, gpsStatus, onToggleGPS }) => {
  const isIndoor = environment === 'indoor';
  const isTracking = gpsStatus === 'tracking';

  const Icon = isIndoor ? Building2 : Trees;
  const label = isIndoor ? 'Indoor' : environment === 'transition' ? 'Transitioning' : 'Outdoor';

  return (
    <motion.button
      onClick={onToggleGPS}
      whileTap={{ scale: 0.97 }}
      className="bg-card rounded-2xl px-3 py-2 flex items-center gap-2 shadow-lg border border-border/40 hover:border-primary/30 transition-colors"
      style={{ boxShadow: '0 2px 12px -2px hsl(220 25% 10% / 0.1)' }}
    >
      <Icon className={`w-3.5 h-3.5 ${isIndoor ? 'text-primary' : 'text-emerald-500'}`} />
      <span className="text-xs font-semibold text-foreground">{label}</span>
      {!isIndoor && (
        <>
          <span className="w-px h-3.5 bg-border/60" />
          <Locate className={`w-3 h-3 ${isTracking ? 'text-primary' : 'text-muted-foreground'}`} />
        </>
      )}
    </motion.button>
  );
};

export default EnvironmentPill;
