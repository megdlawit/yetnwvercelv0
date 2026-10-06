// Venue Settings → Indoor 3D map: how the venue's indoor map looks to
// visitors — which view opens first, how tall walls stand, and which details
// show by default (visitors can still flip each one in Map Layers). The
// details themselves — walls, rooms, doors, stairs, furniture, trees — are
// drawn in the map editor. Live preview; goes live on Publish.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Box, Square, Loader2, PenTool, ExternalLink, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { themeOf } from '@/lib/venue/themes';
import {
  DEFAULT_MAP_SETTINGS, INDOOR_LAYERS, WALL_HEIGHT_RANGE, parseMapSettings, type IndoorLayerId, type VenueMapSettings,
} from '@/lib/venue/mapSettings';
import VenueViewer from './VenueViewer';
import type { VenueData } from './useVenue';

const same = (a: VenueMapSettings, b: VenueMapSettings) => JSON.stringify(a) === JSON.stringify(b);

export default function IndoorMapSettings({ data, editorUrl, onSaved }: {
  data: VenueData; editorUrl: (floorId?: string) => string | null; onSaved: () => void;
}) {
  const b = data.building;
  const saved = useMemo(() => parseMapSettings(b.map_settings, b.hero_view), [b.map_settings, b.hero_view]);
  const [s, setS] = useState<VenueMapSettings>(saved);
  const [floorId, setFloorId] = useState<string | null>(data.floors[0]?.id ?? null);
  const [preview, setPreview] = useState<'3d' | '2d'>(saved.defaultView);
  const [saving, setSaving] = useState(false);
  const floor = data.floors.find(f => f.id === floorId) ?? null;
  const missing = data.missing.includes('map_settings');
  const dirty = !same(s, saved);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('buildings').update({ map_settings: s as unknown as Json }).eq('id', b.id);
    setSaving(false);
    if (error) { toast.error(/map_settings/.test(error.message) ? 'Run migration 20261005090000_indoor_map_settings.sql first.' : error.message); return; }
    toast.success('Saved — visitors see it after you publish');
    onSaved();
  };
  const setLayer = (id: IndoorLayerId, on: boolean) => setS(x => ({ ...x, layers: { ...x.layers, [id]: on } }));

  return (
    <div className="space-y-5">
      {missing && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Run the database update <code className="text-xs">20261005090000_indoor_map_settings.sql</code> to save these settings.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          {/* opening view */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Visitors' indoor map opens in</Label>
            <div className="grid grid-cols-2 gap-2">
              {([['3d', Box, '3D world', 'Walls, rooms and objects standing up'], ['2d', Square, '2D plan', 'A flat, simple floor plan']] as const).map(([id, Icon, label, sub]) => (
                <button key={id} type="button" onClick={() => { setS(x => ({ ...x, defaultView: id })); setPreview(id); }} aria-pressed={s.defaultView === id}
                  className={cn('rounded-2xl border p-3 text-left transition-colors', s.defaultView === id ? 'border-primary bg-primary/10' : 'hover:bg-muted')}>
                  <Icon className="h-5 w-5 text-primary" />
                  <span className="mt-1 block text-sm font-semibold">{label}</span>
                  <span className="block text-xs text-muted-foreground">{sub}</span>
                </button>
              ))}
            </div>
          </div>

          {/* wall height */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Wall height in 3D</Label>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">{s.wallHeightM.toFixed(1)} m</span>
            </div>
            <Slider min={WALL_HEIGHT_RANGE.min} max={WALL_HEIGHT_RANGE.max} step={WALL_HEIGHT_RANGE.step} value={[s.wallHeightM]}
              onValueChange={([v]) => { setS(x => ({ ...x, wallHeightM: Math.round(v * 10) / 10 })); setPreview('3d'); }} aria-label="Wall height in metres" />
            <p className="text-xs text-muted-foreground">Lower walls let visitors see into rooms from above; taller ones feel more like the real building.</p>
          </div>

          {/* layers */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Shown by default (visitors can change these in Map Layers)</Label>
            <div className="divide-y rounded-2xl border">
              {INDOOR_LAYERS.map(l => (
                <label key={l.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{l.label}</span>
                    <span className="block text-xs text-muted-foreground">{l.description}</span>
                  </span>
                  <Switch checked={s.layers[l.id]} onCheckedChange={v => setLayer(l.id, v)} aria-label={l.label} />
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* live preview */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl bg-muted p-0.5">
              {([['3d', Box, '3D'], ['2d', Square, '2D']] as const).map(([id, Icon, label]) => (
                <button key={id} onClick={() => setPreview(id)} aria-pressed={preview === id}
                  className={cn('flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold', preview === id ? 'bg-card shadow-sm' : 'text-muted-foreground')}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
            {data.floors.length > 1 && (
              <select value={floorId ?? ''} onChange={e => setFloorId(e.target.value)} className="h-8 rounded-lg border bg-card px-2 text-xs" aria-label="Floor to preview">
                {data.floors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}
            <span className="ml-auto text-[11px] font-medium text-muted-foreground">Live preview</span>
          </div>
          <VenueViewer buildingId={b.id} floorId={floorId} level={floor?.level ?? 0} theme={themeOf(b.theme)} mode={preview}
            wallHeight={s.wallHeightM} layers={s.layers} className="h-[340px] overflow-hidden rounded-2xl border"
            emptyText="Nothing drawn on this floor yet — open the map editor to add walls, rooms and objects." />
          <p className="text-xs text-muted-foreground">
            The 3D details come from your map: add walls, rooms, doors, stairs, lifts, furniture and trees in the map editor.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={!dirty || saving || missing}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save</Button>
        {dirty && <Button variant="ghost" onClick={() => setS(saved)}><RotateCcw className="mr-1.5 h-4 w-4" /> Undo changes</Button>}
        {!same(s, DEFAULT_MAP_SETTINGS) && !dirty && (
          <Button variant="ghost" onClick={() => setS({ ...DEFAULT_MAP_SETTINGS, defaultView: s.defaultView })}><RotateCcw className="mr-1.5 h-4 w-4" /> Reset to defaults</Button>
        )}
        {editorUrl(floorId ?? undefined) && (
          <Button variant="outline" asChild><Link to={editorUrl(floorId ?? undefined)!}><PenTool className="mr-1.5 h-4 w-4" /> Open map editor</Link></Button>
        )}
        <Button variant="outline" asChild><a href={`/venue/${b.id}?preview=1`} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" /> Preview as visitor</a></Button>
      </div>
    </div>
  );
}
