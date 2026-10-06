// First-time guidance: a welcome, then a spotlight that glides between the
// key parts of the dashboard, then a small celebration with the next step.
// Steps point at elements marked data-tour="…"; any that aren't on screen
// (e.g. the sidebar on a phone) are skipped.

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles, LayoutDashboard, Building2, ListChecks, Box, PenTool, Zap, Search, Eye, Globe, HelpCircle,
  ArrowRight, ArrowLeft, X, Map as MapIcon, MapPin, Newspaper, Users, Upload, PartyPopper,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { celebrateBuild } from '@/lib/celebrate';

interface Step { target: string; icon: typeof Sparkles; title: string; body: string }

const STEPS: Step[] = [
  { target: 'sidebar', icon: LayoutDashboard, title: 'Your command center', body: 'Everything about your venue lives here — the map, places, events, stories, QR codes and your team. Grouped by what you want to do.' },
  { target: 'venue', icon: Building2, title: 'Your venue', body: 'This is the venue you\'re managing. Run more than one site? Switch between them, or add a new one, from here.' },
  { target: 'setup', icon: ListChecks, title: 'Your setup checklist', body: 'Six steps from an empty venue to a published one. Tick them off in any order — we\'ll always show you what\'s next.' },
  { target: 'hero', icon: Box, title: 'One model, 2D and 3D', body: 'Upload the map you already have and it becomes a 3D world. The 2D plan, the 3D world and the visitor app are all the same model — edit once, it updates everywhere.' },
  { target: 'edit-map', icon: PenTool, title: 'The map editor', body: 'Import a CAD file, PDF or image, then draw walls, rooms, doors and paths, name places and walk through it in 3D.' },
  { target: 'quick-actions', icon: Zap, title: 'One-click actions', body: 'Add a place, an attraction or an event, or make a QR code for a gate — no hunting through menus.' },
  { target: 'search', icon: Search, title: 'Find anything', body: 'Search places, areas, events and pages. Tip: press Ctrl K from anywhere.' },
  { target: 'preview', icon: Eye, title: 'See what visitors see', body: 'Open your venue exactly as a visitor would — including the changes you haven\'t published yet.' },
  { target: 'publish', icon: Globe, title: 'You decide when it goes live', body: 'Edits stay private to your team. When you\'re happy, press Publish — the orange number tells you how many changes are waiting.' },
  { target: 'help', icon: HelpCircle, title: 'Help is always here', body: 'Quick answers, the guide, and this tour again whenever you want it.' },
];

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 8, CARD_W = 360;

function findTarget(id: string): HTMLElement | null {
  // Some targets exist twice (desktop and phone versions); use the visible one.
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export default function GuidedTour({ open, firstName, hasMap, onClose, onUploadMap }: {
  open: boolean; firstName: string; hasMap: boolean; onClose: () => void; onUploadMap: () => void;
}) {
  const [phase, setPhase] = useState<'welcome' | 'steps' | 'done'>('welcome');
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ w: innerWidth, h: innerHeight });

  // Only the steps whose element is on screen right now.
  const steps = useMemo(() => (open && phase === 'steps' ? STEPS.filter(s => findTarget(s.target)) : STEPS), [open, phase]);
  const step = steps[Math.min(index, steps.length - 1)];

  useEffect(() => { if (open) { setPhase('welcome'); setIndex(0); } }, [open]);

  const measure = useCallback(() => {
    setViewport({ w: innerWidth, h: innerHeight });
    const el = step && findTarget(step.target);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    // Big targets (the hero map) are clipped to the screen so the card still fits.
    const top = Math.max(r.top, 8), bottom = Math.min(r.bottom, innerHeight - 8);
    setRect({ top: top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: Math.max(bottom - top, 24) + PAD * 2 });
  }, [step]);

  useLayoutEffect(() => {
    if (!open || phase !== 'steps' || !step) return;
    const el = findTarget(step.target);
    el?.scrollIntoView({ block: el.getBoundingClientRect().height > innerHeight * 0.6 ? 'start' : 'center', behavior: 'smooth' });
    measure();
    const t = setTimeout(measure, 380);
    let raf = 0;
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    addEventListener('resize', onMove); addEventListener('scroll', onMove, true);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); removeEventListener('resize', onMove); removeEventListener('scroll', onMove, true); };
  }, [open, phase, step, measure]);

  const finish = useCallback(() => { setPhase('done'); celebrateBuild(); }, []);
  const next = useCallback(() => (index >= steps.length - 1 ? finish() : setIndex(i => i + 1)), [index, steps.length, finish]);
  const back = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (phase === 'steps' && (e.key === 'ArrowRight' || e.key === 'Enter')) { e.preventDefault(); next(); }
      else if (phase === 'steps' && e.key === 'ArrowLeft') back();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, phase, next, back, onClose]);

  if (!open) return null;

  // Where the card goes: below the target if there's room, else above, else beside, else centred.
  const card = (() => {
    const w = Math.min(CARD_W, viewport.w - 24), h = 250;
    if (!rect) return { left: (viewport.w - w) / 2, top: (viewport.h - h) / 2, w, arrow: null as null | 'up' | 'down' | 'left' };
    const clampX = (x: number) => Math.min(Math.max(12, x), viewport.w - w - 12);
    if (rect.top + rect.height + h + 16 < viewport.h) return { left: clampX(rect.left), top: rect.top + rect.height + 14, w, arrow: 'up' as const };
    if (rect.top - h - 16 > 0) return { left: clampX(rect.left), top: rect.top - h - 14, w, arrow: 'down' as const };
    if (rect.left + rect.width + w + 24 < viewport.w) return { left: rect.left + rect.width + 14, top: Math.min(Math.max(12, rect.top), viewport.h - h - 12), w, arrow: 'left' as const };
    return { left: clampX(rect.left + rect.width - w - 16), top: Math.min(rect.top + 16, viewport.h - h - 12), w, arrow: null };
  })();

  const overlay = (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Dashboard tour">
      <style>{`
        @keyframes tour-pop { from { opacity: 0; transform: translateY(8px) scale(.96) } to { opacity: 1; transform: none } }
        @keyframes tour-glow { 0%,100% { box-shadow: 0 0 0 4px hsl(var(--primary) / .35), 0 0 0 0 hsl(var(--primary) / .35) } 50% { box-shadow: 0 0 0 4px hsl(var(--primary) / .55), 0 0 0 14px hsl(var(--primary) / 0) } }
        @keyframes tour-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
      `}</style>

      {phase === 'steps' ? (
        <>
          <svg className="absolute inset-0 h-full w-full" onClick={onClose} aria-hidden>
            <defs>
              <mask id="tour-hole">
                <rect width="100%" height="100%" fill="white" />
                {rect && <rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} rx="16" fill="black" style={{ transition: 'all .35s cubic-bezier(.4,0,.2,1)' }} />}
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(8, 20, 14, 0.62)" mask="url(#tour-hole)" />
          </svg>
          {rect && (
            <div className="pointer-events-none absolute rounded-2xl border-2 border-primary"
              style={{ ...rect, transition: 'all .35s cubic-bezier(.4,0,.2,1)', animation: 'tour-glow 1.8s ease-in-out infinite' }} />
          )}
          {step && (
            <div key={index} className="absolute rounded-3xl border bg-card p-5 shadow-2xl"
              style={{ left: card.left, top: card.top, width: card.w, transition: 'left .35s, top .35s', animation: 'tour-pop .3s ease-out' }}>
              {card.arrow === 'up' && <span className="absolute -top-2 left-8 h-4 w-4 rotate-45 border-l border-t bg-card" />}
              {card.arrow === 'down' && <span className="absolute -bottom-2 left-8 h-4 w-4 rotate-45 border-b border-r bg-card" />}
              {card.arrow === 'left' && <span className="absolute -left-2 top-8 h-4 w-4 rotate-45 border-b border-l bg-card" />}
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-emerald-400 text-white shadow-lg shadow-primary/30"><step.icon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Step {index + 1} of {steps.length}</p>
                  <h3 className="text-base font-bold leading-snug">{step.title}</h3>
                </div>
                <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted" aria-label="Skip tour"><X className="h-4 w-4" /></button>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              <div className="mt-4 flex gap-1">
                {steps.map((_, i) => <span key={i} className={cn('h-1.5 flex-1 rounded-full transition-colors', i <= index ? 'bg-primary' : 'bg-muted')} />)}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <button onClick={onClose} className="text-xs font-medium text-muted-foreground hover:text-foreground">Skip tour</button>
                <div className="flex gap-2">
                  {index > 0 && <Button size="sm" variant="ghost" onClick={back}><ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back</Button>}
                  <Button size="sm" onClick={next}>{index === steps.length - 1 ? 'Finish' : 'Next'} <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[rgba(8,20,14,0.62)] p-4 backdrop-blur-[2px]" onClick={onClose}>
          <div className="relative w-full max-w-lg overflow-hidden rounded-[2rem] border bg-card shadow-2xl" style={{ animation: 'tour-pop .35s ease-out' }} onClick={e => e.stopPropagation()}>
            <div className="relative h-44 overflow-hidden bg-gradient-to-br from-[hsl(152_70%_22%)] via-[hsl(152_60%_30%)] to-[hsl(133_60%_42%)]">
              <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
              <div className="absolute inset-0 flex items-center justify-center gap-2 px-6">
                {(phase === 'welcome' ? [MapIcon, Box, MapPin, Newspaper, Users] : [PartyPopper]).map((Icon, i, all) => (
                  <div key={i} className="flex items-center gap-2" style={{ animation: `tour-pop .4s ease-out ${i * 0.12}s both` }}>
                    <span className={cn('grid place-items-center rounded-2xl bg-white/15 text-white ring-1 ring-white/25 backdrop-blur', all.length === 1 ? 'h-20 w-20' : 'h-12 w-12')}
                      style={{ animation: `tour-float 3s ease-in-out ${i * 0.3}s infinite` }}>
                      <Icon className={all.length === 1 ? 'h-9 w-9' : 'h-5 w-5'} />
                    </span>
                    {i < all.length - 1 && <ArrowRight className="h-4 w-4 text-white/50" />}
                  </div>
                ))}
              </div>
            </div>
            <div className="p-6 text-center">
              {phase === 'welcome' ? (
                <>
                  <p className="text-xs font-bold uppercase tracking-wider text-primary">Welcome to Yet New</p>
                  <h2 className="mt-1 text-2xl font-bold">Hi {firstName}, let's build your digital venue</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Your map becomes a 3D world, you add places and stories, and visitors explore it on their phones. A 1-minute tour shows you where everything is.</p>
                  <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <Button size="lg" onClick={() => { setIndex(0); setPhase('steps'); }}><Sparkles className="mr-2 h-4 w-4" /> Take the 1-minute tour</Button>
                    <Button size="lg" variant="ghost" onClick={onClose}>I'll explore on my own</Button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-bold">You're all set!</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {hasMap ? 'Your map is in. Next: describe your places, add an event, then publish.' : 'The best first step is your map — upload the plan you already have and watch it turn into a 3D world.'}
                  </p>
                  <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    {hasMap
                      ? <Button size="lg" onClick={onClose}>Start exploring <ArrowRight className="ml-2 h-4 w-4" /></Button>
                      : <Button size="lg" onClick={() => { onClose(); onUploadMap(); }}><Upload className="mr-2 h-4 w-4" /> Upload your map</Button>}
                    {!hasMap && <Button size="lg" variant="ghost" onClick={onClose}>Later</Button>}
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">Replay the tour any time from <HelpCircle className="inline h-3.5 w-3.5" /> Help.</p>
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
