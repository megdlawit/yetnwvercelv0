// The moment the map hands over to the building: "GPS can't follow us in
// here" (walking in on a route) or "Entering …" (tapping the building).
// A paper veil lifts off the map as the 3D view glides in behind it, and an
// ink card with a pulsing door says what happened — then it gets out of the
// way on its own.

import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { DoorOpen, Satellite } from 'lucide-react';
import { t, type Lang } from '@ethi/indoor-core';

export interface Handoff { kind: 'gps' | 'enter'; venue: string; nonce: number }

export default function HandoffCard({ handoff, lang, onDone }: { handoff: Handoff | null; lang: Lang; onDone: () => void }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!handoff) return;
    const id = window.setTimeout(onDone, handoff.kind === 'gps' ? 4200 : 3000);
    return () => window.clearTimeout(id);
  }, [handoff, onDone]);

  const title = !handoff ? '' : handoff.kind === 'gps' ? t(lang, 'nav.gps-lost') : t(lang, 'nav.entering', { venue: handoff.venue });
  const sub = handoff?.venue ? t(lang, 'nav.welcome', { venue: handoff.venue }) : '';

  return (
    <AnimatePresence>
      {handoff && (
        <>
          {/* the veil: the map fades into the building */}
          <motion.div key={`veil-${handoff.nonce}`} aria-hidden className="pointer-events-none absolute inset-0 z-[45] bg-paper"
            initial={{ opacity: reduced ? 0 : 0.95 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.9, ease: 'easeOut' }} />
          <motion.div key={`card-${handoff.nonce}`} role="status" aria-live="polite"
            initial={{ opacity: 0, y: reduced ? 0 : -16, scale: reduced ? 1 : 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduced ? 0 : -10 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30, delay: reduced ? 0 : 0.15 }}
            onClick={onDone}
            className="absolute left-1/2 top-[max(5.5rem,env(safe-area-inset-top))] z-[60] flex w-[min(420px,calc(100%-32px))] -translate-x-1/2 cursor-pointer items-center gap-3.5 rounded-[22px] bg-ink/[.94] px-4 py-3.5 font-inter text-white shadow-[0_18px_44px_rgba(15,61,38,.35)] backdrop-blur-md">
            <span className="relative grid h-12 w-12 flex-none place-items-center rounded-[15px] bg-lime text-ink">
              {!reduced && <span className="absolute -inset-1 animate-[ring_2.2s_infinite] rounded-[18px] border-2 border-lime" />}
              {handoff.kind === 'gps' ? <Satellite className="h-[22px] w-[22px]" /> : <DoorOpen className="h-[22px] w-[22px]" />}
            </span>
            <span className="min-w-0">
              <b className="block text-[15.5px] font-semibold leading-snug">{title}</b>
              {sub && <small className="mt-0.5 block truncate text-[12.5px] font-medium text-white/70">{sub}</small>}
            </span>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
