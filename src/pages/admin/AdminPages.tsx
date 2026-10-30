// The control center's pages: overview, approvals, institutions, venues, people and
// activity across the whole platform. Each page is a large title and a few inset lists;
// the main decision on a row is a button, everything else is in its ••• menu.

import { useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Building, Building2, Check, Eye, LayoutGrid, PenTool, Globe, CloudOff, Star, Ban, RotateCcw, ShieldPlus, ShieldMinus, ShieldCheck,
  BadgeCheck, Landmark, Flag, Shapes, Trees, Pencil, Users, Inbox, ArrowRight, Footprints, Activity as ActivityIcon, MapPin, Layers,
  CalendarDays, Route, ScrollText, Clock, Store,
} from 'lucide-react';
import {
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import AuditLogList from '@/components/audit/AuditLogList';
import { INSTITUTION_KINDS, isInstitutionKind } from '@/lib/accounts';
import { PLACE_TYPES, type PlaceType } from '@/lib/venue/places';
import { Stars } from '@/components/reviews/ReviewParts';
import { PlaceRequestRow, usePlaceRequests } from '@/components/business/PlaceRequests';
import { STATUS_INFO, trustLevelOf } from '@/lib/venue/trust';
import { dayLabel } from '@/lib/venue/activity';
import { useAdminConsole, waitingCount } from './AdminLayout';
import {
  useAdminQuery, adminActions, openInstitutionDashboard,
  type AdminActivity, type AdminInstitution, type AdminOverview, type AdminBusinessClaim, type AdminFlaggedReview, type AdminVerificationDue, type AdminUser, type AdminVenue, type AdminVerificationRequest, type InstitutionStatus, type VisitorStats,
} from './useAdmin';
import { Avatar, Empty, Loading, Mark, StatusChip, TrustPill, VenueStatus, describe, matches, plural, timeAgo, useNoteDialog } from './parts';
import { FilledButton, Group, IconTile, Metric, MoreMenu, Page, Pill, PlainButton, Row, SearchField, Segmented, Timeline, Toolbar } from './ui';
import { ACCOUNT_TYPES, OversightDialog, accountLabel, canOversee, useAccountTypes, type AccountType } from './Oversight';

const placeTypeLabel = (t: string | null) => (t && t in PLACE_TYPES ? PLACE_TYPES[t as PlaceType].label : 'Place');
const kindLabel = (k: string | null) => (k && isInstitutionKind(k) ? INSTITUTION_KINDS[k].label : k ?? 'Institution');
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong');
const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' · ');

/** Go to an institution's own dashboard (support view). */
function useOpenDashboard() {
  const navigate = useNavigate();
  return (institutionId: string | null, venueId?: string) => {
    if (institutionId) {
      openInstitutionDashboard(institutionId, venueId);
      navigate('/dashboard');
    } else {
      toast.info('This venue has no institution.');
    }
  };
}

/** The editor for a venue's first floor. */
async function openEditor(venueId: string, navigate: (to: string) => void) {
  const { data } = await supabase.from('floors').select('id').eq('building_id', venueId).order('level').limit(1);
  const f = data?.[0]?.id;
  if (f) {
    navigate(`/admin/floors/${venueId}/${f}/editor`);
  } else {
    toast.info('This venue has no floor yet.');
  }
}

const SeeAll = ({ to, children = 'See all' }: { to: string; children?: ReactNode }) => (
  <Link to={to} className="flex items-center text-sm font-medium text-primary hover:underline">{children}</Link>
);

// ── Overview ─────────────────────────────────────────────────────────────────

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Overview() {
  const { overview: o } = useAdminConsole();
  const { user } = useAdminAuth();
  const navigate = useNavigate();
  const visitors = useAdminQuery<VisitorStats>('admin_visitor_stats');
  const institutions = useAdminQuery<AdminInstitution[]>('admin_institutions');
  const venues = useAdminQuery<AdminVenue[]>('admin_venues');
  const activity = useAdminQuery<AdminActivity[]>('admin_activity', { lim: 8 });
  const waiting = waitingCount(o);
  const pendingInst = (institutions.data ?? []).filter(i => i.status === 'pending').slice(0, 4);
  const pendingVenues = (venues.data ?? []).filter(v => v.review_status === 'pending').slice(0, 4);
  const verifications = o?.verifications_pending ?? 0;
  const otherWaiting = (o?.claims_pending ?? 0) + (o?.reviews_flagged ?? 0) + (o?.verifications_due ?? 0);
  const meta = (user?.user_metadata ?? {}) as { display_name?: string; full_name?: string };
  const first = (meta.display_name || meta.full_name || '').split(' ')[0];

  return (
    <Page title={first ? `${greeting()}, ${first}` : greeting()} subtitle="Here’s how Yet New is doing.">
      <DecisionCard waiting={waiting} o={o} onReview={() => navigate('/admin/approvals')} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Group title="Waiting for you" icon={Inbox} action={waiting ? <SeeAll to="/admin/approvals">All approvals <ArrowRight className="ml-1 h-4 w-4" /></SeeAll> : null}>
          {(institutions.loading && !institutions.data) || (venues.loading && !venues.data) ? <Loading /> : !pendingInst.length && !pendingVenues.length && !verifications && !otherWaiting ? (
            <Empty icon={Check} title="All caught up" text="New institutions and first publishes from new teams show up here for your approval." />
          ) : (
            <>
              {pendingInst.map(i => (
                <Row key={i.id} to="/admin/approvals" leading={<Mark name={i.name} logo={i.logo_url} />}
                  title={i.name} subtitle={join('New institution', kindLabel(i.kind), timeAgo(i.created_at))} />
              ))}
              {pendingVenues.map(v => (
                <Row key={v.id} to="/admin/approvals" leading={<IconTile icon={Globe} tone="blue" />}
                  title={v.name} subtitle={join('Wants to publish', v.institution_name, v.review_requested_at && timeAgo(v.review_requested_at))} />
              ))}
              {verifications ? (
                <Row to="/admin/approvals" leading={<IconTile icon={BadgeCheck} tone="green" />}
                  title={plural(verifications, 'verification request')} subtitle="Places asking to be verified or official" />
              ) : null}
              {o?.claims_pending ? (
                <Row to="/admin/approvals" leading={<IconTile icon={Store} tone="orange" />}
                  title={plural(o.claims_pending, 'business claim')} subtitle="Businesses asking to manage their place" />
              ) : null}
              {o?.reviews_flagged ? (
                <Row to="/admin/approvals" leading={<IconTile icon={Flag} tone="red" />}
                  title={plural(o.reviews_flagged, 'flagged review')} subtitle="Reviews visitors reported" />
              ) : null}
              {o?.verifications_due ? (
                <Row to="/admin/approvals" leading={<IconTile icon={BadgeCheck} tone="gray" />}
                  title={plural(o.verifications_due, 'verification', 'verifications')} subtitle="Ended or ending within 30 days — renew or remove" />
              ) : null}
            </>
          )}
        </Group>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <Metric icon={Building} label="Institutions" value={o?.institutions ?? '—'} caption={o ? `${o.new_institutions_30d} new in 30 days` : undefined} onClick={() => navigate('/admin/institutions')} />
          <Metric icon={Globe} label="Venues live" value={o ? `${o.venues_published} / ${o.venues}` : '—'} caption={o ? `${o.publishes_30d} publishes in 30 days` : undefined} onClick={() => navigate('/admin/venues')} />
          <Metric icon={Users} label="Team members" value={o?.team_members ?? '—'} caption={o ? plural(o.platform_admins, 'Yet New admin') : undefined} onClick={() => navigate('/admin/users')} />
          <Metric icon={Footprints} label="Visits" value={visitors.data ? visitors.data.visits.toLocaleString('en') : '—'} caption={visitors.data ? `${plural(visitors.data.saves, 'place')} saved` : undefined} onClick={() => navigate('/admin/insights')} />
        </div>
      </div>

      <Group title="Recent changes" icon={ActivityIcon} action={<SeeAll to="/admin/activity">See all <ArrowRight className="ml-1 h-4 w-4" /></SeeAll>}>
        <div className="px-5 py-5"><ActivityTimeline rows={activity.data} loading={activity.loading} /></div>
      </Group>
    </Page>
  );
}

/** One thing to do next — like the dashboard's "Next step" card. */
function DecisionCard({ waiting, o, onReview }: { waiting: number; o: AdminOverview | null; onReview: () => void }) {
  if (o && waiting > 0) {
    const parts = [
      o.institutions_pending ? plural(o.institutions_pending, 'new institution') : null,
      o.venues_pending ? plural(o.venues_pending, 'publish request') : null,
      o.verifications_pending ? plural(o.verifications_pending, 'verification') : null,
      o.claims_pending ? plural(o.claims_pending, 'business claim') : null,
      o.reviews_flagged ? plural(o.reviews_flagged, 'flagged review') : null,
      o.verifications_due ? plural(o.verifications_due, 'renewal') : null,
    ].filter(Boolean).join(', ');
    return (
      <section className="flex flex-wrap items-center gap-4 rounded-3xl border bg-gradient-to-br from-primary/10 via-card to-card p-5">
        <div className="min-w-[240px] flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Needs your decision · {waiting} waiting</p>
          <h2 className="mt-1 text-lg font-bold">{parts}</h2>
          <p className="text-sm text-muted-foreground">Nothing from a new team goes live until you approve it.</p>
        </div>
        <Button size="lg" onClick={onReview} className="rounded-full"><ShieldCheck className="mr-1.5 h-4 w-4" /> Review now</Button>
      </section>
    );
  } else if (o) {
    return (
      <section className="flex items-center gap-4 rounded-3xl border bg-gradient-to-br from-emerald-500/10 via-card to-card p-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-700"><Check className="h-5 w-5" /></span>
        <div>
          <h2 className="text-lg font-bold">All caught up</h2>
          <p className="text-sm text-muted-foreground">No institutions, venues or verifications are waiting for you.</p>
        </div>
      </section>
    );
  } else {
    return null;
  }
}

const activityIcon = (a: AdminActivity) => (a.action === 'published' ? Globe : a.action.includes('review') ? Eye
  : ({ place: MapPin, floor: Layers, venue: Globe, event: CalendarDays, tour: Route } as Record<string, typeof Globe>)[a.object_type] ?? Pencil);

function ActivityTimeline({ rows, loading }: { rows: AdminActivity[] | null; loading: boolean }) {
  if (loading && !rows) {
    return <Loading />;
  } else if (!rows?.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Edits and publishes from every institution appear here.</p>;
  } else {
    const groups: { day: string; items: { id: number; icon: typeof Globe; text: ReactNode; meta: ReactNode }[] }[] = [];
    for (const a of rows) {
      const day = dayLabel(a.created_at);
      const item = { id: a.id, icon: activityIcon(a), text: describe(a), meta: join(a.institution_name, timeAgo(a.created_at)) };
      if (groups[groups.length - 1]?.day === day) {
        groups[groups.length - 1].items.push(item);
      } else {
        groups.push({ day, items: [item] });
      }
    }
    return <Timeline groups={groups} />;
  }
}

// ── Approvals ────────────────────────────────────────────────────────────────

/** A request with its decision buttons; the buttons drop under the text on a phone. */
function Decision({ leading, title, subtitle, detail, note, children }: {
  leading: ReactNode; title: ReactNode; subtitle: ReactNode; detail?: ReactNode; note?: string | null; children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4">
      <span className="shrink-0 self-start">{leading}</span>
      <div className="min-w-[200px] flex-1">
        <p className="font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
        {note ? <p className="mt-1.5 whitespace-pre-line rounded-lg bg-muted/60 px-2 py-1 text-xs">“{note}”</p> : null}
      </div>
      <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">{children}</div>
    </div>
  );
}

export function Approvals() {
  const { reloadOverview } = useAdminConsole();
  const institutions = useAdminQuery<AdminInstitution[]>('admin_institutions');
  const venues = useAdminQuery<AdminVenue[]>('admin_venues');
  const verifications = useAdminQuery<AdminVerificationRequest[]>('admin_verification_queue');
  const claims = useAdminQuery<AdminBusinessClaim[]>('admin_business_claims');
  const flagged = useAdminQuery<AdminFlaggedReview[]>('admin_flagged_reviews');
  const due = useAdminQuery<AdminVerificationDue[]>('admin_verifications_due', { days: 30 });
  // How long a verification lasts before it's re-checked (business plan §20: "expiry or review date").
  const [months, setMonths] = useState(12);
  const openDashboard = useOpenDashboard();
  const notes = useNoteDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const pendingInst = (institutions.data ?? []).filter(i => i.status === 'pending');
  const pendingVenues = (venues.data ?? []).filter(v => v.review_status === 'pending');
  const pendingVerifications = verifications.data ?? [];
  const pendingClaims = claims.data ?? [];
  const flaggedReviews = flagged.data ?? [];
  const dueChecks = due.data ?? [];
  const loading = (institutions.loading && !institutions.data) || (venues.loading && !venues.data);
  const total = pendingInst.length + pendingVenues.length + pendingVerifications.length + pendingClaims.length + flaggedReviews.length + dueChecks.length;
  const refresh = () => {
    void institutions.reload(); void venues.reload(); void verifications.reload(); void claims.reload(); void flagged.reload(); void due.reload(); reloadOverview();
  };

  const run = async (id: string, work: () => Promise<void>, done: string) => {
    setBusy(id);
    try { await work(); toast.success(done); refresh(); } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const decideInst = (i: AdminInstitution, status: InstitutionStatus, note?: string) => run(i.id, () => adminActions.setInstitutionStatus(i.id, status, note),
    status === 'approved' ? `${i.name} approved${i.pending_reviews ? ' — its waiting venues are live now' : ''}` : `${i.name} declined`);
  const decideVenue = (v: AdminVenue, approve: boolean, note?: string) => run(v.id, () => adminActions.reviewVenue(v.id, approve, note),
    approve ? `${v.name} is live` : `Publishing ${v.name} declined`);
  const decideVerification = (r: AdminVerificationRequest, approve: boolean, note?: string) => run(r.id, () => adminActions.decideVerification(r.id, approve, note, months),
    approve ? `${r.place_name ?? r.venue_name} is ${r.level} now, for ${months} months` : 'Verification declined');
  const decideClaim = (c: AdminBusinessClaim, approve: boolean, note?: string) => run(c.id, () => adminActions.decideClaim(c.id, approve, note),
    approve ? `${c.business_name} now manages ${c.place_name}` : 'Claim declined');
  const moderate = (r: AdminFlaggedReview, hide: boolean, reason?: string) => run(r.id, () => adminActions.moderateReview(r.id, hide, reason),
    hide ? 'Review hidden' : 'Review kept — its flags are cleared');
  const renew = (d: AdminVerificationDue, keep: boolean, note?: string) => run(d.poi_id ?? d.building_id,
    () => adminActions.setTrust(d.building_id, keep ? d.level : 'listed', note, d.poi_id ?? undefined, months),
    keep ? `${d.name}: renewed for ${months} months` : `${d.name}: verification removed`);

  return (
    <Page title="Approvals" subtitle="Approving an institution also publishes the venues it was waiting to publish.">
      {notes.dialog}
      {loading ? <Loading /> : total === 0 ? (
        <Group><Empty icon={Check} title="All caught up" text="New institutions, publish requests, verifications, business claims and flagged reviews will wait here for you." /></Group>
      ) : null}

      {!loading && pendingInst.length ? (
        <Group title={`New institutions · ${pendingInst.length}`}>
          {pendingInst.map(i => (
            <Decision key={i.id} leading={<Mark name={i.name} logo={i.logo_url} size={40} />} title={i.name}
              subtitle={join(kindLabel(i.kind), `signed up ${timeAgo(i.created_at)}`, `by ${i.owner_name || (i.owner_username ? `@${i.owner_username}` : 'unknown')}`)}
              detail={join(plural(i.venues, 'venue'), plural(i.members, 'person', 'people'), i.pending_reviews ? `${i.pending_reviews} waiting to publish` : null)}>
              <MoreMenu label={`More for ${i.name}`} title={i.name}>
                <DropdownMenuItem onSelect={() => openDashboard(i.id)}><LayoutGrid className="mr-2 h-4 w-4" /> Look inside their dashboard</DropdownMenuItem>
              </MoreMenu>
              <PlainButton tone="red" disabled={busy === i.id}
                onClick={() => notes.ask({ title: `Decline ${i.name}?`, text: 'Their venues stay offline. They can still sign in and see your note.', confirm: 'Decline', danger: true, run: n => decideInst(i, 'rejected', n) })}>
                Decline
              </PlainButton>
              <FilledButton disabled={busy === i.id} onClick={() => void decideInst(i, 'approved')}>Approve</FilledButton>
            </Decision>
          ))}
        </Group>
      ) : null}

      {!loading && pendingVenues.length ? (
        <Group title={`Publish requests · ${pendingVenues.length}`}>
          {pendingVenues.map(v => (
            <Decision key={v.id} leading={<IconTile icon={v.layout === 'site' ? Trees : Building2} tone="blue" size={40} />} title={v.name}
              subtitle={join(v.institution_name, v.institution_status && v.institution_status !== 'approved' ? 'institution not approved yet' : null, v.review_requested_at && `asked ${timeAgo(v.review_requested_at)}`)}
              detail={join(plural(v.floors, v.layout === 'site' ? 'zone' : 'floor'), plural(v.places, 'place'), v.placed ? 'on the world map' : 'not on the world map yet')}>
              <PlainButton href={`/venue/${v.id}?preview=1`}>Preview</PlainButton>
              <PlainButton tone="red" disabled={busy === v.id}
                onClick={() => notes.ask({ title: `Decline publishing ${v.name}?`, text: 'Tell the team what to change — they see your note on their dashboard and can publish again.', confirm: 'Decline', danger: true, run: n => decideVenue(v, false, n) })}>
                Decline
              </PlainButton>
              <FilledButton disabled={busy === v.id} onClick={() => void decideVenue(v, true)}>Publish</FilledButton>
            </Decision>
          ))}
        </Group>
      ) : null}

      {verifications.needsMigration ? (
        <Group title="Verification requests" footer="Run the 20261028090000_place_trust migration to turn on verification requests."><Empty icon={BadgeCheck} title="Not set up yet" /></Group>
      ) : !loading && pendingVerifications.length ? (
        <Group title={`Verification requests · ${pendingVerifications.length}`} footer="Verification is free and never sold." action={<label className="flex items-center gap-1.5 text-xs text-muted-foreground">Valid for
            <select value={months} onChange={e => setMonths(Number(e.target.value))} className="rounded-lg border bg-card px-1.5 py-1 text-xs text-foreground" aria-label="Valid for">
              {[6, 12, 24].map(m => <option key={m} value={m}>{m} months</option>)}
            </select></label>}>
          {pendingVerifications.map(r => (
            <Decision key={r.id} leading={<IconTile icon={r.level === 'official' ? Landmark : BadgeCheck} tone={r.level === 'official' ? 'purple' : 'green'} size={40} />}
              title={<>{r.place_name ? `${r.place_name}, ${r.venue_name}` : r.venue_name} <span className="font-normal text-muted-foreground">→ {STATUS_INFO[r.level].label}</span></>}
              subtitle={join(r.institution_name, `asked ${timeAgo(r.requested_at)}`, r.requested_by_name && `by ${r.requested_by_name}`, `now ${STATUS_INFO[trustLevelOf(r.current_level)].label}`, !r.is_published && 'not published')}
              detail={<>{r.scope ? <>Check: <b className="font-medium text-foreground">{r.scope}</b> · </> : null}{join(`Source: ${r.source || 'not given'}`, `Responsible: ${r.responsible_party || 'not given'}`)}{r.open_reports ? <> · <span className="text-amber-700">{plural(r.open_reports, 'open report')}</span></> : null}</>}
              note={r.note}>
              <PlainButton href={`/venue/${r.building_id}${r.is_published ? '' : '?preview=1'}`}>Look</PlainButton>
              <PlainButton tone="red" disabled={busy === r.id}
                onClick={() => notes.ask({ title: 'Decline this verification?', text: 'Say what is missing — the team sees your note in Venue Settings and can ask again.', confirm: 'Decline', danger: true, run: n => decideVerification(r, false, n) })}>
                Decline
              </PlainButton>
              <FilledButton disabled={busy === r.id}
                onClick={() => notes.ask({ title: `Mark ${r.place_name ?? r.venue_name} ${r.level}?`, text: 'Visitors see the badge with today’s date. Note how you checked it (kept in the activity log).', confirm: r.level === 'official' ? 'Mark official' : 'Verify', run: n => decideVerification(r, true, n) })}>
                {r.level === 'official' ? 'Mark official' : 'Verify'}
              </FilledButton>
            </Decision>
          ))}
        </Group>
      ) : null}

      {!loading && pendingClaims.length ? (
        <Group title={`Business claims · ${pendingClaims.length}`} footer="Check the evidence — call the number, look up the licence. The business then manages the place's contact, prices and review answers.">
          {pendingClaims.map(c => (
            <Decision key={c.id} leading={<IconTile icon={Store} tone="orange" size={40} />}
              title={<>{c.business_name} <span className="font-normal text-muted-foreground">→ {c.place_name}</span></>}
              subtitle={join(`${placeTypeLabel(c.place_type)} in ${c.venue_name}`, c.venue_institution, `asked ${timeAgo(c.requested_at)}`, c.requested_by_name && `by ${c.requested_by_name}`)}
              detail={join(c.contact_phone && `Phone: ${c.contact_phone}`, c.other_claims ? `${plural(Number(c.other_claims), 'other business', 'other businesses')} also asking` : null)}
              note={c.evidence}>
              <PlainButton href={`/venue/${c.building_id}?poi=${c.poi_id}`}>Look</PlainButton>
              <PlainButton tone="red" disabled={busy === c.id}
                onClick={() => notes.ask({ title: `Decline ${c.business_name}'s claim?`, text: 'Say what is missing — they see your note on Yet New Business and can ask again.', confirm: 'Decline', danger: true, run: n => decideClaim(c, false, n) })}>
                Decline
              </PlainButton>
              <FilledButton disabled={busy === c.id}
                onClick={() => notes.ask({ title: `Let ${c.business_name} manage ${c.place_name}?`, text: 'Note how you checked it (kept in the audit log). Other claims for this place are answered too.', confirm: 'Approve', run: n => decideClaim(c, true, n) })}>
                Approve
              </FilledButton>
            </Decision>
          ))}
        </Group>
      ) : null}

      {!loading && <AdminPlaceRequests />}

      {!loading && flaggedReviews.length ? (
        <Group title={`Flagged reviews · ${flaggedReviews.length}`} footer="Hide only what breaks the rules — abuse, spam, personal details, not about the place. Criticism stays.">
          {flaggedReviews.map(r => (
            <Decision key={r.id} leading={<IconTile icon={Flag} tone="red" size={40} />}
              title={<>{r.author_name} <span className="font-normal text-muted-foreground">on {r.place_name}</span> <Stars value={r.rating} size={12} className="ml-1 align-[-1px]" /></>}
              subtitle={join(r.venue_name, timeAgo(r.created_at), `${plural(r.flags, 'flag')}`, r.reasons.length ? `“${r.reasons.join('”, “')}”` : null)}
              note={r.body}>
              <PlainButton disabled={busy === r.id} onClick={() => void moderate(r, false)}>Keep</PlainButton>
              <FilledButton disabled={busy === r.id}
                onClick={() => notes.ask({ title: 'Hide this review?', text: 'Visitors stop seeing it and it leaves the rating. Its writer still sees it, with your reason.', confirm: 'Hide', danger: true, run: n => moderate(r, true, n) })}>
                Hide
              </FilledButton>
            </Decision>
          ))}
        </Group>
      ) : null}

      {!loading && dueChecks.length ? (
        <Group title={`Verifications to renew · ${dueChecks.length}`} action={<label className="flex items-center gap-1.5 text-xs text-muted-foreground">Valid for
            <select value={months} onChange={e => setMonths(Number(e.target.value))} className="rounded-lg border bg-card px-1.5 py-1 text-xs text-foreground" aria-label="Valid for">
              {[6, 12, 24].map(m => <option key={m} value={m}>{m} months</option>)}
            </select></label>}
          footer="Ended or ending within 30 days. Until renewed, visitors see a lapsed verification as Listed.">
          {dueChecks.map(d => {
            const key = d.poi_id ?? d.building_id;
            const lapsed = new Date(d.verified_until).getTime() < Date.now();
            return (
              <Decision key={key} leading={<IconTile icon={d.level === 'official' ? Landmark : BadgeCheck} tone={lapsed ? 'gray' : 'green'} size={40} />}
                title={<>{d.poi_id ? `${d.name}, ${d.venue_name}` : d.name} <span className="font-normal text-muted-foreground">· {STATUS_INFO[d.level].label}</span></>}
                subtitle={join(lapsed ? `ended ${timeAgo(d.verified_until)}` : `ends ${new Date(d.verified_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
                  d.verified_at && `verified ${timeAgo(d.verified_at)}`, d.responsible_party)}
                detail={d.scope ? `Checked: ${d.scope}` : undefined}>
                <PlainButton href={`/venue/${d.building_id}${d.poi_id ? `?poi=${d.poi_id}` : ''}`}>Look</PlainButton>
                <PlainButton tone="red" disabled={busy === key}
                  onClick={() => notes.ask({ title: `Remove ${d.name}'s verification?`, text: 'It goes back to Listed. Say why — the team sees your note.', confirm: 'Remove', danger: true, run: n => renew(d, false, n) })}>
                  Remove
                </PlainButton>
                <FilledButton disabled={busy === key}
                  onClick={() => notes.ask({ title: `Renew ${d.name} for ${months} months?`, text: 'Note how you re-checked it (kept in the audit log).', confirm: 'Renew', run: n => renew(d, true, n) })}>
                  Renew
                </FilledButton>
              </Decision>
            );
          })}
        </Group>
      ) : null}
    </Page>
  );
}

// ── Institutions ─────────────────────────────────────────────────────────────

const INSTITUTION_FILTERS = [['all', 'All'], ['pending', 'Waiting'], ['approved', 'Approved'], ['suspended', 'Suspended'], ['rejected', 'Declined']] as const;

export function Institutions() {
  const { reloadOverview } = useAdminConsole();
  const q = useAdminQuery<AdminInstitution[]>('admin_institutions');
  const openDashboard = useOpenDashboard();
  const notes = useNoteDialog();
  const navigate = useNavigate();
  const accounts = useAccountTypes();
  const [filter, setFilter] = useState<'all' | InstitutionStatus>('all');
  const [search, setSearch] = useState('');
  const [overseeing, setOverseeing] = useState<{ id: string; name: string } | null>(null);
  const rows = useMemo(() => (q.data ?? []).filter(i => (filter === 'all' || i.status === filter) && matches(search, i.name, i.owner_username, i.owner_name, i.kind)), [q.data, filter, search]);
  const typeOf = (id: string) => accounts.types?.get(id) ?? 'venue';

  const setType = async (i: AdminInstitution, t: AccountType) => {
    try { await accounts.setType(i.id, t); toast.success(`${i.name} is a ${accountLabel(t).toLowerCase()} account now`); } catch (e) { fail(e); }
  };
  const set = async (i: AdminInstitution, s: InstitutionStatus, note?: string) => {
    try {
      await adminActions.setInstitutionStatus(i.id, s, note);
      toast.success(`${i.name}: ${s === 'approved' ? 'approved' : s === 'suspended' ? 'suspended — its venues are offline' : s === 'rejected' ? 'declined' : 'back to waiting'}`);
      void q.reload(); reloadOverview();
    } catch (e) { fail(e); }
  };

  return (
    <Page title="Institutions" subtitle={q.data ? plural(q.data.length, 'institution') : undefined}>
      {notes.dialog}
      <OversightDialog overseer={overseeing} institutions={(q.data ?? []).map(i => ({ id: i.id, name: i.name }))} grants={accounts.grants}
        onClose={() => setOverseeing(null)} setOversight={accounts.setOversight} />
      <Toolbar>
        <div className="max-w-full overflow-x-auto"><Segmented label="Show" value={filter} onChange={setFilter} options={INSTITUTION_FILTERS} /></div>
        <SearchField value={search} onChange={setSearch} placeholder="Search institutions" className="w-full sm:w-64" />
      </Toolbar>
      <Group>
        {q.loading && !q.data ? <Loading /> : !rows.length ? <Empty icon={Building} title="No institutions" text={search ? 'Nothing matches your search.' : 'None in this list.'} /> : rows.map(i => {
          const type = typeOf(i.id);
          return (
            <Row key={i.id} leading={<Mark name={i.name} logo={i.logo_url} size={36} />}
              title={<span className="flex items-center gap-2"><span className="truncate">{i.name}</span>{type !== 'venue' ? <Pill tone="purple">{accountLabel(type)}</Pill> : null}</span>}
              subtitle={join(kindLabel(i.kind), `${i.published} of ${plural(i.venues, 'venue')} live`, plural(i.members, 'person', 'people'), i.last_activity && `active ${timeAgo(i.last_activity)}`)}
              detail={i.status !== 'approved' && i.review_note ? `“${i.review_note}”` : undefined}
              trailing={<>
                {i.pending_reviews ? <Pill tone="blue">{i.pending_reviews} to publish</Pill> : null}
                {i.status !== 'approved' ? <StatusChip status={i.status} /> : null}
                <MoreMenu label={`Actions for ${i.name}`} title={i.name}>
                  <DropdownMenuItem onSelect={() => openDashboard(i.id)}><LayoutGrid className="mr-2 h-4 w-4" /> Open their dashboard</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {i.status !== 'approved' ? <DropdownMenuItem onSelect={() => void set(i, 'approved')}><Check className="mr-2 h-4 w-4" /> {i.status === 'suspended' ? 'Reactivate' : 'Approve'}</DropdownMenuItem> : null}
                  {i.status === 'approved' ? <DropdownMenuItem className="text-amber-700" onSelect={() => notes.ask({ title: `Suspend ${i.name}?`, text: 'Their venues go offline and they can’t publish until you reactivate them.', confirm: 'Suspend', danger: true, run: n => set(i, 'suspended', n) })}><Ban className="mr-2 h-4 w-4" /> Suspend</DropdownMenuItem> : null}
                  {i.status === 'pending' ? <DropdownMenuItem className="text-destructive" onSelect={() => notes.ask({ title: `Decline ${i.name}?`, text: 'Their venues stay offline.', confirm: 'Decline', danger: true, run: n => set(i, 'rejected', n) })}><Ban className="mr-2 h-4 w-4" /> Decline</DropdownMenuItem> : null}
                  {i.status === 'rejected' || i.status === 'suspended' ? <DropdownMenuItem onSelect={() => void set(i, 'pending')}><RotateCcw className="mr-2 h-4 w-4" /> Back to waiting</DropdownMenuItem> : null}
                  {!accounts.missing ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger><Shapes className="mr-2 h-4 w-4" /> Kind of account: {accountLabel(type)}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-72 rounded-xl">
                          {ACCOUNT_TYPES.map(([t, label, hint]) => (
                            <DropdownMenuItem key={t} onSelect={() => void setType(i, t)}>
                              <span className="flex-1"><span className="block font-medium">{label}</span><span className="block text-[11px] text-muted-foreground">{hint}</span></span>
                              {type === t ? <Check className="ml-2 h-4 w-4 text-primary" /> : null}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      {canOversee(type) ? <DropdownMenuItem onSelect={() => setOverseeing({ id: i.id, name: i.name })}><Eye className="mr-2 h-4 w-4" /> What it oversees ({accounts.grants.filter(g => g.overseer_id === i.id).length})…</DropdownMenuItem> : null}
                      {canOversee(type) ? <DropdownMenuItem onSelect={() => navigate(`/destination?as=${i.id}`)}><Landmark className="mr-2 h-4 w-4" /> Open its Destination OS</DropdownMenuItem> : null}
                    </>
                  ) : null}
                </MoreMenu>
              </>} />
          );
        })}
      </Group>
    </Page>
  );
}

// ── Venues ───────────────────────────────────────────────────────────────────

const VENUE_FILTERS = [['all', 'All'], ['live', 'Live'], ['review', 'In review'], ['draft', 'Drafts']] as const;

export function Venues() {
  const { reloadOverview } = useAdminConsole();
  const q = useAdminQuery<AdminVenue[]>('admin_venues');
  const navigate = useNavigate();
  const openDashboard = useOpenDashboard();
  const notes = useNoteDialog();
  const [filter, setFilter] = useState<'all' | 'live' | 'draft' | 'review'>('all');
  const [search, setSearch] = useState('');
  const rows = useMemo(() => (q.data ?? []).filter(v =>
    (filter === 'all' || (filter === 'live' ? v.is_published : filter === 'review' ? v.review_status === 'pending' : !v.is_published && v.review_status !== 'pending'))
    && matches(search, v.name, v.institution_name)), [q.data, filter, search]);

  const act = async (work: () => Promise<void>, done: string, overview = true) => {
    try {
      await work(); toast.success(done); void q.reload();
      if (overview) { reloadOverview(); } else { /* the overview doesn't count this */ }
    } catch (e) { fail(e); }
  };
  const live = (v: AdminVenue, on: boolean) => act(() => adminActions.setVenueLive(v.id, on), on ? `${v.name} published` : `${v.name} taken offline`);
  const trust = (v: AdminVenue, level: 'listed' | 'verified' | 'official', note?: string) =>
    act(() => adminActions.setTrust(v.id, level, note), level === 'listed' ? `${v.name}: verification removed` : `${v.name} is ${level} now`);
  const suspend = (v: AdminVenue, on: boolean, note?: string) =>
    act(() => adminActions.suspendVenue(v.id, on, note), on ? `${v.name} suspended — offline` : `${v.name}: suspension lifted — the team can publish again`);
  const feature = (v: AdminVenue, rank: number) =>
    act(() => adminActions.setHomeRank(v.id, rank), rank > 0 ? `${v.name} featured on the home page` : `${v.name} no longer featured`, false);

  return (
    <Page title="Venues" subtitle={q.data ? `${q.data.filter(v => v.is_published).length} live of ${plural(q.data.length, 'venue')}` : undefined}>
      {notes.dialog}
      <Toolbar>
        <Segmented label="Show" value={filter} onChange={setFilter} options={VENUE_FILTERS} />
        <SearchField value={search} onChange={setSearch} placeholder="Search venues" className="w-full sm:w-64" />
      </Toolbar>
      <Group>
        {q.loading && !q.data ? <Loading /> : !rows.length ? <Empty icon={Globe} title="No venues" text={search ? 'Nothing matches your search.' : 'None in this list.'} /> : rows.map(v => {
          const level = trustLevelOf(v.trust_level);
          return (
            <Row key={v.id}
              leading={<IconTile icon={v.layout === 'site' ? Trees : Building2} tone={v.is_published && !v.suspended_at ? 'green' : 'gray'} size={36} />}
              title={<span className="flex items-center gap-1.5"><span className="truncate">{v.name}</span>{v.home_rank > 0 ? <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Featured" /> : null}</span>}
              subtitle={join(v.institution_name ?? 'No institution', plural(v.floors, v.layout === 'site' ? 'zone' : 'floor'), plural(v.places, 'place'),
                v.published_at ? `published ${timeAgo(v.published_at)}` : 'never published')}
              detail={v.suspended_at && v.suspend_note ? `“${v.suspend_note}”` : undefined}
              trailing={<>
                {v.open_reports ? <span className="hidden items-center gap-1 text-xs text-amber-700 sm:flex" title="Open visitor reports"><Flag className="h-3.5 w-3.5" />{v.open_reports}</span> : null}
                <span className="hidden sm:inline-flex"><TrustPill level={v.trust_level} /></span>
                <VenueStatus v={v} />
                <MoreMenu label={`Actions for ${v.name}`} title={v.name}>
                  <DropdownMenuItem asChild><a href={`/venue/${v.id}${v.is_published ? '' : '?preview=1'}`} target="_blank" rel="noreferrer"><Eye className="mr-2 h-4 w-4" /> {v.is_published ? 'View as a visitor' : 'Preview'}</a></DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void openEditor(v.id, navigate)}><PenTool className="mr-2 h-4 w-4" /> Open the map editor</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openDashboard(v.institution_id, v.id)}><LayoutGrid className="mr-2 h-4 w-4" /> Open their dashboard</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {v.is_published
                    ? <DropdownMenuItem onSelect={() => void live(v, false)}><CloudOff className="mr-2 h-4 w-4" /> Take offline</DropdownMenuItem>
                    : <DropdownMenuItem onSelect={() => void live(v, true)}><Globe className="mr-2 h-4 w-4" /> Publish now</DropdownMenuItem>}
                  {v.home_rank > 0
                    ? <DropdownMenuItem onSelect={() => void feature(v, 0)}><Star className="mr-2 h-4 w-4" /> Stop featuring</DropdownMenuItem>
                    : <DropdownMenuItem onSelect={() => void feature(v, 10)}><Star className="mr-2 h-4 w-4" /> Feature on the home page</DropdownMenuItem>}
                  <DropdownMenuSeparator />
                  {level !== 'verified' ? <DropdownMenuItem onSelect={() => notes.ask({ title: `Verify ${v.name}?`, text: 'Visitors see “Verified” with today’s date. Note how you checked it.', confirm: 'Verify', run: n => trust(v, 'verified', n) })}><BadgeCheck className="mr-2 h-4 w-4" /> Mark verified</DropdownMenuItem> : null}
                  {level !== 'official' ? <DropdownMenuItem onSelect={() => notes.ask({ title: `Mark ${v.name} official?`, text: 'Only when the responsible authority confirmed it. Note who and how.', confirm: 'Mark official', run: n => trust(v, 'official', n) })}><Landmark className="mr-2 h-4 w-4" /> Mark official</DropdownMenuItem> : null}
                  {level !== 'listed' ? <DropdownMenuItem onSelect={() => notes.ask({ title: `Remove verification from ${v.name}?`, text: 'It goes back to Listed. Say why — the team sees your note.', confirm: 'Remove', danger: true, run: n => trust(v, 'listed', n) })}><ShieldMinus className="mr-2 h-4 w-4" /> Remove verification</DropdownMenuItem> : null}
                  {v.suspended_at
                    ? <DropdownMenuItem onSelect={() => void suspend(v, false)}><RotateCcw className="mr-2 h-4 w-4" /> Lift suspension</DropdownMenuItem>
                    : <DropdownMenuItem className="text-destructive" onSelect={() => notes.ask({ title: `Suspend ${v.name}?`, text: 'It goes offline now, and the team can’t publish it until you lift the suspension. Tell them why.', confirm: 'Suspend', danger: true, run: n => suspend(v, true, n) })}><Ban className="mr-2 h-4 w-4" /> Suspend venue</DropdownMenuItem>}
                </MoreMenu>
              </>} />
          );
        })}
      </Group>
    </Page>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

export function People() {
  const { reloadOverview } = useAdminConsole();
  const q = useAdminQuery<AdminUser[]>('admin_users');
  const { user } = useAdminAuth();
  const openDashboard = useOpenDashboard();
  const [search, setSearch] = useState('');
  const [who, setWho] = useState<'all' | 'admins'>('all');
  const rows = useMemo(() => (q.data ?? []).filter(u => (who === 'all' || u.is_platform_admin)
    && matches(search, u.display_name, u.username, u.email, ...u.institutions.map(i => i.name))), [q.data, search, who]);
  const admins = (q.data ?? []).filter(u => u.is_platform_admin).length;
  const setAdmin = async (u: AdminUser, make: boolean) => {
    try { await adminActions.setPlatformAdmin(u.user_id, make); toast.success(make ? `${u.display_name || u.username} is now a Yet New admin` : 'Admin access removed'); void q.reload(); reloadOverview(); }
    catch (e) { fail(e); }
  };

  return (
    <Page title="People" subtitle="Team members are managed by their institution’s owner.">
      <Toolbar>
        <Segmented label="Show" value={who} onChange={setWho} options={[['all', `Everyone${q.data ? ` · ${q.data.length}` : ''}`], ['admins', `Yet New team · ${admins}`]] as const} />
        <SearchField value={search} onChange={setSearch} placeholder="Search people" className="w-full sm:w-64" />
      </Toolbar>
      <Group>
        {q.loading && !q.data ? <Loading /> : !rows.length ? <Empty icon={Users} title="Nobody here" text="Try another search." /> : rows.map(u => {
          const name = u.display_name || u.username || u.email || 'Unknown';
          return (
            <Row key={u.user_id} leading={<Avatar name={name} size={36} />}
              title={<span className="flex items-center gap-2"><span className="truncate">{name}</span>{u.is_platform_admin ? <Pill tone="purple">Admin</Pill> : null}</span>}
              subtitle={join(u.username ? `@${u.username}` : u.email, u.institutions.length ? u.institutions.map(i => `${i.name} (${i.role})`).join(', ') : 'No institution')}
              trailing={<>
                <span className="hidden text-xs text-muted-foreground md:inline">{u.last_sign_in_at ? `Signed in ${timeAgo(u.last_sign_in_at)}` : 'Never signed in'}</span>
                <MoreMenu label={`Actions for ${name}`} title={name}>
                  {u.institutions.map(i => (
                    <DropdownMenuItem key={i.id} onSelect={() => openDashboard(i.id)}><LayoutGrid className="mr-2 h-4 w-4" /> Open {i.name}</DropdownMenuItem>
                  ))}
                  {u.institutions.length ? <DropdownMenuSeparator /> : null}
                  {u.is_platform_admin
                    ? <DropdownMenuItem disabled={u.user_id === user?.id} onSelect={() => void setAdmin(u, false)}><ShieldMinus className="mr-2 h-4 w-4" /> Remove Yet New admin</DropdownMenuItem>
                    : <DropdownMenuItem onSelect={() => void setAdmin(u, true)}><ShieldPlus className="mr-2 h-4 w-4" /> Make Yet New admin</DropdownMenuItem>}
                </MoreMenu>
              </>} />
          );
        })}
      </Group>
    </Page>
  );
}

// ── Activity (recent changes; the audit log is the other tab) ───────────────

export function Activity() {
  const { pathname } = useLocation();
  const audit = pathname.endsWith('/audit');
  const q = useAdminQuery<AdminActivity[]>('admin_activity', { lim: 200 });
  const [search, setSearch] = useState('');
  const rows = (q.data ?? []).filter(a => matches(search, a.venue_name, a.institution_name, a.actor_name, a.object_name, a.action));

  if (audit) {
    return (
      <Page title="Audit log" subtitle="Every change to access, trust and visibility across the platform. Permanent: entries can’t be changed or deleted, by anyone.">
        <Group title="All changes" icon={ScrollText}><div className="p-5"><AuditLogList institutionId={null} fileName="Yet New audit log.csv" /></div></Group>
      </Page>
    );
  } else {
    return (
      <Page title="Recent changes" subtitle="The latest 200 edits and publishes from every institution."
        actions={<Button variant="outline" className="rounded-xl" onClick={() => void q.reload()}><Clock className="mr-1.5 h-4 w-4" /> Refresh</Button>}>
        <Group title="Activity" icon={ActivityIcon} action={<SearchField value={search} onChange={setSearch} placeholder="Search activity" className="w-full sm:w-60" />}>
          <div className="px-5 py-5"><ActivityTimeline rows={q.data ? rows : null} loading={q.loading} /></div>
        </Group>
      </Page>
    );
  }
}

/** Businesses asking a venue to add their place — usually the venue's team answers; Yet New can too. */
function AdminPlaceRequests() {
  const { rows, reload } = usePlaceRequests(null);
  if (!rows || rows.length === 0) {
    return null;
  } else {
    return (
      <Group title={`Places businesses asked to add · ${rows.length}`} flush
        footer="The venue's team sees these on its Places page. Step in when a venue is slow to answer: add the place in the venue's editor, then link it.">
        <ul className="divide-y">{rows.map(r => <PlaceRequestRow key={r.id} r={r} showVenue canAnswer onDone={() => void reload()} />)}</ul>
      </Group>
    );
  }
}
