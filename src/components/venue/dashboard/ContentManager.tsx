// Dashboard → Content: stories, guides, announcements, events and
// educational pieces shown in the visitor app (one language for now).

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Loader2, ImagePlus, X, Trash2, CalendarDays, MapPin, Eye, EyeOff, Route, ArrowUp, ArrowDown } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { CONTENT_KINDS, type ContentKind } from '@/lib/venue/places';
import type { PlaceEntry } from '@/lib/venue/placeList';
import type { ContentRow, PoiRow, VenueData } from './useVenue';
import { savePlace } from './placesApi';
import { uploadImage } from './upload';

const KINDS = Object.keys(CONTENT_KINDS) as ContentKind[];

/** "2026-10-02T14:30" for <input type="datetime-local"> ↔ ISO. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function contentWhen(c: Pick<ContentRow, 'starts_at' | 'ends_at'>): string {
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (c.starts_at && c.ends_at) return `${fmt(c.starts_at)} – ${fmt(c.ends_at)}`;
  if (c.starts_at) return `From ${fmt(c.starts_at)}`;
  if (c.ends_at) return `Until ${fmt(c.ends_at)}`;
  return '';
}

export default function ContentManager({ data, places, onChanged, kinds = KINDS, emptyText }: {
  data: VenueData; places: PlaceEntry<PoiRow>[]; onChanged: () => void;
  /** The kinds this page manages (e.g. Events page: just events). */
  kinds?: ContentKind[];
  emptyText?: string;
}) {
  const [kind, setKind] = useState<ContentKind | 'all'>(kinds.length === 1 ? kinds[0] : 'all');
  const [params, setParams] = useSearchParams();
  // The open editor lives in the URL (?edit=<id> / ?new=1), so search results and links can open it.
  const editId = params.get('edit');
  const editing: ContentRow | 'new' | null = params.get('new') ? 'new' : editId ? data.content.find(c => c.id === editId) ?? null : null;
  const setEditing = (e: ContentRow | 'new' | null) => {
    const next = new URLSearchParams(params);
    next.delete('edit'); next.delete('new');
    if (e === 'new') next.set('new', '1'); else if (e) next.set('edit', e.id);
    setParams(next, { replace: true });
  };

  if (data.missing.includes('venue_content')) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-5 text-sm text-amber-900 dark:text-amber-200">
        Content needs one database update. In Supabase → SQL editor, run <code className="font-mono">supabase/migrations/20260930170000_places_content_theme.sql</code>, then reload this page.
      </div>
    );
  }

  const mine = data.content.filter(c => kinds.includes(c.kind as ContentKind));
  const shown = mine.filter(c => kind === 'all' || c.kind === kind);
  const placeName = (poiId: string | null) => places.find(p => p.poi?.id === poiId)?.name;

  const togglePublished = async (c: ContentRow) => {
    const { error } = await supabase.from('venue_content').update({ is_published: !c.is_published }).eq('id', c.id);
    if (error) toast.error(error.message); else onChanged();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5 flex-1">
          {kinds.length > 1 && (['all', ...kinds] as const).map(k => {
            const n = k === 'all' ? mine.length : mine.filter(c => c.kind === k).length;
            return (
              <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
                className={cn('rounded-full border px-3 py-1 text-xs font-medium', kind === k ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
                {k === 'all' ? 'All' : CONTENT_KINDS[k].plural} <span className="opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4 mr-1.5" /> New {kind === 'all' ? 'item' : CONTENT_KINDS[kind].label.toLowerCase()}</Button>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {shown.map(c => {
          const k = c.kind as ContentKind;
          const ended = c.ends_at && new Date(c.ends_at) < new Date();
          return (
            <article key={c.id} className={cn('rounded-2xl border bg-card overflow-hidden flex flex-col', (!c.is_published || ended) && 'opacity-70')}>
              {c.image_url ? <img src={c.image_url} alt="" className="h-32 w-full object-cover" /> : <div className="h-2 bg-primary/20" />}
              <div className="p-4 flex-1 space-y-1.5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {CONTENT_KINDS[k]?.label ?? c.kind}
                  <span className={cn('rounded-full px-1.5 py-0.5 normal-case tracking-normal font-medium', c.is_published ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-muted')}>
                    {ended ? 'Ended' : c.is_published ? 'Visible' : 'Draft'}
                  </span>
                </div>
                <h3 className="font-semibold leading-snug">{c.title}</h3>
                {k === 'tour' && <p className="text-xs flex items-center gap-1.5"><Route className="h-3.5 w-3.5" /> {c.stops?.length ?? 0} stops</p>}
                {c.summary && <p className="text-sm text-muted-foreground line-clamp-2">{c.summary}</p>}
                {(c.starts_at || c.ends_at) && <p className="text-xs flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> {contentWhen(c)}</p>}
                {c.poi_id && placeName(c.poi_id) && <p className="text-xs flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {placeName(c.poi_id)}</p>}
              </div>
              <div className="flex border-t">
                <button onClick={() => togglePublished(c)} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium hover:bg-muted">
                  {c.is_published ? <><EyeOff className="h-3.5 w-3.5" /> Hide</> : <><Eye className="h-3.5 w-3.5" /> Show to visitors</>}
                </button>
                <button onClick={() => setEditing(c)} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium hover:bg-muted border-l"><Pencil className="h-3.5 w-3.5" /> Edit</button>
              </div>
            </article>
          );
        })}
      </div>
      {!shown.length && (
        <div className="rounded-2xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
          {emptyText ?? 'Nothing here yet. Tell visitors a story about a place, post today\'s events, or share a guide to the venue.'}
        </div>
      )}

      <ContentEditor key={editing === 'new' ? `new-${kind}` : editing?.id ?? 'none'} data={data} places={places}
        item={editing} defaultKind={kind === 'all' ? kinds[0] : kind} kinds={kinds}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
    </div>
  );
}

function ContentEditor({ data, places, item, defaultKind, kinds, onClose, onSaved }: {
  data: VenueData; places: PlaceEntry<PoiRow>[]; item: ContentRow | 'new' | null; defaultKind: ContentKind; kinds: ContentKind[];
  onClose: () => void; onSaved: () => void;
}) {
  const row = item === 'new' ? null : item;
  const [f, setF] = useState(() => ({
    kind: (row?.kind as ContentKind) ?? defaultKind, title: row?.title ?? '', summary: row?.summary ?? '', body: row?.body ?? '',
    image_url: row?.image_url ?? '', place: row?.poi_id ? places.find(p => p.poi?.id === row.poi_id)?.key ?? '' : '',
    starts_at: toLocalInput(row?.starts_at ?? null), ends_at: toLocalInput(row?.ends_at ?? null), is_published: row?.is_published ?? true,
    // tour stops, as place keys in visiting order
    stops: (row?.stops ?? []).map(id => places.find(p => p.poi?.id === id)?.key).filter((k): k is string => !!k),
  }));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(p => ({ ...p, [k]: v }));
  const dated = CONTENT_KINDS[f.kind].dated;

  const save = async () => {
    if (!f.title.trim()) { toast.error('Add a title.'); return; }
    if (dated && f.starts_at && f.ends_at && f.ends_at < f.starts_at) { toast.error('The end is before the start.'); return; }
    setSaving(true);
    try {
      // Linking a map place that has no details row yet creates that row.
      let poiId: string | null = null;
      const place = places.find(p => p.key === f.place);
      if (place) poiId = place.poi?.id ?? (await savePlace(data.building.id, place, {})).id;
      const stops: string[] = [];
      if (f.kind === 'tour') {
        for (const key of f.stops) {
          const p = places.find(x => x.key === key);
          if (p) stops.push(p.poi?.id ?? (await savePlace(data.building.id, p, {})).id);
        }
      }
      const body = {
        kind: f.kind, title: f.title.trim(), summary: f.summary.trim() || null, body: f.body.trim() || null,
        image_url: f.image_url || null, poi_id: poiId,
        starts_at: dated ? fromLocalInput(f.starts_at) : null, ends_at: dated ? fromLocalInput(f.ends_at) : null,
        is_published: f.is_published, stops,
      };
      const { error } = row
        ? await supabase.from('venue_content').update(body).eq('id', row.id)
        : await supabase.from('venue_content').insert({ ...body, building_id: data.building.id });
      if (error) throw new Error(error.message);
      toast.success(f.is_published ? 'Saved — goes live when you publish changes' : 'Saved as draft');
      onSaved();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save'); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!row) return;
    const { error } = await supabase.from('venue_content').delete().eq('id', row.id);
    if (error) toast.error(error.message); else { toast.success('Deleted'); onSaved(); }
  };

  return (
    <Sheet open={item !== null} onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{row ? `Edit ${CONTENT_KINDS[f.kind].label.toLowerCase()}` : `New ${CONTENT_KINDS[f.kind].label.toLowerCase()}`}</SheetTitle>
          <SheetDescription>Shown in the visitor app once published.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 py-5">
          {kinds.length > 1 && <Field label="Kind">
            <div className="flex flex-wrap gap-1.5">
              {kinds.map(k => (
                <button key={k} type="button" onClick={() => set('kind', k)} aria-pressed={f.kind === k}
                  className={cn('rounded-full border px-3 py-1 text-xs font-medium', f.kind === k ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
                  {CONTENT_KINDS[k].label}
                </button>
              ))}
            </div>
          </Field>}
          <Field label="Title"><Input value={f.title} onChange={e => set('title', e.target.value)} /></Field>
          <Field label="Summary (one or two lines for the list)"><Input value={f.summary} onChange={e => set('summary', e.target.value)} /></Field>
          <Field label="Full text"><Textarea rows={8} value={f.body} onChange={e => set('body', e.target.value)} /></Field>
          <Field label="Image">
            {f.image_url ? (
              <div className="relative">
                <img src={f.image_url} alt="" className="h-40 w-full rounded-lg object-cover" />
                <button type="button" onClick={() => set('image_url', '')} className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white" aria-label="Remove image"><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : (
              <label className="flex h-24 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground hover:bg-muted">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} {uploading ? 'Uploading…' : 'Add an image'}
                <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={async e => {
                  const file = e.target.files?.[0]; e.target.value = '';
                  if (!file) return;
                  setUploading(true);
                  try { set('image_url', await uploadImage(file, 'content', data.building.institution_id)); }
                  catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed'); }
                  finally { setUploading(false); }
                }} />
              </label>
            )}
          </Field>
          <Field label="About a place (optional)">
            <select value={f.place} onChange={e => set('place', e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="">The whole venue</option>
              {places.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </Field>
          {f.kind === 'tour' && (
            <Field label={`Stops, in order (${f.stops.length})`}>
              <ol className="space-y-1.5">
                {f.stops.map((key, i) => (
                  <li key={key} className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{i + 1}</span>
                    <span className="flex-1 truncate">{places.find(p => p.key === key)?.name ?? 'Removed place'}</span>
                    <button type="button" disabled={i === 0} onClick={() => set('stops', move(f.stops, i, i - 1))} className="rounded p-1 hover:bg-muted disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" disabled={i === f.stops.length - 1} onClick={() => set('stops', move(f.stops, i, i + 1))} className="rounded p-1 hover:bg-muted disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => set('stops', f.stops.filter(k => k !== key))} className="rounded p-1 hover:bg-muted" aria-label="Remove stop"><X className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ol>
              <select value="" onChange={e => e.target.value && set('stops', [...f.stops, e.target.value])} className="h-10 w-full rounded-md border bg-background px-3 text-sm" aria-label="Add a stop">
                <option value="">+ Add a stop…</option>
                {places.filter(p => p.nodeId && !f.stops.includes(p.key)).map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </Field>
          )}
          {dated && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts"><Input type="datetime-local" value={f.starts_at} onChange={e => set('starts_at', e.target.value)} /></Field>
              <Field label="Ends"><Input type="datetime-local" value={f.ends_at} onChange={e => set('ends_at', e.target.value)} /></Field>
            </div>
          )}
          {dated && <p className="text-[11px] text-muted-foreground">Visitors see it under “What's on” until it ends.</p>}
          <label className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
            <span><span className="block text-sm font-medium">Show to visitors</span><span className="block text-xs text-muted-foreground">Goes live with your next “Publish changes”. Drafts stay with your team.</span></span>
            <Switch checked={f.is_published} onCheckedChange={v => set('is_published', v)} />
          </label>
        </div>
        <SheetFooter className="gap-2 sm:justify-between border-t pt-4">
          {row ? (
            confirmDelete
              ? <Button variant="destructive" onClick={remove}>Delete for good</Button>
              : <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4 mr-1.5" /> Delete</Button>
          ) : <span />}
          <Button onClick={save} disabled={saving || uploading}>{saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Save</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const move = <T,>(xs: T[], from: number, to: number) => { const out = [...xs]; const [x] = out.splice(from, 1); out.splice(to, 0, x); return out; };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}
