/**
 * GPSStatusPill — The "GPS INACTIVE" pill shown over the map.
 * Figma: small green-tinted pill with satellite icon + "GPS INACTIVE" text.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { Satellite } from 'lucide-react';

interface GPSStatusPillProps {
  active: boolean;
  onClick?: () => void;
}

const GPSStatusPill: React.FC<GPSStatusPillProps> = ({ active, onClick }) => {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className="gps-inactive-pill"
    >
      <Satellite className="w-3 h-3" />
      <span>{active ? 'GPS ACTIVE' : 'GPS INACTIVE'}</span>
    </motion.button>
  );
};

export default GPSStatusPill;
