// The control center's pages: overview, approvals, institutions, venues,
// people and activity across the whole platform.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Building, ShieldCheck, Map as MapIcon, Users, MapPin, Footprints, Bookmark, Mail, Check, X, Eye, LayoutGrid, MoreHorizontal,
  PenTool, Globe, CloudOff, Star, History, Inbox, Ban, RotateCcw, ShieldPlus, ShieldMinus, Clock, ArrowRight, Sparkles, BadgeCheck, Landmark, Flag, Shapes,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { PageHeader, Panel } from '@/pages/dashboard/ui';
import { INSTITUTION_KINDS, isInstitutionKind } from '@/lib/accounts';
import { useAdminConsole } from './AdminLayout';
import {
  useAdminQuery, adminActions, openInstitutionDashboard,
  type AdminActivity, type AdminInstitution, type AdminUser, type AdminVenue, type AdminVerificationRequest, type InstitutionStatus, type VisitorStats,
} from './useAdmin';
import { STATUS_INFO, trustLevelOf } from '@/lib/venue/trust';
import { Empty, Loading, Mark, Stat, StatusChip, VenueChip, describe, matches, timeAgo, useNoteDialog } from './parts';
import { ACCOUNT_TYPES, OversightDialog, accountLabel, canOversee, useAccountTypes, type AccountType } from './Oversight';

const kindLabel = (k: string | null) => (k && isInstitutionKind(k) ? INSTITUTION_KINDS[k].label : k ?? '—');
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong');

/** Go to an institution's own dashboard (support view). */
function useOpenDashboard() {
  const navigate = useNavigate();
  return (institutionId: string | null, venueId?: string) => {
    if (!institutionId) return;
    openInstitutionDashboard(institutionId, venueId);
    navigate('/dashboard');
  };
}

/** The editor for a venue's first floor. */
async function openEditor(venueId: string, navigate: (to: string) => void) {
  const { data } = await supabase.from('floors').select('id').eq('building_id', venueId).order('level').limit(1);
  const f = data?.[0]?.id;
  if (f) navigate(`/admin/floors/${venueId}/${f}/editor`); else toast.info('This venue has no floor yet.');
}

// ── Overview ─────────────────────────────────────────────────────────────────

export function Overview() {
  const { overview } = useAdminConsole();
  const navigate = useNavigate();
  const visitors = useAdminQuery<VisitorStats>('admin_visitor_stats');
  const institutions = useAdminQuery<AdminInstitution[]>('admin_institutions');
  const venues = useAdminQuery<AdminVenue[]>('admin_venues');
  const activity = useAdminQuery<AdminActivity[]>('admin_activity', { lim: 12 });
  const o = overview;
  const waiting = (o?.institutions_pending ?? 0) + (o?.venues_pending ?? 0) + (o?.verifications_pending ?? 0);
  const pendingInst = (institutions.data ?? []).filter(i => i.status === 'pending').slice(0, 4);
  const pendingVenues = (venues.data ?? []).filter(v => v.review_status === 'pending').slice(0, 4);
  const hour = new Date().getHours();

  return (
    <>
      <PageHeader title={hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}
        description="Everything on Yet New at a glance — institutions, venues, people and what needs your decision."
        actions={waiting ? <Button onClick={() => navigate('/admin/approvals')}><ShieldCheck className="mr-1.5 h-4 w-4" /> Review {waiting} waiting</Button> : undefined} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={ShieldCheck} label="Waiting for your approval" value={o ? waiting : '—'} tone={waiting ? 'attention' : 'good'}
          sub={o ? `${o.institutions_pending} institution${o.institutions_pending === 1 ? '' : 's'} · ${o.venues_pending} publish request${o.venues_pending === 1 ? '' : 's'}${o.verifications_pending ? ` · ${o.verifications_pending} verification${o.verifications_pending === 1 ? '' : 's'}` : ''}` : undefined}
          onClick={() => navigate('/admin/approvals')} />
        <Stat icon={Building} label="Institutions" value={o?.institutions ?? '—'} sub={o ? `${o.new_institutions_30d} new in 30 days${o.institutions_suspended ? ` · ${o.institutions_suspended} suspended` : ''}` : undefined} onClick={() => navigate('/admin/institutions')} />
        <Stat icon={MapIcon} label="Venues live" value={o ? `${o.venues_published} / ${o.venues}` : '—'} sub={o ? `${o.publishes_30d} publishes in 30 days · ${o.places.toLocaleString('en')} places` : undefined} onClick={() => navigate('/admin/venues')} />
        <Stat icon={Users} label="Team members" value={o?.team_members ?? '—'} sub={o ? `${o.platform_admins} Yet New admin${o.platform_admins === 1 ? '' : 's'}` : undefined} onClick={() => navigate('/admin/users')} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Panel title="Needs your decision" icon={Inbox} action={waiting ? <Button variant="ghost" size="sm" onClick={() => navigate('/admin/approvals')}>All approvals <ArrowRight className="ml-1 h-4 w-4" /></Button> : undefined} bodyClassName="px-2 pb-2">
            {!pendingInst.length && !pendingVenues.length ? (
              <Empty icon={Check} title="All caught up" text="New institutions and first publishes from new teams show up here for your approval." />
            ) : (
              <ul className="divide-y">
                {pendingInst.map(i => (
                  <li key={i.id} className="flex items-center gap-3 px-3 py-3">
                    <Mark name={i.name} logo={i.logo_url} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{i.name}</span><span className="block truncate text-xs text-muted-foreground">New institution · {kindLabel(i.kind)} · {timeAgo(i.created_at)}</span></span>
                    <Button size="sm" variant="outline" onClick={() => navigate('/admin/approvals')}>Review</Button>
                  </li>
                ))}
                {pendingVenues.map(v => (
                  <li key={v.id} className="flex items-center gap-3 px-3 py-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-500/10 text-sky-700"><Globe className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{v.name}</span><span className="block truncate text-xs text-muted-foreground">Wants to publish · {v.institution_name} · {v.review_requested_at ? timeAgo(v.review_requested_at) : ''}</span></span>
                    <Button size="sm" variant="outline" onClick={() => navigate('/admin/approvals')}>Review</Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Recent activity across all venues" icon={History} action={<Button variant="ghost" size="sm" onClick={() => navigate('/admin/activity')}>See all <ArrowRight className="ml-1 h-4 w-4" /></Button>} bodyClassName="px-2 pb-2">
            <ActivityList rows={activity.data} loading={activity.loading} />
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Visitors" icon={Sparkles} bodyClassName="grid grid-cols-2 gap-2 px-4 pb-4">
            {[
              [Users, 'Visitor profiles', visitors.data?.visitors],
              [Mail, 'With an email', visitors.data?.with_email],
              [Bookmark, 'Places saved', visitors.data?.saves],
              [MapPin, 'Visits', visitors.data?.visits],
              [Footprints, 'Steps walked', visitors.data?.steps],
            ].map(([Icon, label, n]) => {
              const I = Icon as typeof Users;
              return (
                <div key={label as string} className="rounded-2xl bg-muted/60 p-3">
                  <I className="h-4 w-4 text-primary" />
                  <p className="mt-1.5 text-lg font-black tabular-nums leading-none">{n == null ? '—' : Number(n).toLocaleString('en')}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{label as string}</p>
                </div>
              );
            })}
          </Panel>
          <Panel title="Newest institutions" icon={Building} bodyClassName="px-2 pb-2">
            {institutions.loading ? <Loading /> : (
              <ul className="divide-y">
                {(institutions.data ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6).map(i => (
                  <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                    <Mark name={i.name} logo={i.logo_url} size={32} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{i.name}</span><span className="block text-[11px] text-muted-foreground">{i.published}/{i.venues} venues live · {timeAgo(i.created_at)}</span></span>
                    <StatusChip status={i.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function ActivityList({ rows, loading }: { rows: AdminActivity[] | null; loading: boolean }) {
  if (loading && !rows) return <Loading />;
  if (!rows?.length) return <Empty icon={History} title="Nothing yet" text="Edits and publishes from every institution appear here." />;
  return (
    <ul className="divide-y">
      {rows.map(a => (
        <li key={a.id} className="flex items-start gap-3 px-3 py-2.5">
          <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', a.action === 'published' ? 'bg-emerald-500' : a.action.includes('review') ? 'bg-sky-500' : 'bg-muted-foreground/40')} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm">{describe(a)}</span>
            <span className="block text-[11px] text-muted-foreground">{a.institution_name ?? '—'} · {timeAgo(a.created_at)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── Approvals ────────────────────────────────────────────────────────────────

export function Approvals() {
  const { reloadOverview } = useAdminConsole();
  const institutions = useAdminQuery<AdminInstitution[]>('admin_institutions');
  const venues = useAdminQuery<AdminVenue[]>('admin_venues');
  const openDashboard = useOpenDashboard();
  const notes = useNoteDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const pendingInst = (institutions.data ?? []).filter(i => i.status === 'pending');
  const pendingVenues = (venues.data ?? []).filter(v => v.review_status === 'pending');
  const verifications = useAdminQuery<AdminVerificationRequest[]>('admin_verification_queue');
  const refresh = () => { void institutions.reload(); void venues.reload(); void verifications.reload(); reloadOverview(); };

  const decideInst = async (i: AdminInstitution, status: InstitutionStatus, note?: string) => {
    setBusy(i.id);
    try {
      await adminActions.setInstitutionStatus(i.id, status, note);
      toast.success(status === 'approved' ? `${i.name} approved${i.pending_reviews ? ' — its waiting venues are live now' : ''}` : `${i.name} declined`);
      refresh();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const decideVenue = async (v: AdminVenue, approve: boolean, note?: string) => {
    setBusy(v.id);
    try {
      await adminActions.reviewVenue(v.id, approve, note);
      toast.success(approve ? `${v.name} is live` : `Publishing ${v.name} declined`);
      refresh();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const decideVerification = async (r: AdminVerificationRequest, approve: boolean, note?: string) => {
    setBusy(r.id);
    try {
      await adminActions.decideVerification(r.id, approve, note);
      toast.success(approve ? `${r.place_name ?? r.venue_name} is ${r.level} now` : 'Verification declined');
      refresh();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  return (
    <>
      <PageHeader title="Approvals" description="New institutions, and venues from teams that aren't approved yet, wait here. Approving an institution also publishes what it was waiting to publish." />
      {notes.dialog}
      <div className="space-y-6">
        <Panel title={<>New institutions <span className="ml-1 rounded-full bg-muted px-2 text-xs">{pendingInst.length}</span></>} icon={Building} bodyClassName="px-2 pb-2">
          {institutions.loading && !institutions.data ? <Loading /> : !pendingInst.length ? (
            <Empty icon={Check} title="No institutions waiting" text="When someone signs up their institution, it appears here. They can build their venue meanwhile; nothing goes live until you approve." />
          ) : (
            <ul className="divide-y">
              {pendingInst.map(i => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-3.5">
                  <Mark name={i.name} logo={i.logo_url} size={44} />
                  <span className="min-w-[200px] flex-1">
                    <span className="block font-semibold">{i.name}</span>
                    <span className="block text-xs text-muted-foreground">{kindLabel(i.kind)} · signed up {timeAgo(i.created_at)} by {i.owner_name || i.owner_username || 'unknown'}{i.owner_username ? ` (@${i.owner_username})` : ''}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{i.venues} venue{i.venues === 1 ? '' : 's'} · {i.members} on the team{i.pending_reviews ? ` · ${i.pending_reviews} waiting to publish` : ''}</span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => openDashboard(i.id)}><LayoutGrid className="mr-1.5 h-4 w-4" /> Look inside</Button>
                    <Button size="sm" variant="outline" disabled={busy === i.id}
                      onClick={() => notes.ask({ title: `Decline ${i.name}?`, text: 'Their venues stay offline. They can still sign in and see your note.', confirm: 'Decline', danger: true, run: n => decideInst(i, 'rejected', n) })}>
                      <X className="mr-1.5 h-4 w-4" /> Decline
                    </Button>
                    <Button size="sm" disabled={busy === i.id} onClick={() => void decideInst(i, 'approved')}><Check className="mr-1.5 h-4 w-4" /> Approve</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={<>Publish requests <span className="ml-1 rounded-full bg-muted px-2 text-xs">{pendingVenues.length}</span></>} icon={Globe} bodyClassName="px-2 pb-2">
          {venues.loading && !venues.data ? <Loading /> : !pendingVenues.length ? (
            <Empty icon={Check} title="No venues waiting" text="When a team that isn't approved yet presses Publish, the venue waits here. Look at the preview, then approve it to put it live." />
          ) : (
            <ul className="divide-y">
              {pendingVenues.map(v => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-3 py-3.5">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-sky-500/10 text-sky-700"><MapIcon className="h-5 w-5" /></span>
                  <span className="min-w-[200px] flex-1">
                    <span className="block font-semibold">{v.name}</span>
                    <span className="block text-xs text-muted-foreground">{v.institution_name} {v.institution_status && v.institution_status !== 'approved' && <>· <StatusChip status={v.institution_status} /></>}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{v.floors} {v.layout === 'site' ? 'zone' : 'floor'}{v.floors === 1 ? '' : 's'} · {v.places} places · {v.placed ? 'on the world map' : 'not on the world map yet'} · asked {v.review_requested_at ? timeAgo(v.review_requested_at) : ''}</span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" asChild><a href={`/venue/${v.id}?preview=1`} target="_blank" rel="noreferrer"><Eye className="mr-1.5 h-4 w-4" /> Preview</a></Button>
                    <Button size="sm" variant="outline" disabled={busy === v.id}
                      onClick={() => notes.ask({ title: `Decline publishing ${v.name}?`, text: 'Tell the team what to change — they see your note on their dashboard and can publish again.', confirm: 'Decline', danger: true, run: n => decideVenue(v, false, n) })}>
                      <X className="mr-1.5 h-4 w-4" /> Decline
                    </Button>
                    <Button size="sm" disabled={busy === v.id} onClick={() => void decideVenue(v, true)}><Check className="mr-1.5 h-4 w-4" /> Approve & publish</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={<>Verification requests <span className="ml-1 rounded-full bg-muted px-2 text-xs">{verifications.data?.length ?? 0}</span></>} icon={BadgeCheck} bodyClassName="px-2 pb-2">
          {verifications.needsMigration ? (
            <Empty icon={BadgeCheck} title="Not set up yet" text="Run the 20261028090000_place_trust migration to turn on verification requests." />
          ) : verifications.loading && !verifications.data ? <Loading /> : !verifications.data?.length ? (
            <Empty icon={Check} title="No requests waiting" text="Teams ask from Venue Settings → Trust & verification. Check their details, then verify. Verification is free and never sold." />
          ) : (
            <ul className="divide-y">
              {verifications.data.map(r => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-3.5">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700">{r.level === 'official' ? <Landmark className="h-5 w-5" /> : <BadgeCheck className="h-5 w-5" />}</span>
                  <span className="min-w-[220px] flex-1">
                    <span className="block font-semibold">{r.place_name ? `${r.place_name} · ${r.venue_name}` : r.venue_name} <span className="font-normal text-muted-foreground">wants to be</span> {STATUS_INFO[r.level].label}</span>
                    <span className="block text-xs text-muted-foreground">{r.institution_name ?? '—'} · asked {timeAgo(r.requested_at)}{r.requested_by_name ? ` by ${r.requested_by_name}` : ''} · now {STATUS_INFO[trustLevelOf(r.current_level)].label}{r.is_published ? '' : ' · not published'}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">Source: {r.source || 'not given'} · Responsible: {r.responsible_party || 'not given'}{r.open_reports ? <> · <span className="text-amber-700">{r.open_reports} open report{r.open_reports === 1 ? '' : 's'}</span></> : null}</span>
                    {r.note && <span className="mt-1 block whitespace-pre-line rounded-lg bg-muted/60 px-2 py-1 text-xs">“{r.note}”</span>}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" asChild><a href={`/venue/${r.building_id}${r.is_published ? '' : '?preview=1'}`} target="_blank" rel="noreferrer"><Eye className="mr-1.5 h-4 w-4" /> Look</a></Button>
                    <Button size="sm" variant="outline" disabled={busy === r.id}
                      onClick={() => notes.ask({ title: 'Decline this verification?', text: 'Say what is missing — the team sees your note in Venue Settings and can ask again.', confirm: 'Decline', danger: true, run: n => decideVerification(r, false, n) })}>
                      <X className="mr-1.5 h-4 w-4" /> Decline
                    </Button>
                    <Button size="sm" disabled={busy === r.id}
                      onClick={() => notes.ask({ title: `Mark ${r.place_name ?? r.venue_name} ${r.level}?`, text: 'Visitors see the badge with today’s date. Note how you checked it (kept in the activity log).', confirm: r.level === 'official' ? 'Mark official' : 'Verify', run: n => decideVerification(r, true, n) })}>
                      <Check className="mr-1.5 h-4 w-4" /> {r.level === 'official' ? 'Mark official' : 'Verify'}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

// ── Institutions ─────────────────────────────────────────────────────────────

export function Institutions() {
  const { query, reloadOverview } = useAdminConsole();
  const q = useAdminQuery<AdminInstitution[]>('admin_institutions');
  const openDashboard = useOpenDashboard();
  const notes = useNoteDialog();
  const [filter, setFilter] = useState<'all' | InstitutionStatus>('all');
  const [search, setSearch] = useState('');
  const rows = useMemo(() => (q.data ?? []).filter(i => (filter === 'all' || i.status === filter) && matches(search || query, i.name, i.owner_username, i.owner_name, i.kind)), [q.data, filter, search, query]);
  const count = (s: InstitutionStatus) => (q.data ?? []).filter(i => i.status === s).length;
  const accounts = useAccountTypes();
  const navigate = useNavigate();
  const [overseeing, setOverseeing] = useState<{ id: string; name: string } | null>(null);
  const typeOf = (id: string) => accounts.types?.get(id) ?? 'venue';
  const setType = async (i: AdminInstitution, t: AccountType) => {
    try { await accounts.setType(i.id, t); toast.success(`${i.name} is a ${accountLabel(t).toLowerCase()} account now`); }
    catch (e) { fail(e); }
  };
  const set = async (i: AdminInstitution, s: InstitutionStatus, note?: string) => {
    try { await adminActions.setInstitutionStatus(i.id, s, note); toast.success(`${i.name}: ${s === 'approved' ? 'approved' : s === 'suspended' ? 'suspended — its venues are offline' : s}`); void q.reload(); reloadOverview(); }
    catch (e) { fail(e); }
  };

  return (
    <>
      <PageHeader title="Institutions" description="Every institution on Yet New: its team, its venues, its standing and its kind of account — government and destination accounts can oversee others." />
      {notes.dialog}
      <OversightDialog overseer={overseeing} institutions={(q.data ?? []).map(i => ({ id: i.id, name: i.name }))} grants={accounts.grants}
        onClose={() => setOverseeing(null)} setOversight={accounts.setOversight} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['all', 'pending', 'approved', 'suspended', 'rejected'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)} className={cn('rounded-full border px-3 py-1.5 text-sm', filter === s ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:bg-muted')}>
            {s === 'all' ? `All ${q.data?.length ?? ''}` : `${{ pending: 'Waiting', approved: 'Approved', suspended: 'Suspended', rejected: 'Declined' }[s]} ${count(s)}`}
          </button>
        ))}
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search institutions…" className="ml-auto h-9 w-56 rounded-xl" />
      </div>
      <Panel bodyClassName="overflow-x-auto">
        {q.loading && !q.data ? <Loading /> : !rows.length ? <Empty icon={Building} title="No institutions here" text="Try another filter." /> : (
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-5 py-3 font-medium">Institution</th><th className="py-3 font-medium">Owner</th><th className="py-3 font-medium">Venues</th><th className="py-3 font-medium">Team</th><th className="py-3 font-medium">Last active</th><th className="py-3 font-medium">Status</th><th className="w-12" /></tr></thead>
            <tbody className="divide-y">
              {rows.map(i => (
                <tr key={i.id} className="hover:bg-muted/40">
                  <td className="px-5 py-3"><span className="flex items-center gap-3"><Mark name={i.name} logo={i.logo_url} size={34} /><span><span className="block font-semibold">{i.name}</span><span className="block text-xs text-muted-foreground">{typeOf(i.id) !== 'venue' && <span className="mr-1 rounded bg-violet-100 px-1.5 py-px font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-300">{accountLabel(typeOf(i.id))}{canOversee(typeOf(i.id)) && ` · oversees ${accounts.grants.filter(g => g.overseer_id === i.id).length}`}</span>}{kindLabel(i.kind)} · joined {timeAgo(i.created_at)}</span></span></span></td>
                  <td className="py-3"><span className="block">{i.owner_name || '—'}</span>{i.owner_username && <span className="block text-xs text-muted-foreground">@{i.owner_username}</span>}</td>
                  <td className="py-3 tabular-nums">{i.published}/{i.venues} live{i.pending_reviews ? <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 text-[11px] font-semibold text-sky-800">{i.pending_reviews} waiting</span> : null}</td>
                  <td className="py-3 tabular-nums">{i.members}</td>
                  <td className="py-3 text-muted-foreground">{i.last_activity ? timeAgo(i.last_activity) : '—'}</td>
                  <td className="py-3"><StatusChip status={i.status} />{i.review_note && <span className="mt-0.5 block max-w-[180px] truncate text-[11px] text-muted-foreground" title={i.review_note}>“{i.review_note}”</span>}</td>
                  <td className="py-3 pr-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted" aria-label={`Actions for ${i.name}`}><MoreHorizontal className="h-4 w-4" /></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="truncate">{i.name}</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => openDashboard(i.id)}><LayoutGrid className="mr-2 h-4 w-4" /> Open their dashboard</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {i.status !== 'approved' && <DropdownMenuItem onSelect={() => void set(i, 'approved')}><Check className="mr-2 h-4 w-4" /> {i.status === 'suspended' ? 'Reactivate' : 'Approve'}</DropdownMenuItem>}
                        {i.status === 'approved' && <DropdownMenuItem className="text-amber-700" onSelect={() => notes.ask({ title: `Suspend ${i.name}?`, text: 'Their venues go offline and they can’t publish until you reactivate them.', confirm: 'Suspend', danger: true, run: n => set(i, 'suspended', n) })}><Ban className="mr-2 h-4 w-4" /> Suspend</DropdownMenuItem>}
                        {i.status === 'pending' && <DropdownMenuItem className="text-destructive" onSelect={() => notes.ask({ title: `Decline ${i.name}?`, text: 'Their venues stay offline.', confirm: 'Decline', danger: true, run: n => set(i, 'rejected', n) })}><X className="mr-2 h-4 w-4" /> Decline</DropdownMenuItem>}
                        {(i.status === 'rejected' || i.status === 'suspended') && <DropdownMenuItem onSelect={() => void set(i, 'pending')}><RotateCcw className="mr-2 h-4 w-4" /> Back to waiting</DropdownMenuItem>}
                        {!accounts.missing && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger><Shapes className="mr-2 h-4 w-4" /> Kind of account: {accountLabel(typeOf(i.id))}</DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="w-72">
                                {ACCOUNT_TYPES.map(([t, label, hint]) => (
                                  <DropdownMenuItem key={t} onSelect={() => void setType(i, t)}>
                                    <span className="flex-1"><span className="block font-medium">{label}</span><span className="block text-[11px] text-muted-foreground">{hint}</span></span>
                                    {typeOf(i.id) === t && <Check className="ml-2 h-4 w-4 text-primary" />}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            {canOversee(typeOf(i.id)) && <DropdownMenuItem onSelect={() => setOverseeing({ id: i.id, name: i.name })}><Eye className="mr-2 h-4 w-4" /> What it oversees…</DropdownMenuItem>}
                            {canOversee(typeOf(i.id)) && <DropdownMenuItem onSelect={() => navigate(`/destination?as=${i.id}`)}><Landmark className="mr-2 h-4 w-4" /> Open its Destination OS</DropdownMenuItem>}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

// ── Venues ───────────────────────────────────────────────────────────────────

export function Venues() {
  const { query, reloadOverview } = useAdminConsole();
  const q = useAdminQuery<AdminVenue[]>('admin_venues');
  const navigate = useNavigate();
  const openDashboard = useOpenDashboard();
  const [filter, setFilter] = useState<'all' | 'live' | 'draft' | 'review'>('all');
  const [search, setSearch] = useState('');
  const rows = useMemo(() => (q.data ?? []).filter(v =>
    (filter === 'all' || (filter === 'live' ? v.is_published : filter === 'review' ? v.review_status === 'pending' : !v.is_published && v.review_status !== 'pending'))
    && matches(search || query, v.name, v.institution_name)), [q.data, filter, search, query]);

  const live = async (v: AdminVenue, on: boolean) => {
    try { await adminActions.setVenueLive(v.id, on); toast.success(on ? `${v.name} published` : `${v.name} taken offline`); void q.reload(); reloadOverview(); }
    catch (e) { fail(e); }
  };
  const notes = useNoteDialog();
  const trust = async (v: AdminVenue, level: 'listed' | 'verified' | 'official', note?: string) => {
    try { await adminActions.setTrust(v.id, level, note); toast.success(level === 'listed' ? `${v.name}: verification removed` : `${v.name} is ${level} now`); void q.reload(); reloadOverview(); }
    catch (e) { fail(e); }
  };
  const suspend = async (v: AdminVenue, on: boolean, note?: string) => {
    try { await adminActions.suspendVenue(v.id, on, note); toast.success(on ? `${v.name} suspended — offline` : `${v.name}: suspension lifted — the team can publish again`); void q.reload(); reloadOverview(); }
    catch (e) { fail(e); }
  };
  const feature = async (v: AdminVenue, rank: number) => {
    try { await adminActions.setHomeRank(v.id, rank); toast.success(rank > 0 ? `${v.name} featured on the home page` : `${v.name} no longer featured`); void q.reload(); }
    catch (e) { fail(e); }
  };

  return (
    <>
      <PageHeader title="Venues" description="Every venue on the platform. Look at any of them, put one online or offline, verify it, suspend it, or feature it on the home page." />
      {notes.dialog}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([['all', 'All'], ['live', 'Live'], ['review', 'In review'], ['draft', 'Drafts']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} className={cn('rounded-full border px-3 py-1.5 text-sm', filter === id ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:bg-muted')}>{label}</button>
        ))}
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search venues…" className="ml-auto h-9 w-56 rounded-xl" />
      </div>
      <Panel bodyClassName="overflow-x-auto">
        {q.loading && !q.data ? <Loading /> : !rows.length ? <Empty icon={MapIcon} title="No venues here" text="Try another filter." /> : (
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-5 py-3 font-medium">Venue</th><th className="py-3 font-medium">Institution</th><th className="py-3 font-medium">Map</th><th className="py-3 font-medium">Last published</th><th className="py-3 font-medium">Status</th><th className="w-12" /></tr></thead>
            <tbody className="divide-y">
              {rows.map(v => (
                <tr key={v.id} className="hover:bg-muted/40">
                  <td className="px-5 py-3"><span className="flex items-center gap-2 font-semibold">{v.name}{v.home_rank > 0 && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Featured" />}</span><span className="block text-xs text-muted-foreground">{v.layout === 'site' ? 'Outdoor site' : 'Building'}</span></td>
                  <td className="py-3">{v.institution_name ?? '—'}{v.institution_status && v.institution_status !== 'approved' && <span className="ml-1.5"><StatusChip status={v.institution_status} /></span>}</td>
                  <td className="py-3 text-muted-foreground">{v.floors} {v.layout === 'site' ? 'zone' : 'floor'}{v.floors === 1 ? '' : 's'} · {v.places} places{v.placed ? ' · on world map' : ''}</td>
                  <td className="py-3 text-muted-foreground">{v.published_at ? timeAgo(v.published_at) : 'Never'}</td>
                  <td className="py-3">
                    <span className="flex flex-wrap items-center gap-1">
                      {v.suspended_at ? <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', STATUS_INFO.suspended.cls)} title={v.suspend_note ?? undefined}>Suspended</span>
                        : v.archived_at ? <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', STATUS_INFO.archived.cls)}>Archived</span>
                        : <VenueChip live={v.is_published} review={v.review_status} />}
                      {trustLevelOf(v.trust_level) !== 'listed' && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_INFO[trustLevelOf(v.trust_level)].cls)}>{STATUS_INFO[trustLevelOf(v.trust_level)].label}</span>}
                      {v.open_reports ? <span className="flex items-center gap-0.5 text-[11px] text-amber-700" title="Open visitor reports"><Flag className="h-3 w-3" />{v.open_reports}</span> : null}
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted" aria-label={`Actions for ${v.name}`}><MoreHorizontal className="h-4 w-4" /></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="truncate">{v.name}</DropdownMenuLabel>
                        <DropdownMenuItem asChild><a href={`/venue/${v.id}${v.is_published ? '' : '?preview=1'}`} target="_blank" rel="noreferrer"><Eye className="mr-2 h-4 w-4" /> {v.is_published ? 'View as a visitor' : 'Preview'}</a></DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void openEditor(v.id, navigate)}><PenTool className="mr-2 h-4 w-4" /> Open the map editor</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => openDashboard(v.institution_id, v.id)}><LayoutGrid className="mr-2 h-4 w-4" /> Open their dashboard</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {v.is_published
                          ? <DropdownMenuItem className="text-amber-700" onSelect={() => void live(v, false)}><CloudOff className="mr-2 h-4 w-4" /> Take offline</DropdownMenuItem>
                          : <DropdownMenuItem onSelect={() => void live(v, true)}><Globe className="mr-2 h-4 w-4" /> Publish now</DropdownMenuItem>}
                        {v.home_rank > 0
                          ? <DropdownMenuItem onSelect={() => void feature(v, 0)}><Star className="mr-2 h-4 w-4" /> Stop featuring</DropdownMenuItem>
                          : <DropdownMenuItem onSelect={() => void feature(v, 10)}><Star className="mr-2 h-4 w-4" /> Feature on the home page</DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        {trustLevelOf(v.trust_level) !== 'verified' && <DropdownMenuItem onSelect={() => notes.ask({ title: `Verify ${v.name}?`, text: 'Visitors see “Verified” with today’s date. Note how you checked it.', confirm: 'Verify', run: n => trust(v, 'verified', n) })}><BadgeCheck className="mr-2 h-4 w-4" /> Mark verified</DropdownMenuItem>}
                        {trustLevelOf(v.trust_level) !== 'official' && <DropdownMenuItem onSelect={() => notes.ask({ title: `Mark ${v.name} official?`, text: 'Only when the responsible authority confirmed it. Note who and how.', confirm: 'Mark official', run: n => trust(v, 'official', n) })}><Landmark className="mr-2 h-4 w-4" /> Mark official</DropdownMenuItem>}
                        {trustLevelOf(v.trust_level) !== 'listed' && <DropdownMenuItem onSelect={() => notes.ask({ title: `Remove verification from ${v.name}?`, text: 'It goes back to Listed. Say why — the team sees your note.', confirm: 'Remove', danger: true, run: n => trust(v, 'listed', n) })}><ShieldMinus className="mr-2 h-4 w-4" /> Remove verification</DropdownMenuItem>}
                        {v.suspended_at
                          ? <DropdownMenuItem onSelect={() => void suspend(v, false)}><RotateCcw className="mr-2 h-4 w-4" /> Lift suspension</DropdownMenuItem>
                          : <DropdownMenuItem className="text-destructive" onSelect={() => notes.ask({ title: `Suspend ${v.name}?`, text: 'It goes offline now, and the team can’t publish it until you lift the suspension. Tell them why.', confirm: 'Suspend', danger: true, run: n => suspend(v, true, n) })}><Ban className="mr-2 h-4 w-4" /> Suspend venue</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

export function People() {
  const { query, reloadOverview } = useAdminConsole();
  const q = useAdminQuery<AdminUser[]>('admin_users');
  const { user } = useAdminAuth();
  const openDashboard = useOpenDashboard();
  const [search, setSearch] = useState('');
  const [onlyAdmins, setOnlyAdmins] = useState(false);
  const rows = useMemo(() => (q.data ?? []).filter(u => (!onlyAdmins || u.is_platform_admin)
    && matches(search || query, u.display_name, u.username, u.email, ...u.institutions.map(i => i.name))), [q.data, search, query, onlyAdmins]);
  const setAdmin = async (u: AdminUser, make: boolean) => {
    try { await adminActions.setPlatformAdmin(u.user_id, make); toast.success(make ? `${u.display_name || u.username} is now a Yet New admin` : 'Admin access removed'); void q.reload(); reloadOverview(); }
    catch (e) { fail(e); }
  };

  return (
    <>
      <PageHeader title="People" description="Everyone who signs in: institution teams and the Yet New team. Team members are managed by their institution's owner." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => setOnlyAdmins(false)} className={cn('rounded-full border px-3 py-1.5 text-sm', !onlyAdmins ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:bg-muted')}>Everyone {q.data?.length ?? ''}</button>
        <button onClick={() => setOnlyAdmins(true)} className={cn('rounded-full border px-3 py-1.5 text-sm', onlyAdmins ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:bg-muted')}>Yet New team {(q.data ?? []).filter(u => u.is_platform_admin).length}</button>
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people…" className="ml-auto h-9 w-56 rounded-xl" />
      </div>
      <Panel bodyClassName="overflow-x-auto">
        {q.loading && !q.data ? <Loading /> : !rows.length ? <Empty icon={Users} title="Nobody here" text="Try another search." /> : (
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-5 py-3 font-medium">Person</th><th className="py-3 font-medium">Institutions</th><th className="py-3 font-medium">Joined</th><th className="py-3 font-medium">Last signed in</th><th className="w-12" /></tr></thead>
            <tbody className="divide-y">
              {rows.map(u => (
                <tr key={u.user_id} className="hover:bg-muted/40">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-3">
                      <Mark name={u.display_name || u.username || u.email || '?'} size={34} />
                      <span>
                        <span className="flex items-center gap-1.5 font-semibold">{u.display_name || u.username || u.email}{u.is_platform_admin && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-800 dark:bg-violet-950 dark:text-violet-300">Yet New admin</span>}</span>
                        <span className="block text-xs text-muted-foreground">{u.username ? `@${u.username}` : u.email}</span>
                      </span>
                    </span>
                  </td>
                  <td className="py-3">
                    <span className="flex flex-wrap gap-1">
                      {u.institutions.length ? u.institutions.map(i => (
                        <button key={i.id} onClick={() => openDashboard(i.id)} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted" title="Open their dashboard">{i.name} <span className="text-muted-foreground">· {i.role}</span></button>
                      )) : <span className="text-xs text-muted-foreground">—</span>}
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground">{timeAgo(u.created_at)}</td>
                  <td className="py-3 text-muted-foreground">{u.last_sign_in_at ? timeAgo(u.last_sign_in_at) : 'Never'}</td>
                  <td className="py-3 pr-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted" aria-label="Actions"><MoreHorizontal className="h-4 w-4" /></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {u.is_platform_admin
                          ? <DropdownMenuItem disabled={u.user_id === user?.id} onSelect={() => void setAdmin(u, false)}><ShieldMinus className="mr-2 h-4 w-4" /> Remove Yet New admin</DropdownMenuItem>
                          : <DropdownMenuItem onSelect={() => void setAdmin(u, true)}><ShieldPlus className="mr-2 h-4 w-4" /> Make Yet New admin</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────────

export function Activity() {
  const q = useAdminQuery<AdminActivity[]>('admin_activity', { lim: 200 });
  const { query } = useAdminConsole();
  const rows = (q.data ?? []).filter(a => matches(query, a.venue_name, a.institution_name, a.actor_name, a.object_name, a.action));
  return (
    <>
      <PageHeader title="Activity" description="The latest 200 changes and publishes from every institution." actions={<Button variant="outline" onClick={() => void q.reload()}><Clock className="mr-1.5 h-4 w-4" /> Refresh</Button>} />
      <Panel bodyClassName="px-2 pb-2"><ActivityList rows={q.data ? rows : null} loading={q.loading} /></Panel>
    </>
  );
}
