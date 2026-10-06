/**
 * FloatingTopCard — the turn-by-turn HUD, in the Indoor design: a frosted
 * card with an ink turn tile, the instruction, the distance to the turn in
 * serif and a lime progress bar. It turns ink as the turn gets close.
 */

import React, { useRef } from 'react';
import { cn } from '@/lib/utils';
import { DOT_BLUE, DOT_LIVE, GLASS, PROGRESS_FILL } from '@/components/indoor/theme';
import { formatDistance, formatDuration, t, type Lang } from '@ethi/indoor-core';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin,
  ArrowUp,
  CornerDownLeft,
  CornerDownRight,
  Flag,
  Volume2,
  VolumeX,
  ArrowUpFromLine,
  ArrowDownFromLine,
  RefreshCw,
  ArrowRight,
  Navigation,
  X,
  Footprints,
  Car,
  Pencil,
} from 'lucide-react';
import type { InstructionHud, UnifiedInstructionType } from '@/lib/InstructionEngine';
import type { TravelMode } from '@/lib/geo/GeoTypes';

interface FloatingTopCardProps {
  startName: string;
  endName: string;
  hud: InstructionHud;
  isNavigating: boolean;
  isRerouting?: boolean;
  /** True while we're still trying to fetch a real walking/driving route
   *  and don't have one yet — shows a loading banner instead of letting a
   *  direct-line fallback look like the final route. */
  isFetchingRoute?: boolean;
  deviationSec?: number;
  voiceEnabled?: boolean;
  onToggleVoice?: () => void;
  /** Shows a cancel (X) button that ends the current navigation/route. */
  onCancel?: () => void;
  /** Current outdoor travel mode. Omit (or leave undefined) to hide the
   *  walk/car toggle entirely — e.g. while navigating indoors. */
  travelMode?: TravelMode;
  onToggleTravelMode?: (mode: TravelMode) => void;
  /** When provided, the "From" row becomes tappable — opens the starting
   *  point picker (search / tap map / current location) instead of always
   *  routing from the device's live GPS position. Outdoor routes only. */
  onEditStart?: () => void;
  /** Live step counting while walking a route (indoor turn-by-turn). */
  walk?: { steps: number; walking: boolean; metres?: number } | null;
  /** The navigation engine says the person has arrived. Without it, the last
   *  instruction ("Arrive at …") counts as arriving. */
  arrived?: boolean;
  /** Guidance language; with onLanguage, an EN / አማ switch shows in the card. */
  lang?: Lang;
  onLanguage?: (lang: Lang) => void;
  /** The floor the visitor is on (the floor indicator flips as they climb). */
  floorLabel?: string | null;
}

const TURN_ICONS: Partial<Record<UnifiedInstructionType, React.ReactNode>> = {
  LEFT: <CornerDownLeft className="h-[22px] w-[22px]" />,
  RIGHT: <CornerDownRight className="h-[22px] w-[22px]" />,
  STRAIGHT: <ArrowUp className="h-[22px] w-[22px]" />,
  SLIGHT_LEFT: <CornerDownLeft className="h-5 w-5 opacity-80" />,
  SLIGHT_RIGHT: <CornerDownRight className="h-5 w-5 opacity-80" />,
  ARRIVE: <Flag className="h-[22px] w-[22px]" />,
  START: <Navigation className="h-[22px] w-[22px]" />,
  STAIRS_UP: <ArrowUpFromLine className="h-[22px] w-[22px]" />,
  STAIRS_DOWN: <ArrowDownFromLine className="h-[22px] w-[22px]" />,
  ELEVATOR_UP: <ArrowUpFromLine className="h-[22px] w-[22px]" />,
  ELEVATOR_DOWN: <ArrowDownFromLine className="h-[22px] w-[22px]" />,
  EXIT_BUILDING: <ArrowRight className="h-[22px] w-[22px]" />,
  ENTER_BUILDING: <MapPin className="h-[22px] w-[22px]" />,
};

function fmtDistance(m: number, lang: Lang): string {
  return formatDistance(m, lang);
}

function fmtETA(seconds: number, lang: Lang): string {
  if (seconds <= 0) return '';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return formatDuration(seconds, lang);
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function fmtManeuverDist(m: number, lang: Lang): string {
  if (m <= 5) return t(lang, 'now');
  if (m < 100) return t(lang, 'unit.m', { n: Math.round(m / 5) * 5 });
  return fmtDistance(m, lang);
}

/** The prototype's language switch: EN | አማ. */
function LangSwitch({ lang, onLanguage, dark }: { lang: Lang; onLanguage: (l: Lang) => void; dark: boolean }) {
  return (
    <span role="group" aria-label={t(lang, 'hud.language')} className={cn('inline-flex flex-none rounded-full p-0.5 tracking-normal', dark ? 'bg-white/[.14]' : 'bg-ink/[.08]')}>
      {(['en', 'am'] as const).map(l => (
        <button key={l} aria-pressed={lang === l} onClick={() => onLanguage(l)}
          className={cn('rounded-full px-[9px] py-1 text-[11px] font-semibold normal-case', lang === l ? (dark ? 'bg-white text-ink' : 'bg-ink text-white') : '')}>
          {l === 'en' ? 'EN' : 'አማ'}
        </button>
      ))}
    </span>
  );
}

const FloatingTopCard: React.FC<FloatingTopCardProps> = ({
  startName,
  endName,
  hud,
  isNavigating,
  isRerouting = false,
  isFetchingRoute = false,
  deviationSec = 0,
  voiceEnabled,
  onToggleVoice,
  onCancel,
  travelMode,
  onToggleTravelMode,
  onEditStart,
  walk,
  arrived,
  lang = 'en',
  onLanguage,
  floorLabel,
}) => {
  const cur = hud.current;
  // The final leg's instruction is ARRIVE well before the person gets there.
  const isArrived = arrived ?? cur?.type === 'ARRIVE';
  const showInstruction = isNavigating && cur != null;
  const eta = fmtETA(hud.estimatedTimeS, lang);
  const remainingDist = fmtDistance(hud.distanceRemainingM, lang);
  const maneuverDist = fmtManeuverDist(hud.distanceToManeuverM, lang);
  const icon = cur ? (TURN_ICONS[cur.type] ?? <ArrowUp className="h-[22px] w-[22px]" />) : null;
  // "Arrive 10:42" — the clock time you'll get there, at walking pace.
  const arriveAt = hud.estimatedTimeS > 0 && !isArrived
    ? new Date(Date.now() + hud.estimatedTimeS * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;

  // Progress along the route: the longest remaining distance seen for this
  // destination is the whole trip.
  const tripRef = useRef<{ to: string; total: number }>({ to: '', total: 0 });
  if (tripRef.current.to !== endName) tripRef.current = { to: endName, total: 0 };
  tripRef.current.total = Math.max(tripRef.current.total, hud.distanceRemainingM);
  const progress = isArrived ? 1 : tripRef.current.total > 0 ? 1 - hud.distanceRemainingM / tripRef.current.total : 0;

  const near = showInstruction && !isArrived && hud.distanceToManeuverM <= 8;
  const off = isRerouting || isFetchingRoute;
  const dark = near || (isNavigating && isArrived);
  const strip = (t: string) => t.replace(/\s+in\s+\d+\s*m(?:eters)?\.?$/i, '');
  const roundBtn = cn('grid h-[26px] w-[26px] flex-none place-items-center rounded-full', dark ? 'bg-white/[.14]' : 'bg-ink/[.08]');

  // The main line: the turn, the arrival, or (before setting off) the route.
  const title = isNavigating && isArrived ? t(lang, 'nav.arrived.title')
    : showInstruction ? strip(cur!.text)
    : t(lang, 'hud.to', { place: endName });
  const then = (x: string) => t(lang, 'step.then', { instruction: lang === 'en' ? x.replace(/^./, c => c.toLowerCase()) : x });
  const sub = isNavigating && isArrived ? endName
    : showInstruction && hud.next && hud.next.type !== 'ARRIVE' ? then(strip(hud.next.text))
    : [eta, arriveAt ? t(lang, 'hud.arrive-at', { time: arriveAt }) : ''].filter(Boolean).join(' · ') || t(lang, 'hud.from', { place: startName });
  const big = isNavigating && isArrived ? '' : showInstruction ? maneuverDist : hud.distanceRemainingM > 0 ? remainingDist : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: near ? 1.02 : 1 }}
      role="status" aria-live="polite"
      className={cn('relative rounded-[22px] px-3.5 pb-3 pt-[11px] font-inter transition-colors duration-300', GLASS,
        dark ? '!bg-ink/[.92] text-white' : off ? '!bg-[rgba(255,246,228,.92)] text-ink' : 'text-ink')}
    >
      {/* eyebrow: where to, and the small controls */}
      <div className={cn('mb-[9px] flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[.14em]', dark ? 'text-white/70' : 'text-moss')}>
        <span className={isNavigating ? DOT_BLUE : DOT_LIVE} />
        <span className="min-w-0 truncate">
          {onEditStart && !isNavigating ? (
            <button onClick={onEditStart} aria-label="Change starting point" className="inline-flex max-w-full items-center gap-1 uppercase tracking-[.14em] hover:underline">
              <span className="truncate">{t(lang, 'hud.from', { place: startName })}</span><Pencil className="h-2.5 w-2.5 flex-none" />
            </button>
          ) : isNavigating ? t(lang, 'hud.to', { place: endName }) : t(lang, 'hud.from', { place: startName })}
        </span>
        <span className="flex-1" />
        {/* Floor indicator: flips by itself as the visitor climbs */}
        {floorLabel && (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={floorLabel} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }}
              className={cn('flex-none rounded-full px-2 py-[3px] text-[10px] tracking-[.08em]', dark ? 'bg-white/[.14] text-white' : 'bg-ink text-white')}>
              {floorLabel}
            </motion.span>
          </AnimatePresence>
        )}
        {onLanguage && <LangSwitch lang={lang} onLanguage={onLanguage} dark={dark} />}
        {travelMode && onToggleTravelMode && (
          <span className={cn('flex flex-none items-center rounded-full p-0.5', dark ? 'bg-white/[.14]' : 'bg-ink/[.08]')}>
            {(['walk', 'car'] as const).map(m => (
              <button key={m} onClick={() => onToggleTravelMode(m)} aria-pressed={travelMode === m}
                aria-label={m === 'walk' ? 'Walking directions' : 'Driving directions'}
                className={cn('grid h-[22px] w-[26px] place-items-center rounded-full', travelMode === m && 'bg-ink text-white')}>
                {m === 'walk' ? <Footprints className="h-3 w-3" /> : <Car className="h-3 w-3" />}
              </button>
            ))}
          </span>
        )}
        {isNavigating && onToggleVoice && (
          <button onClick={onToggleVoice} aria-label={voiceEnabled ? t(lang, 'hud.voice-off') : t(lang, 'hud.voice-on')} className={roundBtn}>
            {voiceEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>
        )}
        {onCancel && (
          <button onClick={onCancel} aria-label={t(lang, 'hud.cancel')} title="Cancel navigation" className={roundBtn}>
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* the turn */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={isArrived ? 'arrived' : cur?.id ?? 'route'}
          initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }}
          transition={{ duration: 0.18 }}
          className="flex items-center gap-3">
          <div className={cn('grid h-11 w-11 flex-none place-items-center rounded-[15px] transition-[background,color,transform] duration-300 lg:h-12 lg:w-12',
            dark ? 'scale-[1.04] bg-lime text-ink' : off ? 'bg-[#e08a1a] text-white' : 'bg-ink text-white')}>
            {off ? <RefreshCw className="h-5 w-5 animate-spin" />
              : isNavigating && isArrived ? <Flag className="h-[22px] w-[22px]" />
              : showInstruction ? icon : <Navigation className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-base font-semibold leading-[1.15] lg:text-[19px]">
              {off ? (isRerouting ? (deviationSec > 0 ? t(lang, 'nav.off-route') : t(lang, 'hud.recalculating')) : t(lang, 'hud.getting-route')) : title}
            </b>
            <small className={cn('mt-[3px] block truncate text-[12.5px] font-medium', dark ? 'text-white/70' : 'text-sub')}>{sub}</small>
          </div>
          {big && <div className="whitespace-nowrap font-news text-[21px] font-semibold leading-none tabular-nums lg:text-[26px]">{big}</div>}
        </motion.div>
      </AnimatePresence>

      {/* progress */}
      {(isNavigating || hud.distanceRemainingM > 0) && (
        <div className={cn('mt-[11px] h-1 overflow-hidden rounded-sm', dark ? 'bg-white/15' : 'bg-ink/10')}>
          <i className={cn('block h-full transition-[width] duration-500', PROGRESS_FILL)} style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
        </div>
      )}

      {/* remaining + live steps */}
      {isNavigating && !isArrived && (hud.distanceRemainingM > 0 || walk) && (
        <div className={cn('mt-2 flex items-center gap-2 whitespace-nowrap text-[11.5px] font-semibold tabular-nums', dark ? 'text-white/75' : 'text-sub')} aria-live="polite">
          {hud.distanceRemainingM > 0 && (
            <span className="min-w-0 truncate">{t(lang, 'hud.left', { distance: remainingDist })}{eta ? ` · ${eta}` : ''}{arriveAt && <span className="hidden sm:inline"> · {t(lang, 'hud.arrive-at', { time: arriveAt })}</span>}</span>
          )}
          {walk && (
            <span className="ml-auto inline-flex flex-none items-center gap-1.5">
              <Footprints className={cn('h-3.5 w-3.5', walk.walking && 'animate-pulse text-[#2fbf5a]')} />
              {t(lang, 'hud.steps-walked', { n: walk.steps })}
              {walk.metres != null && <span className="hidden sm:inline">· {t(lang, 'hud.walked', { n: Math.round(walk.metres) })}</span>}
              <span className={cn('hidden sm:inline', walk.walking && 'text-[#2fbf5a]')}>· {walk.walking ? t(lang, 'hud.walking') : walk.steps > 0 ? t(lang, 'hud.paused') : t(lang, 'hud.start-walking')}</span>
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
};

export default FloatingTopCard;