// Insights: how visitors use the venue's map — visits, directions, QR scans, what they search
// for (and don't find), when they come. Counted anonymously (src/lib/analytics/visits.ts);
// the numbers behind the pilot's KPI report.

import { useCallback, useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Download, Loader2, MapPin, Navigation, QrCode, Search, SearchX, Sparkles, Flag, Users, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import { DEVICE_LABELS, SOURCE_LABELS, change, downloadText, hoursText, percent, period, toCsv, type VenueInsights } from '@/lib/analytics/insights';
import { PageHeader, Panel } from './ui';

const PERIODS = [[7, '7 days'], [30, '30 days'], [90, '90 days']] as const;
const fmt = (n: number) => n.toLocaleString();
const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export default function Insights() {
  const { data } = useDashboard();
  const b = data.building;
  const [days, setDays] = useState<number>(30);
  const [ins, setIns] = useState<VenueInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: j, error: e } = await supabase.rpc('venue_insights', { b: b.id, ...period(days) });
    setError(e ? e.message : null);
    setIns(e ? null : (j as unknown as VenueInsights));
    setLoading(false);
  }, [b.id, days]);
  useEffect(() => { void load(); }, [load]);

  const exportCsv = () => {
    if (!ins) return;
    const t = ins.totals;
    const rows = [
      ['Visits', t.visits], ['Places opened', t.places], ['Directions started', t.routes], ['Step-by-step guidance started', t.guides],
      ['QR scans', t.qr], ['Searches', t.searches], ['Searches with no result', t.searches_missed], ['Questions to Ask', t.asks],
      ['Questions not understood', t.asks_missed], ['Places shared', t.shares], ['Problem reports', ins.reports.new], ['Reports fixed', ins.reports.fixed],
      ['Median time to fix (hours)', ins.reports.median_hours_to_fix ?? ''],
    ].map(([measure, value]) => ({ measure, value }));
    downloadText(`${b.name} insights, last ${days} days.csv`, toCsv(rows, [{ key: 'measure', label: 'Measure' }, { key: 'value', label: `Last ${days} days` }]));
  };

  const missing = error && /venue_insights|schema cache|does not exist|function/i.test(error);
  return (
    <>
      <PageHeader title="Insights" description="How visitors use your map: visits, directions, QR scans and what they look for. Counted anonymously — no names, accounts or locations."
        actions={<>
          <div className="flex rounded-full border p-0.5" role="group" aria-label="Period">
            {PERIODS.map(([n, label]) => (
              <button key={n} onClick={() => setDays(n)} aria-pressed={days === n}
                className={cn('rounded-full px-3 py-1.5 text-sm', days === n ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:bg-muted')}>{label}</button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!ins}><Download className="mr-1.5 h-4 w-4" />CSV</Button>
        </>} />

      {missing ? (
        <Panel bodyClassName="p-5"><p className="text-sm text-muted-foreground">Run the 20261029090000_visit_insights migration to start counting visits.</p></Panel>
      ) : error ? (
        <Panel bodyClassName="p-5"><p className="text-sm text-destructive">{error}</p></Panel>
      ) : !ins ? (
        <div className="grid place-items-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}>
          {!b.is_published && (
            <p className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Your venue isn’t published, so visitors can’t open it yet. Counting starts when it’s live. Your own team’s visits are never counted.
            </p>
          )}
          <Tiles ins={ins} />
          <Panel title="Visits per day" icon={Users} bodyClassName="px-2 pb-3">
            {ins.totals.visits ? <VisitsChart days={ins.days} /> : <Empty text="No visits in this period yet. Share your QR codes and venue link to bring visitors in." />}
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Most visited places" icon={MapPin} bodyClassName="px-5 pb-5">
              <Ranked rows={ins.top_places.map(p => ({ label: p.name ?? 'A place', value: p.views + p.routes, note: `${fmt(p.views)} opened · ${fmt(p.routes)} directions` }))} empty="Places visitors open and get directions to show here." />
            </Panel>
            <Panel title="Busy hours" icon={BarChart3} bodyClassName="px-5 pb-5">
              <Hours hours={ins.hours} />
            </Panel>
            <Panel title="What visitors search for" icon={Search} bodyClassName="px-5 pb-5">
              <Ranked rows={ins.top_searches.map(s => ({ label: s.query, value: s.count, note: s.found ? undefined : 'nothing found' }))} empty="Searches show here." />
            </Panel>
            <Panel title="Searched for, not found" icon={SearchX} bodyClassName="px-5 pb-5">
              {ins.missed_searches.length
                ? <><p className="mb-3 text-xs text-muted-foreground">Visitors looked for these and your map had nothing. Add the place, or give an existing place this name in its details.</p>
                  <Ranked rows={ins.missed_searches.map(s => ({ label: s.query, value: s.count }))} /></>
                : <Empty text="Every search found something. 🎉" />}
            </Panel>
            <Panel title="QR codes scanned" icon={QrCode} bodyClassName="px-5 pb-5">
              <Ranked rows={ins.qr_places.map(q => ({ label: q.name ?? 'A QR code', value: q.count }))} empty="Scans of your venue’s QR codes show here, by where they hang." />
            </Panel>
            <Panel title="How visitors arrive" icon={Navigation} bodyClassName="px-5 pb-5">
              <Ranked rows={Object.entries(ins.sources).map(([k, v]) => ({ label: SOURCE_LABELS[k] ?? k, value: v ?? 0 })).sort((x, y) => y.value - x.value)} empty="Shows once visitors come." />
              {Object.keys(ins.devices).length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  On {Object.entries(ins.devices).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0)).map(([k, v]) => `${DEVICE_LABELS[k] ?? k} ${percent(v ?? 0, ins.totals.visits) ?? 0}%`).join(' · ')}
                </p>
              )}
            </Panel>
          </div>
          <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            A visit is one visitor’s session on your map. Nothing identifies them: no account, location or contact. Browsers set to “do not track” aren’t counted, and nor is your team. What people type to Ask isn’t stored.
          </p>
        </div>
      )}
    </>
  );
}

function Tiles({ ins }: { ins: VenueInsights }) {
  const t = ins.totals;
  const tiles: { label: string; value: string; sub?: string; delta?: number | null; icon: typeof Users }[] = [
    { label: 'Visits', value: fmt(t.visits), delta: change(t.visits, ins.previous.visits), icon: Users },
    { label: 'Directions started', value: fmt(t.routes), sub: t.visits ? `in ${percent(t.visits_with_route, t.visits)}% of visits` : undefined, delta: change(t.routes, ins.previous.routes), icon: Navigation },
    { label: 'QR scans', value: fmt(t.qr), delta: change(t.qr, ins.previous.qr), icon: QrCode },
    { label: 'Searches', value: fmt(t.searches), sub: t.searches ? `${percent(t.searches - t.searches_missed, t.searches)}% found something` : undefined, delta: change(t.searches, ins.previous.searches), icon: Search },
    { label: 'Questions to Ask', value: fmt(t.asks), sub: t.asks ? `${percent(t.asks - t.asks_missed, t.asks)}% understood` : undefined, icon: Sparkles },
    { label: 'Problem reports', value: fmt(ins.reports.new), sub: ins.reports.new ? `${fmt(ins.reports.fixed)} fixed · median ${hoursText(ins.reports.median_hours_to_fix)}` : undefined, icon: Flag },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map(x => (
        <div key={x.label} className="rounded-3xl border bg-card p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><x.icon className="h-3.5 w-3.5" />{x.label}</p>
          <p className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums tracking-tight">{x.value}</span>
            {x.delta != null && (
              <span title="Against the period before" className={cn('text-xs font-semibold tabular-nums', x.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                {x.delta >= 0 ? '▲' : '▼'} {Math.abs(x.delta)}%
              </span>
            )}
          </p>
          <p className="mt-0.5 min-h-[16px] text-[11px] text-muted-foreground">{x.sub ?? (x.delta != null ? 'vs the period before' : '')}</p>
        </div>
      ))}
    </div>
  );
}

function VisitsChart({ days }: { days: VenueInsights['days'] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={days} margin={{ top: 8, right: 22, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="visitsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={40} />
          <Tooltip cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload as VenueInsights['days'][number] | undefined;
              return p ? (
                <div className="rounded-xl border bg-popover px-3 py-2 text-xs shadow-md">
                  <p className="font-semibold">{dayLabel(p.day)}</p>
                  <p className="text-muted-foreground">{fmt(p.visits)} visits · {fmt(p.routes)} directions</p>
                </div>
              ) : null;
            }} />
          <Area type="monotone" dataKey="visits" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#visitsFill)" activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A ranked list with a bar for each row's share of the largest. */
function Ranked({ rows, empty }: { rows: { label: string; value: number; note?: string }[]; empty?: string }) {
  if (!rows.length) return <Empty text={empty ?? 'Nothing yet.'} />;
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <ol className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate" title={r.label}>{r.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{fmt(r.value)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary/80" style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} />
          </div>
          {r.note && <p className="mt-0.5 text-[11px] text-muted-foreground">{r.note}</p>}
        </li>
      ))}
    </ol>
  );
}

function Hours({ hours }: { hours: VenueInsights['hours'] }) {
  const max = Math.max(...hours.map(h => h.visits), 1);
  const busiest = hours.reduce((a, h) => (h.visits > a.visits ? h : a), hours[0]);
  if (!busiest?.visits) return <Empty text="When visitors come, by hour of the day." />;
  const label = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return (
    <>
      <div className="flex h-28 items-end gap-[3px]" role="img" aria-label={`Visits by hour; busiest ${label(busiest.hour)}`}>
        {hours.map(h => (
          <div key={h.hour} title={`${label(h.hour)}–${label((h.hour + 1) % 24)}: ${fmt(h.visits)} visits`}
            className={cn('flex-1 rounded-t-[3px] transition-colors hover:bg-primary', h.hour === busiest.hour ? 'bg-primary' : 'bg-primary/40')}
            style={{ height: `${Math.max(2, (h.visits / max) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
      <p className="mt-2 text-xs text-muted-foreground">Busiest around <strong className="text-foreground">{label(busiest.hour)}</strong> (Addis Ababa time).</p>
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
}
