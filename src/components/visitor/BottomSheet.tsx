// The phone's bottom sheet over the map, like modern map apps: drag the
// handle (or flick) between a peek (search only), half and full height.

import { useEffect, useState, type ReactNode } from 'react';
import { motion, useDragControls, type PanInfo } from 'framer-motion';

export type Snap = 'peek' | 'half' | 'full';

const useViewportHeight = () => {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  useEffect(() => { const on = () => setH(window.innerHeight); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  return h;
};

export const useIsDesktop = () => {
  const q = '(min-width: 768px)';
  const [d, setD] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q), on = () => setD(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return d;
};

export default function BottomSheet({ snap, onSnap, header, children, bottomOffset = 64 }: {
  snap: Snap; onSnap: (s: Snap) => void; header: ReactNode; children: ReactNode;
  /** Space kept free under the sheet (the bottom navigation). */
  bottomOffset?: number;
}) {
  const vh = useViewportHeight();
  const controls = useDragControls();
  const full = Math.round(vh * 0.86);
  const visible: Record<Snap, number> = { peek: 150, half: Math.round(vh * 0.5), full };
  const y = full - visible[snap];

  const settle = (_: unknown, info: PanInfo) => {
    const at = y + info.offset.y + info.velocity.y * 0.2;
    const shown = full - at;
    const nearest = (Object.keys(visible) as Snap[]).reduce((a, b) => (Math.abs(visible[b] - shown) < Math.abs(visible[a] - shown) ? b : a));
    onSnap(nearest);
  };

  return (
    <motion.div
      className="fixed inset-x-0 z-30 flex flex-col overflow-hidden rounded-t-[28px] bg-card/95 shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.35)] ring-1 ring-black/5 backdrop-blur-xl"
      style={{ height: full, bottom: bottomOffset }}
      animate={{ y }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}
      drag="y" dragControls={controls} dragListener={false} dragElastic={0.06}
      dragConstraints={{ top: 0, bottom: full - visible.peek }} onDragEnd={settle}>
      <div className="shrink-0 touch-none" onPointerDown={e => controls.start(e)}>
        <button onClick={() => onSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half')} className="mx-auto block py-2.5" aria-label="Resize the panel">
          <span className="block h-1.5 w-11 rounded-full bg-muted-foreground/30" />
        </button>
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: Math.max(0, y) }}>{children}</div>
    </motion.div>
  );
}
