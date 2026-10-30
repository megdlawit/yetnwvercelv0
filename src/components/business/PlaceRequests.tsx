// Businesses asking a venue to add their place to its map (migration 20261104090000). The venue's
// team adds the place in the editor as usual, then links the request to it here — which makes the
// business that place's manager. Or declines, with a reason the business sees. Yet New can do both.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Link2, Loader2, MapPin, Phone, Store, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PLACE_TYPES, isBusinessPlaceType, type PlaceType } from '@/lib/venue/places';
import { sinceText } from '@/lib/venue/trust';

export type PlaceRequest = Database['public']['Functions']['venue_place_requests']['Returns'][number];

export const placeTypeLabel = (t: string | null) => (t && t in PLACE_TYPES ? PLACE_TYPES[t as PlaceType].label : 'Place');

/** The requests for one venue (its team), or every waiting one (Yet New, venue = null). */
export function usePlaceRequests(venue: string | null) {
  const [rows, setRows] = useState<PlaceRequest[] | null>(null);
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('venue_place_requests', { b: venue });
    setMissing(!!error && /venue_place_requests|schema cache|Could not find/i.test(error.message));
    setRows(data ?? []);
  }, [venue]);
  useEffect(() => { void load(); }, [load]);
  return { rows, missing, reload: load };
}

export function PlaceRequestRow({ r, showVenue = false, canAnswer, onDone }: {
  r: PlaceRequest; showVenue?: boolean; canAnswer: boolean; onDone: () => void;
}) {
  const [mode, setMode] = useState<'link' | 'decline' | null>(null);
  const pending = r.status === 'pending';
  return (
    <li className="space-y-2 px-4 py-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Store className="h-5 w-5" /></span>
        <span className="min-w-[200px] flex-1">
          <span className="block text-sm font-semibold">
            {r.place_name} <span className="font-normal text-muted-foreground">· {placeTypeLabel(r.place_type)}</span>
          </span>
          <span className="block text-xs text-muted-foreground">
            Asked by <span className="font-medium text-foreground">{r.business_name}</span>{showVenue ? <> for {r.venue_name}</> : null} · {sinceText(r.requested_at)}
          </span>
          <span className="mt-1 flex items-start gap-1 text-xs"><MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" /> {r.where_note}</span>
          {r.contact_phone && <a href={`tel:${r.contact_phone}`} className="mt-0.5 flex items-center gap-1 text-xs text-primary hover:underline"><Phone className="h-3 w-3" /> {r.contact_phone}</a>}
          {r.note && <span className="mt-1 block rounded-lg bg-muted/60 px-2 py-1 text-xs text-muted-foreground">“{r.note}”</span>}
        </span>
        {pending ? (
          canAnswer && (
            <span className="flex flex-wrap gap-2">
              <Button size="sm" className="rounded-xl" onClick={() => setMode('link')}><Link2 className="mr-1.5 h-4 w-4" /> Link the place</Button>
              <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => setMode('decline')}><X className="mr-1.5 h-4 w-4" /> Decline</Button>
            </span>
          )
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {r.status === 'added' ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Added and linked</> : r.status === 'declined' ? 'Declined' : 'Withdrawn'}
          </span>
        )}
      </div>
      <LinkDialog r={mode === 'link' ? r : null} onClose={() => setMode(null)} onDone={() => { setMode(null); onDone(); }} />
      <DeclineDialog r={mode === 'decline' ? r : null} onClose={() => setMode(null)} onDone={() => { setMode(null); onDone(); }} />
    </li>
  );
}

type Poi = { id: string; name: string; place_type: string | null };

function LinkDialog({ r, onClose, onDone }: { r: PlaceRequest | null; onClose: () => void; onDone: () => void }) {
  const [pois, setPois] = useState<Poi[] | null>(null);
  const [managed, setManaged] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (r) {
      setPick(''); setPois(null);
      void (async () => {
        const [p, bp] = await Promise.all([
          supabase.from('pois').select('id, name, place_type').eq('building_id', r.building_id).order('name'),
          supabase.from('business_profiles').select('poi_id').eq('building_id', r.building_id).not('business_id', 'is', null),
        ]);
        const all = (p.data ?? []) as Poi[];
        setManaged(new Set((bp.data ?? []).map(x => x.poi_id)));
        setPois(all.filter(x => isBusinessPlaceType(x.place_type)));
        // The likeliest match first: same name.
        const same = all.find(x => isBusinessPlaceType(x.place_type) && x.name.trim().toLowerCase() === r.place_name.trim().toLowerCase());
        if (same) {
          setPick(same.id);
        } else {
          setPick('');
        }
      })();
    } else {
      setPois(null);
    }
  }, [r]);
  const link = async () => {
    if (r && pick) {
      setBusy(true);
      const { error } = await supabase.rpc('answer_business_place_request', { req: r.id, poi: pick, note: null });
      setBusy(false);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success(`${r.business_name} now manages ${pois?.find(p => p.id === pick)?.name ?? 'the place'} — they'll see it in Yet New Business.`);
        onDone();
      }
    } else {
      onClose();
    }
  };
  return (
    <Dialog open={!!r} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link {r?.place_name}</DialogTitle>
          <DialogDescription>
            First add the place to your map in the editor (where: “{r?.where_note}”) and set its type to café, restaurant, hotel, shop or custom.
            Then pick it here — {r?.business_name} becomes its manager and can keep its phone, prices and photos up to date.
          </DialogDescription>
        </DialogHeader>
        {pois === null ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : pois.length === 0 ? (
          <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
            No café, restaurant, hotel or shop places on your map yet. Add {r?.place_name} in the editor, publish, then come back here.
          </p>
        ) : (
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger className="rounded-xl"><SelectValue placeholder="Choose the place on your map" /></SelectTrigger>
            <SelectContent>
              {pois.map(p => (
                <SelectItem key={p.id} value={p.id} disabled={managed.has(p.id)}>
                  {p.name} · {placeTypeLabel(p.place_type)}{managed.has(p.id) ? ' (managed by a business)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void link()} disabled={!pick || busy}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Link and confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({ r, onClose, onDone }: { r: PlaceRequest | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (r) { setNote(''); } else { /* closed */ } }, [r]);
  const decline = async () => {
    if (r) {
      setBusy(true);
      const { error } = await supabase.rpc('answer_business_place_request', { req: r.id, poi: null, note: note.trim() || null });
      setBusy(false);
      if (error) { toast.error(error.message); } else { toast.success('Declined — the business sees your reason'); onDone(); }
    } else {
      onClose();
    }
  };
  return (
    <Dialog open={!!r} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Decline {r?.place_name}?</DialogTitle>
          <DialogDescription>{r?.business_name} sees your reason, so they know what to do next.</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. We don't have a café at the north gate — did you mean the Main Gate kiosk?" />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={() => void decline()} disabled={busy}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Decline</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
