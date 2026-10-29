import { describe, expect, it } from 'vitest';
import { attentionFor, byAttention, noticeState, noticeWhen, worst, type OverseenVenue } from './destination';

const NOW = new Date('2026-10-29T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString();
const venue = (name: string, extra: Partial<OverseenVenue> = {}): OverseenVenue => ({
  id: name, name, institution_id: 'i', institution_name: 'Inst', institution_status: 'approved', is_published: true, published_at: daysAgo(30),
  suspended_at: null, archived_at: null, trust_level: 'listed', verified_at: null, checked_at: daysAgo(10), responsible_party: null,
  open_reports: 0, oldest_open_report: null, safety_reports: 0, verification_pending: false, visits: 0, routes: 0, searches_missed: 0, notices: 0, ...extra,
});

describe('what needs an authority\'s attention', () => {
  it('a healthy venue needs nothing', () => {
    expect(attentionFor(venue('Ok'), NOW)).toEqual([]);
  });

  it('flags safety, suspension, old reports and stale details', () => {
    const a = attentionFor(venue('Busy', { safety_reports: 2, open_reports: 3, oldest_open_report: daysAgo(12), checked_at: daysAgo(300) }), NOW);
    expect(a.map(x => x.severity)).toEqual(['critical', 'warning', 'warning']);
    expect(a[0].text).toBe('2 open safety or access reports');
    expect(attentionFor(venue('Off', { suspended_at: daysAgo(1) }), NOW)[0]).toEqual({ severity: 'critical', text: 'Suspended — offline for visitors' });
    expect(attentionFor(venue('New', { checked_at: null }), NOW)[0].text).toBe('Details never confirmed');
  });

  it('drafts, waiting verification and missed searches are information', () => {
    const a = attentionFor(venue('Draft', { is_published: false, verification_pending: true, searches_missed: 14 }), NOW);
    expect(a.map(x => x.text)).toEqual(['Not published yet', 'Waiting for Yet New verification', '14 searches found nothing']);
    expect(worst(a)).toBe('info');
  });

  it('archived venues are left alone', () => {
    expect(attentionFor(venue('Gone', { archived_at: daysAgo(5), safety_reports: 1 }), NOW)).toEqual([]);
  });

  it('sorts the worst first, healthy last', () => {
    const list = byAttention([venue('B healthy'), venue('C info', { is_published: false }), venue('A critical', { safety_reports: 1 }), venue('D warn', { checked_at: null })], NOW);
    expect(list.map(v => v.name)).toEqual(['A critical', 'D warn', 'C info', 'B healthy']);
  });
});

describe('official notices over time', () => {
  const n = (starts: number, ends: number | null, withdrawn = false) => ({
    starts_at: daysAgo(starts), ends_at: ends == null ? null : daysAgo(ends), withdrawn_at: withdrawn ? daysAgo(0) : null,
  });
  it('knows live, scheduled, ended and withdrawn', () => {
    expect(noticeState(n(2, null), NOW)).toBe('live');
    expect(noticeState(n(-2, -5), NOW)).toBe('scheduled');
    expect(noticeState(n(5, 1), NOW)).toBe('ended');
    expect(noticeState(n(2, null, true), NOW)).toBe('withdrawn');
    expect(noticeWhen(n(5, 1), NOW)).toMatch(/^Ended /);
    expect(noticeWhen(n(2, -3), NOW)).toMatch(/^Until /);
  });
});
