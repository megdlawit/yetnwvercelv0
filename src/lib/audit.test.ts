import { describe, expect, it } from 'vitest';
import { auditGroup, describeAudit, type AuditEntry } from './audit';

const entry = (action: string, target_name: string | null, details: Record<string, unknown> = {}, target_type = 'venue'): AuditEntry => ({
  id: 1, created_at: '2026-10-30T09:00:00Z', actor_id: 'u', actor_name: 'Abebe', actor_role: 'owner', action, target_type, target_id: 'x',
  target_name, institution_id: 'i', building_id: 'b', details,
});

describe('the audit log in plain words', () => {
  it('says what happened to a venue', () => {
    expect(describeAudit(entry('venue.published', 'Unity Park'))).toBe('published Unity Park for visitors');
    expect(describeAudit(entry('venue.suspended', 'Unity Park', { note: 'Unsafe stairs' }))).toBe('suspended Unity Park — “Unsafe stairs”');
    expect(describeAudit(entry('venue.trust', 'Unity Park', { trust_level: { from: 'listed', to: 'official' } }))).toBe('changed Unity Park from listed to official');
    expect(describeAudit(entry('venue.featured', 'Unity Park', { home_rank: { from: 0, to: 2 } }))).toBe('featured Unity Park on the home page');
  });

  it('says who joined, left or changed role', () => {
    expect(describeAudit(entry('member.added', 'Vera', { role: 'viewer' }, 'person'))).toBe('added Vera to the team as a viewer');
    expect(describeAudit(entry('member.role', 'Vera', { role: { from: 'viewer', to: 'editor' } }, 'person'))).toBe('made Vera an editor');
    expect(describeAudit(entry('member.removed', null, {}, 'person'))).toBe('removed someone from the team');
  });

  it('says who oversees whom', () => {
    expect(describeAudit(entry('oversight.granted', 'Unity Park', { overseer: 'Addis Ababa Tourism' }, 'institution'))).toBe('let Addis Ababa Tourism oversee Unity Park');
    expect(describeAudit(entry('institution.type', 'Addis Ababa Tourism', { account_type: { from: 'venue', to: 'government' } }, 'institution'))).toBe('made Addis Ababa Tourism a government account');
  });

  it('still says something for an action it does not know', () => {
    expect(describeAudit(entry('venue.something_new', 'Unity Park'))).toBe('venue something new Unity Park');
  });

  it('groups entries for filtering', () => {
    expect(auditGroup('venue.published')).toBe('visibility');
    expect(auditGroup('venue.trust')).toBe('trust');
    expect(auditGroup('verification.approved')).toBe('trust');
    expect(auditGroup('member.added')).toBe('team');
    expect(auditGroup('oversight.granted')).toBe('institution');
    expect(auditGroup('report.fixed')).toBe('reports');
  });
});
