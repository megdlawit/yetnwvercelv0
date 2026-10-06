/**
 * IndoorTrackingModal — "Pre Home Access" screen shown on first app open.
 * Matches Pre_Home-_Access.png exactly:
 *   • Map is visible behind a very light scrim
 *   • Floating white card centered vertically
 *   • Green footprint icon overlaps the top edge of the card
 *   • "Allow Sensor Access" dark-green fill button
 *   • "Continue Without" green-outlined ghost button
 *
 * Rendered at z-[60] so it sits above ProfilePage (z-40) and ExplorePanel (z-50).
 * The parent (Index/App) should mount it with `open={!sensorPermissionGranted}`.
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Footprints } from 'lucide-react';

interface IndoorTrackingModalProps {
  open: boolean;
  onAllow: () => void;
  onSkip: () => void;
}

const IndoorTrackingModal: React.FC<IndoorTrackingModalProps> = ({ open, onAllow, onSkip }) => {
  return (
    <AnimatePresence>
      {open && (
        /* Full-screen scrim — very light so map is clearly visible behind */
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="absolute inset-0 z-[60] flex items-center justify-center px-5"
          style={{ background: 'rgba(0,0,0,0.18)' }}
        >
          {/* Card — springs up from slightly below */}
          <motion.div
            initial={{ opacity: 0, scale: 0.93, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.93, y: 24 }}
            transition={{ type: 'spring', damping: 22, stiffness: 280 }}
            className="bg-white rounded-3xl w-full overflow-visible"
            style={{
              boxShadow: '0 20px 64px -12px rgba(0,0,0,0.28)',
              paddingBottom: 24,
              /* Push card slightly above vertical centre so the nav bar doesn't fight it */
              marginTop: -32,
            }}
          >
            {/* Footprint icon — floats above the card edge */}
            <div className="flex justify-center" style={{ marginTop: -28 }}>
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{
                  background: 'hsl(138 55% 88%)',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
                }}
              >
                <Footprints
                  className="w-8 h-8"
                  style={{ color: 'hsl(133 55% 40%)' }}
                />
              </div>
            </div>

            <div className="px-6 pt-5 text-center">
              <h2
                className="font-black mb-3"
                style={{ fontSize: 20, color: '#111', letterSpacing: '-0.3px' }}
              >
                Indoor Tracking
              </h2>
              <p
                className="text-sm leading-relaxed mb-7 px-1"
                style={{ color: 'hsl(0 0% 44%)', lineHeight: 1.6 }}
              >
                GPS doesn't work inside the palaces. We use your device's motion
                sensors to seamlessly switch to indoor tracking when you enter a
                building.
              </p>

              {/* Primary — dark forest green */}
              <button
                onClick={onAllow}
                className="w-full py-4 rounded-full font-bold text-sm text-white mb-3 transition-transform active:scale-95"
                style={{ background: 'hsl(152 70% 20%)' }}
              >
                Allow Sensor Access
              </button>

              {/* Secondary — green outline ghost */}
              <button
                onClick={onSkip}
                className="w-full py-4 rounded-full font-semibold text-sm border-2 bg-white transition-transform active:scale-95"
                style={{
                  color: 'hsl(133 55% 38%)',
                  borderColor: 'hsl(133 55% 72%)',
                }}
              >
                Continue Without
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default IndoorTrackingModal;