import { describe, expect, it } from 'vitest';
import { isStale, sinceText, trustBadge, venueStatus } from './trust';

const NOW = new Date('2026-10-28T12:00:00Z');

describe('place status', () => {
  it('names the most telling status first', () => {
    const live = { is_published: true, trust_level: 'verified', home_rank: 0 };
    expect(venueStatus(live)).toBe('verified');
    expect(venueStatus({ ...live, home_rank: 5 })).toBe('featured');
    expect(venueStatus({ ...live, is_published: false })).toBe('draft');
    expect(venueStatus({ ...live, is_published: false, archived_at: '2026-10-01' })).toBe('archived');
    expect(venueStatus({ ...live, suspended_at: '2026-10-01' })).toBe('suspended');
    expect(venueStatus(live, 'suspended')).toBe('suspended');
    expect(venueStatus({ is_published: true })).toBe('listed');
    expect(venueStatus({ is_published: true, trust_level: 'nonsense' })).toBe('listed');
  });
});

describe('what visitors see', () => {
  it('says who verified it and when', () => {
    expect(trustBadge({ trust_level: 'verified', verified_at: '2026-10-02T09:00:00Z' }, NOW))
      .toEqual({ level: 'verified', label: 'Verified', detail: 'Checked by Yet New · Oct 2026' });
    expect(trustBadge({ trust_level: 'official', verified_at: '2026-09-10T09:00:00Z', responsible_party: 'Addis Ababa City Administration', checked_at: '2026-10-25T09:00:00Z' }, NOW))
      .toEqual({ level: 'official', label: 'Official', detail: 'Confirmed by Addis Ababa City Administration · Sep 2026 · Details checked 3 days ago' });
  });

  it('shows a listed place only when someone has checked it', () => {
    expect(trustBadge({ trust_level: 'listed' }, NOW)).toBeNull();
    expect(trustBadge({ checked_at: '2026-08-01T00:00:00Z' }, NOW)).toEqual({ level: 'listed', label: 'Listed', detail: 'Details checked 2 months ago' });
  });

  it('reads time plainly', () => {
    expect(sinceText('2026-10-28T08:00:00Z', NOW)).toBe('today');
    expect(sinceText('2026-10-27T08:00:00Z', NOW)).toBe('yesterday');
    expect(sinceText('2025-06-01T00:00:00Z', NOW)).toBe('over a year ago');
  });

  it('flags details no one has confirmed for half a year', () => {
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale('2026-09-01T00:00:00Z', NOW)).toBe(false);
    expect(isStale('2026-03-01T00:00:00Z', NOW)).toBe(true);
  });
});
