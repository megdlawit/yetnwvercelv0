import { describe, expect, it } from 'vitest';
import { normalizeUsername, passwordProblem, signInEmail, usernameFromEmail, usernameProblem, usernameToEmail, slugify } from './accounts';
import { describeActivity, timeAgo, dayLabel } from './venue/activity';

describe('accounts', () => {
  it('maps usernames to internal sign-in addresses and back', () => {
    expect(usernameToEmail(' @UnityPark ')).toBe('unitypark@accounts.yetnew.app');
    expect(usernameFromEmail('unitypark@accounts.yetnew.app')).toBe('unitypark');
    expect(usernameFromEmail('me@gmail.com')).toBeNull();
  });
  it('signs in older email accounts by email', () => {
    expect(signInEmail('admin@venue.com')).toBe('admin@venue.com');
    expect(signInEmail('@unitypark')).toBe('unitypark@accounts.yetnew.app');
    expect(signInEmail('UnityPark')).toBe('unitypark@accounts.yetnew.app');
  });
  it('validates usernames and passwords', () => {
    expect(usernameProblem('ab')).toMatch(/3/);
    expect(usernameProblem('unity park')).toMatch(/letters/);
    expect(usernameProblem('_unity')).toMatch(/starting/);
    expect(usernameProblem('unity.park_2')).toBeNull();
    expect(normalizeUsername('Unity.Park')).toBe('unity.park');
    expect(passwordProblem('short1')).toMatch(/8/);
    expect(passwordProblem('longpassword')).toMatch(/numbers/);
    expect(passwordProblem('unitypark2026')).toBeNull();
  });
  it('slugifies names', () => {
    expect(slugify('Unity Park — Addis Ababa')).toBe('unity-park-addis-ababa');
    expect(slugify('ቤተ መዘክር')).toBe('venue');
  });
});

describe('activity', () => {
  const base = { actor_id: 'u1', actor_name: 'Sara', count: 1, created_at: '2026-10-02T10:00:00Z', object_name: null as string | null };
  it('writes sentences', () => {
    expect(describeActivity({ ...base, action: 'created', object_type: 'place', object_name: 'Historic Garden' })).toBe('Sara added “Historic Garden”');
    expect(describeActivity({ ...base, action: 'created', object_type: 'event', object_name: 'Coffee ceremony' }, 'u1')).toBe('You added event “Coffee ceremony”');
    expect(describeActivity({ ...base, action: 'updated', object_type: 'place', object_name: 'Café', count: 3 })).toBe('Sara updated “Café” (3 changes)');
    expect(describeActivity({ ...base, action: 'map_edited', object_type: 'map', count: 1200 })).toBe('Sara edited the map (1,200 changes)');
    expect(describeActivity({ ...base, actor_name: null, action: 'published', object_type: 'venue' })).toBe('Someone published the venue');
  });
  it('says when', () => {
    const now = new Date(2026, 9, 2, 15, 0);
    expect(timeAgo(new Date(2026, 9, 2, 14, 48).toISOString(), now)).toBe('12 minutes ago');
    expect(timeAgo(new Date(2026, 9, 2, 14, 59, 50).toISOString(), now)).toBe('just now');
    expect(timeAgo(new Date(2026, 9, 2, 9, 0).toISOString(), now)).toBe('6 hours ago');
    expect(timeAgo(new Date(2026, 9, 1, 20, 0).toISOString(), now)).toBe('yesterday');
    expect(dayLabel(new Date(2026, 9, 2, 1, 0).toISOString(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 1, 1, 0).toISOString(), now)).toBe('Yesterday');
  });
});
