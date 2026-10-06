// Publish settings: is the venue live, what visitors get, what's waiting,
// and the public link to share.

import { toast } from 'sonner';
import { Globe, Copy, ExternalLink, CheckCircle2, Circle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDashboard } from '@/components/dashboard/DashboardContext';
import { describeActivity, timeAgo } from '@/lib/venue/activity';
import { PageHeader, Panel, StatusDot } from './ui';

export default function PublishSettings() {
  const ws = useWorkspace();
  const { data, places, openPublish, previewUrl } = useDashboard();
  const b = data.building;
  const link = `${window.location.origin}/venue/${b.id}`;
  const since = b.published_at ? new Date(b.published_at).getTime() : 0;
  const pending = data.activity.filter(a => !['published', 'unpublished'].includes(a.action) && new Date(a.created_at).getTime() > since);
  const history = data.activity.filter(a => a.action === 'published' || a.action === 'unpublished');
  const what = [
    { label: '2D & 3D map', ok: data.counts.walls + data.counts.rooms > 0 },
    { label: 'Search & categories', ok: places.length > 0 },
    { label: 'Turn-by-turn navigation', ok: data.edges.length > 0 },
    { label: 'Place details, photos & hours', ok: places.some(p => p.poi) },
    { label: 'Events & announcements', ok: data.content.some(c => (c.kind === 'event' || c.kind === 'announcement') && c.is_published) },
    { label: 'Stories, guides & tours', ok: data.content.some(c => !['event', 'announcement'].includes(c.kind) && c.is_published) },
  ];

  return (
    <>
      <PageHeader title="Publish Settings" description="Your edits stay private until you publish. Visitors always see the last published version." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel bodyClassName="p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</p>
          <p className="mt-1 flex items-center gap-2 text-2xl font-bold"><StatusDot ok={b.is_published} /> {b.is_published ? 'Published' : 'Not published'}</p>
          <p className="text-sm text-muted-foreground">{b.published_at ? `Last published ${new Date(b.published_at).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}` : 'Never published'}</p>
          {pending.length > 0 && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{data.unpublished} change{data.unpublished === 1 ? '' : 's'} waiting to be published.</p>}
          <div className="mt-5 flex gap-2">
            <Button onClick={openPublish}><Globe className="mr-1.5 h-4 w-4" /> {b.is_published ? (data.unpublished ? 'Review & Publish' : 'Publish settings') : 'Publish venue'}</Button>
            <Button variant="outline" asChild><a href={previewUrl} target="_blank" rel="noreferrer">Preview</a></Button>
          </div>
        </Panel>
        <Panel title="Public link" bodyClassName="px-6 pb-6">
          <p className="text-sm text-muted-foreground">Share it on your website and social media, or print QR codes for your gates.</p>
          <div className="mt-3 flex gap-2">
            <Input readOnly value={link} onFocus={e => e.target.select()} />
            <Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success('Link copied'))} aria-label="Copy link"><Copy className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" asChild><a href={link} target="_blank" rel="noreferrer" aria-label="Open"><ExternalLink className="h-4 w-4" /></a></Button>
          </div>
          {!b.is_published && <p className="mt-2 text-xs text-amber-700">The link shows “not available” until you publish.</p>}
        </Panel>
        <Panel title="What visitors get" bodyClassName="px-6 pb-6">
          <ul className="grid gap-2 sm:grid-cols-2">
            {what.map(w => <li key={w.label} className="flex items-center gap-2 text-sm">{w.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground/50" />} <span className={w.ok ? '' : 'text-muted-foreground'}>{w.label}</span></li>)}
          </ul>
        </Panel>
        <Panel title="Waiting to be published" bodyClassName="px-6 pb-6">
          {pending.length ? (
            <ul className="space-y-2 text-sm">{pending.slice(0, 12).map(a => <li key={a.id} className="flex justify-between gap-3"><span className="truncate">{describeActivity(a, ws.account.userId)}</span><span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.created_at)}</span></li>)}</ul>
          ) : <p className="text-sm text-muted-foreground">Nothing — visitors see exactly what you see.</p>}
        </Panel>
        <Panel title="Publish history" bodyClassName="px-6 pb-6" className="lg:col-span-2">
          {history.length ? (
            <ul className="space-y-2 text-sm">{history.map(a => <li key={a.id} className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /> {describeActivity(a, ws.account.userId)} <span className="text-xs text-muted-foreground">· {new Date(a.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span></li>)}</ul>
          ) : <p className="text-sm text-muted-foreground">No publishes yet.</p>}
        </Panel>
      </div>
    </>
  );
}
