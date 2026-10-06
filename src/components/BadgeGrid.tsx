/**
 * BadgeGrid — individual achievement badges for the Profile screen.
 *
 * Mirrors computeBadges' four thresholds (src/hooks/useUserProfile.ts) 1:1,
 * so the count shown elsewhere in the header (`badgesEarned`) always matches
 * however many cards here render as unlocked — this is just a richer view
 * of the same underlying numbers, not a separate source of truth.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { MapPin, Compass, Footprints, Trophy, type LucideIcon } from 'lucide-react';

interface BadgeDef {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Returns [unlocked, current, target] for this badge given the person's stats. */
  progress: (placesVisited: number, stepsWalked: number) => [boolean, number, number];
}

const BADGE_DEFS: BadgeDef[] = [
  {
    id: 'first-steps',
    label: 'First Steps',
    icon: MapPin,
    progress: (places) => [places >= 1, Math.min(places, 1), 1],
  },
  {
    id: 'explorer',
    label: 'Explorer',
    icon: Compass,
    progress: (places) => [places >= 5, Math.min(places, 5), 5],
  },
  {
    id: 'on-the-move',
    label: 'On the Move',
    icon: Footprints,
    progress: (_places, steps) => [steps >= 1000, Math.min(steps, 1000), 1000],
  },
  {
    id: 'marathoner',
    label: 'Marathoner',
    icon: Trophy,
    progress: (_places, steps) => [steps >= 5000, Math.min(steps, 5000), 5000],
  },
];

interface BadgeGridProps {
  placesVisited: number;
  stepsWalked: number;
}

const BadgeGrid: React.FC<BadgeGridProps> = ({ placesVisited, stepsWalked }) => (
  <div className="grid grid-cols-2 gap-2.5">
    {BADGE_DEFS.map((badge, i) => {
      const [unlocked, current, target] = badge.progress(placesVisited, stepsWalked);
      const Icon = badge.icon;
      const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
      return (
        <motion.div
          key={badge.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, duration: 0.25 }}
          className="rounded-2xl p-3 flex flex-col items-center text-center"
          style={{
            background: unlocked ? 'hsl(38 80% 50% / 0.10)' : 'hsl(var(--muted))',
            boxShadow: unlocked ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
          }}
        >
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center mb-1.5"
            style={{
              background: unlocked ? 'hsl(38 80% 50% / 0.18)' : 'hsl(var(--border) / 0.4)',
              color: unlocked ? 'hsl(38 70% 40%)' : 'hsl(var(--muted-foreground))',
            }}
          >
            <Icon className="w-5 h-5" />
          </div>
          <p
            className="text-[11px] font-bold leading-tight"
            style={{ color: unlocked ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}
          >
            {badge.label}
          </p>
          {!unlocked && (
            <>
              <div className="w-full h-1 rounded-full mt-1.5 overflow-hidden" style={{ background: 'hsl(var(--border) / 0.5)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: 'hsl(152 70% 26%)' }}
                />
              </div>
              <p className="text-[9px] mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {current.toLocaleString()} / {target.toLocaleString()}
              </p>
            </>
          )}
        </motion.div>
      );
    })}
  </div>
);

export default BadgeGrid;
