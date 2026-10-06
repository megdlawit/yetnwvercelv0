// Areas: the rooms, halls, gardens and sections detected on (or drawn into)
// the map. Rename them and set what they are without opening the editor.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Search, PenTool, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Room } from '@/data/types';
import { parsePolygon, roomOutline } from '@/lib/venue/features';
import { polygonArea } from '@/lib/cad/geometry';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import { PageHeader } from './ui';

const TYPES: Record<Room['type'], string> = {
  office: 'Room / hall', meeting: 'Meeting room', entrance: 'Entrance', stairs: 'Stairs', elevator: 'Elevator',
  restroom: 'Restroom', reception: 'Reception', utility: 'Utility / storage',
};

export default function Areas() {
  const { data, reload, area, editorUrl } = useDashboard();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focus = params.get('focus');
  const [query, setQuery] = useState('');
  const [onlyUnnamed, setOnlyUnnamed] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => { if (focus) document.getElementById(`area-${focus}`)?.scrollIntoView({ block: 'center' }); }, [focus]);

  const sizeOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data.rooms) {
      const room = { ...r, nodeId: r.nodeId ?? '', type: r.type as Room['type'], polygon: parsePolygon(r.polygon) } as Room;
      m.set(r.id, polygonArea(roomOutline(room)) / 1600);
    }
    return m;
  }, [data.rooms]);

  const save = async (id: string, patch: { name?: string; type?: string }) => {
    const { error } = await supabase.from('rooms').update(patch).eq('id', id);
    if (error) { toast.error(error.message); return; }
    reload();
  };

  const q = query.trim().toLowerCase();
  const unnamed = data.rooms.filter(r => !r.name.trim()).length;

  return (
    <>
      <PageHeader title="Areas" description={`Rooms, halls, gardens and sections of your venue, grouped by ${area.one.toLowerCase()}. Names show on the map and in search.`}
        actions={<Button variant="outline" onClick={() => { const u = editorUrl(); if (u) navigate(u); }}><PenTool className="mr-1.5 h-4 w-4" /> Draw areas in the editor</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search areas…" className="pl-9" />
        </div>
        {unnamed > 0 && (
          <button onClick={() => setOnlyUnnamed(v => !v)} aria-pressed={onlyUnnamed}
            className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium', onlyUnnamed ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'hover:bg-muted')}>
            <AlertTriangle className="h-3.5 w-3.5" /> {unnamed} without a name
          </button>
        )}
      </div>

      <div className="space-y-6">
        {data.floors.map(f => {
          const rooms = data.rooms.filter(r => r.floorId === f.id && (!onlyUnnamed || !r.name.trim()) && (!q || r.name.toLowerCase().includes(q) || TYPES[r.type as Room['type']]?.toLowerCase().includes(q)))
            .sort((a, b) => (a.name || '~').localeCompare(b.name || '~'));
          if (!rooms.length && (q || onlyUnnamed)) return null;
          return (
            <section key={f.id} className="overflow-hidden rounded-3xl border bg-card">
              <div className="flex items-center justify-between border-b px-5 py-3">
                <h2 className="font-semibold">{f.name} <span className="ml-1 text-xs font-normal text-muted-foreground">{rooms.length} area{rooms.length === 1 ? '' : 's'}</span></h2>
                <Button size="sm" variant="ghost" onClick={() => { const u = editorUrl(f.id); if (u) navigate(u); }}>Open in editor</Button>
              </div>
              {rooms.length ? (
                <div className="divide-y">
                  {rooms.map(r => (
                    <div key={r.id} id={`area-${r.id}`} className={cn('grid grid-cols-1 items-center gap-2 px-5 py-2.5 sm:grid-cols-[minmax(0,1fr)_200px_90px]', r.id === focus && 'bg-primary/5')}>
                      <Input value={names[r.id] ?? r.name} placeholder="Unnamed area — add a name" aria-label="Area name"
                        className={cn('h-9', !r.name.trim() && names[r.id] === undefined && 'border-amber-400')}
                        onChange={e => setNames(n => ({ ...n, [r.id]: e.target.value }))}
                        onBlur={() => { const v = names[r.id]; if (v !== undefined && v.trim() !== r.name) save(r.id, { name: v.trim() }); }}
                        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                      <select value={r.type} onChange={e => save(r.id, { type: e.target.value })} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Area type">
                        {(Object.keys(TYPES) as Room['type'][]).map(t => <option key={t} value={t}>{TYPES[t]}</option>)}
                      </select>
                      <span className="text-right text-sm tabular-nums text-muted-foreground">{(sizeOf.get(r.id) ?? 0).toFixed(0)} m²</span>
                    </div>
                  ))}
                </div>
              ) : <p className="px-5 py-6 text-sm text-muted-foreground">No areas on this {area.one.toLowerCase()} yet. Upload a plan or draw rooms in the editor.</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}
