import React from 'react';
import { NavNode } from '@/data/types';
import { NavigationState } from '@/hooks/useNavigationSimulation';
import { CheckCircle, ArrowRight, ArrowLeft, MoveRight, MapPin } from 'lucide-react';
import { t, type Lang } from '@ethi/indoor-core';
import { useGuidanceLang } from '@/lib/guidanceLang';

interface DirectionsPanelProps {
  path: NavNode[] | null;
  navState: NavigationState;
  /** Plan pixels per metre (lib/navScale); 1 = no real scale, keep the original ÷10. */
  pxPerMeter?: number;
}

// ─── Direction helpers ────────────────────────────────────────────────────────

type TurnDir = 'straight' | 'left' | 'right' | 'start' | 'arrive';

interface Step {
  instruction: string;
  dir: TurnDir;
  distanceM: number;
}

function getTurn(prev: NavNode, cur: NavNode, next: NavNode): TurnDir {
  const dx1 = cur.x - prev.x, dy1 = cur.y - prev.y;
  const dx2 = next.x - cur.x, dy2 = next.y - cur.y;
  const cross = dx1 * dy2 - dy1 * dx2;
  const dot   = dx1 * dx2 + dy1 * dy2;
  if (Math.abs(cross) < 10 && dot > 0) return 'straight';
  return cross > 0 ? 'right' : 'left';
}

function buildSteps(path: NavNode[], pxPerMeter = 1, lang: Lang = 'en'): Step[] {
  if (path.length < 2) return [];
  const perMeter = pxPerMeter !== 1 ? pxPerMeter : 10;
  const nodeDist = (a: NavNode, b: NavNode) => Math.round(Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) / perMeter);
  const steps: Step[] = [];

  steps.push({
    instruction: t(lang, 'step.start', { place: path[0].name || t(lang, 'list.your-location') }),
    dir: 'start',
    distanceM: 0,
  });

  for (let i = 1; i < path.length - 1; i++) {
    const node = path[i];
    const dist = nodeDist(path[i - 1], path[i]);

    if (!node.isHallway && node.name) {
      const dir = i + 1 < path.length ? getTurn(path[i - 1], path[i], path[i + 1]) : 'straight';
      const key = dir === 'left' ? 'step.left.at' : dir === 'right' ? 'step.right.at' : 'step.continue.to';
      steps.push({ instruction: t(lang, key, { landmark: node.name }), dir, distanceM: dist });
    } else {
      if (i + 1 < path.length) {
        const dir = getTurn(path[i - 1], path[i], path[i + 1]);
        const words = dir === 'left' ? t(lang, 'step.left') : dir === 'right' ? t(lang, 'step.right') : t(lang, 'step.continue', { distance: t(lang, 'unit.m', { n: dist }) });
        steps.push({ instruction: words, dir, distanceM: dir === 'straight' ? 0 : dist });
      }
    }
  }

  steps.push({
    instruction: t(lang, 'list.arrive', { place: path[path.length - 1].name || t(lang, 'list.destination') }),
    dir: 'arrive',
    distanceM: nodeDist(path[path.length - 2], path[path.length - 1]),
  });

  return steps;
}

// ─── Step icon ────────────────────────────────────────────────────────────────

const StepIcon: React.FC<{ dir: TurnDir; active?: boolean; done?: boolean }> = ({ dir, active, done }) => {
  const base = 'w-3.5 h-3.5 mt-0.5 shrink-0';
  if (done)           return <CheckCircle className={`${base} text-primary`} />;
  if (dir === 'arrive') return <MapPin className={`${base} ${active ? 'text-destructive animate-pulse' : 'opacity-30'}`} />;
  if (dir === 'start')  return <div className={`w-2.5 h-2.5 mt-1 rounded-full border-2 shrink-0 ${active ? 'border-primary' : 'border-muted-foreground/30'}`} />;
  if (dir === 'left')   return <ArrowLeft  className={`${base} ${active ? 'text-primary animate-pulse' : 'opacity-30'}`} />;
  if (dir === 'right')  return <ArrowRight className={`${base} ${active ? 'text-primary animate-pulse' : 'opacity-30'}`} />;
  return                       <MoveRight  className={`${base} ${active ? 'text-primary animate-pulse' : 'opacity-30'}`} />;
};

// ─── Component ────────────────────────────────────────────────────────────────

const DirectionsPanel: React.FC<DirectionsPanelProps> = ({ path, navState, pxPerMeter = 1 }) => {
  const [lang] = useGuidanceLang();
  if (!path || path.length < 2) return null;

  const steps = buildSteps(path, pxPerMeter, lang);
  const activeIdx = Math.min(navState.currentNodeIndex + 1, steps.length - 1);

  return (
    <div className="space-y-1 pt-2 border-t border-border/30">
      <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 px-1">
        <MoveRight className="w-3 h-3" />
        {t(lang, 'list.heading')}
      </h4>
      <div className="space-y-0.5 max-h-[200px] overflow-y-auto scroll-touch pr-1">
        {steps.map((step, i) => {
          const isDone   = (navState.isNavigating || navState.isComplete) && i < activeIdx;
          const isActive = (navState.isNavigating || navState.isPaused) && i === activeIdx;
          const isFinal  = navState.isComplete && i === steps.length - 1;

          return (
            <div
              key={i}
              className={`flex items-start gap-2.5 px-3 py-2 rounded-xl text-xs transition-all ${
                isActive
                  ? 'bg-primary/10 text-foreground font-bold'
                  : isDone || isFinal
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground/50'
              }`}
            >
              <StepIcon dir={step.dir} active={isActive} done={isDone || isFinal} />
              <span className="flex-1 leading-snug">
                {step.instruction}
                {step.distanceM > 0 && (
                  <span className="ml-1.5 text-[10px] font-semibold text-muted-foreground/60">
                    ~{t(lang, 'unit.m', { n: step.distanceM })}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DirectionsPanel;