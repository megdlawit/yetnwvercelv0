// The pilot KPI report, for an authority (across the venues it oversees) or Yet New (every
// venue): a chosen period against the one before, every KPI with its definition, weekly visits
// and each venue's numbers. Prints cleanly (Print → Save as PDF) and exports as CSV.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Loader2, Printer } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { downloadText, toCsv } from '@/lib/analytics/insights';
import { STATUS_INFO, trustLevelOf } from '@/lib/venue/trust';
import { KPIS, formatKpi, kpiChange, previousPeriod, type Kpi, type KpiGroup, type PilotReport as Report } from '@/lib/pilotReport';

const day = (d: Date) => d.toISOString().slice(0, 10);
const nice = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const GROUPS: KpiGroup[] = ['Coverage and trust', 'Visitor use', 'Responsiveness', 'Official notices and changes'];

export default function PilotReport({ overseer, title }: { overseer: string | null; title: string }) {
  const today = new Date();
  const [from, setFrom] = useState(() => day(new Date(today.getTime() - 30 * 864e5)));
  const [to, setTo] = useState(() => day(today));
  const [now, setNow] = useState<Report | null>(null);
  const [before, setBefore] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The period runs from the start of `from` to the end of `to`.
  const span = useMemo(() => ({ since: new Date(`${from}T00:00:00`).toISOString(), until: new Date(new Date(`${to}T00:00:00`).getTime() + 864e5).toISOString() }), [from, to]);
  const load = useCallback(async () => {
    if (new Date(span.until) <= new Date(span.since)) { setError('The end date has to be after the start date.'); return; }
    setLoading(true);
    const prev = previousPeriod(span.since, span.until);
    const [a, b] = await Promise.all([
      supabase.rpc('pilot_report', { overseer, ...span }),
      supabase.rpc('pilot_report', { overseer, ...prev }),
    ]);
    setError(a.error?.message ?? null);
    setNow(a.error ? null : a.data as unknown as Report);
    setBefore(b.error ? null : b.data as unknown as Report);
    setLoading(false);
  }, [overseer, span]);
  useEffect(() => { void load(); }, [load]);

  const presets: [string, number][] = [['Last 30 days', 30], ['Last 90 days', 90], ['Last 12 months', 365]];
  const exportCsv = () => {
    if (!now) return;
    const rows = KPIS.map(k => ({ group: k.group, kpi: k.label, value: formatKpi(k, k.value(now)), before: before ? formatKpi(k, k.value(before)) : '', definition: k.definition }));
    downloadText(`${title} — pilot report ${from} to ${to}.csv`, toCsv(rows, [
      { key: 'group', label: 'Group' }, { key: 'kpi', label: 'KPI' }, { key: 'value', label: `${from} to ${to}` }, { key: 'before', label: 'Period before' }, { key: 'definition', label: 'Definition' },
    ]));
  };

  if (error && /pilot_report|schema cache|does not exist|function/i.test(error)) {
    return <p className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground">Run the 20261101090000_pilot_report migration to generate pilot reports.</p>;
  }
  return (
    <div className="space-y-5 print:space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="flex flex-wrap gap-1.5">
          {presets.map(([label, days]) => (
            <button key={label} onClick={() => { setFrom(day(new Date(Date.now() - days * 864e5))); setTo(day(new Date())); }}
              className="rounded-full border px-3 py-1.5 text-sm hover:bg-muted">{label}</button>
          ))}
        </div>
        <label className="text-xs text-muted-foreground">From<Input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="mt-1 h-9 w-40" /></label>
        <label className="text-xs text-muted-foreground">To<Input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="mt-1 h-9 w-40" /></label>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!now}><Download className="mr-1.5 h-4 w-4" />CSV</Button>
          <Button size="sm" onClick={() => window.print()} disabled={!now}><Printer className="mr-1.5 h-4 w-4" />Print or save as PDF</Button>
        </div>
      </div>

      {error && <p className="rounded-3xl border bg-card p-5 text-sm text-destructive">{error}</p>}
      {!now ? (!error && <div className="grid place-items-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>) : (
        <article className={cn('space-y-5 rounded-3xl border bg-card p-6 transition-opacity sm:p-8 print:rounded-none print:border-0 print:p-0', loading && 'opacity-60')}>
          <header className="border-b pb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Yet New · pilot KPI report</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {nice(span.since)} – {nice(new Date(new Date(span.until).getTime() - 1).toISOString())} · compared with the {Math.round((new Date(span.until).getTime() - new Date(span.since).getTime()) / 864e5)} days before ·
              {' '}{now.coverage.venues} venue{now.coverage.venues === 1 ? '' : 's'} of {now.coverage.institutions} institution{now.coverage.institutions === 1 ? '' : 's'} · generated {nice(new Date().toISOString())}
            </p>
          </header>

          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 print:grid-cols-3">
            {KPIS.filter(k => k.headline).map(k => <Headline key={k.id} k={k} now={now} before={before} />)}
          </section>

          {now.weeks.length > 1 && (
            <section className="break-inside-avoid">
              <h3 className="mb-2 text-sm font-semibold">Visits per week</h3>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={now.weeks} margin={{ top: 8, right: 22, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="week" tickFormatter={w => new Date(w).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => v.toLocaleString()} />
                    <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Visits']} labelFormatter={w => `Week of ${new Date(w).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
                      contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                    <Line type="monotone" dataKey="visits" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {GROUPS.map(g => {
            const ks = KPIS.filter(k => k.group === g && !(g === 'Official notices and changes' && k.id === 'notices' && now.notices == null));
            return (
              <section key={g} className="break-inside-avoid">
                <h3 className="mb-2 text-sm font-semibold">{g}</h3>
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">KPI</th><th className="w-28 py-1.5 text-right font-medium">This period</th><th className="w-28 py-1.5 text-right font-medium">Before</th><th className="w-20 py-1.5 text-right font-medium">Change</th></tr></thead>
                  <tbody className="divide-y">
                    {ks.map(k => (
                      <tr key={k.id} className="align-top">
                        <td className="py-2 pr-3"><p className="font-medium">{k.label}</p><p className="text-[11px] leading-snug text-muted-foreground">{k.definition}</p></td>
                        <td className="py-2 text-right font-semibold tabular-nums">{formatKpi(k, k.value(now))}</td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">{before ? formatKpi(k, k.value(before)) : '—'}</td>
                        <td className="py-2 text-right"><Change k={k} now={now} before={before} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}

          {now.venues.length > 0 && (
            <section className="break-inside-avoid">
              <h3 className="mb-2 text-sm font-semibold">By venue</h3>
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Venue</th><th className="py-1.5 font-medium">Trust</th><th className="py-1.5 text-right font-medium">Visits</th><th className="py-1.5 text-right font-medium">Directions</th><th className="py-1.5 text-right font-medium">QR scans</th><th className="py-1.5 text-right font-medium">Reports fixed</th></tr></thead>
                <tbody className="divide-y">
                  {now.venues.map(v => (
                    <tr key={v.id}>
                      <td className="py-1.5">{v.name}{!v.is_published && <span className="ml-1.5 text-xs text-muted-foreground">(not live)</span>}</td>
                      <td className="py-1.5 text-muted-foreground">{STATUS_INFO[trustLevelOf(v.trust_level)].label}</td>
                      <td className="py-1.5 text-right tabular-nums">{v.visits.toLocaleString()}</td>
                      <td className="py-1.5 text-right tabular-nums">{v.routes.toLocaleString()}</td>
                      <td className="py-1.5 text-right tabular-nums">{v.qr.toLocaleString()}</td>
                      <td className="py-1.5 text-right tabular-nums">{v.reports ? `${v.reports_fixed} of ${v.reports}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <footer className="border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
            Counted anonymously: no names, accounts, contact details or locations of visitors are collected; browsers that ask not to be tracked, previews and the venues’ own teams are not counted.
            Days are in Addis Ababa time. Trust and coverage figures describe the end of the period; “Reports still open” describes the moment the report was generated.
          </footer>
        </article>
      )}
    </div>
  );
}

function Headline({ k, now, before }: { k: Kpi; now: Report; before: Report | null }) {
  return (
    <div className="rounded-2xl border p-4 print:p-3">
      <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
      <p className="mt-1 flex items-baseline gap-2"><span className="text-2xl font-bold tabular-nums">{formatKpi(k, k.value(now))}</span><Change k={k} now={now} before={before} /></p>
    </div>
  );
}

function Change({ k, now, before }: { k: Kpi; now: Report; before: Report | null }) {
  const c = kpiChange(k, now, before);
  if (c == null || c === 0) return <span className="text-xs text-muted-foreground">{c === 0 ? 'same' : ''}</span>;
  const good = (c > 0) === (k.higherIsBetter !== false);
  return (
    <span className={cn('text-xs font-semibold tabular-nums', good ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
      {c > 0 ? '▲' : '▼'} {Math.abs(c)}{k.unit === '%' ? ' pts' : '%'}
    </span>
  );
}
