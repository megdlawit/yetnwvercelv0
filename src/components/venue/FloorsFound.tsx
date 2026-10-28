// The floors found in a file, drawn like the building they make: top floor
// first, each with its level badge (G, 1, 2 … B1), and what was left out
// (roof, site, another building) underneath. Shared by both floor imports.

import { Building2, AlertTriangle, CircleSlash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fillLevels, orderBasements, type FloorPart } from '@/lib/cad/floorParts';

/** "G" for the ground floor, "B1" for the first basement, else the number. */
export const levelGlyph = (level: number) => (level === 0 ? 'G' : level < 0 ? `B${-level}` : String(level));

export function LevelBadge({ level, off, size = 'md', className }: { level: number; off?: boolean; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-xl font-bold tabular-nums leading-none',
      size === 'sm' ? 'h-6 w-6 text-[11px]' : size === 'lg' ? 'h-12 w-12 text-lg' : 'h-8 w-8 text-sm',
      off ? 'border border-dashed text-muted-foreground' : level < 0 ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground', className)}
      title={level === 0 ? 'Ground floor' : level < 0 ? `Basement ${-level}` : `Level ${level}`}>
      {levelGlyph(level)}
    </span>
  );
}

export default function FloorsFound({ floors, area = { one: 'floor', many: 'floors' } }: { floors: FloorPart[]; area?: { one: string; many: string } }) {
  const levelled = fillLevels(orderBasements(floors));
  const on = levelled.filter(f => f.include !== false).sort((a, b) => b.level - a.level);
  const off = levelled.filter(f => f.include === false);
  const untitled = on.some(f => f.note?.startsWith('The sheet has no floor titles'));
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <header className="flex items-center gap-3 border-b bg-primary/5 px-3 py-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><Building2 className="h-5 w-5" /></span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{on.length} {on.length === 1 ? area.one : area.many} found</span>
          <span className="block text-[11px] text-muted-foreground">Each becomes its own {area.one}, stacked by level</span>
        </span>
      </header>

      <ol className="relative px-3 py-2">
        {/* The building's spine, through the level badges. */}
        {on.length > 1 && <span aria-hidden className="absolute bottom-5 left-[27px] top-5 w-px bg-primary/25" />}
        {on.map(f => (
          <li key={f.key} className="relative flex items-center gap-2.5 py-1">
            <LevelBadge level={f.level} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{f.name}</span>
              {f.note && !f.note.startsWith('The sheet has no floor titles') && <span className="block truncate text-[11px] text-muted-foreground">{f.note}</span>}
            </span>
          </li>
        ))}
      </ol>

      {off.length > 0 && (
        <div className="border-t px-3 py-2">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">Left out — not a {area.one}? You can still add {off.length === 1 ? 'it' : 'them'} in the next step</p>
          <ul className="space-y-1">
            {off.map(f => (
              <li key={f.key} className="flex items-center gap-2.5 text-xs text-muted-foreground">
                <CircleSlash className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{f.name}{f.note ? ` — ${f.note}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {untitled && (
        <p className="flex gap-1.5 border-t bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> The sheet has no floor titles, so the {area.many} are named in order, left to right. Check them in the next step.
        </p>
      )}
      <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Elevations, sections and the site plan aren&apos;t {area.many} and are left out.</p>
    </section>
  );
}
