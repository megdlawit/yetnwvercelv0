// Venue Settings → Visitor home page: how this venue greets people on the
// public home page — headline, cover photo, which view opens first. The
// hotspots in the 3D hero are the venue's featured places. Goes live on Publish.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Box, Square, Globe2, ImagePlus, Loader2, Star, ExternalLink, X, Crown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { anchorOf } from '@/lib/venue/geoVenue';
import type { PlaceEntry } from '@/lib/venue/placeList';
import { uploadImage } from './upload';
import type { PoiRow, VenueData } from './useVenue';

export default function HeroSettings({ data, places, isPlatformAdmin, onSaved }: { data: VenueData; places: PlaceEntry<PoiRow>[]; isPlatformAdmin: boolean; onSaved: () => void }) {
  const b = data.building;
  const [tagline, setTagline] = useState(b.tagline ?? '');
  const [cover, setCover] = useState(b.cover_url ?? '');
  const [view, setView] = useState(b.hero_view ?? '3d');
  const [busy, setBusy] = useState<'save' | 'upload' | null>(null);
  const placed = !!anchorOf(b);
  const hotspots = places.filter(p => p.featured);
  const dirty = tagline.trim() !== (b.tagline ?? '') || cover !== (b.cover_url ?? '') || view !== (b.hero_view ?? '3d');

  const save = async (patch?: Record<string, unknown>) => {
    setBusy('save');
    const { error } = await supabase.from('buildings').update(patch ?? { tagline: tagline.trim() || null, cover_url: cover || null, hero_view: view }).eq('id', b.id);
    setBusy(null);
    if (error) { toast.error(/tagline|hero_view|cover_url|home_rank/.test(error.message) ? 'Run migration 20261004090000_visitor_home.sql first.' : error.message); return; }
    toast.success('Saved — visitors see it after you publish');
    onSaved();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Headline under “Explore {b.name}”</Label>
        <Input value={tagline} onChange={e => setTagline(e.target.value)} maxLength={140} placeholder="Discover gardens, history and the best coffee in the city." />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Cover photo (shown while the 3D world loads, and on venue cards)</Label>
        <div className="flex items-center gap-3">
          {cover ? (
            <div className="relative h-20 w-32 overflow-hidden rounded-xl border">
              <img src={cover} alt="" className="h-full w-full object-cover" />
              <button onClick={() => setCover('')} className="absolute right-1 top-1 rounded-full bg-black/55 p-0.5 text-white" aria-label="Remove cover"><X className="h-3 w-3" /></button>
            </div>
          ) : <div className="grid h-20 w-32 place-items-center rounded-xl border border-dashed text-xs text-muted-foreground">No cover</div>}
          <label className="cursor-pointer text-sm font-medium text-primary hover:underline">
            {busy === 'upload' ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <ImagePlus className="mr-1 inline h-4 w-4" />} {cover ? 'Change' : 'Upload'}
            <input type="file" accept="image/*" className="sr-only" onChange={async e => {
              const file = e.target.files?.[0]; e.target.value = '';
              if (!file) return;
              setBusy('upload');
              try { setCover(await uploadImage(file, 'media', b.institution_id)); } catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed'); }
              finally { setBusy(null); }
            }} />
          </label>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Visitors first see</Label>
        <div className="grid grid-cols-3 gap-2">
          {([['3d', Box, '3D world'], ['2d', Square, '2D map'], ['outdoor', Globe2, 'Outdoor map']] as const).map(([id, Icon, label]) => (
            <button key={id} onClick={() => setView(id)} aria-pressed={view === id} disabled={id === 'outdoor' && !placed}
              title={id === 'outdoor' && !placed ? 'Place the venue on the world map first' : undefined}
              className={cn('flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-medium disabled:opacity-40', view === id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}>
              <Icon className="h-5 w-5" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-muted/50 p-3 text-sm">
        <p className="flex items-center gap-1.5 font-medium"><Star className="h-4 w-4 text-amber-500" /> Hotspots: your featured places</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {hotspots.length ? `${hotspots.map(p => p.name).slice(0, 5).join(', ')}${hotspots.length > 5 ? '…' : ''} lead the home page.` : 'No featured places yet — the most interesting places are picked automatically.'}{' '}
          Turn on <b>Featured</b> on any place under <Link to="/dashboard/attractions" className="text-primary hover:underline">Attractions</Link> or <Link to="/dashboard/places" className="text-primary hover:underline">Places</Link>.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => save()} disabled={!dirty || busy !== null}>{busy === 'save' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save</Button>
        <Button variant="outline" asChild><a href={`/visit?v=${b.id}`} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" /> View home page</a></Button>
      </div>

      {isPlatformAdmin && (
        <label className="flex items-center justify-between gap-3 rounded-xl border border-violet-300 bg-violet-50 px-3 py-2.5 text-sm dark:bg-violet-950/30">
          <span className="flex items-center gap-2"><Crown className="h-4 w-4 text-violet-600" /> Lead the Yet New home page <span className="text-xs text-muted-foreground">(Yet New team only)</span></span>
          <Switch checked={(b.home_rank ?? 0) > 0} onCheckedChange={v => save({ home_rank: v ? 10 : 0 })} />
        </label>
      )}
    </div>
  );
}
