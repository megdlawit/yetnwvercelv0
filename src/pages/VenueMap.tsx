// The visitor's venue map (/venue/:id): the same map, controls and
// navigation as /explore — floor plan and outdoor map, layers, 3D tilt,
// turn-by-turn with step counting — scoped to this venue's published data.
// QR codes and links (?entry= / ?from=, ?place=, ?navigate=1, ?view=outdoor,
// ?directions=1) open it at the right spot. Events and collections live in
// the venue guide (/venue/:id/guide).

import { useMemo, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2, MapPin } from 'lucide-react';
import { ExploreMap, type ExploreVenue } from './Index';
import type { MapMode } from '@/components/LocationSplash';
import { resolveEntry, useVisitorVenue } from '@/components/visitor/useVisitorVenue';
import { toExploreBuilding, toExplorePois, venueArrivalPoint } from '@/components/visitor/exploreVenue';
import { themeOf } from '@/lib/venue/themes';
import { parseMapSettings } from '@/lib/venue/mapSettings';

export default function VenueMap() {
  const { buildingId } = useParams();
  const [params] = useSearchParams();
  const preview = params.get('preview') === '1';
  const { state, data, places } = useVisitorVenue(buildingId, preview);
  const [mode, setMode] = useState<MapMode>(params.get('view') === 'outdoor' || params.get('directions') === '1' ? 'outdoor' : 'indoor');

  const venue = useMemo<ExploreVenue | null>(() => {
    if (!data) return null;
    const placeId = resolveEntry(params.get('place'), places);
    const view = params.get('view');
    return {
      buildings: [toExploreBuilding(data)],
      pois: toExplorePois(data, places),
      entryNodeId: resolveEntry(params.get('entry') ?? params.get('from'), places),
      placeNodeId: placeId,
      navigate: params.get('navigate') === '1',
      directionsTo: params.get('directions') === '1' ? venueArrivalPoint(data, places) : null,
      features: data.features,
      places,
      // Amharic names by path point, for Amharic guidance.
      amNames: Object.fromEntries(data.pois.filter(p => p.node_id && p.name_am).map(p => [p.node_id as string, p.name_am as string])),
      theme: themeOf(data.building.theme),
      // The institution's Indoor 3D map settings (published with the venue).
      settings: parseMapSettings(data.building.map_settings, data.building.hero_view),
      initialView: view === '2d' || view === '3d' ? view : null,
      notice: !data.building.is_published ? 'Preview — not published yet'
        : data.previewing ? 'Preview — includes unpublished changes' : null,
    };
    // Links are read once, when the venue arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, places]);

  // Events and collections are part of the venue guide.
  if (params.get('events') === '1' || params.get('collection')) {
    return <Navigate to={`/venue/${buildingId}/guide?${params.toString()}`} replace />;
  }

  if (state === 'unavailable') {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center px-6 text-center">
        <MapPin className="mb-3 h-10 w-10 text-muted-foreground/40" />
        <h1 className="text-lg font-semibold">This venue isn't available</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">It may not be published yet, or the link is wrong. Please ask staff for help.</p>
      </div>
    );
  }

  if (!venue) {
    return (
      <div className="flex h-[100dvh] w-screen items-center justify-center" style={{ background: '#f0f4f0' }}>
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl" style={{ background: 'hsl(152 70% 22% / 0.1)' }}>
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'hsl(152 70% 22%)' }} />
          </div>
          <p className="text-base font-bold" style={{ color: 'hsl(152 70% 22%)' }}>Loading Map</p>
        </div>
      </div>
    );
  }

  return <ExploreMap key={venue.buildings[0].id} mapMode={mode} onChangeMode={setMode} initialTravelMode="walk" venue={venue} />;
}
