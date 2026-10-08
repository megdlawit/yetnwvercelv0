// A place / address search box that suggests as you type: arrow keys to
// move, Enter to pick, Esc to close. Shows recent picks before you type, and
// "my location". Used to find a venue's site on the world map.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Search, Loader2, X, MapPin, Building2, Trees, Landmark, Route, Hotel, GraduationCap, Hospital, ShoppingBag,
  UtensilsCrossed, Church, Crosshair, History, LocateFixed, Camera, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePlaceSuggestions, type PlaceSuggestion } from '@/hooks/usePlaceSuggestions';

const RECENT_KEY = 'yetnew-place-search-recent';

function readRecent(): PlaceSuggestion[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 5) : []; } catch { return []; }
}
function remember(p: PlaceSuggestion) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([p, ...readRecent().filter(r => r.id !== p.id)].slice(0, 5))); } catch { /* private mode */ }
}

/** An icon for the kind of place. */
function iconFor(p: PlaceSuggestion): LucideIcon {
  const t = p.type, k = p.kind;
  if (k === 'coordinates') return Crosshair;
  if (/park|garden|nature|wood|forest|zoo|playground/.test(t)) return Trees;
  if (/museum|gallery|attraction|monument|memorial|artwork|viewpoint/.test(t) || k === 'historic') return Camera;
  if (/hospital|clinic|doctors|pharmacy/.test(t)) return Hospital;
  if (/university|college|school|kindergarten/.test(t)) return GraduationCap;
  if (/hotel|hostel|guest_house/.test(t)) return Hotel;
  if (/restaurant|cafe|fast_food|bar|pub/.test(t)) return UtensilsCrossed;
  if (/church|mosque|place_of_worship|cathedral/.test(t)) return Church;
  if (k === 'shop' || /mall|marketplace|supermarket/.test(t)) return ShoppingBag;
  if (k === 'highway' || k === 'railway') return Route;
  if (k === 'building' || /office|government|townhall/.test(t)) return Building2;
  if (k === 'tourism' || k === 'amenity') return Landmark;
  return MapPin;
}

/** The typed words in bold. */
function highlight(text: string, query: string): ReactNode {
  const words = query.trim().split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return text;
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'ig'));
  return parts.map((part, i) => (i % 2 ? <mark key={i} className="bg-transparent font-semibold text-foreground">{part}</mark> : part));
}

export default function PlaceSearch({ near, onPick, onLocate, placeholder = 'Search a place or address…', className }: {
  near: { lat: number; lng: number } | null;
  onPick: (p: PlaceSuggestion) => void;
  onLocate?: () => void;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState(readRecent);
  // Only search while the list is open (not for the name a pick just filled in).
  const { results, loading, failed } = usePlaceSuggestions(open ? query : '', near);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  const typing = query.trim().length >= 2;
  // Before typing: my location, then recent picks.
  const items = useMemo(() => (typing ? results : recent), [typing, results, recent]);
  const showLocate = !typing && !!onLocate;
  const count = items.length + (showLocate ? 1 : 0);
  useEffect(() => { setActive(0); }, [query, open]);

  // Close when clicking elsewhere.
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [open]);

  const pick = (p: PlaceSuggestion) => {
    remember(p); setRecent(readRecent());
    setQuery(p.name);
    setOpen(false);
    onPick(p);
  };
  const choose = (i: number) => {
    if (showLocate && i === 0) { setOpen(false); onLocate?.(); return; }
    const p = items[i - (showLocate ? 1 : 0)];
    if (p) pick(p);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => (count ? (a + 1) % count : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (count ? (a - 1 + count) % count : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (count) choose(Math.min(active, count - 1)); }
    else if (e.key === 'Escape') setOpen(false);
  };

  const row = (i: number, Icon: LucideIcon, title: ReactNode, sub: ReactNode, tone: 'place' | 'muted' = 'place') => (
    <li key={i} id={`${listId}-${i}`} role="option" aria-selected={active === i}
      onPointerDown={e => e.preventDefault()} onClick={() => choose(i)} onPointerEnter={() => setActive(i)}
      className={cn('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2', active === i ? 'bg-primary/10' : 'hover:bg-muted')}>
      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', tone === 'place' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground/90">{title}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
    </li>
  );

  return (
    <div ref={box} className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={query} placeholder={placeholder} autoComplete="off" spellCheck={false}
        role="combobox" aria-expanded={open && count > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && count ? `${listId}-${active}` : undefined}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
        className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          : query && <button type="button" onClick={() => { setQuery(''); setOpen(true); }} aria-label="Clear search" className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>}
      </span>
      {open && (count > 0 || (typing && !loading)) && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-11 z-30 max-h-80 overflow-y-auto rounded-2xl border bg-popover p-1 shadow-xl">
          {showLocate && row(0, LocateFixed, 'Use my current location', 'Go to where you are now', 'muted')}
          {!typing && recent.length > 0 && <li className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground" aria-hidden>Recent</li>}
          {items.map((p, n) => {
            const i = n + (showLocate ? 1 : 0);
            return row(i, typing ? iconFor(p) : History, typing ? highlight(p.name, query) : p.name, p.detail, typing ? 'place' : 'muted');
          })}
          {typing && !loading && !results.length && (
            <li className="px-3 py-3 text-sm text-muted-foreground">
              {failed ? 'Search is unavailable right now — check your connection.' : <>No places match “{query.trim()}”. Try a nearby landmark or the city name.</>}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
