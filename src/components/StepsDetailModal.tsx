/**
 * StepsDetailModal — tapping "Steps" on the Profile screen opens this,
 * the "health app" treatment: an animated ring toward today's step goal,
 * plus a 7-day bar chart underneath (fed by daily_steps — see
 * useUserProfile's stepsHistory / fetchStepsHistory).
 */
import React from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import type { DailyStepEntry } from '@/hooks/useUserProfile';

/** Default daily step goal used for the ring. Not user-configurable yet —
 *  a reasonable general walking-activity target rather than anything
 *  medically prescriptive. */
const DEFAULT_DAILY_GOAL = 6000;

const RING_SIZE = 132;
const RING_STROKE = 12;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function weekdayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2);
}

interface StepsDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  todaySteps: number;
  history: DailyStepEntry[];
  goal?: number;
}

const StepsDetailModal: React.FC<StepsDetailModalProps> = ({
  open, onOpenChange, todaySteps, history, goal = DEFAULT_DAILY_GOAL,
}) => {
  const progress = goal > 0 ? Math.min(1, todaySteps / goal) : 0;
  const dashoffset = RING_CIRCUMFERENCE * (1 - progress);

  const chartData = history.map((h) => ({
    ...h,
    label: weekdayLabel(h.date),
    isToday: h.date === history[history.length - 1]?.date,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Steps</DialogTitle>
          <DialogDescription>Your walking activity today and this week.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center py-2">
          <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="hsl(var(--muted))"
              strokeWidth={RING_STROKE}
            />
            <motion.circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="hsl(152 70% 32%)"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              initial={{ strokeDashoffset: RING_CIRCUMFERENCE }}
              animate={{ strokeDashoffset: dashoffset }}
              transition={{ duration: 1, ease: 'easeOut' }}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
            <text
              x="50%" y="46%"
              textAnchor="middle"
              className="fill-foreground"
              style={{ fontSize: 22, fontWeight: 900 }}
            >
              {todaySteps.toLocaleString()}
            </text>
            <text
              x="50%" y="62%"
              textAnchor="middle"
              style={{ fontSize: 10, fontWeight: 700, fill: 'hsl(var(--muted-foreground))' }}
            >
              of {goal.toLocaleString()} goal
            </text>
          </svg>

          <div className="w-full mt-4" style={{ height: 120 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fontWeight: 700, fill: 'hsl(var(--muted-foreground))' }}
                />
                <YAxis hide />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))' }}
                  formatter={(value: number) => [`${value.toLocaleString()} steps`, '']}
                  labelFormatter={() => ''}
                />
                <Bar dataKey="steps" radius={[4, 4, 0, 0]} maxBarSize={22}>
                  {chartData.map((d) => (
                    <Cell key={d.date} fill={d.isToday ? 'hsl(152 70% 32%)' : 'hsl(152 70% 32% / 0.30)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StepsDetailModal;
