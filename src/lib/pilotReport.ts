// The pilot KPI report (pilot_report): its shape, and the KPIs with their definitions — one
// list, so the report page, its CSV and the pilot package document say the same thing.

import { percent } from '@/lib/analytics/insights';

export interface PilotReport {
  coverage: { institutions: number; venues: number; live: number; trusted: number; official: number; checked_recently: number };
  use: {
    visits: number; visits_with_route: number; places: number; routes: number; guides: number; qr: number;
    searches: number; searches_missed: number; asks: number; asks_missed: number; shares: number; phone_visits: number;
  };
  weeks: { week: string; visits: number; routes: number; qr: number }[];
  reports: { new: number; fixed: number; dismissed: number; safety: number; fixed_within_7_days: number; median_hours_to_fix: number | null; open_now: number };
  notices: { issued: number; urgent: number } | null;
  changes: { published: number; verified: number; suspended: number; verification_requests: number };
  venues: { id: string; name: string; trust_level: string; is_published: boolean; visits: number; routes: number; qr: number; reports: number; reports_fixed: number }[];
}

export type KpiGroup = 'Coverage and trust' | 'Visitor use' | 'Responsiveness' | 'Official notices and changes';
export interface Kpi {
  id: string; group: KpiGroup; label: string; definition: string;
  /** The value, or null when there's nothing to measure yet. */
  value: (r: PilotReport) => number | null;
  unit?: '%' | 'h';
  /** Higher is better (for the arrow's colour); false for e.g. hours to fix. */
  higherIsBetter?: boolean;
  headline?: boolean;
}

export const KPIS: Kpi[] = [
  // Coverage and trust
  { id: 'live', group: 'Coverage and trust', label: 'Venues live for visitors', definition: 'Venues published on Yet New and not suspended or archived, at the end of the period.', value: r => r.coverage.live },
  { id: 'trusted', group: 'Coverage and trust', label: 'Live venues verified or official', unit: '%', headline: true, definition: 'Share of live venues whose details Yet New verified, or the responsible authority confirmed as official.', value: r => percent(r.coverage.trusted, r.coverage.live) },
  { id: 'checked', group: 'Coverage and trust', label: 'Live venues with details checked in the last 6 months', unit: '%', definition: 'Share of live venues whose team confirmed their details (or fixed a report) within 180 days before the end of the period.', value: r => percent(r.coverage.checked_recently, r.coverage.live) },
  // Visitor use
  { id: 'visits', group: 'Visitor use', label: 'Visits', headline: true, definition: 'Anonymous visitor sessions on the venues’ maps. One person opening the map once is one visit, however long they stay. Venue teams, previews and “do not track” browsers are not counted.', value: r => r.use.visits },
  { id: 'routes', group: 'Visitor use', label: 'Directions started', headline: true, definition: 'Times a visitor asked for the way to a place.', value: r => r.use.routes },
  { id: 'route_share', group: 'Visitor use', label: 'Visits that used directions', unit: '%', definition: 'Share of visits in which directions were started at least once.', value: r => percent(r.use.visits_with_route, r.use.visits) },
  { id: 'qr', group: 'Visitor use', label: 'QR code scans', headline: true, definition: 'Visits that started from a venue’s QR code, plus QR codes scanned inside the map.', value: r => r.use.qr },
  { id: 'search_found', group: 'Visitor use', label: 'Searches that found something', unit: '%', headline: true, definition: 'Share of searches with at least one result. The rest show teams what visitors look for that the map lacks.', value: r => percent(r.use.searches - r.use.searches_missed, r.use.searches) },
  { id: 'ask_understood', group: 'Visitor use', label: 'Questions the guide understood', unit: '%', definition: 'Share of questions to the map’s “Ask” guide that it could answer. What visitors typed is never stored.', value: r => percent(r.use.asks - r.use.asks_missed, r.use.asks) },
  { id: 'phone', group: 'Visitor use', label: 'Visits on phones', unit: '%', definition: 'Share of visits from a phone-sized screen.', value: r => percent(r.use.phone_visits, r.use.visits) },
  // Responsiveness
  { id: 'reports', group: 'Responsiveness', label: 'Problems reported by visitors', definition: 'Reports filed with “Report a problem” on a place: wrong details, closed, blocked, accessibility, safety.', value: r => r.reports.new, higherIsBetter: false },
  { id: 'fixed_7', group: 'Responsiveness', label: 'Reports fixed within 7 days', unit: '%', headline: true, definition: 'Share of the period’s reports the venue team marked fixed within 7 days of the report.', value: r => percent(r.reports.fixed_within_7_days, r.reports.new) },
  { id: 'median_fix', group: 'Responsiveness', label: 'Median time to fix a report', unit: 'h', higherIsBetter: false, definition: 'Half of the fixed reports were fixed faster than this.', value: r => r.reports.median_hours_to_fix },
  { id: 'open_now', group: 'Responsiveness', label: 'Reports still open', higherIsBetter: false, definition: 'Reports not yet fixed or dismissed, at the time the report is generated.', value: r => r.reports.open_now },
  // Official notices and changes
  { id: 'notices', group: 'Official notices and changes', label: 'Official notices issued', definition: 'Notices the authority published to the venues’ visitor maps (closures, safety, hours).', value: r => r.notices?.issued ?? null },
  { id: 'verified_changes', group: 'Official notices and changes', label: 'Venues newly verified or made official', definition: 'Trust changes to verified or official recorded in the audit log during the period.', value: r => r.changes.verified },
  { id: 'published_changes', group: 'Official notices and changes', label: 'Times venues were published', definition: 'Venues going live (or live again) during the period, from the audit log.', value: r => r.changes.published },
];

/** Change from the period before, in percent; null when there's nothing to compare. */
export function kpiChange(k: Kpi, now: PilotReport, before: PilotReport | null): number | null {
  if (!before) return null;
  const a = k.value(now), b = k.value(before);
  if (a == null || b == null) return null;
  if (k.unit === '%') return a - b;            // percentage points
  if (!b) return null;
  return Math.round(((a - b) / b) * 100);
}

export function formatKpi(k: Kpi, v: number | null): string {
  if (v == null) return '—';
  if (k.unit === '%') return `${v}%`;
  if (k.unit === 'h') return v < 48 ? `${Math.round(v)} h` : `${Math.round(v / 24)} days`;
  return v.toLocaleString();
}

/** The period before one of the same length. */
export function previousPeriod(since: string, until: string): { since: string; until: string } {
  const a = new Date(since).getTime(), b = new Date(until).getTime();
  return { since: new Date(a - (b - a)).toISOString(), until: since };
}
