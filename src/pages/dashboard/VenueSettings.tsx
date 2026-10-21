// Venue settings: name, description, building vs outdoor site, theme, and the
// institution's profile (name, kind, logo).

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Building2, Trees, Loader2, ImagePlus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import ThemePicker from '@/components/venue/dashboard/ThemePicker';
import GeoPlacer from '@/components/venue/dashboard/GeoPlacer';
import HeroSettings from '@/components/venue/dashboard/HeroSettings';
import IndoorMapSettings from '@/components/venue/dashboard/IndoorMapSettings';
import { anchorOf } from '@/lib/venue/geoVenue';
import { uploadImage } from '@/components/venue/dashboard/upload';
import { InstitutionMark } from '@/components/dashboard/DashboardLayout';
import { INSTITUTION_KINDS, type InstitutionKind } from '@/lib/accounts';
import { PageHeader, Panel } from './ui';

export default function VenueSettings() {
  const ws = useWorkspace();
  const { data, reload, places, editorUrl } = useDashboard();
  // Coming from "Place on the world map" (the dashboard's next step, or the editor): go straight there.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    return () => clearTimeout(t);
  }, [hash]);
  const b = data.building;
  const [name, setName] = useState(b.name);
  const [description, setDescription] = useState(b.description ?? '');
  const [layout, setLayout] = useState<'building' | 'site'>(b.layout === 'site' ? 'site' : 'building');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dirty = name.trim() !== b.name || (description.trim() || null) !== (b.description ?? null) || layout !== (b.layout ?? 'building');

  const save = async () => {
    if (name.trim().length < 2) { toast.error('Give the venue a name.'); return; }
    setSaving(true);
    const { error } = await supabase.from('buildings').update({ name: name.trim(), description: description.trim() || null, layout }).eq('id', b.id);
    setSaving(false);
    if (error) { toast.error(/layout/.test(error.message) ? 'Run the 20261002090000 migration first.' : error.message); return; }
    toast.success('Venue saved'); await reload(); ws.reload();
  };

  const remove = async () => {
    const { error } = await supabase.from('buildings').delete().eq('id', b.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${b.name} deleted`); ws.reload();
  };

  return (
    <>
      <PageHeader title="Venue Settings" description="How your venue is named, described, laid out and placed on the world map, and how it looks." />
      <div id="location" className="mb-6 scroll-mt-24">
        <Panel title={<>Location on the world map {anchorOf(b) ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Placed</span> : <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Not placed yet</span>}</>}
          bodyClassName="px-5 pb-5">
          <p className="mb-3 text-sm text-muted-foreground">Line your plan up with the real site. Visitors then see your venue standing on the real map with 3D terrain, their GPS position, and the way in from the street.</p>
          <GeoPlacer data={data} onSaved={reload} />
        </Panel>
      </div>
      <div id="indoor-map" className="mb-6 scroll-mt-24">
        <Panel title="Indoor 3D map" bodyClassName="px-5 pb-5">
          <p className="mb-4 text-sm text-muted-foreground">How your indoor map looks to visitors on the venue map — the opening view, wall height and which details show.</p>
          <IndoorMapSettings data={data} editorUrl={editorUrl} onSaved={reload} />
        </Panel>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Panel title="Venue details" bodyClassName="space-y-4 px-5 pb-5">
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Description (shown to visitors)</Label><Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="A green escape in the heart of the city…" /></div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Layout</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {([['building', Building2, 'Building', 'Organised by floors — museums, hospitals, malls'], ['site', Trees, 'Outdoor site', 'Organised by zones — parks, campuses, heritage sites']] as const).map(([id, Icon, label, sub]) => (
                  <button key={id} type="button" onClick={() => setLayout(id)} aria-pressed={layout === id} className={cn('rounded-2xl border p-3 text-left', layout === id ? 'border-primary bg-primary/10' : 'hover:bg-muted')}>
                    <Icon className="h-5 w-5 text-primary" /><span className="mt-1 block text-sm font-semibold">{label}</span><span className="block text-xs text-muted-foreground">{sub}</span>
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={save} disabled={!dirty || saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save changes</Button>
          </Panel>
          <Panel title="Visitor home page" bodyClassName="px-5 pb-5"><HeroSettings data={data} places={places} isPlatformAdmin={ws.isPlatformAdmin} onSaved={reload} /></Panel>
          <Panel title="Theme" bodyClassName="px-5 pb-5"><ThemePicker data={data} onChanged={reload} /></Panel>
        </div>
        <div className="space-y-6">
          <InstitutionProfile />
          {ws.institution?.role !== 'editor' && (
            <Panel title="Danger zone" bodyClassName="px-5 pb-5">
              <p className="text-sm text-muted-foreground">Deleting the venue removes its map, places, content and QR codes for good.</p>
              <Button variant="outline" className="mt-3 text-destructive" onClick={() => setDeleting(true)}><Trash2 className="mr-1.5 h-4 w-4" /> Delete {b.name}</Button>
            </Panel>
          )}
        </div>
      </div>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {b.name}?</AlertDialogTitle>
            <AlertDialogDescription>Its map, places, content and QR codes are deleted, and visitor links stop working. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete venue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function InstitutionProfile() {
  const ws = useWorkspace();
  const inst = ws.institution!;
  const canEdit = inst.role !== 'editor';
  const [name, setName] = useState(inst.name);
  const [kind, setKind] = useState(inst.kind);
  const [description, setDescription] = useState(inst.description ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    const { error } = await supabase.from('institutions').update(patch).eq('id', inst.id);
    setBusy(false);
    if (error) { toast.error(error.message); return false; }
    toast.success('Institution profile saved'); await ws.reload(); return true;
  };

  return (
    <Panel title="Institution profile" bodyClassName="space-y-4 px-5 pb-5">
      <div className="flex items-center gap-3">
        <InstitutionMark name={inst.name} logo={inst.logo_url} size={56} />
        {canEdit && (
          <label className="cursor-pointer text-sm font-medium text-primary hover:underline">
            <ImagePlus className="mr-1 inline h-4 w-4" /> {inst.logo_url ? 'Change logo' : 'Upload logo'}
            <input type="file" accept="image/*" className="sr-only" onChange={async e => {
              const file = e.target.files?.[0]; e.target.value = '';
              if (!file) return;
              try { await save({ logo_url: await uploadImage(file, 'logo', inst.id) }); } catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed'); }
            }} />
          </label>
        )}
      </div>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Name</Label><Input value={name} disabled={!canEdit} onChange={e => setName(e.target.value)} /></div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Kind</Label>
        <select value={kind} disabled={!canEdit} onChange={e => setKind(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
          {(Object.keys(INSTITUTION_KINDS) as InstitutionKind[]).map(k => <option key={k} value={k}>{INSTITUTION_KINDS[k].label}</option>)}
          {!(kind in INSTITUTION_KINDS) && <option value={kind}>{kind}</option>}
        </select>
      </div>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">About</Label><Textarea rows={3} value={description} disabled={!canEdit} onChange={e => setDescription(e.target.value)} /></div>
      {canEdit
        ? <Button onClick={() => save({ name: name.trim(), kind, description: description.trim() || null })} disabled={busy || name.trim().length < 2}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save profile</Button>
        : <p className="text-xs text-muted-foreground">Only the owner can change the institution profile.</p>}
    </Panel>
  );
}
