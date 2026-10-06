// Accessibility at a glance: tick what each place offers, see what visitors
// with a wheelchair or a pram can rely on.

import { useState } from 'react';
import { toast } from 'sonner';
import { Accessibility, Search, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ACCESSIBILITY_LABELS, PLACE_TYPES, parseAccessibility, type Accessibility as Acc } from '@/lib/venue/places';
import { savePlace, type PoiPatch } from '@/components/venue/dashboard/placesApi';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import { PageHeader, Panel } from './ui';

type Key = keyof typeof ACCESSIBILITY_LABELS;
const KEYS = Object.keys(ACCESSIBILITY_LABELS) as Key[];

export default function AccessibilityPage() {
  const { data, places, reload } = useDashboard();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const visible = places.filter(p => p.visible);
  const accOf = (p: typeof places[number]) => parseAccessibility(p.poi?.accessibility);
  const count = (k: Key) => visible.filter(p => accOf(p)[k]).length;
  const hasLift = data.rooms.some(r => r.type === 'elevator');
  const multiLevel = data.floors.length > 1 && data.building.layout !== 'site';

  const toggle = async (p: typeof places[number], k: Key, v: boolean) => {
    setBusy(p.key);
    try { await savePlace(data.building.id, p, { accessibility: { ...accOf(p), [k]: v } as Acc as unknown as PoiPatch['accessibility'] }); await reload(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save'); }
    finally { setBusy(null); }
  };

  const q = query.trim().toLowerCase();
  const shown = places.filter(p => !q || p.name.toLowerCase().includes(q));

  return (
    <>
      <PageHeader title="Accessibility" description="Tell visitors what each place offers. It shows on every place, and step-free directions avoid stairs automatically." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KEYS.map(k => (
          <Panel key={k} bodyClassName="p-4">
            <p className="text-xs text-muted-foreground">{ACCESSIBILITY_LABELS[k]}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{count(k)} <span className="text-sm font-normal text-muted-foreground">of {visible.length} places</span></p>
          </Panel>
        ))}
      </div>
      {multiLevel && (
        <p className={`mb-4 flex items-center gap-2 rounded-2xl px-4 py-3 text-sm ${hasLift ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'}`}>
          {hasLift ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {hasLift ? 'Elevators are on the map, so step-free routes between floors work.' : 'No elevator is mapped yet — visitors needing step-free routes can\'t change floors. Mark lift areas as “Elevator” under Areas.'}
        </p>
      )}
      <div className="relative mb-3 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search places…" className="pl-9" />
      </div>
      <div className="overflow-x-auto rounded-3xl border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Place</th>
              {KEYS.map(k => <th key={k} className="px-3 py-3 text-center font-medium">{ACCESSIBILITY_LABELS[k]}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map(p => {
              const a = accOf(p), Icon = PLACE_TYPES[p.type].icon;
              return (
                <tr key={p.key} className={busy === p.key ? 'opacity-60' : ''}>
                  <td className="px-5 py-2.5"><span className="flex items-center gap-2"><Icon className="h-4 w-4 text-muted-foreground" /> {p.name}</span></td>
                  {KEYS.map(k => (
                    <td key={k} className="px-3 py-2.5 text-center">
                      <Checkbox checked={!!a[k]} disabled={busy === p.key} onCheckedChange={v => toggle(p, k, !!v)} aria-label={`${p.name}: ${ACCESSIBILITY_LABELS[k]}`} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <p className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted-foreground"><Accessibility className="h-4 w-4" /> No places yet.</p>}
      </div>
    </>
  );
}
