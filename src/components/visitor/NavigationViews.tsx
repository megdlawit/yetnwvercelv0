// Directions: choose where you start, see the whole route, then follow it
// live — one big instruction at a time, with distance and time to go.

import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, CircleDot, Flag, Layers, Accessibility, Footprints,
  Navigation, X, Volume2, VolumeX, ScanLine, ChevronLeft, ChevronRight, PartyPopper, LocateFixed, Footprints as Steps,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { Step } from '@/lib/venue/routing';
import type { Floor, Place } from './types';

export const STEP_ICONS: Record<Step['icon'], typeof ArrowUp> = {
  start: CircleDot, straight: ArrowUp, left: ArrowLeft, right: ArrowRight,
  'slight-left': ArrowUpLeft, 'slight-right': ArrowUpRight, floor: Layers, arrive: Flag,
};

export function DirectionsPanel({ dest, places, start, startLabel, onStart, stepFree, onStepFree, info, floors, onPickFloor, onBack, onGo, problem }: {
  dest: Place; places: Place[]; start: string | null; startLabel: (p: Place) => string; onStart: (id: string) => void;
  stepFree: boolean; onStepFree: (v: boolean) => void;
  info: { steps: Step[]; metres: number; minutes: number } | null;
  floors: Floor[]; onPickFloor: (floorId: string) => void; onBack: () => void; onGo: () => void; problem: string | null;
}) {
  return (
    <div className="space-y-4 p-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back to {dest.name}</button>
      <div className="space-y-2 rounded-xl border p-3">
        <label className="flex items-center gap-2 text-sm">
          <CircleDot className="h-4 w-4 shrink-0 text-sky-500" />
          <select className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm" value={start ?? ''} onChange={e => onStart(e.target.value)} aria-label="Start from">
            {places.filter(p => p.id !== dest.id).map(p => <option key={p.id} value={p.id}>{startLabel(p)}{floors.length > 1 ? ` (${p.floorName})` : ''}</option>)}
          </select>
        </label>
        <p className="flex items-center gap-2 text-sm"><Flag className="h-4 w-4 shrink-0 text-primary" /> {dest.name}</p>
        <label className="flex items-center justify-between gap-2 border-t pt-1 text-sm">
          <span className="flex items-center gap-2"><Accessibility className="h-4 w-4" /> Step-free route</span>
          <Switch checked={stepFree} onCheckedChange={onStepFree} aria-label="Step-free route" />
        </label>
        {stepFree && <p className="text-[11px] text-muted-foreground">Avoids stairs and escalators, prefers ramps, lifts and level paths, and starts from an accessible entrance.</p>}
      </div>
      {info ? (
        <>
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-4 text-primary-foreground shadow-lg">
            <div>
              <p className="text-3xl font-black leading-none">{info.minutes} <span className="text-base font-semibold">min</span></p>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-primary-foreground/80"><Footprints className="h-4 w-4" /> {Math.round(info.metres)} m walk</p>
            </div>
            <Button size="lg" variant="secondary" className="rounded-full px-6 font-bold shadow" onClick={onGo}><Navigation className="mr-1.5 h-4 w-4" /> Start</Button>
          </div>
          {/* the route as a timeline */}
          <ol className="relative pl-1">
            <span className="absolute bottom-5 left-[18px] top-5 w-0.5 rounded-full bg-gradient-to-b from-sky-400 via-sky-300 to-primary" aria-hidden />
            {info.steps.map((s, i) => {
              const Icon = STEP_ICONS[s.icon];
              const fl = floors.find(f => f.level === s.floorLevel);
              const end = s.icon === 'arrive', begin = s.icon === 'start';
              return (
                <li key={i} className="relative">
                  <button onClick={() => fl && onPickFloor(fl.id)} className="flex w-full items-center gap-3 rounded-xl py-1.5 pr-2 text-left text-sm hover:bg-muted/60">
                    <span className={cn('relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card', end ? 'bg-primary text-primary-foreground' : begin ? 'bg-sky-500 text-white' : s.icon === 'floor' ? 'bg-violet-500 text-white' : 'bg-muted text-foreground')}><Icon className="h-4 w-4" /></span>
                    <span className={cn('flex-1', (end || begin) && 'font-semibold')}>{s.text}</span>
                    {floors.length > 1 && fl && <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{fl.name}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : <p className="text-sm text-amber-700 dark:text-amber-400">{problem}</p>}
    </div>
  );
}

/** The live guidance card over the map. */
export function GuidanceCard({ steps, stepIndex, remainingM, totalM, arrived, destName, tracking, voice, onVoice, onNext, onBack, onEnd, onRecalibrate, onTrack, offRoute, walked }: {
  steps: Step[]; stepIndex: number; remainingM: number; totalM: number; arrived: boolean; destName: string;
  /** How progress is being measured. */
  tracking: 'gps' | 'steps' | 'manual';
  voice: boolean; onVoice: (v: boolean) => void; onNext: () => void; onBack: () => void; onEnd: () => void;
  onRecalibrate: () => void; onTrack: () => void; offRoute: boolean;
  /** Steps counted since directions started, when the step counter is on. */
  walked?: { steps: number; metres: number } | null;
}) {
  const step = steps[stepIndex];
  const nextStep = steps.slice(stepIndex + 1).find(s => s.icon !== 'straight') ?? null;
  const Icon = step ? STEP_ICONS[step.icon] : Flag;
  const minutes = Math.max(arrived ? 0 : 1, Math.round(remainingM / 1.2 / 60));
  return (
    <div className="pointer-events-auto absolute inset-x-3 bottom-3 z-20 mx-auto max-w-md overflow-hidden rounded-3xl border bg-card shadow-2xl md:bottom-auto md:top-16" role="region" aria-label="Directions">
      {arrived ? (
        <div className="flex items-center gap-4 p-5">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground"><PartyPopper className="h-7 w-7" /></span>
          <div className="flex-1">
            <p className="text-lg font-bold leading-tight">You've arrived</p>
            <p className="text-sm text-muted-foreground">{destName}</p>
          </div>
          <Button className="rounded-full" onClick={onEnd}>Done</Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4 bg-primary p-4 text-primary-foreground">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15"><Icon className="h-8 w-8" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold leading-snug" aria-live="polite">{step?.text}</p>
              {nextStep && <p className="truncate text-sm text-primary-foreground/80">Then: {nextStep.text}</p>}
            </div>
          </div>
          <div className="h-1.5 bg-muted"><div className="h-full bg-sky-500 transition-all" style={{ width: `${totalM ? Math.min(100, ((totalM - remainingM) / totalM) * 100) : 0}%` }} /></div>
          {offRoute && <p className="bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">You seem to be off the route — scan a QR code nearby, or follow the blue line.</p>}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <div className="flex-1 text-sm">
              <span className="font-semibold">{minutes} min</span> <span className="text-muted-foreground">· {Math.round(remainingM)} m to go</span>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {tracking === 'gps' ? <><LocateFixed className="h-3 w-3" /> Following your GPS</> : tracking === 'steps' ? <><Steps className="h-3 w-3" /> {walked ? `${walked.steps} steps · ${Math.round(walked.metres)} m walked` : 'Counting your steps'}</> : 'Tap › as you go'}
              </p>
            </div>
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onBack} aria-label="Previous instruction"><ChevronLeft className="h-5 w-5" /></Button>
            <Button size="icon" variant="outline" className="h-9 w-9" onClick={onNext} aria-label="Next instruction"><ChevronRight className="h-5 w-5" /></Button>
          </div>
          <div className="flex items-center gap-1 border-t px-2 py-1.5">
            <Button size="sm" variant="ghost" onClick={() => onVoice(!voice)} aria-pressed={voice}>{voice ? <Volume2 className="mr-1 h-4 w-4" /> : <VolumeX className="mr-1 h-4 w-4" />} Voice</Button>
            {tracking === 'manual' && <Button size="sm" variant="ghost" onClick={onTrack}><Steps className="mr-1 h-4 w-4" /> Track me</Button>}
            <Button size="sm" variant="ghost" onClick={onRecalibrate}><ScanLine className="mr-1 h-4 w-4" /> Scan QR</Button>
            <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={onEnd}><X className="mr-1 h-4 w-4" /> End</Button>
          </div>
        </>
      )}
    </div>
  );
}
