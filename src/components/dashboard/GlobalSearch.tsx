// Search everything in the venue (Ctrl/⌘ K): places, areas, floors or zones,
// events and other content, and dashboard pages.

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Square, Layers, Newspaper, CornerDownLeft } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { CONTENT_KINDS, PLACE_TYPES, type ContentKind } from '@/lib/venue/places';
import { useDashboard } from './DashboardContext';
import { NAV, contentPath } from './nav';

export default function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, places, area } = useDashboard();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onOpenChange(!open); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const go = (to: string) => { onOpenChange(false); navigate(to); };
  const floorName = new Map(data.floors.map(f => [f.id, f.name] as const));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search places, areas, events, content…" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {places.length > 0 && (
          <CommandGroup heading="Places">
            {places.slice(0, 200).map(p => {
              const Icon = PLACE_TYPES[p.type].icon;
              return (
                <CommandItem key={p.key} value={`place ${p.name} ${p.typeLabel} ${p.key}`} onSelect={() => go(`/dashboard/places?edit=${encodeURIComponent(p.key)}`)}>
                  <Icon className="mr-2 h-4 w-4" /> {p.name} <span className="ml-2 text-xs text-muted-foreground">{p.typeLabel}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {data.rooms.some(r => r.name.trim()) && (
          <CommandGroup heading="Areas">
            {data.rooms.filter(r => r.name.trim()).slice(0, 200).map(r => (
              <CommandItem key={r.id} value={`area ${r.name} ${r.type} ${r.id}`} onSelect={() => go(`/dashboard/areas?focus=${r.id}`)}>
                <Square className="mr-2 h-4 w-4" /> {r.name} <span className="ml-2 text-xs text-muted-foreground">{floorName.get(r.floorId)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading={area.many}>
          {data.floors.map(f => (
            <CommandItem key={f.id} value={`floor zone ${f.name} ${f.id}`} onSelect={() => go('/dashboard/floors')}>
              <Layers className="mr-2 h-4 w-4" /> {f.name}
            </CommandItem>
          ))}
        </CommandGroup>
        {data.content.length > 0 && (
          <CommandGroup heading="Content">
            {data.content.map(c => (
              <CommandItem key={c.id} value={`content ${c.title} ${c.kind} ${c.id}`} onSelect={() => go(`${contentPath(c.kind as ContentKind)}?edit=${c.id}`)}>
                <Newspaper className="mr-2 h-4 w-4" /> {c.title} <span className="ml-2 text-xs text-muted-foreground">{CONTENT_KINDS[c.kind as ContentKind]?.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Go to">
          {NAV.flatMap(g => g.items).filter(i => i.to).map(i => (
            <CommandItem key={i.to} value={`page ${i.label}`} onSelect={() => go(i.to!)}>
              <i.icon className="mr-2 h-4 w-4" /> {i.label === 'Floors' ? area.many : i.label} <CornerDownLeft className="ml-auto h-3.5 w-3.5 opacity-40" />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
