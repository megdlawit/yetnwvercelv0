// Destination OS: what a government or destination account sees across the venues it oversees
// (destination_overview), what needs its attention, and its official notices.

import { isStale, sinceText } from '@/lib/venue/trust';

export interface OverseenVenue {
  id: string; name: string; institution_id: string; institution_name: string; institution_status: string | null;
  is_published: boolean; published_at: string | null; suspended_at: string | null; archived_at: string | null;
  trust_level: string | null; verified_at: string | null; checked_at: string | null; responsible_party: string | null;
  open_reports: number; oldest_open_report: string | null; safety_reports: number; verification_pending: boolean;
  visits: number; routes: number; searches_missed: number; notices: number;
}
export interface DestinationOverview {
  institutions: { id: string; name: string; status: string | null; since: string }[];
  venues: OverseenVenue[];
}

export type Severity = 'critical' | 'warning' | 'info';
export interface Attention { severity: Severity; text: string }

const DAY = 86_400_000;

/** What needs looking at, worst first. Archived venues need nothing. */
export function attentionFor(v: OverseenVenue, now = new Date()): Attention[] {
  if (v.archived_at) return [];
  const out: Attention[] = [];
  if (v.suspended_at || v.institution_status === 'suspended') out.push({ severity: 'critical', text: 'Suspended — offline for visitors' });
  if (v.safety_reports) out.push({ severity: 'critical', text: `${v.safety_reports} open safety or access report${v.safety_reports === 1 ? '' : 's'}` });
  if (v.oldest_open_report && now.getTime() - new Date(v.oldest_open_report).getTime() > 7 * DAY) {
    out.push({ severity: 'warning', text: `Reports waiting since ${sinceText(v.oldest_open_report, now)}` });
  }
  if (v.is_published && isStale(v.checked_at, now)) {
    out.push({ severity: 'warning', text: v.checked_at ? `Details last checked ${sinceText(v.checked_at, now)}` : 'Details never confirmed' });
  }
  if (!v.is_published && !v.suspended_at) out.push({ severity: 'info', text: 'Not published yet' });
  if (v.verification_pending) out.push({ severity: 'info', text: 'Waiting for Yet New verification' });
  if (v.searches_missed >= 10) out.push({ severity: 'info', text: `${v.searches_missed} searches found nothing` });
  return out;
}

const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
export const worst = (a: Attention[]): Severity | null => (a.length ? a.reduce((w, x) => (RANK[x.severity] < RANK[w] ? x.severity : w), a[0].severity) : null);

/** Venues needing the most attention first, then by name. */
export function byAttention(venues: OverseenVenue[], now = new Date()): (OverseenVenue & { attention: Attention[] })[] {
  return venues.map(v => ({ ...v, attention: attentionFor(v, now) }))
    .sort((a, b) => (RANK[worst(a.attention) ?? 'info'] + (a.attention.length ? 0 : 3)) - (RANK[worst(b.attention) ?? 'info'] + (b.attention.length ? 0 : 3)) || a.name.localeCompare(b.name));
}

// ── Official notices ──────────────────────────────────────────────────────────

export type NoticeSeverity = 'info' | 'advisory' | 'urgent';
export const NOTICE_SEVERITY: Record<NoticeSeverity, { label: string; hint: string }> = {
  info: { label: 'Information', hint: 'Hours, events, general news' },
  advisory: { label: 'Advisory', hint: 'Plan around it: works, crowds, weather' },
  urgent: { label: 'Urgent', hint: 'Safety or closures — shown first, in red' },
};

export interface OfficialNotice {
  id: string; issuer_id: string; title: string; body: string | null; severity: NoticeSeverity;
  starts_at: string; ends_at: string | null; all_venues: boolean; building_ids: string[];
  created_at: string; withdrawn_at: string | null;
}
/** A notice as visitors get it (venue_notices). */
export interface VenueNotice { id: string; title: string; body: string | null; severity: NoticeSeverity; starts_at: string; ends_at: string | null; issuer_name: string; issuer_logo: string | null }

export type NoticeState = 'live' | 'scheduled' | 'ended' | 'withdrawn';
export function noticeState(n: Pick<OfficialNotice, 'starts_at' | 'ends_at' | 'withdrawn_at'>, now = new Date()): NoticeState {
  if (n.withdrawn_at) return 'withdrawn';
  if (n.ends_at && new Date(n.ends_at) <= now) return 'ended';
  if (new Date(n.starts_at) > now) return 'scheduled';
  return 'live';
}

/** "Until 3 Nov", "From 1 Nov to 3 Nov", "Ended 2 Nov". */
export function noticeWhen(n: Pick<OfficialNotice, 'starts_at' | 'ends_at' | 'withdrawn_at'>, now = new Date()): string {
  const d = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const s = noticeState(n, now);
  if (s === 'withdrawn') return `Withdrawn ${d(n.withdrawn_at!)}`;
  if (s === 'ended') return `Ended ${d(n.ends_at!)}`;
  if (s === 'scheduled') return n.ends_at ? `From ${d(n.starts_at)} to ${d(n.ends_at)}` : `From ${d(n.starts_at)}`;
  return n.ends_at ? `Until ${d(n.ends_at)}` : `Since ${d(n.starts_at)}`;
}
