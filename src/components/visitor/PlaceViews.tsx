// How places look to visitors: a list row, a recommendation card, and the
// full details page (photo header, quick facts, Navigate / Explore, hours,
// accessibility, stories). Each kind of place has its own colour and icon.

import type { CSSProperties, ReactNode } from 'react';
import {
  ArrowLeft, Star, Clock, Accessibility, Check, Navigation, Footprints, Share2, Bookmark, BookmarkCheck, Telescope, Layers, ChevronRight,
  ShieldCheck, Flag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { polygonArea } from '@/lib/cad/geometry';
import { roomOutline } from '@/lib/venue/features';
import { ACCESSIBILITY_LABELS, hoursSummary, openStatus, type Accessibility as PlaceAccessibility, type OpeningHours } from '@/lib/venue/places';
import { VISITOR_CATEGORIES } from '@/lib/venue/discover';
import { trustBadge, type TrustFields } from '@/lib/venue/trust';
import { CATEGORY_COLORS, CATEGORY_ICONS, PX_PER_METER, type Place } from './types';

export type DistanceOf = (p: Place) => { metres: number; minutes: number } | null;

const typeLine = (p: Place, multiFloor: boolean) => [p.typeLabel ?? VISITOR_CATEGORIES[p.category].label, multiFloor ? p.floorName : ''].filter(Boolean).join(' · ');
/** A soft wash of the place's colour, for icon bubbles and photo stand-ins. */
export const tint = (color: string, strong = false): CSSProperties =>
  strong ? { background: `linear-gradient(135deg, ${color}, ${color}b3)` } : { background: `${color}1f`, color };

export function CategoryBubble({ p, size = 'md' }: { p: Pick<Place, 'category'>; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = CATEGORY_ICONS[p.category];
  const box = size === 'lg' ? 'h-14 w-14 rounded-2xl' : size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-11 w-11 rounded-xl';
  return <span className={cn('flex shrink-0 items-center justify-center', box)} style={tint(CATEGORY_COLORS[p.category])}><Icon className={size === 'lg' ? 'h-7 w-7' : size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} /></span>;
}

export function PlaceRow({ p, onOpen, distance, multiFloor }: { p: Place; onOpen: () => void; distance: DistanceOf; multiFloor: boolean }) {
  const st = openStatus(p.hours);
  const d = distance(p);
  return (
    <button onClick={onOpen} className="group flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-muted/70">
      {p.images[0]
        ? <img src={p.images[0]} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
        : <CategoryBubble p={p} />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 truncate text-sm font-semibold">{p.name} {p.featured && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {typeLine(p, multiFloor)}
          {st && <span className={st.open ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}> · {st.open ? 'Open' : 'Closed'}</span>}
        </span>
      </span>
      {d ? <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"><Footprints className="mb-0.5 mr-0.5 inline h-3 w-3" />{d.minutes} min</span>
        : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />}
    </button>
  );
}

export function PlaceCard({ p, onOpen, distance }: { p: Place; onOpen: () => void; distance: DistanceOf }) {
  const Icon = CATEGORY_ICONS[p.category];
  const st = openStatus(p.hours);
  const d = distance(p);
  return (
    <button onClick={onOpen} className="group w-44 shrink-0 snap-start overflow-hidden rounded-3xl bg-card text-left shadow-md ring-1 ring-black/5 transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]">
      <div className="relative h-28 overflow-hidden">
        {p.images[0] ? <img src={p.images[0]} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          : <div className="flex h-full items-center justify-center" style={tint(CATEGORY_COLORS[p.category], true)}><Icon className="h-9 w-9 text-white/90" /></div>}
        <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />
        {p.featured && <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-amber-700"><Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" /> Popular</span>}
        {d && <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">{d.minutes} min</span>}
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-semibold">{p.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {p.typeLabel ?? VISITOR_CATEGORIES[p.category].label}
          {st && <span className={st.open ? 'text-emerald-600' : 'text-amber-600'}> · {st.open ? 'Open now' : 'Closed'}</span>}
        </p>
      </div>
    </button>
  );
}

export function PlaceDetail({ p, multiFloor, distance, hasElevator, stories, onBack, onNavigate, onShare, onExplore, saved, onSave, onStreetDirections, onReport }: {
  p: Place; multiFloor: boolean; distance: DistanceOf; hasElevator: boolean;
  stories: ReactNode; onBack: () => void; onNavigate: () => void; onShare: () => void;
  /** Fly the map to this place (Explore = look around; Navigate = get there). */
  onExplore: () => void; saved: boolean; onSave: () => void;
  /** Walking directions along the streets from where you are (outdoor map), when offered. */
  onStreetDirections?: () => void;
  /** Tell the venue's team something here is wrong. */
  onReport?: () => void;
}) {
  const d = distance(p);
  const st = openStatus(p.hours);
  const color = CATEGORY_COLORS[p.category];
  const Icon = CATEGORY_ICONS[p.category];
  const area = p.room ? Math.round(polygonArea(roomOutline(p.room)) / PX_PER_METER / PX_PER_METER) : null;
  const roundBtn = 'grid h-9 w-9 place-items-center rounded-full bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/55';
  const chip = 'flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium';
  return (
    <div className="pb-4">
      {/* photo header */}
      <div className="relative h-36 overflow-hidden md:h-52">
        {p.images.length > 0 ? (
          <div className="flex h-full snap-x snap-mandatory overflow-x-auto">
            {p.images.map(url => <img key={url} src={url} alt="" className="h-full w-full shrink-0 snap-center object-cover" />)}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center" style={tint(color, true)}><Icon className="h-16 w-16 text-white/30" /></div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/25" />
        <div className="absolute inset-x-3 top-3 flex items-center justify-between">
          <button onClick={onBack} className={roundBtn} aria-label="Back"><ArrowLeft className="h-4 w-4" /></button>
          <div className="flex gap-2">
            <button onClick={onSave} className={roundBtn} aria-pressed={saved} aria-label={saved ? 'Remove from saved' : 'Save'} title={saved ? 'Saved' : 'Save'}>
              {saved ? <BookmarkCheck className="h-4 w-4 text-amber-300" /> : <Bookmark className="h-4 w-4" />}
            </button>
            <button onClick={onShare} className={roundBtn} aria-label="Share"><Share2 className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="absolute inset-x-4 bottom-3 text-white">
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ background: color }}>
            <Icon className="h-3 w-3" /> {p.typeLabel ?? VISITOR_CATEGORIES[p.category].label}
          </span>
          <h2 className="mt-1 flex items-center gap-1.5 text-2xl font-bold leading-tight drop-shadow">{p.name} {p.featured && <Star className="h-5 w-5 fill-amber-400 text-amber-400" />}</h2>
          {p.images.length > 1 && <p className="text-[11px] text-white/75">{p.images.length} photos · swipe</p>}
        </div>
      </div>

      <div className="space-y-4 p-4">
        {/* quick facts */}
        <div className="flex flex-wrap gap-1.5">
          {st && <span className={cn(chip, st.open ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300')}><Clock className="h-3 w-3" /> {st.open ? 'Open now' : 'Closed'}</span>}
          {d && <span className={cn(chip, 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300')}><Footprints className="h-3 w-3" /> {d.minutes} min · {Math.round(d.metres)} m</span>}
          {multiFloor && <span className={cn(chip, 'bg-muted')}><Layers className="h-3 w-3" /> {p.floorName}</span>}
          {(p.access.wheelchair || p.access.stepFree) && <span className={cn(chip, 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300')}><Accessibility className="h-3 w-3" /> {p.access.wheelchair ? 'Wheelchair friendly' : 'Step-free'}</span>}
          {area ? <span className={cn(chip, 'bg-muted')}>{area} m²</span> : null}
        </div>

        {/* Explore = look around; Navigate = get there */}
        <div className="grid grid-cols-2 gap-2">
          {p.navigable
            ? <Button size="lg" className="rounded-2xl shadow-md" onClick={onNavigate}><Navigation className="mr-1.5 h-4 w-4" /> Navigate</Button>
            : <Button size="lg" variant="secondary" className="rounded-2xl" disabled>No directions</Button>}
          <Button size="lg" variant="outline" className="rounded-2xl" onClick={onExplore}><Telescope className="mr-1.5 h-4 w-4" /> Explore</Button>
        </div>

        {p.description && <p className="whitespace-pre-line text-[15px] leading-relaxed">{p.description}</p>}
        {p.trust && <TrustLine trust={p.trust} />}
        <PlaceHours hours={p.hours} />
        <PlaceAccess access={p.access} />
        {stories && <div className="space-y-1.5"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Events & stories here</p>{stories}</div>}
        {multiFloor && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Accessibility className="h-3.5 w-3.5" />
            {hasElevator ? 'Reachable by elevator — turn on step-free in directions.' : 'This venue has no elevator mapped yet.'}
          </p>
        )}
        {!p.navigable && <p className="text-center text-xs text-muted-foreground">Directions aren't offered to this place. Please ask staff.</p>}
        {onStreetDirections && (
          <button onClick={onStreetDirections} className="flex w-full items-center justify-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <Footprints className="h-3.5 w-3.5" /> Walking directions from where you are
          </button>
        )}
        {onReport && (
          <button onClick={onReport} className="flex w-full items-center justify-center gap-1.5 pt-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
            <Flag className="h-3.5 w-3.5" /> Something wrong here? Report a problem
          </button>
        )}
      </div>
    </div>
  );
}

/** Verified / Official, and when the details were last checked. Featured never shows here: it isn't trust. */
export function TrustLine({ trust, compact }: { trust: TrustFields; compact?: boolean }) {
  const t = trustBadge(trust);
  if (!t) return null;
  const strong = t.level !== 'listed';
  if (compact) {
    return strong ? <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400" title={t.detail ?? undefined}><ShieldCheck className="h-3 w-3" /> {t.label}</span> : null;
  }
  return (
    <div className={cn('flex gap-3 rounded-2xl p-3', strong ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'bg-muted/50')}>
      <ShieldCheck className={cn('mt-0.5 h-4 w-4 shrink-0', strong ? 'text-emerald-600' : 'text-muted-foreground')} />
      <div className="space-y-0.5 text-sm">
        {strong && <p className="font-semibold text-emerald-800 dark:text-emerald-300">{t.label}</p>}
        {t.detail && <p className="text-xs text-muted-foreground">{t.detail}</p>}
      </div>
    </div>
  );
}

function PlaceHours({ hours }: { hours: OpeningHours | null }) {
  if (!hours) return null;
  const st = openStatus(hours);
  return (
    <div className="flex gap-3 rounded-2xl bg-muted/50 p-3">
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="space-y-0.5 text-sm">
        {st && <p className={cn('font-semibold', st.open ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>{st.text}</p>}
        <p className="text-xs text-muted-foreground">{hoursSummary(hours)}</p>
        {hours.note && <p className="text-xs text-muted-foreground">{hours.note}</p>}
      </div>
    </div>
  );
}

function PlaceAccess({ access }: { access: PlaceAccessibility }) {
  const keys = (Object.keys(ACCESSIBILITY_LABELS) as (keyof typeof ACCESSIBILITY_LABELS)[]).filter(k => access[k]);
  if (!keys.length && !access.notes) return null;
  return (
    <div className="flex gap-3 rounded-2xl bg-muted/50 p-3">
      <Accessibility className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1">
        <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {keys.map(k => <li key={k} className="flex items-center gap-1 text-xs"><Check className="h-3 w-3 text-emerald-600" /> {ACCESSIBILITY_LABELS[k]}</li>)}
        </ul>
        {access.notes && <p className="text-xs text-muted-foreground">{access.notes}</p>}
      </div>
    </div>
  );
}
