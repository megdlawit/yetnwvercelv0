// The home page search: venues on Yet New (their indoor map, or outdoor),
// places inside them, and any address on the world map — suggested as you
// type. Arrow keys and Enter work.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Globe2, Loader2, MapPin, Search, X } from 'lucide-react';
import { usePlaceSuggestions } from '@/hooks/usePlaceSuggestions';
import { loadVenueIndex, matchScore, type VenueIndex } from '@/components/visitor/venueSearch';

const ADDIS = { lat: 9.0108, lng: 38.7613 };

interface Row { key: string; icon: ReactNode; title: ReactNode; sub: string; go: () => void; extra?: { label: string; go: () => void } }

function bold(text: string, query: string): ReactNode {
  const words = query.trim().split(/\s+/).filter(w => w.length > 0).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return text;
  return text.split(new RegExp(`(${words.join('|')})`, 'ig')).map((p, i) => (i % 2 ? <b key={i} className="font-bold text-ink">{p}</b> : p));
}

export function HomeSearch({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [index, setIndex] = useState<VenueIndex | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const typing = q.trim().length >= 2;
  const { results: outdoor, loading } = usePlaceSuggestions(open && typing ? q : '', ADDIS);

  useEffect(() => { if (open && !index) void loadVenueIndex().then(setIndex); }, [open, index]);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [open]);

  const rows = useMemo<{ title: string; rows: Row[] }[]>(() => {
    const venues = index?.venues ?? [], places = index?.places ?? [];
    const venueRow = (v: VenueIndex['venues'][number]): Row => ({
      key: `v-${v.id}`,
      icon: v.cover ? <img src={v.cover} alt="" className="h-full w-full object-cover" /> : <Building2 className="h-[18px] w-[18px]" />,
      title: bold(v.name, q), sub: [v.institution, v.tagline].filter(Boolean).join(' · ') || 'Indoor map',
      go: () => navigate(`/venue/${v.id}`),
      extra: v.placed ? { label: 'Outdoor', go: () => navigate(`/venue/${v.id}?view=outdoor`) } : undefined,
    });
    if (!typing) return venues.length ? [{ title: 'Venues on Yet New', rows: venues.slice(0, 5).map(venueRow) }] : [];
    const out: { title: string; rows: Row[] }[] = [];
    const vs = venues.map(v => ({ v, s: Math.max(matchScore(v.name, q), matchScore(v.institution ?? '', q) - 1) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 4);
    if (vs.length) out.push({ title: 'Venues', rows: vs.map(x => venueRow(x.v)) });
    const ps = places.map(p => ({ p, s: matchScore(p.name, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 6);
    if (ps.length) out.push({
      title: 'Places in venues',
      rows: ps.map(({ p }) => ({
        key: `p-${p.venueId}-${p.nodeId}`,
        icon: p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <MapPin className="h-[18px] w-[18px]" />,
        title: bold(p.name, q), sub: [p.venueName, p.detail].filter(Boolean).join(' · '),
        go: () => navigate(`/venue/${p.venueId}?place=${encodeURIComponent(p.nodeId)}`),
      })),
    });
    if (outdoor.length) out.push({
      title: 'On the map',
      rows: outdoor.slice(0, 5).map(o => ({
        key: `o-${o.id}`, icon: <Globe2 className="h-[18px] w-[18px]" />, title: bold(o.name, q), sub: o.detail,
        go: () => navigate(`/explore?lat=${o.lat.toFixed(6)}&lng=${o.lng.toFixed(6)}&name=${encodeURIComponent(o.name)}`),
      })),
    });
    return out;
  }, [index, q, typing, outdoor, navigate]);
  const flat = rows.flatMap(g => g.rows);
  useEffect(() => { setActive(0); }, [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => (flat.length ? (a + 1) % flat.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (flat.length ? (a - 1 + flat.length) % flat.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); flat[Math.min(active, flat.length - 1)]?.go(); }
    else if (e.key === 'Escape') setOpen(false);
  };

  let n = -1;
  return (
    <div ref={box} className={`relative w-full max-w-[460px] ${className}`}>
      <div className="flex h-[52px] items-center gap-2.5 rounded-full bg-white px-4 shadow-[0_10px_30px_rgba(20,50,30,.12),inset_0_0_0_1.5px_rgba(15,61,38,.08)] focus-within:shadow-[0_10px_30px_rgba(20,50,30,.16),inset_0_0_0_2px_#3fdc2c] ph640:h-11">
        <Search className="h-[18px] w-[18px] flex-none text-moss" />
        <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
          placeholder="Search venues, places or an address" autoComplete="off" spellCheck={false}
          role="combobox" aria-expanded={open && flat.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && flat.length ? `${listId}-${active}` : undefined}
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-[15px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-[#7b857d] ph640:text-sm" />
        {loading && typing ? <Loader2 className="h-4 w-4 flex-none animate-spin text-moss" />
          : q && <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="grid h-7 w-7 flex-none place-items-center rounded-full text-moss hover:bg-[#eef3ee]"><X className="h-4 w-4" /></button>}
      </div>
      {open && (flat.length > 0 || (typing && !loading)) && (
        <div id={listId} role="listbox" className="absolute inset-x-0 top-[calc(100%+8px)] z-[60] max-h-[min(420px,60vh)] overflow-y-auto rounded-[22px] bg-white p-1.5 text-left shadow-[0_24px_60px_rgba(20,50,30,.22)]">
          {rows.map(g => (
            <div key={g.title} role="group" aria-label={g.title}>
              <p className="px-3 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[.12em] text-[#7b857d]">{g.title}</p>
              {g.rows.map(r => {
                const i = ++n;
                return (
                  <div key={r.key} id={`${listId}-${i}`} role="option" aria-selected={active === i}
                    onPointerEnter={() => setActive(i)} onPointerDown={e => e.preventDefault()} onClick={r.go}
                    className={`flex cursor-pointer items-center gap-3 rounded-2xl px-2.5 py-2 ${active === i ? 'bg-[#eef6ee]' : ''}`}>
                    <span className="grid h-10 w-10 flex-none place-items-center overflow-hidden rounded-xl bg-[#e8f3e8] text-moss">{r.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-[#33403a]">{r.title}</span>
                      {r.sub && <span className="block truncate text-[12px] text-[#7b857d]">{r.sub}</span>}
                    </span>
                    {r.extra && (
                      <button type="button" onClick={e => { e.stopPropagation(); r.extra!.go(); }}
                        className="flex-none rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-moss shadow-[inset_0_0_0_1.5px_rgba(15,61,38,.15)] hover:bg-ink hover:text-white">
                        {r.extra.label}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {typing && !loading && !flat.length && <p className="px-3 py-3 text-sm text-[#7b857d]">Nothing matches “{q.trim()}” yet.</p>}
        </div>
      )}
    </div>
  );
}
