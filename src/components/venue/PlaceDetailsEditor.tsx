// The visitor-facing side of a place, edited right in the map editor: photos,
// description, type, and whether it's promoted (featured on the home page and
// first on the map). Saved to the place's `pois` row — created the first time
// anything is saved — and shown to visitors after Publish. A live preview
// shows the card visitors tap.

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Star, X, ArrowLeft, Megaphone, Check, Navigation } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { PLACE_TYPES, placeTypeOf, type PlaceType } from '@/lib/venue/places';
import { uploadImage } from '@/components/venue/dashboard/upload';
import { withLegacy } from '@/components/venue/dashboard/placesApi';

type PoiRow = Tables<'pois'>;
type Form = { description: string; images: string[]; type: PlaceType; featured: boolean; nameAm: string; descriptionAm: string };

// A first guess for a place with no details yet: its name, then its room.
const firstType = (name: string, roomType?: string): PlaceType => {
  const byName = placeTypeOf({ name });
  if (byName !== 'attraction') return byName;
  return roomType === 'restroom' ? 'restroom' : roomType === 'entrance' ? 'entrance' : 'attraction';
};

export default function PlaceDetailsEditor({ buildingId, institutionId, node, roomType }: {
  buildingId: string;
  institutionId: string | null;
  node: { id: string; floorId: string; name: string };
  roomType?: string;
}) {
  const [poi, setPoi] = useState<PoiRow | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<Form | null>(null);
  const [busy, setBusy] = useState<'load' | 'save' | 'upload' | null>('load');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    setBusy('load');
    supabase.from('pois').select('*').eq('node_id', node.id).maybeSingle().then(({ data }) => {
      if (!live) return;
      const row = data as PoiRow | null;
      const f: Form = {
        description: row?.description ?? '',
        images: row?.images?.length ? row.images : row?.image_url ? [row.image_url] : [],
        type: row?.place_type && row.place_type in PLACE_TYPES ? row.place_type as PlaceType : row ? placeTypeOf(row) : firstType(node.name, roomType),
        featured: !!row?.is_featured,
        nameAm: row?.name_am ?? '',
        descriptionAm: row?.description_am ?? '',
      };
      setPoi(row); setForm(f); setSaved(f); setBusy(null);
    });
    return () => { live = false; };
  }, [node.id, node.name, roomType]);

  if (!form || !saved) return <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading visitor details…</div>;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const save = async () => {
    setBusy('save');
    // Amharic only once the indoor 3D migration added the columns (or when someone typed some).
    const am = (poi && 'name_am' in poi) || form.nameAm.trim() || form.descriptionAm.trim()
      ? { name_am: form.nameAm.trim() || null, description_am: form.descriptionAm.trim() || null } : {};
    const patch = { ...withLegacy({ description: form.description.trim() || null, images: form.images, place_type: form.type, is_featured: form.featured }), ...am };
    const q = poi
      ? supabase.from('pois').update(patch).eq('id', poi.id).select('*').single()
      : supabase.from('pois').insert({ building_id: buildingId, node_id: node.id, floor_id: node.floorId, name: node.name || 'Place', ...patch }).select('*').single();
    const { data, error } = await q;
    setBusy(null);
    if (error) { toast.error(/name_am|description_am/.test(error.message) ? 'Run the indoor 3D migration (20261006090000) to save Amharic text.' : /column|schema cache/i.test(error.message) ? `${error.message} — run the places migration (20260930170000).` : error.message); return; }
    setPoi(data as PoiRow); setSaved(form);
    toast.success('Saved — visitors see it after you publish');
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy('upload');
    try {
      const urls: string[] = [];
      for (const f of [...files].slice(0, 6)) urls.push(await uploadImage(f, 'places', institutionId));
      setForm(x => x && ({ ...x, images: [...x.images, ...urls].slice(0, 8) }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally { setBusy(null); }
  };
  const move = (i: number, to: number) => setForm(x => {
    if (!x) return x;
    const imgs = [...x.images]; const [it] = imgs.splice(i, 1); imgs.splice(to, 0, it);
    return { ...x, images: imgs };
  });
  const Icon = PLACE_TYPES[form.type].icon;

  return (
    <section className="space-y-3 rounded-xl border bg-gradient-to-b from-primary/5 to-transparent p-3">
      <div className="flex items-center gap-1.5">
        <Megaphone className="h-3.5 w-3.5 text-primary" />
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What visitors see</h4>
        {poi && !dirty && <span className="ml-auto flex items-center gap-1 text-[10px] text-primary"><Check className="h-3 w-3" /> saved</span>}
      </div>

      {/* live preview of the visitor's card */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="relative h-24 bg-gradient-to-br from-primary/80 to-emerald-400">
          {form.images[0] ? <img src={form.images[0]} alt="" className="h-full w-full object-cover" />
            : <div className="grid h-full place-items-center text-white/80"><Icon className="h-8 w-8" /></div>}
          {form.featured && <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950 shadow"><Star className="h-3 w-3 fill-current" /> Featured</span>}
          {form.images.length > 1 && <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-1.5 text-[10px] font-semibold text-white">1/{form.images.length}</span>}
        </div>
        <div className="p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-primary">{PLACE_TYPES[form.type].label}</p>
          <p className="text-sm font-semibold leading-tight">{node.name || 'Unnamed place'}</p>
          <p className={cn('mt-0.5 line-clamp-2 text-xs', form.description ? 'text-muted-foreground' : 'italic text-muted-foreground/60')}>{form.description || 'Add a description to tempt visitors in…'}</p>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground"><Navigation className="h-3 w-3" /> Navigate</span>
        </div>
      </div>

      {/* photos */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Photos <span className="font-normal text-muted-foreground">— the first is the cover</span></p>
        <div className="grid grid-cols-4 gap-1.5">
          {form.images.map((src, i) => (
            <div key={src} className={cn('group relative aspect-square overflow-hidden rounded-lg border', i === 0 && 'ring-2 ring-primary')}>
              <img src={src} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 flex items-start justify-between bg-black/0 p-0.5 opacity-0 transition-opacity group-hover:bg-black/30 group-hover:opacity-100">
                {i > 0 ? <button onClick={() => move(i, i - 1)} className="rounded bg-black/60 p-0.5 text-white" aria-label="Move earlier" title={i === 1 ? 'Make cover' : 'Move earlier'}><ArrowLeft className="h-3 w-3" /></button> : <span />}
                <button onClick={() => setForm(x => x && ({ ...x, images: x.images.filter(u => u !== src) }))} className="rounded bg-black/60 p-0.5 text-white" aria-label="Remove photo"><X className="h-3 w-3" /></button>
              </div>
            </div>
          ))}
          {form.images.length < 8 && (
            <button onClick={() => fileRef.current?.click()} disabled={busy === 'upload'}
              className="grid aspect-square place-items-center rounded-lg border-2 border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-primary" aria-label="Add photos">
              {busy === 'upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { void upload(e.target.files); e.target.value = ''; }} />
      </div>

      {/* type + description */}
      <label className="block space-y-1">
        <span className="text-xs font-medium">Type</span>
        <select value={form.type} onChange={e => setForm(x => x && ({ ...x, type: e.target.value as PlaceType }))} className="h-8 w-full rounded-md border bg-background px-2 text-xs">
          {(Object.keys(PLACE_TYPES) as PlaceType[]).map(t => <option key={t} value={t}>{PLACE_TYPES[t].label}</option>)}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="flex items-center justify-between text-xs font-medium">Description <span className="font-normal tabular-nums text-muted-foreground">{form.description.length}/500</span></span>
        <Textarea rows={3} maxLength={500} value={form.description} onChange={e => setForm(x => x && ({ ...x, description: e.target.value }))}
          placeholder="What's here, why it's worth a visit, opening times…" className="text-xs" />
      </label>

      {/* Amharic: the name and blurb visitors see (and hear) when the map is in Amharic */}
      <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
        <span className="block text-xs font-medium">In Amharic <span className="font-normal text-muted-foreground">(optional)</span></span>
        <Input lang="am" value={form.nameAm} onChange={e => setForm(x => x && ({ ...x, nameAm: e.target.value }))} placeholder="ስም — ለምሳሌ፦ ካፌ" className="h-8 text-xs" aria-label="Name in Amharic" />
        <Textarea lang="am" rows={2} maxLength={500} value={form.descriptionAm} onChange={e => setForm(x => x && ({ ...x, descriptionAm: e.target.value }))}
          placeholder="አጭር መግለጫ…" className="text-xs" aria-label="Description in Amharic" />
      </div>

      {/* promote */}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-card p-2.5">
        <Star className={cn('mt-0.5 h-4 w-4 shrink-0', form.featured ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground')} />
        <span className="flex-1">
          <span className="block text-xs font-semibold">Promote this place</span>
          <span className="block text-[11px] text-muted-foreground">Featured first on the home page and highlighted on the map.</span>
        </span>
        <Switch checked={form.featured} onCheckedChange={v => setForm(x => x && ({ ...x, featured: v }))} aria-label="Promote this place" />
      </label>

      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={save} disabled={!dirty || busy === 'save' || busy === 'upload'}>
          {busy === 'save' && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save details
        </Button>
        {dirty && <Button size="sm" variant="ghost" onClick={() => setForm(saved)}>Undo</Button>}
      </div>
    </section>
  );
}
