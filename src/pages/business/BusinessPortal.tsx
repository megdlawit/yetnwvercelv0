// YET NEW Business (business plan §18): where a hotel, restaurant, café or shop manages how it
// appears on venue maps. Find your place and ask to manage it (Yet New checks the claim), then
// keep your phone, prices and amenities up to date and answer visitor reviews. Listing is free;
// visitors contact you directly — Yet New takes no bookings or payments.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Store, Search, Loader2, MapPin, Star, MessageSquare, Pencil, ExternalLink, Clock, Check, X, LogOut, LayoutGrid, Plus, ShieldCheck, Undo2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/auth/AuthShell';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { WorkspaceProvider, useWorkspace, type Role } from '@/contexts/WorkspaceContext';
import { PLACE_TYPES, type PlaceType } from '@/lib/venue/places';
import {
  AMENITIES, PRICE_RANGES, isAmenity, isPriceRange, ratingText, reviewsText, suggestedAmenities, type Amenity, type PriceRange, type ReviewRow,
} from '@/lib/venue/business';
import { sinceText } from '@/lib/venue/trust';
import { Stars } from '@/components/reviews/ReviewParts';
import { ReviewsSheet } from '@/components/reviews/ReviewAnswers';
import { PageHeader, Panel } from '@/pages/dashboard/ui';

type MyPlace = { poi_id: string; place_name: string; place_type: string | null; building_id: string; venue_name: string; images: string[];
  profile: Partial<Tables<'business_profiles'>>; rating: number | null; reviews: number; unanswered: number };
type Claim = Tables<'business_claims'> & { place_name?: string; venue_name?: string };
type Found = { poi_id: string; place_name: string; place_type: string | null; building_id: string; venue_name: string; claimed: boolean };

const typeLabel = (t: string | null) => (t && t in PLACE_TYPES ? PLACE_TYPES[t as PlaceType].label : 'Place');
const canEdit = (r: Role | undefined) => r === 'owner' || r === 'editor' || r === 'admin';
const fail = (e: { message: string } | null | undefined) => toast.error(e?.message ?? 'Something went wrong');

/** Signed out: what Yet New Business is, and the way in — keeping the place the visitor came from. */
export default function BusinessPortal() {
  const { session, loading } = useAdminAuth();
  if (loading) {
    return <Frame><Spinner /></Frame>;
  } else if (!session) {
    return <Frame><Welcome /></Frame>;
  } else {
    return <WorkspaceProvider><SignedIn /></WorkspaceProvider>;
  }
}

function Welcome() {
  const [params] = useSearchParams();
  const claim = params.get('claim');
  const here = `/business${claim ? `?claim=${encodeURIComponent(claim)}` : ''}`;
  return (
    <div className="mx-auto max-w-md space-y-5 rounded-3xl border bg-card p-6 text-center shadow-sm">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Store className="h-7 w-7" /></span>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold">Yet New Business</h1>
        <p className="text-sm text-muted-foreground">
          Run a hotel, restaurant, café or shop on a venue's map? Keep your phone, prices and what you offer up to date,
          and answer what visitors say. Free — visitors contact you directly.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button asChild className="h-11 rounded-2xl"><Link to={`/signup?type=business${claim ? `&claim=${encodeURIComponent(claim)}` : ''}`}><Plus className="mr-1.5 h-4 w-4" /> Create a business account</Link></Button>
        <Button asChild variant="outline" className="h-11 rounded-2xl"><Link to="/login" state={{ from: here }}>I already have an account</Link></Button>
      </div>
    </div>
  );
}

function SignedIn() {
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();
  const businesses = useMemo(() => ws.institutions.filter(i => i.account_type === 'business'), [ws.institutions]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const business = businesses.find(b => b.id === businessId) ?? businesses[0] ?? null;

  if (ws.loading) {
    return <Frame><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></Frame>;
  } else if (!business) {
    return <Frame><NotABusiness hasVenue={ws.institutions.some(i => i.account_type !== 'business')} /></Frame>;
  } else {
    return (
      <Frame business={business.name} businesses={businesses.length > 1 ? businesses : undefined} onSwitch={setBusinessId}>
        <Portal key={business.id} businessId={business.id} businessName={business.name} editable={canEdit(business.role)}
          welcome={params.get('welcome') === '1'} claimPoi={params.get('claim')}
          onClaimHandled={() => { params.delete('claim'); params.delete('welcome'); setParams(params, { replace: true }); }} />
      </Frame>
    );
  }
}

function Frame({ business, businesses, onSwitch, children }: {
  business?: string; businesses?: { id: string; name: string }[]; onSwitch?: (id: string) => void; children: React.ReactNode;
}) {
  const { signOut, user } = useAdminAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-[100dvh] bg-muted/30 text-foreground">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
        <Link to="/business" aria-label="Yet New Business"><Logo className="text-lg" /></Link>
        <span className="hidden items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary sm:flex"><Store className="h-3.5 w-3.5" /> Business</span>
        {business && (
          businesses && onSwitch ? (
            <select onChange={e => onSwitch(e.target.value)} className="min-w-0 truncate rounded-xl border bg-card px-2 py-1 text-sm font-semibold" aria-label="Business"
              defaultValue={businesses.find(b => b.name === business)?.id}>
              {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : <span className="min-w-0 truncate text-sm font-bold">{business}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <span className="hidden text-xs text-muted-foreground md:inline">{user?.email?.endsWith('@accounts.yetnew.app') ? `@${user.email.split('@')[0]}` : user?.email}</span>
          <Button variant="ghost" size="sm" className="rounded-xl" onClick={async () => { await signOut(); navigate('/login', { replace: true }); }}>
            <LogOut className="mr-1.5 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

function NotABusiness({ hasVenue }: { hasVenue: boolean }) {
  return (
    <div className="mx-auto max-w-md space-y-4 rounded-3xl border bg-card p-6 text-center shadow-sm">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Store className="h-7 w-7" /></span>
      <h1 className="text-xl font-bold">This isn't a business account</h1>
      <p className="text-sm text-muted-foreground">
        Yet New Business is for hotels, restaurants, cafés and shops that want to manage their place on venue maps.
        {hasVenue ? ' Your account runs a venue — use your dashboard for that.' : ''}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        {hasVenue && <Button asChild variant="outline" className="rounded-xl"><Link to="/dashboard"><LayoutGrid className="mr-1.5 h-4 w-4" /> Your dashboard</Link></Button>}
        <Button asChild className="rounded-xl"><Link to="/signup?type=business"><Plus className="mr-1.5 h-4 w-4" /> Create a business account</Link></Button>
      </div>
    </div>
  );
}

function Portal({ businessId, businessName, editable, welcome, claimPoi, onClaimHandled }: {
  businessId: string; businessName: string; editable: boolean; welcome: boolean; claimPoi: string | null; onClaimHandled: () => void;
}) {
  const [places, setPlaces] = useState<MyPlace[] | null>(null);
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState<MyPlace | null>(null);
  const [reviewsOf, setReviewsOf] = useState<MyPlace | null>(null);
  const [claiming, setClaiming] = useState<Found | null>(null);

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([
      supabase.rpc('business_places', { business: businessId }),
      supabase.from('business_claims').select('*').eq('business_id', businessId).order('requested_at', { ascending: false }).limit(50),
    ]);
    setMissing(!!p.error && /business_places|schema cache|does not exist|Could not find/i.test(p.error.message));
    setPlaces((p.data ?? []) as unknown as MyPlace[]);
    // Names for the claims' places (places and published venues are public).
    const ids = [...new Set((c.data ?? []).map(x => x.poi_id))];
    const { data: names } = ids.length ? await supabase.from('pois').select('id, name, building_id').in('id', ids) : { data: [] };
    const venueIds = [...new Set((names ?? []).map(n => n.building_id))];
    const { data: venues } = venueIds.length ? await supabase.from('buildings').select('id, name').in('id', venueIds) : { data: [] };
    setClaims((c.data ?? []).map(x => {
      const n = (names ?? []).find(y => y.id === x.poi_id);
      return { ...x, place_name: n?.name, venue_name: (venues ?? []).find(v => v.id === n?.building_id)?.name };
    }));
  }, [businessId]);
  useEffect(() => { void load(); }, [load]);

  // Arrived from a place's "Is this your business?" link: open the claim for it.
  useEffect(() => {
    if (claimPoi && editable) {
      void (async () => {
        const { data: poi } = await supabase.from('pois').select('id, name, place_type, building_id').eq('id', claimPoi).maybeSingle();
        const { data: venue } = poi ? await supabase.from('buildings').select('name').eq('id', poi.building_id).maybeSingle() : { data: null };
        if (poi && venue) {
          setClaiming({ poi_id: poi.id, place_name: poi.name, place_type: poi.place_type, building_id: poi.building_id, venue_name: venue.name, claimed: false });
        } else {
          toast.error('That place could not be found.');
        }
        onClaimHandled();
      })();
    } else {
      // nothing to open
    }
  }, [claimPoi]); // eslint-disable-line react-hooks/exhaustive-deps -- once per link

  const pending = (claims ?? []).filter(c => c.status === 'pending');
  const decided = (claims ?? []).filter(c => c.status !== 'pending').slice(0, 5);

  if (missing) {
    return <Panel bodyClassName="p-5"><p className="text-sm text-muted-foreground">Run the 20261103090000_business_reviews_verification migration to turn on Yet New Business.</p></Panel>;
  } else {
    return (
      <div className="space-y-6">
        <PageHeader title={welcome ? `Welcome, ${businessName}` : 'Your places'}
          description="How your business appears on venue maps. Visitors see your changes right away." />

        <Panel title="Your places" icon={MapPin} bodyClassName="px-2 pb-2">
          {places === null ? <Spinner /> : places.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No places yet. Find yours below and ask to manage it — Yet New checks it's yours, usually within a working day.
            </p>
          ) : (
            <ul className="divide-y">
              {places.map(p => (
                <li key={p.poi_id} className="flex flex-wrap items-center gap-3 px-3 py-3.5">
                  {p.images[0] ? <img src={p.images[0]} alt="" className="h-12 w-12 rounded-xl object-cover" />
                    : <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary"><Store className="h-5 w-5" /></span>}
                  <span className="min-w-[180px] flex-1">
                    <span className="block font-semibold">{p.place_name}</span>
                    <span className="block text-xs text-muted-foreground">{typeLabel(p.place_type)} · in {p.venue_name}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {p.reviews ? <><Stars value={Number(p.rating ?? 0)} size={11} /> {ratingText(Number(p.rating ?? 0))} · {reviewsText(Number(p.reviews))}</> : 'No reviews yet'}
                      {Number(p.unanswered) > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">{p.unanswered} to answer</span>}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" className="rounded-xl" asChild>
                      <a href={`/venue/${p.building_id}?poi=${p.poi_id}`} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" /> See it</a>
                    </Button>
                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setReviewsOf(p)}><MessageSquare className="mr-1.5 h-4 w-4" /> Reviews</Button>
                    {editable && <Button size="sm" className="rounded-xl" onClick={() => setEditing(p)}><Pencil className="mr-1.5 h-4 w-4" /> Edit details</Button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {editable && <FindPlace onClaim={setClaiming} />}

        {(pending.length > 0 || decided.length > 0) && (
          <Panel title="Your requests" icon={ShieldCheck} bodyClassName="px-2 pb-2">
            <ul className="divide-y">
              {[...pending, ...decided].map(c => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                  <ClaimIcon status={c.status} />
                  <span className="min-w-[180px] flex-1">
                    <span className="block text-sm font-semibold">{c.place_name ?? 'A place'}{c.venue_name ? <span className="font-normal text-muted-foreground"> · {c.venue_name}</span> : null}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.status === 'pending' ? `Waiting for Yet New · asked ${sinceText(c.requested_at)}`
                        : c.status === 'approved' ? 'Approved — it\'s in your places'
                        : c.status === 'rejected' ? `Declined${c.decision_note ? `: ${c.decision_note}` : ''}` : 'Withdrawn'}
                    </span>
                  </span>
                  {c.status === 'pending' && editable && (
                    <Button size="sm" variant="ghost" className="rounded-xl" onClick={async () => {
                      const { error } = await supabase.rpc('withdraw_business_claim', { claim: c.id });
                      if (error) { fail(error); } else { toast.success('Request withdrawn'); void load(); }
                    }}><Undo2 className="mr-1.5 h-4 w-4" /> Withdraw</Button>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <p className="px-1 text-xs text-muted-foreground">
          Listing your business is free. Visitors call, message or visit you directly — Yet New takes no bookings and no commission.
          Being verified is never paid for.
        </p>

        <EditDetails place={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
        <ReviewsSheet place={reviewsOf} editable={editable} onClose={() => { setReviewsOf(null); void load(); }} />
        <ClaimDialog place={claiming} businessId={businessId} businessName={businessName} onClose={() => setClaiming(null)}
          onSent={() => { setClaiming(null); void load(); }} />
      </div>
    );
  }
}

function ClaimIcon({ status }: { status: string }) {
  const [Icon, cls] = status === 'pending' ? [Clock, 'bg-sky-500/10 text-sky-700'] : status === 'approved' ? [Check, 'bg-emerald-500/10 text-emerald-700']
    : [X, 'bg-muted text-muted-foreground'];
  return <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', cls)}><Icon className="h-4 w-4" /></span>;
}

const Spinner = () => <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

function FindPlace({ onClaim }: { onClaim: (f: Found) => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length >= 2) {
      setBusy(true);
      const t = setTimeout(async () => {
        const { data, error } = await supabase.rpc('business_claimable_places', { q: term });
        setBusy(false);
        if (error) { fail(error); } else { setFound((data ?? []) as Found[]); }
      }, 300);
      return () => clearTimeout(t);
    } else {
      setFound(null);
      return undefined;
    }
  }, [q]);
  return (
    <Panel title="Find your place" icon={Search} bodyClassName="px-5 pb-5">
      <p className="mb-3 text-sm text-muted-foreground">Search by your business's name or the venue it's in — a park, museum, mall or campus on Yet New.</p>
      <label className="flex h-10 items-center gap-2 rounded-xl border bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Garden Café, Unity Park" className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Search places" />
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </label>
      {found && (
        found.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing found. If your place isn't on the map yet, ask the venue's team to add it — then claim it here.</p>
        ) : (
          <ul className="mt-3 divide-y rounded-2xl border">
            {found.map(f => (
              <li key={f.poi_id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{f.place_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{typeLabel(f.place_type)} · {f.venue_name}</span>
                </span>
                {f.claimed
                  ? <span className="text-xs text-muted-foreground">Already managed</span>
                  : <Button size="sm" className="rounded-xl" onClick={() => onClaim(f)}>This is mine</Button>}
              </li>
            ))}
          </ul>
        )
      )}
    </Panel>
  );
}

function ClaimDialog({ place, businessId, businessName, onClose, onSent }: {
  place: Found | null; businessId: string; businessName: string; onClose: () => void; onSent: () => void;
}) {
  const [evidence, setEvidence] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (place) { setEvidence(''); setPhone(''); } else { /* closed */ } }, [place]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (place) {
      setBusy(true);
      const { error } = await supabase.rpc('request_business_claim', { poi: place.poi_id, business: businessId, evidence: evidence.trim(), phone: phone.trim() || null });
      setBusy(false);
      if (error) { fail(error); } else { toast.success('Sent — Yet New will check and let you know here.'); onSent(); }
    } else {
      onClose();
    }
  };
  return (
    <Dialog open={!!place} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={send}>
          <DialogHeader>
            <DialogTitle>Manage {place?.place_name}</DialogTitle>
            <DialogDescription>{place ? `${typeLabel(place.place_type)} in ${place.venue_name}. ` : ''}Yet New checks that {businessName} runs it before you can edit it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <label className="block space-y-1">
              <span className="text-xs font-semibold">How can we check it's yours?</span>
              <Textarea rows={4} maxLength={2000} value={evidence} onChange={e => setEvidence(e.target.value)}
                placeholder="Your role, your trade licence number, your website or social page — anything that shows you run it." />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold">A phone number we can call (optional)</span>
              <Input maxLength={40} value={phone} onChange={e => setPhone(e.target.value)} placeholder="0911 22 33 44" />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || evidence.trim().length < 10}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Send request</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDetails({ place, onClose, onSaved }: { place: MyPlace | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ about: '', phone: '', whatsapp: '', email: '', website: '', price_range: '' as PriceRange | '', price_note: '', booking_note: '' });
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (place) {
      const p = place.profile;
      setF({ about: p.about ?? '', phone: p.phone ?? '', whatsapp: p.whatsapp ?? '', email: p.email ?? '', website: p.website ?? '',
        price_range: isPriceRange(p.price_range) ? p.price_range : '', price_note: p.price_note ?? '', booking_note: p.booking_note ?? '' });
      setAmenities((p.amenities ?? []).filter(isAmenity));
    } else {
      // closed
    }
  }, [place]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));
  const offered = place ? [...new Set([...suggestedAmenities(place.place_type as PlaceType), ...(Object.keys(AMENITIES) as Amenity[])])] : [];
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (place) {
      setBusy(true);
      const blank = (v: string) => v.trim() || null;
      const { error } = await supabase.from('business_profiles').update({
        about: blank(f.about), phone: blank(f.phone), whatsapp: blank(f.whatsapp), email: blank(f.email), website: blank(f.website),
        price_range: f.price_range || null, price_note: blank(f.price_note), booking_note: blank(f.booking_note), amenities,
      }).eq('poi_id', place.poi_id);
      setBusy(false);
      if (error) { fail(error); } else { toast.success('Saved — visitors see it now'); onSaved(); }
    } else {
      onClose();
    }
  };
  const field = 'space-y-1 block';
  return (
    <Sheet open={!!place} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{place?.place_name}</SheetTitle>
          <SheetDescription>What visitors see on its page in {place?.venue_name}. The place's name and spot on the map stay with the venue's team.</SheetDescription>
        </SheetHeader>
        <form onSubmit={save} className="space-y-4 py-5">
          <label className={field}><span className="text-xs font-semibold">About</span>
            <Textarea rows={4} maxLength={2000} value={f.about} onChange={set('about')} placeholder="What makes your place worth a visit: specialities, atmosphere, history." /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={field}><span className="text-xs font-semibold">Phone</span><Input maxLength={40} value={f.phone} onChange={set('phone')} placeholder="0911 22 33 44" /></label>
            <label className={field}><span className="text-xs font-semibold">WhatsApp</span><Input maxLength={40} value={f.whatsapp} onChange={set('whatsapp')} placeholder="0911 22 33 44" /></label>
            <label className={field}><span className="text-xs font-semibold">Website</span><Input maxLength={300} value={f.website} onChange={set('website')} placeholder="tomoca.com" /></label>
            <label className={field}><span className="text-xs font-semibold">Email</span><Input type="email" maxLength={200} value={f.email} onChange={set('email')} placeholder="hello@…" /></label>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-semibold">Prices</span>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(PRICE_RANGES) as PriceRange[]).map(r => (
                <button key={r} type="button" onClick={() => setF(x => ({ ...x, price_range: x.price_range === r ? '' : r }))} aria-pressed={f.price_range === r}
                  className={cn('rounded-full border px-3 py-1.5 text-sm', f.price_range === r ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:bg-muted')}>
                  {r} <span className="text-xs text-muted-foreground">{PRICE_RANGES[r]}</span>
                </button>
              ))}
            </div>
            <Input maxLength={300} value={f.price_note} onChange={set('price_note')} placeholder="e.g. Macchiato 45 birr · Rooms from 2,500 birr a night" />
          </div>
          <label className={field}><span className="text-xs font-semibold">Booking or ordering</span>
            <Input maxLength={300} value={f.booking_note} onChange={set('booking_note')} placeholder="e.g. Call or WhatsApp to book a table" /></label>
          <div className="space-y-1.5">
            <span className="text-xs font-semibold">What you offer</span>
            <div className="flex flex-wrap gap-1.5">
              {offered.map(a => {
                const on = amenities.includes(a);
                return (
                  <button key={a} type="button" aria-pressed={on} onClick={() => setAmenities(x => (on ? x.filter(y => y !== a) : [...x, a]))}
                    className={cn('flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs', on ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:bg-muted')}>
                    {on && <Check className="h-3 w-3" />}{AMENITIES[a]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
