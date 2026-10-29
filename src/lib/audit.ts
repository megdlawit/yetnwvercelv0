// The audit log (supabase/migrations/20261030090000_roles_audit.sql), in plain words:
// who changed access, trust or visibility, and when.

export interface AuditEntry {
  id: number;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  /** yet_new | owner | editor | viewer | oversight | system */
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  target_name: string | null;
  institution_id: string | null;
  building_id: string | null;
  details: Record<string, unknown>;
}

export const ACTOR_ROLES: Record<string, string> = {
  yet_new: 'Yet New', owner: 'Owner', editor: 'Editor', viewer: 'Viewer', oversight: 'Oversight', system: 'System',
};

const TRUST: Record<string, string> = { listed: 'listed', verified: 'verified', official: 'official' };
const ACCOUNT: Record<string, string> = { venue: 'venue', government: 'government', destination: 'destination', business: 'business', provider: 'experience provider' };
const REVIEW: Record<string, string> = { none: 'no review', pending: 'waiting for review', approved: 'approved', rejected: 'not approved' };
const STATUS: Record<string, string> = { pending: 'waiting for approval', approved: 'approved', rejected: 'rejected', suspended: 'suspended' };

type Change = { from?: unknown; to?: unknown };
const change = (d: Record<string, unknown>, key: string): Change => (d[key] && typeof d[key] === 'object' ? d[key] as Change : {});
const str = (v: unknown) => (v == null ? '' : String(v));

/** "published Unity Park", "made Abebe a viewer"… — what happened, after the actor's name. */
export function describeAudit(e: AuditEntry): string {
  const t = e.target_name || (e.target_type === 'person' ? 'someone' : `a ${e.target_type}`);
  const d = e.details ?? {};
  switch (e.action) {
    case 'venue.created': return `created the venue ${t}`;
    case 'venue.deleted': return `deleted the venue ${t}`;
    case 'venue.published': return `published ${t} for visitors`;
    case 'venue.unpublished': return `took ${t} offline`;
    case 'venue.archived': return `archived ${t}`;
    case 'venue.restored': return `restored ${t} from the archive`;
    case 'venue.suspended': return `suspended ${t}${d.note ? ` — “${str(d.note)}”` : ''}`;
    case 'venue.unsuspended': return `lifted the suspension of ${t}`;
    case 'venue.trust': {
      const c = change(d, 'trust_level');
      return `changed ${t} from ${TRUST[str(c.from)] ?? str(c.from)} to ${TRUST[str(c.to)] ?? str(c.to)}`;
    }
    case 'place.trust': {
      const c = change(d, 'trust_level');
      return `marked the place ${t} as ${TRUST[str(c.to)] ?? str(c.to)}`;
    }
    case 'venue.review': {
      const c = change(d, 'review_status');
      return `set the review of ${t} to ${REVIEW[str(c.to)] ?? str(c.to)}`;
    }
    case 'venue.featured': {
      const c = change(d, 'home_rank');
      return Number(c.to) > 0 ? `featured ${t} on the home page` : `stopped featuring ${t}`;
    }
    case 'venue.moved': return `moved ${t} to another institution`;
    case 'institution.created': return `created the institution ${t}`;
    case 'institution.deleted': return `deleted the institution ${t}`;
    case 'institution.status': {
      const c = change(d, 'status');
      return `set ${t} to ${STATUS[str(c.to)] ?? str(c.to)}`;
    }
    case 'institution.type': {
      const c = change(d, 'account_type');
      return `made ${t} a ${ACCOUNT[str(c.to)] ?? str(c.to)} account`;
    }
    case 'institution.owner': return `changed who owns ${t}`;
    case 'member.added': return `added ${t} to the team as ${article(str(d.role))}`;
    case 'member.removed': return `removed ${t} from the team`;
    case 'member.role': return `made ${t} ${article(str(change(d, 'role').to))}`;
    case 'staff.added': return `gave ${t} Yet New staff access`;
    case 'staff.removed': return `removed ${t}'s Yet New staff access`;
    case 'oversight.granted': return `let ${str(d.overseer) || 'an authority'} oversee ${t}`;
    case 'oversight.revoked': return `ended ${str(d.overseer) || 'an authority'}'s oversight of ${t}`;
    case 'verification.requested': return `asked Yet New to ${d.place ? 'verify a place in' : 'verify'} ${t}${d.level === 'official' ? ' as official' : ''}`;
    case 'verification.approved': return `approved the verification of ${t}`;
    case 'verification.rejected': return `declined the verification of ${t}${d.note ? ` — “${str(d.note)}”` : ''}`;
    case 'verification.withdrawn': return `withdrew the verification request for ${t}`;
    case 'notice.issued': return `issued the official notice “${t}”${d.severity === 'urgent' ? ' (urgent)' : ''} to ${d.all_venues ? 'every venue it oversees' : `${str(d.venues)} venue${d.venues === 1 ? '' : 's'}`}`;
    case 'notice.updated': return `changed the official notice “${t}”`;
    case 'notice.withdrawn': return `withdrew the official notice “${t}”`;
    case 'report.fixed': return `fixed a reported problem at ${t}`;
    case 'report.dismissed': return `dismissed a report about ${t}`;
    case 'report.open': return `reopened a report about ${t}`;
    default: return `${e.action.replace(/[._]/g, ' ')} ${t}`;
  }
}

const article = (role: string) => (role === 'owner' ? 'an owner' : role === 'editor' ? 'an editor' : role === 'viewer' ? 'a viewer' : role || 'a member');

/** Which group an entry belongs to, for filtering. */
export function auditGroup(action: string): 'visibility' | 'trust' | 'team' | 'institution' | 'reports' | 'notices' {
  if (/^(venue\.(published|unpublished|archived|restored|suspended|unsuspended|featured|created|deleted|moved|review))/.test(action)) return 'visibility';
  if (/trust|^verification/.test(action)) return 'trust';
  if (/^(member|staff)\./.test(action)) return 'team';
  if (/^report\./.test(action)) return 'reports';
  if (/^notice\./.test(action)) return 'notices';
  return 'institution';
}
export const AUDIT_GROUPS = [['visibility', 'Online & offline'], ['trust', 'Trust & verification'], ['team', 'Team & access'], ['institution', 'Institution & oversight'], ['reports', 'Reports'], ['notices', 'Official notices']] as const;
