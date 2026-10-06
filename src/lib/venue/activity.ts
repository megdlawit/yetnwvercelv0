// Turning the venue activity log into sentences people read:
// "Sara added Historic Garden", "You edited the map (12 changes)".

export interface ActivityLike {
  actor_id: string | null; actor_name: string | null; action: string; object_type: string; object_name: string | null; count: number; created_at: string;
}

const NOUNS: Record<string, string> = {
  place: 'place', floor: 'floor', venue: 'venue details', story: 'story', guide: 'visitor guide', announcement: 'announcement',
  event: 'event', educational: 'educational piece', tour: 'tour', content: 'content',
};

export function describeActivity(a: ActivityLike, me?: string | null): string {
  const who = a.actor_id && a.actor_id === me ? 'You' : a.actor_name || 'Someone';
  const what = a.object_name ? `“${a.object_name}”` : `a ${NOUNS[a.object_type] ?? a.object_type}`;
  const times = a.count > 1 ? ` (${a.count} changes)` : '';
  switch (a.action) {
    case 'created': return `${who} added ${NOUNS[a.object_type] && a.object_type !== 'place' ? `${NOUNS[a.object_type]} ` : ''}${what}`;
    case 'updated': return a.object_type === 'venue' ? `${who} updated the venue details` : `${who} updated ${what}${times}`;
    case 'deleted': return `${who} removed ${what}`;
    case 'map_edited': return `${who} edited the map${a.count > 1 ? ` (${a.count.toLocaleString()} changes)` : ''}`;
    case 'published': return `${who} published the venue`;
    case 'unpublished': return `${who} took the venue offline`;
    default: return `${who} changed ${what}`;
  }
}

/** "just now", "12 minutes ago", "yesterday", "3 Oct". */
export function timeAgo(iso: string, now = new Date()): string {
  const t = new Date(iso), s = Math.max(0, (now.getTime() - t.getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) { const m = Math.round(s / 60); return `${m} minute${m === 1 ? '' : 's'} ago`; }
  if (s < 86400 && t.getDate() === now.getDate()) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (t.toDateString() === yesterday.toDateString()) return 'yesterday';
  return t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(t.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

/** "Today" / "Yesterday" / "3 October" headings for a timeline. */
export function dayLabel(iso: string, now = new Date()): string {
  const t = new Date(iso);
  if (t.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (t.toDateString() === y.toDateString()) return 'Yesterday';
  return t.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}
