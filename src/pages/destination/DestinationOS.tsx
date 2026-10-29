// Destination OS (/destination): a government or destination account's view across the venues
// it oversees — what's live, what's verified, what needs attention (safety reports, old
// reports, details not checked), visits — and the OFFICIAL NOTICES it issues to those venues'
// visitor maps. Read-only towards the venues: changing them stays with their own teams.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, FileBarChart, BadgeCheck, Building2, CircleAlert, Download, ExternalLink, Eye, Flag, Info, LayoutGrid, Loader2, Megaphone, Plus, Siren, Users, XCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Logo } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { PageHeader, Panel } from '@/pages/dashboard/ui';
import PilotReport from './PilotReport';
import { STATUS_INFO, sinceText, venueStatus } from '@/lib/venue/trust';
import { period, downloadText, toCsv } from '@/lib/analytics/insights';
import {
  NOTICE_SEVERITY, byAttention, noticeState, noticeWhen, worst,
  type DestinationOverview, type NoticeSeverity, type OfficialNotice, type OverseenVenue, type Severity,
} from '@/lib/destination';

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
};
const SEVERITY_ICON: Record<Severity, typeof Info> = { critical: Siren, warning: CircleAlert, info: Info };
export const NOTICE_STYLE: Record<NoticeSeverity, string> = {
  urgent: 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100',
  advisory: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100',
  info: 'border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100',
};
const fmt = (n: number) => n.toLocaleString();

export default function DestinationOS() {
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();
  // The accounts that oversee: your own government / destination institutions (Yet New: all of them).
  const authorities = useMemo(() => ws.institutions.filter(i => (i.account_type === 'government' || i.account_type === 'destination') && i.role !== 'oversight'), [ws.institutions]);
  const authority = authorities.find(a => a.id === params.get('as')) ?? authorities[0] ?? null;
  const [tab, setTab] = useState<'overview' | 'notices' | 'report'>(() => { const t = params.get('tab'); return t === 'notices' || t === 'report' ? t : 'overview'; });

  if (ws.loading) return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!authority) return <Navigate to="/dashboard" replace />;
  const canIssue = authority.role === 'owner' || authority.role === 'editor' || authority.role === 'admin';
  const hasVenues = ws.institutions.some(i => i.role !== 'oversight' && i.account_type !== 'government' && i.account_type !== 'destination');

  return (
    <div className="min-h-screen bg-muted/30 print:bg-white">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6 print:hidden">
        <Logo className="text-lg" />
        <span className="hidden h-6 w-px bg-border sm:block" />
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Destination OS</span>
          {authorities.length > 1 ? (
            <select value={authority.id} onChange={e => setParams({ as: e.target.value })} aria-label="Authority" className="max-w-[260px] truncate bg-transparent text-sm font-semibold">
              {authorities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          ) : <span className="block truncate text-sm font-semibold">{authority.name}</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {(hasVenues || ws.isPlatformAdmin) && <Button variant="ghost" size="sm" asChild><Link to={ws.isPlatformAdmin ? '/admin' : '/dashboard'}><ArrowLeft className="mr-1.5 h-4 w-4" />{ws.isPlatformAdmin ? 'Control center' : 'Your venues'}</Link></Button>}
        </div>
      </header>
      <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
        <div className="mb-5 flex gap-1 rounded-full border bg-card p-1 sm:w-fit print:hidden" role="tablist">
          {([['overview', 'Overview', LayoutGrid], ['notices', 'Official notices', Megaphone], ['report', 'Pilot report', FileBarChart]] as const).map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm', tab === id ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
        {tab === 'overview' ? <Overview authorityId={authority.id} authorityName={authority.name} />
          : tab === 'notices' ? <Notices authorityId={authority.id} authorityName={authority.name} canIssue={canIssue} />
            : <PilotReport overseer={authority.id} title={authority.name} />}
      </main>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function useOverview(authorityId: string) {
  const [data, setData] = useState<DestinationOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data: j, error: e } = await supabase.rpc('destination_overview', { overseer: authorityId, ...period(30) });
    setError(e ? e.message : null);
    setData(e ? null : (j as unknown as DestinationOverview));
  }, [authorityId]);
  useEffect(() => { setData(null); void load(); }, [load]);
  return { data, error, reload: load };
}

const missingMigration = (e: string | null) => !!e && /destination_overview|official_notices|venue_notices|schema cache|does not exist|function/i.test(e);

export function Overview({ authorityId, authorityName }: { authorityId: string; authorityName: string }) {
  const { data, error } = useOverview(authorityId);
  const navigate = useNavigate();
  const venues = useMemo(() => byAttention(data?.venues ?? []), [data]);
  const attention = venues.filter(v => v.attention.some(a => a.severity !== 'info'));

  if (missingMigration(error)) return <Panel bodyClassName="p-5"><p className="text-sm text-muted-foreground">Run the 20261031090000_destination_os migration to turn on Destination OS.</p></Panel>;
  if (error) return <Panel bodyClassName="p-5"><p className="text-sm text-destructive">{error}</p></Panel>;
  if (!data) return <div className="grid place-items-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const live = venues.filter(v => v.is_published && !v.suspended_at);
  const trusted = live.filter(v => v.trust_level === 'verified' || v.trust_level === 'official');
  const open = venues.reduce((s, v) => s + v.open_reports, 0);
  const visits = venues.reduce((s, v) => s + v.visits, 0);
  const openDashboard = (v: OverseenVenue) => navigate(`/dashboard?venue=${v.id}`);
  const exportCsv = () => downloadText(`${authorityName} — venues overseen.csv`, toCsv(venues.map(v => ({
    venue: v.name, institution: v.institution_name, status: STATUS_INFO[venueStatus(v, v.institution_status)].label,
    checked: v.checked_at ? v.checked_at.slice(0, 10) : '', open_reports: v.open_reports, safety_reports: v.safety_reports,
    visits_30d: v.visits, directions_30d: v.routes, attention: v.attention.map(a => a.text).join('; '),
  })), [{ key: 'venue', label: 'Venue' }, { key: 'institution', label: 'Institution' }, { key: 'status', label: 'Status' }, { key: 'checked', label: 'Details checked' },
    { key: 'open_reports', label: 'Open reports' }, { key: 'safety_reports', label: 'Safety reports' }, { key: 'visits_30d', label: 'Visits (30 days)' },
    { key: 'directions_30d', label: 'Directions (30 days)' }, { key: 'attention', label: 'Needs attention' }]));

  if (!data.institutions.length) {
    return (
      <Panel bodyClassName="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <Eye className="h-7 w-7 text-muted-foreground" />
        <p className="font-semibold">{authorityName} doesn’t oversee any venues yet</p>
        <p className="max-w-md text-sm text-muted-foreground">The Yet New team links the venues in your area to your account. Ask them, and the venues will show here — their status, visitors and anything that needs your attention.</p>
      </Panel>
    );
  }

  const tiles: [string, string, string | undefined, typeof Info][] = [
    ['Venues', fmt(venues.length), `${data.institutions.length} institution${data.institutions.length === 1 ? '' : 's'}`, Building2],
    ['Live for visitors', fmt(live.length), undefined, Eye],
    ['Verified or official', fmt(trusted.length), live.length ? `${Math.round((trusted.length / live.length) * 100)}% of live venues` : undefined, BadgeCheck],
    ['Need attention', fmt(attention.length), undefined, AlertTriangle],
    ['Open reports', fmt(open), undefined, Flag],
    ['Visits, 30 days', fmt(visits), undefined, Users],
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Overview" description="Every venue you oversee: what’s live, how sure its details are, and what needs attention. You see everything; changes stay with each venue’s own team."
        actions={<Button size="sm" variant="outline" onClick={exportCsv}><Download className="mr-1.5 h-4 w-4" />CSV</Button>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([label, value, sub, Icon]) => (
          <div key={label} className="rounded-3xl border bg-card p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
            <p className="mt-0.5 min-h-[16px] text-[11px] text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>

      {attention.length > 0 && (
        <Panel title="Needs attention" icon={AlertTriangle} bodyClassName="grid gap-3 px-5 pb-5 md:grid-cols-2">
          {attention.slice(0, 8).map(v => {
            const w = worst(v.attention)!;
            const Icon = SEVERITY_ICON[w];
            return (
              <div key={v.id} className={cn('flex gap-3 rounded-2xl border p-3.5', SEVERITY_STYLE[w])}>
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{v.name}{v.institution_name !== v.name && <span className="font-normal opacity-75"> · {v.institution_name}</span>}</p>
                  <ul className="mt-0.5 space-y-0.5 text-sm">{v.attention.filter(a => a.severity !== 'info').map(a => <li key={a.text}>{a.text}</li>)}</ul>
                </div>
                <Button size="sm" variant="ghost" className="shrink-0 self-start" onClick={() => openDashboard(v)}>Look</Button>
              </div>
            );
          })}
        </Panel>
      )}

      <Panel title="All venues" icon={Building2} bodyClassName="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-5 py-2 font-medium">Venue</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Details checked</th>
              <th className="px-3 py-2 text-right font-medium">Open reports</th><th className="px-3 py-2 text-right font-medium">Visits</th><th className="px-3 py-2 text-right font-medium">Notices</th><th className="w-40" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {venues.map(v => {
              const s = STATUS_INFO[venueStatus(v, v.institution_status)];
              const w = worst(v.attention);
              return (
                <tr key={v.id} className="hover:bg-muted/30">
                  <td className="px-5 py-2.5">
                    <p className="flex items-center gap-1.5 font-medium">{w && w !== 'info' && <span className={cn('h-2 w-2 rounded-full', w === 'critical' ? 'bg-red-500' : 'bg-amber-500')} />}{v.name}</p>
                    <p className="text-[11px] text-muted-foreground">{[v.institution_name !== v.name && v.institution_name, v.responsible_party].filter(Boolean).join(' · ')}</p>
                  </td>
                  <td className="px-3 py-2.5"><span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', s.cls)}>{s.label}</span></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{v.checked_at ? sinceText(v.checked_at) : 'never'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{v.open_reports ? <span className={cn(v.safety_reports && 'font-semibold text-red-600 dark:text-red-400')}>{v.open_reports}</span> : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(v.visits)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{v.notices || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => openDashboard(v)}>Dashboard</Button>
                    {v.is_published && <Button size="icon" variant="ghost" asChild aria-label={`Open ${v.name}'s visitor map`}><a href={`/venue/${v.id}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

// ── Official notices ──────────────────────────────────────────────────────────

export function Notices({ authorityId, authorityName, canIssue }: { authorityId: string; authorityName: string; canIssue: boolean }) {
  const [rows, setRows] = useState<OfficialNotice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const { data: overview } = useOverview(authorityId);
  const venueName = useMemo(() => new Map((overview?.venues ?? []).map(v => [v.id, v.name])), [overview]);

  const load = useCallback(async () => {
    const { data, error: e } = await (supabase.from('official_notices' as never).select('*').eq('issuer_id', authorityId).order('created_at', { ascending: false }).limit(100) as unknown as Promise<{ data: OfficialNotice[] | null; error: { message: string } | null }>);
    setError(e ? e.message : null);
    setRows(data ?? []);
  }, [authorityId]);
  useEffect(() => { void load(); }, [load]);

  const withdraw = async (n: OfficialNotice) => {
    if (!confirm(`Withdraw “${n.title}”? Visitors stop seeing it straight away. It stays in your list and audit log.`)) return;
    const { error: e } = await (supabase.from('official_notices' as never).update({ withdrawn_at: new Date().toISOString() } as never).eq('id', n.id) as unknown as Promise<{ error: { message: string } | null }>);
    if (e) toast.error(e.message); else { toast.success('Notice withdrawn'); void load(); }
  };

  if (missingMigration(error)) return <Panel bodyClassName="p-5"><p className="text-sm text-muted-foreground">Run the 20261031090000_destination_os migration to issue official notices.</p></Panel>;
  return (
    <div className="space-y-4">
      <PageHeader title="Official notices" description={`Closures, safety advice, holiday hours — shown at the top of the visitor map of the venues you choose, signed “${authorityName}”. Venue teams see them but can’t change them.`}
        actions={canIssue && <Button onClick={() => setWriting(true)} disabled={!overview?.venues.length}><Plus className="mr-1.5 h-4 w-4" />New notice</Button>} />
      {error && <Panel bodyClassName="p-5"><p className="text-sm text-destructive">{error}</p></Panel>}
      {!rows ? <div className="grid place-items-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div> : !rows.length ? (
        <Panel bodyClassName="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <Megaphone className="h-7 w-7 text-muted-foreground" />
          <p className="font-semibold">No notices yet</p>
          <p className="max-w-md text-sm text-muted-foreground">{canIssue ? 'Issue one when visitors need to know something: a road closure, a safety warning, special opening hours.' : 'Your account’s owners and editors issue notices.'}</p>
        </Panel>
      ) : (
        <div className="space-y-3">
          {rows.map(n => {
            const state = noticeState(n);
            return (
              <div key={n.id} className={cn('rounded-3xl border bg-card p-4', state === 'withdrawn' || state === 'ended' ? 'opacity-60' : '')}>
                <div className="flex flex-wrap items-start gap-3">
                  <span className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', NOTICE_STYLE[n.severity])}>{NOTICE_SEVERITY[n.severity].label}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{n.title}</p>
                    {n.body && <p className="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">{n.body}</p>}
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      <span className={cn('mr-1.5 font-semibold', state === 'live' && 'text-emerald-600 dark:text-emerald-400')}>{{ live: 'Live', scheduled: 'Scheduled', ended: 'Ended', withdrawn: 'Withdrawn' }[state]}</span>
                      {noticeWhen(n)} · {n.all_venues ? 'every venue you oversee' : n.building_ids.map(id => venueName.get(id) ?? 'a venue').join(', ')}
                    </p>
                  </div>
                  {canIssue && (state === 'live' || state === 'scheduled') && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => withdraw(n)}><XCircle className="mr-1.5 h-4 w-4" />Withdraw</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <NoticeDialog open={writing} onOpenChange={setWriting} authorityId={authorityId} venues={overview?.venues ?? []} onIssued={load} />
    </div>
  );
}

const localNow = (offsetMin = 0) => {
  const d = new Date(Date.now() + offsetMin * 60_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

function NoticeDialog({ open, onOpenChange, authorityId, venues, onIssued }: {
  open: boolean; onOpenChange: (o: boolean) => void; authorityId: string; venues: OverseenVenue[]; onIssued: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<NoticeSeverity>('info');
  const [starts, setStarts] = useState(localNow());
  const [ends, setEnds] = useState('');
  const [all, setAll] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const problem = title.trim().length < 3 ? 'Give it a short title.'
    : ends && new Date(ends) <= new Date(starts) ? 'It has to end after it starts.'
      : !all && !picked.size ? 'Choose at least one venue.' : null;

  const reset = () => { setTitle(''); setBody(''); setSeverity('info'); setStarts(localNow()); setEnds(''); setAll(true); setPicked(new Set()); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    const { error } = await (supabase.from('official_notices' as never).insert({
      issuer_id: authorityId, title: title.trim(), body: body.trim() || null, severity,
      starts_at: new Date(starts).toISOString(), ends_at: ends ? new Date(ends).toISOString() : null,
      all_venues: all, building_ids: all ? [] : [...picked],
    } as never) as unknown as Promise<{ error: { message: string } | null }>);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(new Date(starts) > new Date() ? 'Notice scheduled' : 'Notice is live on the visitor maps');
    reset(); onOpenChange(false); onIssued();
  };
  const byInstitution = useMemo(() => {
    const m = new Map<string, OverseenVenue[]>();
    for (const v of venues) m.set(v.institution_name, [...(m.get(v.institution_name) ?? []), v]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [venues]);

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New official notice</DialogTitle>
            <DialogDescription>Visitors see it at the top of the map, with your name on it. Keep it short and clear.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Title</Label>
              <Input autoFocus value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="North gate closed for repairs" /></div>
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Message (optional)</Label>
              <Textarea value={body} onChange={e => setBody(e.target.value)} maxLength={2000} rows={3} placeholder="Please use the main entrance on Menelik Avenue until 15 November." /></div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">How important</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(NOTICE_SEVERITY) as NoticeSeverity[]).map(s => (
                  <button type="button" key={s} onClick={() => setSeverity(s)} aria-pressed={severity === s}
                    className={cn('rounded-2xl border p-2.5 text-left text-xs', severity === s ? NOTICE_STYLE[s] + ' ring-2 ring-offset-1 ring-current/30' : 'hover:bg-muted')}>
                    <span className="block font-semibold">{NOTICE_SEVERITY[s].label}</span><span className="opacity-80">{NOTICE_SEVERITY[s].hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Starts</Label><Input type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Ends (optional)</Label><Input type="datetime-local" value={ends} min={starts} onChange={e => setEnds(e.target.value)} /></div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Show it on</Label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" checked={all} onChange={() => setAll(true)} /> Every venue you oversee ({venues.length}) — and ones added later</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" checked={!all} onChange={() => setAll(false)} /> Only these venues</label>
              {!all && (
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-2xl border p-3">
                  {byInstitution.map(([inst, vs]) => (
                    <div key={inst}>
                      <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{inst}</p>
                      {vs.map(v => (
                        <label key={v.id} className="flex items-center gap-2 py-0.5 text-sm">
                          <input type="checkbox" checked={picked.has(v.id)} onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(v.id); else n.delete(v.id); return n; })} />
                          {v.name}{!v.is_published && <span className="text-xs text-muted-foreground">(not live)</span>}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            {problem && <p className="mr-auto self-center text-xs text-muted-foreground">{problem}</p>}
            <Button type="submit" disabled={busy || !!problem}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{new Date(starts) > new Date() ? 'Schedule notice' : 'Publish notice'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
