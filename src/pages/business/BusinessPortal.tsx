// YET NEW Business (business plan §18): where a hotel, restaurant, café or shop manages how it
// appears on venue maps. Find your place and ask to manage it (Yet New checks the claim), then
// keep your phone, prices and amenities up to date and answer visitor reviews. Listing is free;
// visitors contact you directly — Yet New takes no bookings or payments.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Store, Search, Loader2, MapPin, MessageSquare, Pencil, ExternalLink, Clock, Check, X, LogOut, LayoutGrid, Plus, ShieldCheck, Undo2,
  ArrowLeft, Building2, ChevronRight, Sparkles,
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
      <ol className="space-y-2.5 text-left">
        {[
          ['Create your account', 'Your business’s name and a sign-in for your team. Two minutes.'],
          ['Find your place', 'Pick the venue you’re in and choose your place — or ask the venue to add it to their map.'],
          ['We confirm it’s yours', 'Usually within a working day. Then add your phone, prices and what you offer.'],
        ].map(([t, d], i) => (
          <li key={t} className="flex gap-3 rounded-2xl bg-muted/50 p-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
            <span><span className="block text-sm font-semibold">{t}</span><span className="block text-xs text-muted-foreground">{d}</span></span>
          </li>
        ))}
      </ol>
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
  const [asks, setAsks] = useState<PlaceAsk[]>([]);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState<MyPlace | null>(null);
  const [reviewsOf, setReviewsOf] = useState<MyPlace | null>(null);
  const [claiming, setClaiming] = useState<Found | null>(null);
  const [asking, setAsking] = useState<{ venueId: string | null; name: string } | null>(null);

  const load = useCallback(async () => {
    const [p, c, a] = await Promise.all([
      supabase.rpc('business_places', { business: businessId }),
      supabase.from('business_claims').select('*').eq('business_id', businessId).order('requested_at', { ascending: false }).limit(50),
      supabase.from('business_place_requests').select('*').eq('business_id', businessId).order('requested_at', { ascending: false }).limit(50),
    ]);
    setMissing(!!p.error && /business_places|schema cache|does not exist|Could not find/i.test(p.error.message));
    setPlaces((p.data ?? []) as unknown as MyPlace[]);
    // Names for the claims' places and the venues asked (places and published venues are public).
    const ids = [...new Set((c.data ?? []).map(x => x.poi_id))];
    const { data: names } = ids.length ? await supabase.from('pois').select('id, name, building_id').in('id', ids) : { data: [] };
    const venueIds = [...new Set([...(names ?? []).map(n => n.building_id), ...(a.data ?? []).map(x => x.building_id)])];
    const { data: venues } = venueIds.length ? await supabase.from('buildings').select('id, name').in('id', venueIds) : { data: [] };
    const venueName = (id: string | undefined) => (venues ?? []).find(v => v.id === id)?.name;
    setClaims((c.data ?? []).map(x => {
      const n = (names ?? []).find(y => y.id === x.poi_id);
      return { ...x, place_name: n?.name, venue_name: venueName(n?.building_id) };
    }));
    setAsks((a.data ?? []).map(x => ({ ...x, venue_name: venueName(x.building_id) })));
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

  const requests: RequestItem[] = [
    ...(claims ?? []).map(c => ({ kind: 'claim' as const, id: c.id, status: c.status, at: c.requested_at, place: c.place_name ?? 'A place', venue: c.venue_name, note: c.decision_note })),
    ...asks.map(a => ({ kind: 'ask' as const, id: a.id, status: a.status, at: a.requested_at, place: a.place_name, venue: a.venue_name, note: a.decision_note })),
  ].sort((x, y) => (x.status === 'pending' ? 0 : 1) - (y.status === 'pending' ? 0 : 1) || y.at.localeCompare(x.at));
  const shownRequests = [...requests.filter(r => r.status === 'pending'), ...requests.filter(r => r.status !== 'pending').slice(0, 6)];

  const withdraw = async (r: RequestItem) => {
    const { error } = r.kind === 'claim'
      ? await supabase.rpc('withdraw_business_claim', { claim: r.id })
      : await supabase.rpc('withdraw_business_place_request', { req: r.id });
    if (error) { fail(error); } else { toast.success('Request withdrawn'); void load(); }
  };

  if (missing) {
    return <Panel bodyClassName="p-5"><p className="text-sm text-muted-foreground">Run the 20261103090000 and 20261104090000 migrations to turn on Yet New Business.</p></Panel>;
  } else if (places === null || claims === null) {
    return <Spinner />;
  } else {
    const hasPlaces = places.length > 0;
    return (
      <div className="space-y-6">
        <PageHeader title={hasPlaces ? 'Your places' : `Welcome, ${businessName}`}
          description={hasPlaces ? 'How your business appears on venue maps. Visitors see your changes right away.'
            : 'Let’s get your business on Yet New — it takes a few minutes, and it’s free.'} />

        <GettingStarted businessId={businessId} places={places} requests={requests} firstVisit={welcome}
          onFind={() => document.getElementById('find-your-place')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          onEdit={() => setEditing(places[0] ?? null)} onReviews={() => setReviewsOf(places.find(p => Number(p.unanswered) > 0) ?? places[0] ?? null)} />

        {hasPlaces && (
          <Panel title="Your places" icon={MapPin} bodyClassName="px-2 pb-2">
            <ul className="divide-y">
              {places.map(p => (
                <li key={p.poi_id} className="flex flex-wrap items-center gap-3 px-3 py-3.5">
                  {p.images[0] ? <img src={p.images[0]} alt="" className="h-12 w-12 rounded-xl object-cover" />
                    : <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary"><Store className="h-5 w-5" /></span>}
                  <span className="min-w-[180px] flex-1">
                    <span className="block font-semibold">{p.place_name}</span>
                    <span className="block text-xs text-muted-foreground">{typeLabel(p.place_type)} · in {p.venue_name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {p.reviews ? <><Stars value={Number(p.rating ?? 0)} size={11} /> {ratingText(Number(p.rating ?? 0))} · {reviewsText(Number(p.reviews))}</> : 'No reviews yet'}
                      {Number(p.unanswered) > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">{p.unanswered} to answer</span>}
                      {!detailsFilled(p) && <span className="rounded-full bg-sky-500/15 px-1.5 text-[10px] font-bold text-sky-800 dark:text-sky-300">Add your details</span>}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {editable && <Button size="sm" className="rounded-xl" onClick={() => setEditing(p)}><Pencil className="mr-1.5 h-4 w-4" /> Edit details</Button>}
                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setReviewsOf(p)}><MessageSquare className="mr-1.5 h-4 w-4" /> Reviews</Button>
                    <Button size="sm" variant="ghost" className="rounded-xl" asChild>
                      <a href={`/venue/${p.building_id}?poi=${p.poi_id}`} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" /> See it as a visitor</a>
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {shownRequests.length > 0 && (
          <Panel title="Your requests" icon={ShieldCheck} bodyClassName="px-2 pb-2">
            <ul className="divide-y">
              {shownRequests.map(r => (
                <li key={`${r.kind}-${r.id}`} className="flex flex-wrap items-center gap-3 px-3 py-3">
                  <ClaimIcon status={r.status} />
                  <span className="min-w-[180px] flex-1">
                    <span className="block text-sm font-semibold">{r.place}{r.venue ? <span className="font-normal text-muted-foreground"> · {r.venue}</span> : null}</span>
                    <span className="block text-xs text-muted-foreground">{requestText(r)}</span>
                  </span>
                  {r.status === 'pending' && editable && (
                    <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => void withdraw(r)}><Undo2 className="mr-1.5 h-4 w-4" /> Withdraw</Button>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {editable && <FindPlace onClaim={setClaiming} onAsk={(venueId, name) => setAsking({ venueId, name: name || businessName })} hasPlaces={hasPlaces} />}

        <p className="px-1 text-xs text-muted-foreground">
          Listing your business is free. Visitors call, message or visit you directly — Yet New takes no bookings and no commission.
          Being verified is never paid for.
        </p>

        <EditDetails place={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
        <ReviewsSheet place={reviewsOf} editable={editable} onClose={() => { setReviewsOf(null); void load(); }} />
        <ClaimDialog place={claiming} businessId={businessId} businessName={businessName} onClose={() => setClaiming(null)}
          onSent={() => { setClaiming(null); void load(); }} />
        <AskVenueDialog ask={asking} businessId={businessId} onClose={() => setAsking(null)} onSent={() => { setAsking(null); void load(); }} />
      </div>
    );
  }
}

type PlaceAsk = Tables<'business_place_requests'> & { venue_name?: string };
type RequestItem = { kind: 'claim' | 'ask'; id: string; status: string; at: string; place: string; venue?: string; note: string | null };

function requestText(r: RequestItem): string {
  if (r.status === 'pending') {
    return r.kind === 'claim'
      ? `Yet New is checking it's yours · asked ${sinceText(r.at)}. Usually within a working day.`
      : `Waiting for ${r.venue ?? 'the venue'} to add it to their map · asked ${sinceText(r.at)}`;
  } else if (r.status === 'approved' || r.status === 'added') {
    return 'Confirmed — it’s in your places above';
  } else if (r.status === 'rejected' || r.status === 'declined') {
    return `Declined${r.note ? `: ${r.note}` : ''}`;
  } else {
    return 'Withdrawn';
  }
}

const detailsFilled = (p: MyPlace) => !!(p.profile.phone || p.profile.whatsapp || p.profile.about || (p.profile.amenities ?? []).length);

/** The steps from a new account to a place visitors can call — ticked off as they happen. */
function GettingStarted({ businessId, places, requests, firstVisit, onFind, onEdit, onReviews }: {
  businessId: string; places: MyPlace[]; requests: RequestItem[]; firstVisit: boolean; onFind: () => void; onEdit: () => void; onReviews: () => void;
}) {
  const key = `yetnew-business-guide-hidden-${businessId}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const asked = requests.some(r => r.status === 'pending' || r.status === 'approved' || r.status === 'added');
  const waitingOn = requests.find(r => r.status === 'pending');
  const confirmed = places.length > 0;
  const detailed = places.some(detailsFilled);
  const unanswered = places.reduce((n, p) => n + Number(p.unanswered), 0);
  const steps = [
    { done: asked || confirmed, title: 'Find your place',
      text: 'Pick the venue you’re in — a park, mall, hotel, museum or campus — and choose your place. Not on their map yet? Ask the venue to add it.',
      action: !asked && !confirmed ? <Button size="sm" className="rounded-xl" onClick={onFind}><Search className="mr-1.5 h-4 w-4" /> Find my place</Button> : null },
    { done: confirmed, title: 'We confirm it’s yours',
      text: waitingOn && !confirmed
        ? (waitingOn.kind === 'claim' ? 'Yet New is checking your request — usually within a working day. We may call the number you gave.'
          : `${waitingOn.venue ?? 'The venue'} is adding your place to their map. Once they link it, it’s yours to manage.`)
        : 'Yet New (or the venue) checks you run it — usually within a working day. You’ll see the answer on this page.',
      action: null },
    { done: detailed, title: 'Add your details',
      text: 'Phone, WhatsApp, opening info, prices and what you offer (Wi-Fi, telebirr, fasting food…). Visitors see changes right away.',
      action: confirmed && !detailed ? <Button size="sm" className="rounded-xl" onClick={onEdit}><Pencil className="mr-1.5 h-4 w-4" /> Add details</Button> : null },
    { done: confirmed && detailed && unanswered === 0, title: 'Answer visitor reviews',
      text: 'Thank people and reply to feedback. Replies are public and signed with your business’s name.',
      action: unanswered > 0 ? <Button size="sm" variant="outline" className="rounded-xl" onClick={onReviews}><MessageSquare className="mr-1.5 h-4 w-4" /> {unanswered} to answer</Button> : null },
  ];
  const doneCount = steps.filter(s => s.done).length;
  const next = steps.findIndex(s => !s.done);
  const hide = () => { try { localStorage.setItem(key, '1'); } catch { /* private mode */ } setHidden(true); };

  if ((hidden && !firstVisit && confirmed) || doneCount === steps.length) {
    return null;
  } else {
    return (
      <section className="overflow-hidden rounded-3xl border bg-card shadow-sm" aria-label="Getting started">
        <div className="flex flex-wrap items-center gap-3 border-b bg-primary/5 px-5 py-4">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-primary-foreground"><Sparkles className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Getting started</span>
            <span className="block text-xs text-muted-foreground">{doneCount} of {steps.length} done · visitors can find and contact you after step 3</span>
          </span>
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
          {confirmed && <Button variant="ghost" size="sm" className="rounded-xl text-xs" onClick={hide}>Hide</Button>}
        </div>
        <ol className="divide-y">
          {steps.map((s, i) => (
            <li key={s.title} className={cn('flex gap-3 px-5 py-3.5', i === next ? 'bg-background' : '')}>
              <span className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold',
                s.done ? 'bg-emerald-500 text-white' : i === next ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                {s.done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm font-semibold', s.done && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{s.title}</span>
                {!s.done && <span className="mt-0.5 block text-xs text-muted-foreground">{s.text}</span>}
                {i === next && s.action && <span className="mt-2 block">{s.action}</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    );
  }
}

function ClaimIcon({ status }: { status: string }) {
  const [Icon, cls] = status === 'pending' ? [Clock, 'bg-sky-500/10 text-sky-700'] : status === 'approved' || status === 'added' ? [Check, 'bg-emerald-500/10 text-emerald-700']
    : [X, 'bg-muted text-muted-foreground'];
  return <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', cls)}><Icon className="h-4 w-4" /></span>;
}

const Spinner = () => <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

type Venue = { building_id: string; venue_name: string; places: number; unclaimed: number };

/** Pick the venue you're in and your place in it — or search by name. Not there? Ask the venue to add it. */
function FindPlace({ onClaim, onAsk, hasPlaces }: { onClaim: (f: Found) => void; onAsk: (venueId: string | null, name: string) => void; hasPlaces: boolean }) {
  const [q, setQ] = useState('');
  const [venue, setVenue] = useState<Venue | null>(null);
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const term = q.trim();

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc('business_venues', { q: '' });
      if (error) { fail(error); } else { setVenues((data ?? []).map(v => ({ ...v, places: Number(v.places), unclaimed: Number(v.unclaimed) }))); }
    })();
  }, []);
  useEffect(() => {
    if (venue || term.length >= 2) {
      setBusy(true);
      const t = setTimeout(async () => {
        const { data, error } = await supabase.rpc('business_find_places', { q: term, venue: venue?.building_id ?? null });
        setBusy(false);
        if (error) { fail(error); } else { setFound((data ?? []) as Found[]); }
      }, venue ? 0 : 300);
      return () => clearTimeout(t);
    } else {
      setFound(null);
      setBusy(false);
      return undefined;
    }
  }, [term, venue]);

  const venueMatches = (venues ?? []).filter(v => !term || v.venue_name.toLowerCase().includes(term.toLowerCase()));
  return (
    <section id="find-your-place" className="scroll-mt-20">
      <Panel title={hasPlaces ? 'Add another place' : 'Find your place'} icon={Search} bodyClassName="px-5 pb-5">
        <p className="mb-3 text-sm text-muted-foreground">
          {venue ? <>Places in <b className="text-foreground">{venue.venue_name}</b>. Choose yours.</>
            : 'Choose the venue your business is in, or search for your place by name.'}
        </p>
        <div className="flex gap-2">
          {venue && (
            <button onClick={() => { setVenue(null); setQ(''); }} className="flex h-10 shrink-0 items-center gap-1 rounded-xl border bg-muted/50 px-3 text-sm font-medium hover:bg-muted" aria-label="Choose another venue">
              <ArrowLeft className="h-4 w-4" /> Venues
            </button>
          )}
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={venue ? `Search in ${venue.venue_name}` : 'Your place or the venue, e.g. Garden Café, Unity Park'}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Search places" />
            {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </label>
        </div>

        {/* Your place's results (a venue picked, or a name searched) */}
        {found && (
          found.length === 0 ? (
            <p className="mt-3 rounded-2xl bg-muted/50 p-3 text-sm text-muted-foreground">
              {venue ? `${venue.venue_name} has no café, restaurant, hotel or shop${term ? ` called “${term}”` : ''} on its map yet.` : `No place called “${term}” yet.`}
            </p>
          ) : (
            <ul className="mt-3 divide-y rounded-2xl border">
              {found.map(f => (
                <li key={f.poi_id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Store className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{f.place_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{typeLabel(f.place_type)} · {f.venue_name}</span>
                  </span>
                  {f.claimed
                    ? <span className="text-xs text-muted-foreground">Managed by a business</span>
                    : <Button size="sm" className="rounded-xl" onClick={() => onClaim(f)}>This is mine</Button>}
                </li>
              ))}
            </ul>
          )
        )}

        {/* Venues to pick from (nothing picked yet) */}
        {!venue && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{term ? 'Venues' : 'Venues on Yet New'}</p>
            {venues === null ? <Spinner /> : venueMatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No venue matches “{term}”. Your venue may not be on Yet New yet — tell them about it!</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {venueMatches.slice(0, 12).map(v => (
                  <li key={v.building_id}>
                    <button onClick={() => { setVenue(v); setQ(''); }} className="flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left hover:bg-muted/60">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted"><Building2 className="h-4 w-4 text-muted-foreground" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{v.venue_name}</span>
                        <span className="block text-xs text-muted-foreground">{v.places ? `${v.places} business ${v.places === 1 ? 'place' : 'places'}` : 'No businesses listed yet'}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Not there? */}
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed p-3">
          <span className="min-w-[200px] flex-1 text-sm">
            <span className="block font-semibold">Can’t find your place?</span>
            <span className="block text-xs text-muted-foreground">
              {venue ? `Ask ${venue.venue_name} to add it to their map. They add it, and it becomes yours to manage.`
                : 'Ask the venue you’re in to add it to their map. They add it, and it becomes yours to manage.'}
            </span>
          </span>
          <Button size="sm" variant="outline" className="rounded-xl" onClick={() => onAsk(venue?.building_id ?? null, term)}>
            <Plus className="mr-1.5 h-4 w-4" /> {venue ? `Ask ${venue.venue_name}` : 'Ask a venue to add it'}
          </Button>
        </div>
      </Panel>
    </section>
  );
}

const ASK_TYPES = ['cafe', 'restaurant', 'hotel', 'shop', 'custom'] as const;

function AskVenueDialog({ ask, businessId, onClose, onSent }: {
  ask: { venueId: string | null; name: string } | null; businessId: string; onClose: () => void; onSent: () => void;
}) {
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ venue: '', name: '', type: 'cafe' as string, where: '', phone: '', note: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (ask) {
      setF({ venue: ask.venueId ?? '', name: ask.name, type: 'cafe', where: '', phone: '', note: '' });
      void (async () => {
        const { data } = await supabase.rpc('business_venues', { q: '' });
        setVenues((data ?? []).map(v => ({ id: v.building_id, name: v.venue_name })).sort((a, z) => a.name.localeCompare(z.name)));
      })();
    } else {
      // closed
    }
  }, [ask]);
  const venueName = venues.find(v => v.id === f.venue)?.name ?? 'the venue';
  const ready = !!f.venue && f.name.trim().length >= 2 && f.where.trim().length >= 3;
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (ready) {
      setBusy(true);
      const { error } = await supabase.rpc('request_business_place', {
        business: businessId, venue: f.venue, place_name: f.name.trim(), place_type: f.type, where_note: f.where.trim(),
        phone: f.phone.trim() || null, note: f.note.trim() || null,
      });
      setBusy(false);
      if (error) { fail(error); } else { toast.success(`Sent to ${venueName}. When they add your place, it appears under “Your places”.`); onSent(); }
    } else {
      toast.error('Choose the venue, and say your place’s name and where it is.');
    }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open={!!ask} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={send}>
          <DialogHeader>
            <DialogTitle>Ask a venue to add your place</DialogTitle>
            <DialogDescription>The venue’s team puts your place on their map and links it to your account — then you manage its details here.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <label className="block space-y-1">
              <span className="text-xs font-semibold">The venue you’re in</span>
              <select value={f.venue} onChange={set('venue')} className="h-10 w-full rounded-xl border bg-card px-3 text-sm" aria-label="Venue">
                <option value="">Choose…</option>
                {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold">Your place’s name</span>
                <Input maxLength={120} value={f.name} onChange={set('name')} placeholder="Garden Café" />
              </label>
              <label className="block space-y-1">
                <span className="block text-xs font-semibold">Type</span>
                <select value={f.type} onChange={set('type')} className="h-10 rounded-xl border bg-card px-3 text-sm" aria-label="Type">
                  {ASK_TYPES.map(t => <option key={t} value={t}>{t === 'custom' ? 'Other' : typeLabel(t)}</option>)}
                </select>
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold">Where is it in the venue?</span>
              <Input maxLength={500} value={f.where} onChange={set('where')} placeholder="Ground floor, next to the north gate" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold">A phone number the venue can call (optional)</span>
              <Input maxLength={40} value={f.phone} onChange={set('phone')} placeholder="0911 22 33 44" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold">Anything else (optional)</span>
              <Textarea rows={2} maxLength={1000} value={f.note} onChange={set('note')} placeholder="e.g. We opened in September; unit 12." />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !ready}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Send to {f.venue ? venueName : 'the venue'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
      if (error) { fail(error); } else { toast.success('Sent! Yet New will check it’s yours — you’ll see the answer on this page.'); onSent(); }
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
            <DialogDescription>
              {place ? `${typeLabel(place.place_type)} in ${place.venue_name}. ` : ''}Yet New checks that {businessName} runs it — usually within a working day,
              sometimes with a quick call. Then you can add your phone, prices and what you offer.
            </DialogDescription>
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
