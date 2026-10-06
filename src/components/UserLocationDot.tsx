/**
 * UserLocationDot — The green pulsing user position dot on the map.
 * Figma shows: small green filled circle with a subtle white ring + outer glow pulse.
 */
import React from 'react';
import { motion } from 'framer-motion';

interface UserLocationDotProps {
  x: number;
  y: number;
  heading?: number;
  isWalking?: boolean;
}

const UserLocationDot: React.FC<UserLocationDotProps> = ({ x, y, heading, isWalking = false }) => {
  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: x - 12, top: y - 12, zIndex: 30 }}
    >
      {/* Outer pulse ring */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ background: 'hsl(133 60% 48% / 0.2)' }}
        animate={{ scale: isWalking ? [1, 2.2, 1] : [1, 1.6, 1], opacity: [0.8, 0, 0.8] }}
        transition={{ duration: isWalking ? 1.2 : 2, repeat: Infinity, ease: 'easeOut' }}
      />

      {/* White ring */}
      <div className="absolute inset-1 rounded-full bg-white shadow-sm" />

      {/* Green center */}
      <div
        className="absolute inset-2 rounded-full"
        style={{ background: 'hsl(133 60% 48%)' }}
      />

      {/* Heading arrow (when navigating) */}
      {heading !== undefined && (
        <div
          className="absolute -top-3 left-1/2 w-0 h-0"
          style={{
            transform: `translateX(-50%) rotate(${heading}deg)`,
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderBottom: '6px solid hsl(133 60% 48%)',
          }}
        />
      )}
    </div>
  );
};

export default UserLocationDot;
