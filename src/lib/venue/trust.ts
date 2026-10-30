// Trust: the business plan's place statuses, the badge visitors see, and what
// visitors can report. Stored as plain columns (migration 20261028090000):
// is_published, trust_level, home_rank / is_featured, archived_at, suspended_at.

export type TrustLevel = 'listed' | 'verified' | 'official';
export type PlaceStatus = 'draft' | 'listed' | 'verified' | 'official' | 'featured' | 'archived' | 'suspended';

export const STATUS_INFO: Record<PlaceStatus, { label: string; hint: string; cls: string }> = {
  draft: { label: 'Draft', hint: 'Not published — only your team sees it.', cls: 'bg-muted text-muted-foreground' },
  listed: { label: 'Listed', hint: 'Published. Not verified by Yet New yet.', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  verified: { label: 'Verified', hint: 'Yet New checked these details.', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  official: { label: 'Official', hint: 'Confirmed by the responsible authority.', cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300' },
  featured: { label: 'Featured', hint: 'Promoted on the home page — always shown as featured.', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300' },
  archived: { label: 'Archived', hint: 'Put away by your team. Offline, nothing deleted.', cls: 'bg-muted text-muted-foreground' },
  suspended: { label: 'Suspended', hint: 'Taken offline by Yet New.', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
};

export interface VenueTrustRow {
  is_published: boolean;
  trust_level?: string | null;
  home_rank?: number | null;
  archived_at?: string | null;
  suspended_at?: string | null;
}

export const trustLevelOf = (v: string | null | undefined): TrustLevel => (v === 'verified' || v === 'official' ? v : 'listed');

/**
 * A venue's one status, the most telling first: taken down, put away, not out yet,
 * promoted, then how far it's been verified. A suspended institution suspends its venues.
 */
export function venueStatus(b: VenueTrustRow, institutionStatus?: string | null): PlaceStatus {
  if (b.suspended_at || institutionStatus === 'suspended') return 'suspended';
  if (b.archived_at) return 'archived';
  if (!b.is_published) return 'draft';
  if ((b.home_rank ?? 0) > 0) return 'featured';
  return trustLevelOf(b.trust_level);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (iso: string) => { const d = new Date(iso); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

/** "today", "3 days ago", "2 months ago", "over a year ago". */
export function sinceText(iso: string, now = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return 'over a year ago';
}

export interface TrustFields {
  trust_level?: string | null; verified_at?: string | null; checked_at?: string | null; responsible_party?: string | null; source?: string | null;
  /** When Yet New's verification ends (20261103090000); absent before that migration. */
  verified_until?: string | null;
  /** What was checked: "Name, hours and location". */
  verification_scope?: string | null;
}

/** Days before the end date when a verification counts as ending soon. */
export const ENDING_SOON_DAYS = 30;
export type VerificationState = 'none' | 'active' | 'ending' | 'lapsed';

/** Where a verification stands: none (listed), active, ending within 30 days, or lapsed. */
export function verificationState(t: TrustFields, now = new Date()): VerificationState {
  const until = t.verified_until ? new Date(t.verified_until).getTime() : null;
  if (trustLevelOf(t.trust_level) === 'listed') {
    return 'none';
  } else if (until === null) {
    return 'active';
  } else if (until < now.getTime()) {
    return 'lapsed';
  } else if (until < now.getTime() + ENDING_SOON_DAYS * 86_400_000) {
    return 'ending';
  } else {
    return 'active';
  }
}

/** "until Mar 2027" for a verification's end, or null. */
export const untilText = (t: TrustFields): string | null => (t.verified_until ? `until ${monthYear(t.verified_until)}` : null);

/**
 * What a visitor sees about how trustworthy a place's details are, or null when there's
 * nothing to say (listed and never checked).
 */
export function trustBadge(t: TrustFields, now = new Date()): { level: TrustLevel; label: string; detail: string | null } | null {
  const level = trustLevelOf(t.trust_level);
  const checked = t.checked_at ? `Details checked ${sinceText(t.checked_at, now)}` : null;
  // A verification that has ended is not shown as one: the place reads as listed until Yet New re-checks it.
  if (verificationState(t, now) === 'lapsed') {
    return { level: 'listed', label: 'Listed', detail: [`${level === 'official' ? 'Official confirmation' : 'Verification'} is being renewed`, checked].filter(Boolean).join(' · ') };
  }
  const scope = t.verification_scope?.trim() ? ` · ${t.verification_scope.trim()}` : '';
  const by = t.responsible_party?.trim() ? ` by ${t.responsible_party.trim()}` : '';
  if (level === 'official') return { level, label: 'Official', detail: [`Confirmed${by}${t.verified_at ? ` · ${monthYear(t.verified_at)}` : ''}${scope}`, checked].filter(Boolean).join(' · ') };
  if (level === 'verified') return { level, label: 'Verified', detail: [`Checked by Yet New${t.verified_at ? ` · ${monthYear(t.verified_at)}` : ''}${scope}`, checked].filter(Boolean).join(' · ') };
  return checked ? { level, label: 'Listed', detail: checked } : null;
}

/** Details no one has confirmed for this long are worth a look (the dashboard nudges). */
export const STALE_AFTER_DAYS = 180;
export function isStale(checkedAt: string | null | undefined, now = new Date()): boolean {
  if (!checkedAt) return true;
  return now.getTime() - new Date(checkedAt).getTime() > STALE_AFTER_DAYS * 86_400_000;
}

export type ReportKind = 'wrong_info' | 'closed' | 'blocked' | 'accessibility' | 'safety' | 'other';
export const REPORT_KINDS: Record<ReportKind, { label: string; hint: string }> = {
  wrong_info: { label: 'Wrong details', hint: 'Name, hours, description or photo is wrong' },
  closed: { label: 'Closed or gone', hint: "It's closed, moved or no longer here" },
  blocked: { label: 'Way blocked', hint: "The route shown can't be walked" },
  accessibility: { label: 'Accessibility', hint: "A lift, ramp or step-free way doesn't work" },
  safety: { label: 'Safety', hint: 'Something dangerous staff should know about' },
  other: { label: 'Something else', hint: '' },
};
export const isReportKind = (k: string): k is ReportKind => k in REPORT_KINDS;
