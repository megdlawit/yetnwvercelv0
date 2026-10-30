// Dashboard pages built on the shared managers: places, attractions, events,
// tours, stories, guides, announcements and QR codes.

import { useDashboard } from '@/components/dashboard/DashboardContext';
import PlacesManager from '@/components/venue/dashboard/PlacesManager';
import ContentManager from '@/components/venue/dashboard/ContentManager';
import QrCodes from '@/components/venue/dashboard/QrCodes';
import { ATTRACTION_TYPES } from '@/lib/venue/health';
import { PLACE_TYPE_LIST } from '@/lib/venue/places';
import { Store } from 'lucide-react';
import { PlaceRequestRow, usePlaceRequests } from '@/components/business/PlaceRequests';
import { PageHeader, Panel } from './ui';

export function PlacesPage() {
  const { data, places, reload } = useDashboard();
  return (
    <>
      <PageHeader title="Places" description="Every place visitors can find — restaurants, restrooms, entrances, parking, attractions. Named places on your map appear here automatically; add photos, hours and accessibility to help visitors." />
      <BusinessRequests venueId={data.building.id} />
      <PlacesManager data={data} places={places} onChanged={reload} newType="cafe" types={PLACE_TYPE_LIST} />
    </>
  );
}

export function AttractionsPage() {
  const { data, places, reload } = useDashboard();
  return (
    <>
      <PageHeader title="Attractions" description="The highlights of your venue: attractions, gardens, viewpoints, cultural sites and play areas. Featured attractions appear first for visitors." />
      <PlacesManager data={data} places={places} onChanged={reload} types={ATTRACTION_TYPES} newType="attraction" addLabel="Add attraction" layout="cards"
        emptyText="No attractions yet. Add one, or set a place's type to Attraction, Garden, Viewpoint, Cultural site or Play area." />
    </>
  );
}

const CONTENT_PAGES = {
  events: { title: 'Events', description: 'Upcoming events visitors see under “What\'s on” until they end.', kinds: ['event'] as const, empty: 'No events yet. Post a concert, a tour, a ceremony or a holiday opening.' },
  tours: { title: 'Tours', description: 'Guided routes through your venue: pick the stops in order and visitors follow them one by one.', kinds: ['tour'] as const, empty: 'No tours yet. Create a “Highlights in 1 hour” route through your best places.' },
  stories: { title: 'Stories', description: 'Stories and educational pieces about your venue and its places.', kinds: ['story', 'educational'] as const, empty: 'No stories yet. Tell visitors the history behind a place.' },
  guides: { title: 'Visitor Guides', description: 'Practical guides: how to get here, what to bring, visiting with children, opening times.', kinds: ['guide'] as const, empty: 'No guides yet. Write a “Plan your visit” guide.' },
  announcements: { title: 'Announcements', description: 'Short notices visitors see until they expire — closures, changes, special offers.', kinds: ['announcement'] as const, empty: 'No announcements. Post one when something changes for visitors.' },
};

export function ContentPage({ page }: { page: keyof typeof CONTENT_PAGES }) {
  const { data, places, reload } = useDashboard();
  const p = CONTENT_PAGES[page];
  return (
    <>
      <PageHeader title={p.title} description={p.description} />
      <ContentManager key={page} data={data} places={places} onChanged={reload} kinds={[...p.kinds]} emptyText={p.empty} />
    </>
  );
}

export function QrPage() {
  const { data, places } = useDashboard();
  return (
    <>
      <PageHeader title="QR Codes" description="Print a code for each gate, entrance, parking area and attraction. Scanning opens your venue with that spot as “You are here”." />
      <QrCodes data={data} places={places} />
    </>
  );
}

/** Businesses asking to be added to this venue's map (Yet New Business). Shown only when there are some. */
function BusinessRequests({ venueId }: { venueId: string }) {
  const { canEdit, reload: reloadVenue } = useDashboard();
  const { rows, reload } = usePlaceRequests(venueId);
  const waiting = (rows ?? []).filter(r => r.status === 'pending');
  if (!rows || rows.length === 0) {
    return null;
  } else {
    return (
      <Panel className="mb-6" title={waiting.length ? `Businesses asking to be on your map · ${waiting.length}` : 'Businesses on your map'} icon={Store} bodyClassName="pb-1">
        <p className="px-5 pb-2 text-xs text-muted-foreground">
          Add the place in the editor, set its type (café, restaurant, hotel, shop), then link it here. The business then keeps its phone, prices and photos up to date — you keep its name and spot on the map.
        </p>
        <ul className="divide-y border-t">
          {rows.map(r => <PlaceRequestRow key={r.id} r={r} canAnswer={canEdit} onDone={() => { void reload(); void reloadVenue(); }} />)}
        </ul>
      </Panel>
    );
  }
}
