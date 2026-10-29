import { describe, expect, it } from 'vitest';
import { KPIS, formatKpi, kpiChange, previousPeriod, type PilotReport } from './pilotReport';

const report = (extra: Partial<{ visits: number; trusted: number; live: number; searches: number; missed: number; fixed7: number; reports: number; median: number | null }> = {}): PilotReport => {
  const x = { visits: 100, trusted: 3, live: 4, searches: 50, missed: 5, fixed7: 6, reports: 8, median: 30, ...extra };
  return {
    coverage: { institutions: 2, venues: 5, live: x.live, trusted: x.trusted, official: 1, checked_recently: 3 },
    use: { visits: x.visits, visits_with_route: 40, places: 300, routes: 70, guides: 20, qr: 25, searches: x.searches, searches_missed: x.missed, asks: 10, asks_missed: 1, shares: 3, phone_visits: 80 },
    weeks: [], reports: { new: x.reports, fixed: 7, dismissed: 1, safety: 2, fixed_within_7_days: x.fixed7, median_hours_to_fix: x.median, open_now: 1 },
    notices: { issued: 2, urgent: 1 }, changes: { published: 1, verified: 2, suspended: 0, verification_requests: 1 }, venues: [],
  };
};
const kpi = (id: string) => KPIS.find(k => k.id === id)!;

describe('pilot KPIs', () => {
  it('every KPI has a plain definition, and ids are unique', () => {
    expect(new Set(KPIS.map(k => k.id)).size).toBe(KPIS.length);
    for (const k of KPIS) expect(k.definition.length, k.id).toBeGreaterThan(30);
  });

  it('computes shares from the report', () => {
    const r = report();
    expect(kpi('trusted').value(r)).toBe(75);
    expect(kpi('search_found').value(r)).toBe(90);
    expect(kpi('fixed_7').value(r)).toBe(75);
    expect(kpi('route_share').value(r)).toBe(40);
  });

  it('compares counts in percent and shares in points', () => {
    expect(kpiChange(kpi('visits'), report({ visits: 150 }), report())).toBe(50);
    expect(kpiChange(kpi('trusted'), report({ trusted: 4 }), report())).toBe(25);   // 100% vs 75%: +25 points
    expect(kpiChange(kpi('visits'), report(), null)).toBeNull();
    expect(kpiChange(kpi('visits'), report(), report({ visits: 0 }))).toBeNull();
  });

  it('formats values', () => {
    expect(formatKpi(kpi('visits'), 1284)).toBe((1284).toLocaleString());
    expect(formatKpi(kpi('trusted'), 75)).toBe('75%');
    expect(formatKpi(kpi('median_fix'), 30)).toBe('30 h');
    expect(formatKpi(kpi('median_fix'), 72)).toBe('3 days');
    expect(formatKpi(kpi('trusted'), null)).toBe('—');
  });

  it('the period before has the same length', () => {
    expect(previousPeriod('2026-10-01T00:00:00.000Z', '2026-10-31T00:00:00.000Z')).toEqual({ since: '2026-09-01T00:00:00.000Z', until: '2026-10-01T00:00:00.000Z' });
  });
});
