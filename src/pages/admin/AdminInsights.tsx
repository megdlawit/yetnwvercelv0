// Insights across every venue: the pilot's KPI baseline for Yet New and the government
// partner — visits, directions, QR scans, searches that found nothing, questions the guide
// didn't understand, and how fast teams fix what visitors report. Exports as CSV.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, Flag, Navigation, QrCode, Search, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { downloadText, hoursText, percent, period, toCsv, type AdminInsights as Data, type AdminInsightsVenue } from '@/lib/analytics/insights';
import { STATUS_INFO, trustLevelOf } from '@/lib/venue/trust';
import { Empty, Loading, matches } from './parts';
import { Group, Metric, Page, PlainButton, SearchField, Segmented, Toolbar } from './ui';

const PERIODS = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '12 months']] as const;
const fmt = (n: number) => n.toLocaleString();

const COLUMNS: { key: keyof AdminInsightsVenue | 'found' | 'understood' | 'fixed_pct'; label: string }[] = [
  { key: 'name', label: 'Venue' }, { key: 'trust_level', label: 'Trust' }, { key: 'visits', label: 'Visits' }, { key: 'places', label: 'Places opened' },
  { key: 'routes', label: 'Directions' }, { key: 'qr', label: 'QR scans' }, { key: 'searches', label: 'Searches' }, { key: 'found', label: 'Searches found (%)' },
  { key: 'asks', label: 'Ask questions' }, { key: 'understood', label: 'Understood (%)' }, { key: 'reports', label: 'Reports' },
  { key: 'fixed_pct', label: 'Reports fixed (%)' }, { key: 'median_hours_to_fix', label: 'Median hours to fix' },
];

export default function AdminInsights() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data: j, error: e } = await supabase.rpc('admin_insights', period(days));
    setError(e ? e.message : null);
    setData(e ? null : (j as unknown as Data));
    setLoading(false);
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => (data?.venues ?? []).filter(v => matches(search, v.name)).map(v => ({
    ...v, found: percent(v.searches - v.searches_missed, v.searches), understood: percent(v.asks - v.asks_missed, v.asks), fixed_pct: percent(v.reports_fixed, v.reports),
  })), [data, search]);
  const reports = useMemo(() => (data?.venues ?? []).reduce((a, v) => ({ n: a.n + v.reports, fixed: a.fixed + v.reports_fixed }), { n: 0, fixed: 0 }), [data]);
  const missed = useMemo(() => (data?.venues ?? []).reduce((a, v) => a + v.searches_missed, 0), [data]);

  const exportCsv = () => downloadText(`Yet New KPIs, last ${days} days.csv`, toCsv(rows, COLUMNS.map(c => ({ key: c.key, label: c.label }))));
  const missing = error && /admin_insights|schema cache|does not exist|function/i.test(error);

  return (
    <Page title="Insights" subtitle="How visitors use every venue. Anonymous counts; venue teams’ own visits aren’t included."
      actions={<>
        <PlainButton onClick={exportCsv} disabled={!rows.length}><Download className="mr-1.5 h-4 w-4" />Export CSV</PlainButton>
      </>}>
      <Toolbar>
        <Segmented label="Period" value={days} onChange={setDays} options={PERIODS} />
        <SearchField value={search} onChange={setSearch} placeholder="Find a venue" className="w-full sm:w-64" />
      </Toolbar>
      {missing ? (
        <Group footer="Run the 20261029090000_visit_insights migration to start counting visits."><Empty icon={BarChart3} title="Not set up yet" /></Group>
      ) : error ? (
        <Group><p className="px-5 py-4 text-sm text-destructive">{error}</p></Group>
      ) : !data ? <Loading /> : (
        <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Metric icon={Users} label="Visits" value={fmt(data.totals.visits)} caption={`${data.totals.venues_with_visits} venues visited`} />
            <Metric icon={Navigation} label="Directions started" value={fmt(data.totals.routes)} />
            <Metric icon={QrCode} label="QR scans" value={fmt(data.totals.qr)} />
            <Metric icon={Search} label="Searches" value={fmt(data.totals.searches)} caption={data.totals.searches ? `${percent(data.totals.searches - missed, data.totals.searches)}% found something` : undefined} />
            <Metric icon={Flag} label="Problem reports" value={fmt(reports.n)} caption={reports.n ? `${percent(reports.fixed, reports.n)}% fixed` : undefined} />
          </div>
          <Group flush title="By venue" icon={BarChart3}
            footer="A visit is one anonymous session on a venue’s map. Found = searches with at least one result; Understood = questions the guide could answer.">
            {!rows.length ? <Empty icon={BarChart3} title="No venues yet" text="Published venues show here with their numbers." /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Venue</th>
                      {['Visits', 'Directions', 'QR', 'Searches', 'Found', 'Ask', 'Understood', 'Reports', 'Fixed', 'Time to fix'].map(h => <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map(v => {
                      const info = STATUS_INFO[trustLevelOf(v.trust_level)];  // listed / verified / official
                      return (
                        <tr key={v.id} className="hover:bg-muted/30">
                          <td className="px-4 py-2.5">
                            <p className="font-medium">{v.name}</p>
                            <p className="text-[11px] text-muted-foreground">{v.published ? 'Live' : 'Offline'} · {info.label}</p>
                          </td>
                          {[fmt(v.visits), fmt(v.routes), fmt(v.qr), fmt(v.searches), pct(v.found), fmt(v.asks), pct(v.understood), fmt(v.reports), pct(v.fixed_pct), hoursText(v.median_hours_to_fix)].map((c, i) => (
                            <td key={i} className="px-3 py-2.5 text-right tabular-nums">{c}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Group>
        </div>
      )}
    </Page>
  );
}

const pct = (n: number | null) => (n == null ? '—' : `${n}%`);
