// The map editor's hands-on tour. A welcome with a little animated "plan
// becomes a 3D venue", then a spotlight that moves through the editor while
// the person really uses it: steps with a "Try it" task tick themselves off
// when it's done (switch to Split, draw a wall, add a place…). Nothing is
// blocked — the editor stays fully usable underneath. Ends with a shortcut
// cheat sheet. Steps whose element isn't on screen (small screens) are skipped.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles, MousePointer2, MapPin, HeartPulse, SquarePlus,
  Globe, ArrowRight, ArrowLeft, X, Check, PartyPopper, Keyboard, Hand,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { celebrateBuild } from '@/lib/celebrate';

export interface EditorState {
  view: string;
  tool: string;
  counts: { walls: number; rooms: number; nodes: number; edges: number; features: number };
  hasSelection: boolean;
}

interface Step {
  /** The element to spotlight (data-tour="…"); may depend on what the person is doing. */
  target: string | ((s: EditorState) => string);
  icon: typeof Sparkles;
  title: string;
  body: string | ((s: EditorState) => string);
  /** A small thing to try; ticks itself off. `base` is the state when the step began. */
  task?: { label: string; done: (s: EditorState, base: EditorState) => boolean };
}

const changed = (s: EditorState, b: EditorState) =>
  s.counts.nodes + s.counts.edges + s.counts.features + s.counts.rooms + s.counts.walls !== b.counts.nodes + b.counts.edges + b.counts.features + b.counts.rooms + b.counts.walls;

// Short, and in the order people actually work: say it, click it, (draw it), check it, publish it.
const STEPS: Step[] = [
  { target: 'map-assistant', icon: Sparkles, title: 'Just tell the map',
    body: 'Type what you want, like "Add a restroom here" or "Connect Room 1 and Room 2". Click the map first and "here" means that spot.',
    task: { label: 'Ask the map for a change', done: changed } },
  { target: 'editor-inspector', icon: MousePointer2, title: 'Click anything to edit it',
    body: 'Rename it, add photos, or connect it so visitors can walk there.',
    task: { label: 'Click something on the map', done: (s, b) => s.hasSelection && !b.hasSelection } },
  { target: 'tool-add', icon: SquarePlus, title: 'Prefer to draw?',
    body: '+ Add has rooms, walls, doors, paths, objects and scenery. More tools has everything else.' },
  { target: 'editor-health', icon: HeartPulse, title: 'Ready for visitors?',
    body: 'This tells you if anything needs fixing. "Fix everything" does the safe fixes for you. Every change can be undone.' },
  { target: 'editor-publish', icon: Globe, title: 'Preview, then publish',
    body: 'Preview shows what visitors will see. Nothing goes live until you press Publish.' },
];

const SHORTCUTS: [string, string][] = [
  ['/', 'Ask the map'], ['Ctrl Z', 'Undo'], ['Del', 'Delete'], ['1 · 2 · 3', '2D · 3D · Split'],
];

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6, CARD_W = 340, CARD_H = 250;

function findTarget(id: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}
const targetOf = (st: Step, s: EditorState) => (typeof st.target === 'function' ? st.target(s) : st.target);

export default function EditorTour({ open, state, justBuilt = false, onClose }: {
  open: boolean;
  state: EditorState;
  /** Just created from an import — welcome them to their new venue. */
  justBuilt?: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'welcome' | 'steps' | 'done'>('welcome');
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ w: innerWidth, h: innerHeight });
  const [ticked, setTicked] = useState(false);
  const base = useRef(state);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Only the steps whose element is on screen (checked when the tour starts).
  const steps = useMemo(() => (open && phase === 'steps' ? STEPS.filter(s => findTarget(targetOf(s, stateRef.current)) || (typeof s.target === 'function')) : STEPS), [open, phase]);
  const step = steps[Math.min(index, steps.length - 1)];
  const target = step ? targetOf(step, state) : null;

  useEffect(() => { if (open) { setPhase('welcome'); setIndex(0); } }, [open]);
  // Each step starts from where the person is now.
  useEffect(() => { base.current = stateRef.current; setTicked(false); }, [index, phase]);

  const finish = useCallback(() => { setPhase('done'); celebrateBuild(); }, []);
  const next = useCallback(() => (index >= steps.length - 1 ? finish() : setIndex(i => i + 1)), [index, steps.length, finish]);
  const back = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);

  // A task done → a tick, then on to the next step.
  const taskDone = phase === 'steps' && !!step?.task && step.task.done(state, base.current);
  useEffect(() => { if (taskDone && !ticked) setTicked(true); }, [taskDone, ticked]);
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    if (!ticked) return;
    const t = setTimeout(() => nextRef.current(), 1100);
    return () => clearTimeout(t);
  }, [ticked]);

  const measure = useCallback(() => {
    setViewport({ w: innerWidth, h: innerHeight });
    const el = target && findTarget(target);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    const top = Math.max(r.top, 4), bottom = Math.min(r.bottom, innerHeight - 4);
    setRect({ top: top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: Math.max(bottom - top, 20) + PAD * 2 });
  }, [target]);

  useLayoutEffect(() => {
    if (!open || phase !== 'steps') return;
    measure();
    const t = setTimeout(measure, 300);
    let raf = 0;
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    addEventListener('resize', onMove); addEventListener('scroll', onMove, true);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); removeEventListener('resize', onMove); removeEventListener('scroll', onMove, true); };
  }, [open, phase, measure]);

  if (!open) return null;

  // Card: below the target if it fits, else above, else beside, else in the corner of a big target.
  const card = (() => {
    const w = Math.min(CARD_W, viewport.w - 24), h = CARD_H;
    if (!rect) return { left: (viewport.w - w) / 2, top: (viewport.h - h) / 2, w, arrow: null as null | 'up' | 'down' | 'left' };
    const clampX = (x: number) => Math.min(Math.max(12, x), viewport.w - w - 12);
    const big = rect.height > viewport.h * 0.5;
    if (!big && rect.top + rect.height + h + 16 < viewport.h) return { left: clampX(rect.left), top: rect.top + rect.height + 12, w, arrow: 'up' as const };
    if (!big && rect.top - h - 16 > 0) return { left: clampX(rect.left), top: rect.top - h - 12, w, arrow: 'down' as const };
    if (!big && rect.left + rect.width + w + 24 < viewport.w) return { left: rect.left + rect.width + 12, top: Math.min(Math.max(12, rect.top), viewport.h - h - 12), w, arrow: 'left' as const };
    return { left: clampX(rect.left + rect.width - w - 16), top: Math.min(rect.top + 16, viewport.h - h - 12), w, arrow: null };
  })();

  const body = step ? (typeof step.body === 'function' ? step.body(state) : step.body) : '';

  const overlay = (
    <div className="pointer-events-none fixed inset-0 z-[100]" role="dialog" aria-label="Map editor tour">
      <style>{`
        @keyframes et-pop { from { opacity: 0; transform: translateY(8px) scale(.96) } to { opacity: 1; transform: none } }
        @keyframes et-glow { 0%,100% { box-shadow: 0 0 0 3px hsl(var(--primary) / .45), 0 0 0 0 hsl(var(--primary) / .4) } 50% { box-shadow: 0 0 0 3px hsl(var(--primary) / .7), 0 0 0 16px hsl(var(--primary) / 0) } }
        @keyframes et-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
        @keyframes et-fill { 0%, 30% { opacity: 0 } 45%, 100% { opacity: 1 } }
        @keyframes et-drop { 0%, 50% { transform: translateY(-14px); opacity: 0 } 62% { transform: translateY(0); opacity: 1 } 100% { opacity: 1 } }
        @keyframes et-path { to { stroke-dashoffset: -16 } }
        @keyframes et-tilt { 0%, 70% { transform: perspective(700px) rotateX(0) } 85%, 100% { transform: perspective(700px) rotateX(42deg) translateY(-6px) } }
        @keyframes et-tick { 0% { transform: scale(0) rotate(-30deg) } 60% { transform: scale(1.3) } 100% { transform: scale(1) } }
      `}</style>

      {phase === 'steps' ? (
        <>
          {/* Dim everything except the spotlight — but never block the editor. */}
          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            <defs>
              <mask id="et-hole">
                <rect width="100%" height="100%" fill="white" />
                {rect && <rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} rx="12" fill="black" style={{ transition: 'all .35s cubic-bezier(.4,0,.2,1)' }} />}
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(8, 20, 14, 0.42)" mask="url(#et-hole)" />
          </svg>
          {rect && (
            <div className="absolute rounded-xl border-2 border-primary"
              style={{ ...rect, transition: 'all .35s cubic-bezier(.4,0,.2,1)', animation: 'et-glow 1.8s ease-in-out infinite' }} />
          )}
          {step && (
            <div key={index} className="pointer-events-auto absolute rounded-3xl border bg-card p-4 shadow-2xl"
              style={{ left: card.left, top: card.top, width: card.w, transition: 'left .35s, top .35s', animation: 'et-pop .3s ease-out' }}>
              {card.arrow === 'up' && <span className="absolute -top-2 left-8 h-4 w-4 rotate-45 border-l border-t bg-card" />}
              {card.arrow === 'down' && <span className="absolute -bottom-2 left-8 h-4 w-4 rotate-45 border-b border-r bg-card" />}
              {card.arrow === 'left' && <span className="absolute -left-2 top-8 h-4 w-4 rotate-45 border-b border-l bg-card" />}
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-emerald-400 text-white shadow-lg shadow-primary/30"><step.icon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Step {index + 1} of {steps.length}</p>
                  <h3 className="text-[15px] font-bold leading-snug">{step.title}</h3>
                </div>
                <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted" aria-label="Close tour"><X className="h-4 w-4" /></button>
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
              {step.task && (
                <div className={cn('mt-3 flex items-center gap-2.5 rounded-2xl border px-3 py-2 text-[13px] font-medium transition-colors duration-300',
                  taskDone ? 'border-primary/40 bg-primary/10 text-primary' : 'border-dashed border-primary/40 bg-primary/5')}>
                  {taskDone
                    ? <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-white" style={{ animation: 'et-tick .4s ease-out' }}><Check className="h-3 w-3" /></span>
                    : <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" /></span>}
                  <span className="flex-1">{taskDone ? 'Nice — done!' : <>Try it: {step.task.label}</>}</span>
                </div>
              )}
              <div className="mt-3 flex gap-1">
                {steps.map((_, i) => <span key={i} className={cn('h-1.5 flex-1 rounded-full transition-colors', i <= index ? 'bg-primary' : 'bg-muted')} />)}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <button onClick={onClose} className="text-xs font-medium text-muted-foreground hover:text-foreground">End tour</button>
                <div className="flex gap-2">
                  {index > 0 && <Button size="sm" variant="ghost" onClick={back}><ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back</Button>}
                  <Button size="sm" variant={step.task && !taskDone ? 'outline' : 'default'} onClick={next}>
                    {index === steps.length - 1 ? 'Finish' : step.task && !taskDone ? 'Skip' : 'Next'} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-[rgba(8,20,14,0.6)] p-4 backdrop-blur-[2px]" onClick={onClose}>
          <div className="relative w-full max-w-lg overflow-hidden rounded-[2rem] border bg-card shadow-2xl" style={{ animation: 'et-pop .35s ease-out' }} onClick={e => e.stopPropagation()}>
            <div className="relative h-48 overflow-hidden bg-gradient-to-br from-[hsl(152_70%_20%)] via-[hsl(160_55%_28%)] to-[hsl(190_60%_35%)]">
              <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
              {phase === 'welcome' ? <PlanToWorld /> : (
                <div className="absolute inset-0 grid place-items-center">
                  <span className="grid h-20 w-20 place-items-center rounded-3xl bg-white/15 text-white ring-1 ring-white/25" style={{ animation: 'et-pop .4s ease-out' }}><PartyPopper className="h-9 w-9" /></span>
                </div>
              )}
            </div>
            <div className="p-6">
              {phase === 'welcome' ? (
                <div className="text-center">
                  <p className="text-xs font-bold uppercase tracking-wider text-primary">{justBuilt ? 'Your venue is built' : 'The map editor'}</p>
                  <h2 className="mt-1 text-2xl font-bold">{justBuilt ? 'Now let\'s make it yours' : 'Tell us how your building works'}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    5 quick steps, under a minute. We'll turn what you tell us into a map — and everything can be undone.
                  </p>
                  <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <Button size="lg" onClick={() => { setIndex(0); setPhase('steps'); }}><Sparkles className="mr-2 h-4 w-4" /> Show me (5 steps)</Button>
                    <Button size="lg" variant="ghost" onClick={onClose}>I'll explore myself</Button>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="text-center text-2xl font-bold">You're all set!</h2>
                  <p className="mt-1 text-center text-sm text-muted-foreground">Reopen this guide any time with <b>Guide</b> in the top bar.</p>
                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-2xl bg-muted/50 p-3 ">
                    {SHORTCUTS.map(([k, label]) => (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <kbd className="min-w-[2rem] rounded-md border bg-card px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold shadow-sm">{k}</kbd>
                        <span className="text-muted-foreground">{label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex justify-center">
                    <Button size="lg" onClick={onClose}><Keyboard className="mr-2 h-4 w-4" /> Start editing</Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
  return createPortal(overlay, document.body);
}

/** A tiny looping story: walls draw, rooms fill, places drop in, a path runs, the plan tilts into 3D. */
function PlanToWorld() {
  const walls = ['M30 30 H190 V120 H30 Z', 'M110 30 V120', 'M30 78 H110'];
  return (
    <div className="absolute inset-0 grid place-items-center">
      <svg viewBox="0 0 220 150" className="h-40 w-60" style={{ animation: 'et-tilt 5s ease-in-out infinite alternate', transformOrigin: '50% 70%' }}>
        <rect x="30" y="30" width="80" height="48" rx="2" fill="rgba(255,255,255,.18)" style={{ animation: 'et-fill 5s ease-out infinite alternate' }} />
        <rect x="110" y="30" width="80" height="90" rx="2" fill="rgba(255,255,255,.12)" style={{ animation: 'et-fill 5s ease-out .3s infinite alternate' }} />
        {walls.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1}
            style={{ animation: `et-draw 1.4s ease-out ${i * 0.35}s both` }} />
        ))}
        <path d="M70 100 L70 60 L150 60 L150 95" fill="none" stroke="#7dd3fc" strokeWidth="2.5" strokeDasharray="4 4" style={{ animation: 'et-path .8s linear infinite' }} />
        {[[70, 100, '#fbbf24'], [70, 54, '#f472b6'], [150, 95, '#a7f3d0']].map(([x, y, c], i) => (
          <g key={i} style={{ animation: `et-drop 5s ease-out ${0.2 * i}s infinite alternate` }}>
            <circle cx={x as number} cy={y as number} r="6" fill={c as string} stroke="white" strokeWidth="2" />
          </g>
        ))}
      </svg>
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/25 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur">
        <Sparkles className="h-3 w-3" /> say it <ArrowRight className="h-3 w-3 opacity-60" /> <MapPin className="h-3 w-3" /> see it <ArrowRight className="h-3 w-3 opacity-60" /> <Hand className="h-3 w-3" /> walk it in 3D
      </div>
    </div>
  );
}
