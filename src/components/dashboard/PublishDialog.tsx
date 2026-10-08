// "Publish changes": shows what changed since visitors last got an update,
// then sends it all to them in one go.

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Globe, Map, MapPin, Newspaper, Layers, Settings2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { describeActivity, timeAgo } from '@/lib/venue/activity';
import { celebrateBuild } from '@/lib/celebrate';
import { publishVenue, unpublishVenue, type VenueData } from '@/components/venue/dashboard/useVenue';

const ICON: Record<string, typeof Map> = { map: Map, place: MapPin, floor: Layers, venue: Settings2 };

export default function PublishDialog({ open, onOpenChange, data, me, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; data: VenueData; me: string; onDone: () => void;
}) {
  const [busy, setBusy] = useState<'publish' | 'unpublish' | null>(null);
  const b = data.building;
  const since = b.published_at ? new Date(b.published_at).getTime() : 0;
  const changes = data.activity.filter(a => !['published', 'unpublished'].includes(a.action) && new Date(a.created_at).getTime() > since);

  const run = async (what: 'publish' | 'unpublish') => {
    setBusy(what);
    try {
      if (what === 'publish') {
        if (await publishVenue(b.id) === 'review') {
          toast.success('Sent to Yet New for review', { description: 'Your institution is new, so the first publish is checked by our team. It goes live as soon as it is approved — usually within a day.', duration: 9000 });
          onOpenChange(false); onDone(); return;
        }
      } else await unpublishVenue(b.id);
      const first = what === 'publish' && !b.published_at;
      if (first) celebrateBuild();
      toast.success(first ? `🎉 ${b.name} is live! Share the link or print your QR codes.` : what === 'publish' ? 'Published — visitors now see the latest version' : 'Your venue is offline for visitors');
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{b.is_published ? (data.unpublished ? 'Changes ready to publish' : 'Everything is published') : `Publish ${b.name}`}</DialogTitle>
          <DialogDescription>
            {b.is_published
              ? data.unpublished
                ? `Visitors still see the version from ${b.published_at ? timeAgo(b.published_at) : 'before'}. Publishing sends them these ${data.unpublished} change${data.unpublished === 1 ? '' : 's'}.`
                : 'Visitors see exactly what you see. New edits will show up here.'
              : 'Anyone with the link or a QR code will be able to explore your venue: the 3D map, search, directions, places and published content.'}
          </DialogDescription>
        </DialogHeader>

        {changes.length > 0 && (
          <ul className="max-h-64 overflow-y-auto divide-y rounded-xl border">
            {changes.slice(0, 30).map(a => {
              const Icon = ICON[a.object_type] ?? Newspaper;
              return (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 min-w-0 truncate">{describeActivity(a, me)}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">{timeAgo(a.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {b.is_published
            ? <Button variant="ghost" className="text-destructive" disabled={!!busy} onClick={() => run('unpublish')}>{busy === 'unpublish' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Take offline</Button>
            : <span />}
          <Button disabled={!!busy || (b.is_published && !data.unpublished && !!b.published_at)} onClick={() => run('publish')}>
            {busy === 'publish' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Globe className="mr-1.5 h-4 w-4" />}
            {b.is_published ? 'Publish changes' : 'Publish venue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
