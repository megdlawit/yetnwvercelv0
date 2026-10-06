// The dashboard's "World" view: the venue standing on the real map, with the
// institution's other placed venues around it. Uses the team's live data.

import { lazy, Suspense, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';
import { themeOf } from '@/lib/venue/themes';
import { useCurrentOutdoorVenue, useSiblingVenues } from '@/components/venue/useOutdoorVenues';
import { useFloorGeometry } from './VenueViewer';

const OutdoorView = lazy(() => import('@/components/venue/OutdoorView'));

export default function VenueWorld({ building, groundFloorId, floors, onEnter, className }: {
  building: Tables<'buildings'>; groundFloorId: string | null; floors: number; onEnter: (venueId: string) => void; className?: string;
}) {
  const geo = useFloorGeometry(building.id, groundFloorId);
  const ground = useMemo(() => {
    if (!geo) return null;
    const byId = new Map(geo.nodes.map(n => [n.id, n] as const));
    const roomName = new Map(geo.rooms.filter(r => r.nodeId).map(r => [r.nodeId, r.name] as const));
    return {
      walls: geo.walls, rooms: geo.rooms,
      places: geo.nodes.filter(n => !n.isHallway && (roomName.get(n.id) || n.name.trim())).map(n => ({ id: n.id, name: roomName.get(n.id) || n.name, x: n.x, y: n.y })),
      paths: geo.edges.flatMap(e => { const a = byId.get(e.fromNodeId), b = byId.get(e.toNodeId); return a && b ? [{ a, b }] : []; }),
    };
  }, [geo]);
  const current = useCurrentOutdoorVenue(building, ground, floors);
  const siblings = useSiblingVenues(building);
  const venues = useMemo(() => (current ? [current, ...siblings] : []), [current, siblings]);
  const loading = <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading the world map…</div>;
  return (
    <div className={className}>
      {!venues.length ? loading : (
        <Suspense fallback={loading}>
          <OutdoorView venues={venues} theme={themeOf(building.theme)} onEnterVenue={onEnter} className="h-full" defaultTerrain={false} />
        </Suspense>
      )}
    </div>
  );
}
