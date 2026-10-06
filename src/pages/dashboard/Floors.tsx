// Floors (buildings) or zones (outdoor sites): add, rename, reorder, remove.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, PenTool, Trash2, ArrowUp, ArrowDown, Layers } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import AddFloorsDialog from '@/components/venue/AddFloorsDialog';
import { PageHeader } from './ui';

export default function Floors() {
  const { data, reload, area, editorUrl, places } = useDashboard();
  const navigate = useNavigate();
  const site = data.building.layout === 'site';
  const [names, setNames] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  // A floor "has a map" when anything is drawn on it — then importing onto it replaces that.
  const existing = data.floors.map(f => ({
    id: f.id, name: f.name, level: f.level,
    hasMap: data.rooms.some(r => r.floorId === f.id) || data.nodes.some(n => n.floorId === f.id),
  }));

  const rename = async (id: string, name: string) => {
    const { error } = await supabase.from('floors').update({ name }).eq('id', id);
    if (error) toast.error(error.message); else reload();
  };

  // Swap levels with the neighbour (through a temporary level, in case levels are unique).
  const swap = async (i: number, j: number) => {
    const a = data.floors[i], b = data.floors[j];
    const steps = [
      supabase.from('floors').update({ level: -9999 }).eq('id', a.id),
      supabase.from('floors').update({ level: a.level }).eq('id', b.id),
      supabase.from('floors').update({ level: b.level }).eq('id', a.id),
    ];
    for (const s of steps) { const { error } = await s; if (error) { toast.error(error.message); break; } }
    reload();
  };

  const remove = async () => {
    if (!removing) return;
    const { error } = await supabase.from('floors').delete().eq('id', removing.id);
    setRemoving(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${removing.name} removed`); reload();
  };

  return (
    <>
      <PageHeader title={area.many}
        description={site ? 'Zones split an outdoor site into parts visitors understand — North Zone, Central Garden, Lake Area. Each zone has its own map.' : 'Each floor of the building has its own plan. Visitors switch floors on the map, and directions cross floors by stairs and lifts.'} />
      <div className="overflow-hidden rounded-3xl border bg-card">
        <div className="divide-y">
          {[...data.floors].map((f, i) => {
            const areas = data.rooms.filter(r => r.floorId === f.id).length;
            const pl = places.filter(p => p.floorId === f.id).length;
            return (
              <div key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-sm font-bold text-primary">{site ? i + 1 : f.level}</span>
                <Input value={names[f.id] ?? f.name} onChange={e => setNames(n => ({ ...n, [f.id]: e.target.value }))} aria-label={`${area.one} name`} className="h-9 max-w-xs"
                  onBlur={() => { const v = names[f.id]?.trim(); if (v && v !== f.name) rename(f.id, v); }} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                <span className="flex-1 text-xs text-muted-foreground">{areas} areas · {pl} places</span>
                <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => swap(i, i - 1)} aria-label="Move down a level"><ArrowDown className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" disabled={i === data.floors.length - 1} onClick={() => swap(i, i + 1)} aria-label="Move up a level"><ArrowUp className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" onClick={() => { const u = editorUrl(f.id); if (u) navigate(u); }}><PenTool className="mr-1.5 h-3.5 w-3.5" /> Edit map</Button>
                <Button size="icon" variant="ghost" className="text-destructive" disabled={data.floors.length === 1} onClick={() => setRemoving({ id: f.id, name: f.name })} aria-label={`Remove ${f.name}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            );
          })}
          {!data.floors.length && <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground"><Layers className="h-4 w-4" /> No {area.many.toLowerCase()} yet.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t bg-muted/30 px-5 py-3">
          <Button size="sm" onClick={() => setAdding(true)}><Plus className="mr-1.5 h-4 w-4" /> Add {area.many.toLowerCase()}</Button>
          <span className="text-xs text-muted-foreground">From your plans — all {area.many.toLowerCase()} in one file, or one file each — or an empty {area.one.toLowerCase()} to draw.</span>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Is this {site ? 'actually a building' : 'an outdoor site'}? Switch between floors and zones in Venue Settings.</p>

      <AddFloorsDialog open={adding} onOpenChange={setAdding} buildingId={data.building.id} floors={existing} area={area}
        onDone={async made => { await reload(); if (made.length === 1 && !site) toast.success(`${made[0].name} is ready`); }} />

      <AlertDialog open={!!removing} onOpenChange={o => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Its plan, areas, paths and places on this {area.one.toLowerCase()} are deleted too. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
