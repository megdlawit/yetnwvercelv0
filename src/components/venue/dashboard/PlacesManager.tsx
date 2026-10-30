// Dashboard → Places: every place visitors can find, with its full details —
// type, description, photos, location, opening hours, accessibility, and
// whether visitors see it and can be guided to it.

import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Search, Plus, Pencil, Star, ImagePlus, X, Loader2, MapPinOff, Trash2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  PLACE_TYPES, PLACE_TYPE_LIST, DAYS, DAY_LABELS, ACCESSIBILITY_LABELS, parseHours, parseAccessibility, hoursSummary,
  type PlaceType, type OpeningHours, type Accessibility, isBusinessPlaceType,
} from '@/lib/venue/places';
import type { PlaceEntry } from '@/lib/venue/placeList';
import type { PoiRow, VenueData } from './useVenue';
import { savePlace, createPlace, deletePlaceDetails, type PoiPatch } from './placesApi';
import { uploadImage } from './upload';
import BusinessSection from './BusinessSection';

type Entry = PlaceEntry<PoiRow>;

export default function PlacesManager({ data, places, onChanged, types, newType, addLabel = 'Add place', layout = 'list', emptyText }: {
  data: VenueData; places: Entry[]; onChanged: () => void;
  /** Only these kinds of place (e.g. the Attractions page). */
  types?: PlaceType[];
  /** Type a new place starts as. */
  newType?: PlaceType;
  addLabel?: string;
  layout?: 'list' | 'cards';
  emptyText?: string;
}) {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<PlaceType | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const floorName = useMemo(() => new Map(data.floors.map(f => [f.id, f.name] as const)), [data.floors]);

  // The open editor lives in the URL (?edit=<place> / ?new=1), so search results and links can open it.
  const editKey = params.get('edit');
  const editing: Entry | 'new' | null = params.get('new') ? 'new' : editKey ? places.find(p => p.key === editKey) ?? null : null;
  const setEditing = (e: Entry | 'new' | null) => {
    const next = new URLSearchParams(params);
    next.delete('edit'); next.delete('new');
    if (e === 'new') next.set('new', '1'); else if (e) next.set('edit', e.key);
    setParams(next, { replace: true });
  };

  const scoped = types ? places.filter(p => types.includes(p.type)) : places;
  const shown = scoped.filter(p =>
    (type === 'all' || p.type === type) &&
    (!query.trim() || `${p.name} ${p.typeLabel}`.toLowerCase().includes(query.trim().toLowerCase())));

  const quick = async (p: Entry, patch: PoiPatch) => {
    setBusy(p.key);
    try { await savePlace(data.building.id, p, patch); onChanged(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save'); }
    finally { setBusy(null); }
  };

  const where = (p: Entry) => p.nodeId ? (data.floors.length > 1 && p.floorId ? floorName.get(p.floorId) ?? '' : '') : 'Not on the map';
  const cover = (p: Entry) => p.poi?.images?.[0] || p.poi?.image_url || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search places…" className="pl-9" aria-label="Search places" />
        </div>
        {(!types || types.length > 1) && (
          <select value={type} onChange={e => setType(e.target.value as PlaceType | 'all')} className="h-10 rounded-md border bg-background px-3 text-sm" aria-label="Filter by type">
            <option value="all">All types ({scoped.length})</option>
            {(types ?? PLACE_TYPE_LIST).map(t => {
              const n = scoped.filter(p => p.type === t).length;
              return n ? <option key={t} value={t}>{PLACE_TYPES[t].label} ({n})</option> : null;
            })}
          </select>
        )}
        <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4 mr-1.5" /> {addLabel}</Button>
      </div>

      {layout === 'cards' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(p => {
            const Icon = PLACE_TYPES[p.type].icon, img = cover(p);
            return (
              <article key={p.key} className={cn('overflow-hidden rounded-2xl border bg-card shadow-sm', !p.visible && 'opacity-60')}>
                <button onClick={() => setEditing(p)} className="block w-full text-left">
                  {img ? <img src={img} alt="" className="h-40 w-full object-cover" /> : <div className="flex h-40 items-center justify-center bg-gradient-to-br from-primary/15 to-primary/5"><Icon className="h-10 w-10 text-primary/60" /></div>}
                  <div className="p-4">
                    <p className="flex items-center gap-1.5 font-semibold">{p.name} {p.featured && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}</p>
                    <p className="text-xs text-muted-foreground">{[p.typeLabel, where(p)].filter(Boolean).join(' · ')}</p>
                    {p.poi?.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{p.poi.description}</p>}
                  </div>
                </button>
                <div className="flex items-center gap-4 border-t px-4 py-2.5 text-xs text-muted-foreground">
                  <label className="flex items-center gap-2"><Switch checked={p.visible} disabled={busy === p.key} onCheckedChange={v => quick(p, { is_visible: v })} aria-label={`Show ${p.name} to visitors`} /> Visible</label>
                  <label className="flex items-center gap-2"><Switch checked={p.featured} disabled={busy === p.key} onCheckedChange={v => quick(p, { is_featured: v })} aria-label={`Feature ${p.name}`} /> Featured</label>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border bg-card divide-y">
          {shown.map(p => {
            const Icon = PLACE_TYPES[p.type].icon, img = cover(p);
            return (
              <div key={p.key} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', !p.visible && 'opacity-60')}>
                {img
                  ? <img src={img} alt="" className="h-10 w-10 rounded-lg object-cover shrink-0" />
                  : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate flex items-center gap-1.5">
                    {p.name} {p.featured && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[p.typeLabel, where(p)].filter(Boolean).join(' · ')}
                    {!p.poi && ' · no details yet'}
                    {p.poi?.opening_hours && ` · ${hoursSummary(parseHours(p.poi.opening_hours)).split(' · ')[0]}`}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground" title="Shown to visitors">
                  <Switch checked={p.visible} disabled={busy === p.key} onCheckedChange={v => quick(p, { is_visible: v })} aria-label={`Show ${p.name} to visitors`} /> Visible
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground" title="Offer “Navigate here”">
                  <Switch checked={p.navigable} disabled={busy === p.key || !p.nodeId} onCheckedChange={v => quick(p, { navigable: v })} aria-label={`Offer directions to ${p.name}`} /> Directions
                </label>
                <Button size="sm" variant="outline" onClick={() => setEditing(p)}><Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit</Button>
              </div>
            );
          })}
        </div>
      )}
      {!shown.length && (
        <div className="rounded-2xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
          {scoped.length ? 'No places match.' : emptyText ?? 'No places yet. Name places in the map editor (or upload a plan) and they appear here — or add one now.'}
        </div>
      )}

      <PlaceEditor
        key={editing === 'new' ? 'new' : editing?.key ?? 'none'}
        data={data} entry={editing} defaultType={newType ?? types?.[0]} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); onChanged(); }}
      />
    </div>
  );
}

interface Form {
  name: string; place_type: PlaceType; custom_type: string; description: string; images: string[];
  floor_id: string; node_id: string; lat: string; lng: string;
  hoursOn: boolean; hours: OpeningHours; accessibility: Accessibility;
  is_visible: boolean; navigable: boolean; is_featured: boolean;
  /** Greet visitors who come within this many metres (0 = off). */
  greet_m: number;
}

const DEFAULT_HOURS: OpeningHours = { mon: [['08:00', '18:00']], tue: [['08:00', '18:00']], wed: [['08:00', '18:00']], thu: [['08:00', '18:00']], fri: [['08:00', '18:00']], sat: [['09:00', '18:00']], sun: [['09:00', '18:00']] };

function formOf(entry: Entry | null, data: VenueData, defaultType: PlaceType = 'attraction'): Form {
  const poi = entry?.poi;
  const hours = parseHours(poi?.opening_hours);
  return {
    name: entry?.name ?? '', place_type: entry?.type ?? defaultType, custom_type: poi?.custom_type ?? '',
    description: poi?.description ?? '', images: poi?.images?.length ? poi.images : poi?.image_url ? [poi.image_url] : [],
    floor_id: entry?.floorId ?? data.floors[0]?.id ?? '', node_id: entry?.nodeId ?? '',
    lat: poi?.lat?.toString() ?? '', lng: poi?.lng?.toString() ?? '',
    hoursOn: !!hours, hours: hours ?? DEFAULT_HOURS, accessibility: parseAccessibility(poi?.accessibility),
    is_visible: entry?.visible ?? true, navigable: entry?.navigable ?? true, is_featured: entry?.featured ?? false,
    greet_m: poi?.trigger_radius ?? 0,
  };
}

function PlaceEditor({ data, entry, defaultType, onClose, onSaved }: { data: VenueData; entry: Entry | 'new' | null; defaultType?: PlaceType; onClose: () => void; onSaved: () => void }) {
  const isNew = entry === 'new';
  const current = entry === 'new' ? null : entry;
  const [f, setF] = useState<Form>(() => formOf(current, data, defaultType));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(prev => ({ ...prev, [k]: v }));

  const roomName = useMemo(() => new Map(data.rooms.filter(r => r.nodeId).map(r => [r.nodeId!, r.name] as const)), [data.rooms]);
  const nodeOptions = data.nodes.filter(n => n.floorId === f.floor_id && !n.isHallway)
    .map(n => ({ id: n.id, label: roomName.get(n.id) || n.name || 'Unnamed spot' }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) urls.push(await uploadImage(file, 'places', data.building.institution_id));
      setF(prev => ({ ...prev, images: [...prev.images, ...urls] }));
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed'); }
    finally { setUploading(false); }
  };

  const setDay = (d: typeof DAYS[number], span: [string, string] | null) =>
    setF(prev => ({ ...prev, hours: { ...prev.hours, [d]: span ? [span] : [] } }));

  const save = async () => {
    if (!f.name.trim()) { toast.error('Give the place a name.'); return; }
    const num = (s: string) => (s.trim() === '' || isNaN(Number(s)) ? null : Number(s));
    const patch: PoiPatch = {
      name: f.name.trim(), place_type: f.place_type, custom_type: f.place_type === 'custom' ? f.custom_type.trim() || null : null,
      description: f.description.trim() || null, images: f.images,
      floor_id: f.floor_id || null, node_id: f.node_id || null, lat: num(f.lat), lng: num(f.lng),
      opening_hours: f.hoursOn ? (f.hours as unknown as PoiPatch['opening_hours']) : null,
      accessibility: f.accessibility as unknown as PoiPatch['accessibility'],
      is_visible: f.is_visible, navigable: f.navigable, is_featured: f.is_featured, trigger_radius: f.greet_m,
    };
    setSaving(true);
    try {
      if (current) await savePlace(data.building.id, current, patch);
      else await createPlace(data.building.id, { ...patch, name: f.name.trim() });
      toast.success(`Saved ${f.name.trim()}`);
      onSaved();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save'); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!current?.poi) return;
    try { await deletePlaceDetails(current.poi.id); toast.success(current.nodeId ? 'Details cleared' : 'Place deleted'); onSaved(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not delete'); }
  };

  const editorLink = f.floor_id ? `/admin/floors/${data.building.id}/${f.floor_id}/editor` : null;

  return (
    <Sheet open={entry !== null} onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isNew ? `New ${PLACE_TYPES[f.place_type].label.toLowerCase()}` : `Edit ${current?.name}`}</SheetTitle>
          <SheetDescription>What visitors see when they tap this place.</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-5">
          <Section title="Basics">
            <Field label="Name"><Input value={f.name} onChange={e => set('name', e.target.value)} /></Field>
            <Field label="Type">
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {PLACE_TYPE_LIST.map(t => {
                  const meta = PLACE_TYPES[t];
                  return (
                    <button key={t} type="button" onClick={() => set('place_type', t)} aria-pressed={f.place_type === t}
                      className={cn('flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] leading-tight',
                        f.place_type === t ? 'border-primary bg-primary/10 text-primary font-medium' : 'hover:bg-muted')}>
                      <meta.icon className="h-4 w-4" /> {meta.label}
                    </button>
                  );
                })}
              </div>
            </Field>
            {f.place_type === 'custom' && (
              <Field label="Custom type label"><Input value={f.custom_type} onChange={e => set('custom_type', e.target.value)} placeholder="e.g. Museum shop" /></Field>
            )}
            <Field label="Description"><Textarea rows={4} value={f.description} onChange={e => set('description', e.target.value)} placeholder="What makes this place worth a visit?" /></Field>
          </Section>

          <Section title="Photos">
            <div className="grid grid-cols-3 gap-2">
              {f.images.map((url, i) => (
                <div key={url} className="relative group aspect-square">
                  <img src={url} alt="" className="h-full w-full rounded-lg object-cover" />
                  {i === 0 && <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] text-white">Cover</span>}
                  <div className="absolute right-1 top-1 flex gap-1">
                    {i > 0 && <button type="button" onClick={() => set('images', [url, ...f.images.filter(u => u !== url)])} className="rounded bg-black/60 px-1.5 text-[10px] text-white">Make cover</button>}
                    <button type="button" onClick={() => set('images', f.images.filter(u => u !== url))} className="rounded-full bg-black/60 p-0.5 text-white" aria-label="Remove photo"><X className="h-3 w-3" /></button>
                  </div>
                </div>
              ))}
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:bg-muted">
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                {uploading ? 'Uploading…' : 'Add photos'}
                <input type="file" accept="image/*" multiple className="sr-only" disabled={uploading} onChange={e => { addImages(e.target.files); e.target.value = ''; }} />
              </label>
            </div>
          </Section>

          <Section title="Location">
            {data.floors.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Floor">
                  <select value={f.floor_id} onChange={e => setF(p => ({ ...p, floor_id: e.target.value, node_id: '' }))} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                    {data.floors.map(fl => <option key={fl.id} value={fl.id}>{fl.name}</option>)}
                  </select>
                </Field>
                <Field label="Spot on the map">
                  <select value={f.node_id} onChange={e => set('node_id', e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                    <option value="">Not on the map</option>
                    {nodeOptions.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                  </select>
                </Field>
              </div>
            )}
            {!f.node_id && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <MapPinOff className="h-4 w-4 shrink-0" /> Not on the map, so visitors can't be guided here or scan a QR code for it.
                {editorLink && <Link to={editorLink} className="underline ml-auto shrink-0">Open map editor</Link>}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="GPS latitude (optional)"><Input inputMode="decimal" value={f.lat} onChange={e => set('lat', e.target.value)} placeholder="9.0306" /></Field>
              <Field label="GPS longitude (optional)"><Input inputMode="decimal" value={f.lng} onChange={e => set('lng', e.target.value)} placeholder="38.7614" /></Field>
            </div>
            <p className="text-[11px] text-muted-foreground">GPS lets visitors open directions to this place in their phone's maps app.</p>
          </Section>

          <Section title="Opening hours" aside={<Switch checked={f.hoursOn} onCheckedChange={v => set('hoursOn', v)} aria-label="Set opening hours" />}>
            {f.hoursOn ? (
              <>
                <div className="space-y-1.5">
                  {DAYS.map(d => {
                    const span = f.hours[d]?.[0] ?? null;
                    return (
                      <div key={d} className="flex items-center gap-2 text-sm">
                        <label className="flex w-20 items-center gap-2">
                          <Checkbox checked={!!span} onCheckedChange={v => setDay(d, v ? ['08:00', '18:00'] : null)} /> {DAY_LABELS[d]}
                        </label>
                        {span ? (
                          <>
                            <Input type="time" value={span[0]} onChange={e => setDay(d, [e.target.value, span[1]])} className="h-8 w-28" aria-label={`${DAY_LABELS[d]} opens`} />
                            <span className="text-muted-foreground">–</span>
                            <Input type="time" value={span[1]} onChange={e => setDay(d, [span[0], e.target.value])} className="h-8 w-28" aria-label={`${DAY_LABELS[d]} closes`} />
                          </>
                        ) : <span className="text-xs text-muted-foreground">Closed</span>}
                      </div>
                    );
                  })}
                </div>
                <button type="button" className="text-xs font-medium text-primary hover:underline"
                  onClick={() => setF(p => ({ ...p, hours: { ...Object.fromEntries(DAYS.map(d => [d, p.hours.mon ?? []])), note: p.hours.note } }))}>
                  Copy Monday to every day
                </button>
                <Field label="Note"><Input value={f.hours.note ?? ''} onChange={e => set('hours', { ...f.hours, note: e.target.value || undefined })} placeholder="e.g. Closed on public holidays" /></Field>
              </>
            ) : <p className="text-xs text-muted-foreground">No hours shown to visitors (always open, or not applicable).</p>}
          </Section>

          {isBusinessPlaceType(f.place_type) && (
            <Section title="Business details"><BusinessSection poiId={current?.poi?.id ?? null} /></Section>
          )}

          <Section title="Accessibility">
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(ACCESSIBILITY_LABELS) as (keyof typeof ACCESSIBILITY_LABELS)[]).map(k => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={!!f.accessibility[k]} onCheckedChange={v => set('accessibility', { ...f.accessibility, [k]: !!v })} /> {ACCESSIBILITY_LABELS[k]}
                </label>
              ))}
            </div>
            <Field label="Accessibility notes"><Input value={f.accessibility.notes ?? ''} onChange={e => set('accessibility', { ...f.accessibility, notes: e.target.value || undefined })} placeholder="e.g. Ramp at the east side" /></Field>
          </Section>

          <Section title="Visitors">
            <Toggle label="Visible to visitors" hint="Hidden places stay on your map but don't appear in the visitor app." checked={f.is_visible} onChange={v => set('is_visible', v)} />
            <Toggle label="Offer directions" hint="Show “Navigate here” for this place." checked={f.navigable} onChange={v => set('navigable', v)} disabled={!f.node_id} />
            <Toggle label="Featured" hint="Highlighted at the top of the visitor list." checked={f.is_featured} onChange={v => set('is_featured', v)} />
            <div className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center justify-between text-sm"><span>Welcome message</span><span className="text-xs tabular-nums text-muted-foreground">{f.greet_m ? `within ${f.greet_m} m` : 'off'}</span></div>
              <Slider value={[f.greet_m]} min={0} max={50} step={1} onValueChange={([v]) => set('greet_m', v)} aria-label="Welcome message distance" />
              <p className="text-xs text-muted-foreground">Visitors walking by get “You're entering {f.name || 'this place'}” once per visit, with the summary of a story linked to it (or the description). Attractions, gardens and cafés with an area on the map greet anyway when visitors step inside.</p>
            </div>
          </Section>
        </div>

        <SheetFooter className="gap-2 sm:justify-between border-t pt-4">
          {current?.poi ? (
            confirmDelete
              ? <Button variant="destructive" onClick={remove}>{current.nodeId ? 'Clear all details' : 'Delete place'}</Button>
              : <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4 mr-1.5" /> {current.nodeId ? 'Clear details' : 'Delete'}</Button>
          ) : <span />}
          <div className="flex gap-2">
            {current?.nodeId && <Button variant="outline" asChild><a href={`/venue/${data.building.id}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1.5" /> Preview</a></Button>}
            <Button onClick={save} disabled={saving || uploading}>{saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Save</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{title}</h3>{aside}</div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn('flex items-start justify-between gap-4', disabled && 'opacity-50')}>
      <span><span className="block text-sm">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
      <Switch checked={checked && !disabled} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}
