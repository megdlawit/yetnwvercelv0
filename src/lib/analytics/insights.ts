// The shape of a venue's Insights (venue_insights) and Yet New's every-venue view
// (admin_insights), and the small sums the pages show.

export interface VenueInsights {
  totals: {
    visits: number; places: number; searches: number; searches_missed: number; routes: number; guides: number;
    qr: number; asks: number; asks_missed: number; shares: number; visits_with_route: number;
  };
  previous: { visits: number; routes: number; searches: number; qr: number };
  reports: { new: number; fixed: number; open: number; median_hours_to_fix: number | null };
  days: { day: string; visits: number; routes: number }[];
  hours: { hour: number; visits: number }[];
  top_places: { id: string; name: string | null; views: number; routes: number }[];
  top_searches: { query: string; count: number; found: boolean }[];
  missed_searches: { query: string; count: number }[];
  qr_places: { id: string | null; name: string | null; count: number }[];
  sources: Partial<Record<'direct' | 'qr' | 'link' | 'embed' | 'home', number>>;
  devices: Partial<Record<'phone' | 'tablet' | 'desktop' | 'unknown', number>>;
}

export interface AdminInsightsVenue {
  id: string; name: string; published: boolean; trust_level: string;
  visits: number; places: number; searches: number; searches_missed: number; routes: number; qr: number;
  asks: number; asks_missed: number; reports: number; reports_fixed: number; median_hours_to_fix: number | null;
}
export interface AdminInsights {
  totals: { visits: number; routes: number; searches: number; qr: number; asks: number; venues_with_visits: number };
  venues: AdminInsightsVenue[];
}

/** The last `days` days up to now, as the database expects them. */
export function period(days: number, now = new Date()): { since: string; until: string } {
  const until = new Date(now.getTime() + 60_000);
  const since = new Date(now);
  since.setDate(since.getDate() - days);
  return { since: since.toISOString(), until: until.toISOString() };
}

/** Change against the period before, in percent; null when there's nothing to compare with. */
export function change(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

/** `part` of `whole` in percent, rounded; null for nothing. */
export function percent(part: number, whole: number): number | null {
  return whole ? Math.round((part / whole) * 100) : null;
}

export const SOURCE_LABELS: Record<string, string> = { direct: 'Opened directly', qr: 'QR code', link: 'Shared link', embed: 'Your website', home: 'Yet New home' };
export const DEVICE_LABELS: Record<string, string> = { phone: 'Phone', tablet: 'Tablet', desktop: 'Computer', unknown: 'Other' };

/** "3 h", "2 days" — how long reports took to fix. */
export function hoursText(h: number | null): string {
  if (h == null) return '—';
  if (h < 1) return 'under 1 h';
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

/** A table as CSV text (quoted where needed), for the pilot's KPI report. */
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(c => cell(c.label)).join(','), ...rows.map(r => columns.map(c => cell(r[c.key])).join(','))].join('\n');
}

/** Byte-order mark, so Excel opens the CSV as UTF-8 (Amharic and accents intact). */
const BOM = '\uFEFF';

export function downloadText(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([`${BOM}${text}`], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
