import React from 'react';
import DocsShell from '@/components/docs/DocsShell';
import {
  DocsTitle, DocsDescription, DocsH2, DocsH3, DocsP, DocsList, DocsListItem,
  DocsInlineCode, DocsCallout, DocsSection, DocsTable,
} from '@/components/docs/DocsTypography';

const DocsAdmin: React.FC = () => (
  <DocsShell>
    <DocsSection>
      <DocsTitle>Admin Guide</DocsTitle>
      <DocsDescription>
        How to sign in, set up a building, and manage everything the map shows —
        buildings &amp; floors, POIs, walking paths, live layers, and merchant
        performance.
      </DocsDescription>

      <DocsH2 id="signing-in">Signing in</DocsH2>
      <DocsP>
        Go to <DocsInlineCode>/admin/login</DocsInlineCode> and sign in with your
        admin email and password. Admin accounts aren't self-service — they're
        created directly in Supabase Auth by whoever manages the project, so if
        you don't have credentials yet, ask them to create one for you.
      </DocsP>
      <DocsP>
        Once signed in you land on <DocsInlineCode>/admin</DocsInlineCode>, a
        single dashboard with five sections in the left sidebar: Buildings,
        POIs, Paths, Layers, and Commerce. Everything below lives inside that
        one shell — switching sections doesn't reload the page.
      </DocsP>

      <DocsH2 id="buildings">Buildings &amp; floors</DocsH2>
      <DocsP>
        A <strong>building</strong> is the top-level container for a venue —
        name, description, and a geo-anchor that ties its indoor floor plan to
        a real-world GPS location:
      </DocsP>
      <DocsList>
        <DocsListItem><strong>Origin lat / lng</strong> — the real-world GPS point the floor plan's pixel origin maps to. There's a "locate me" button to grab your current GPS position while standing at that spot.</DocsListItem>
        <DocsListItem><strong>Rotation (degrees)</strong> — how much the floor plan is rotated relative to true north.</DocsListItem>
        <DocsListItem><strong>Meters per pixel</strong> — the scale factor between the floor plan image and real-world distance.</DocsListItem>
      </DocsList>
      <DocsP>
        Get these three values right and the indoor map lines up with GPS —
        get them wrong and routing/positioning will drift. Each building can
        have multiple <strong>floors</strong>, each with its own SVG floor
        plan image and a <DocsInlineCode>level</DocsInlineCode> number
        (0 = ground floor, negative for basements). New floors can start from
        a blank canvas or from one of the built-in floor templates.
      </DocsP>
      <DocsCallout tone="info" title="Publishing">
        A building isn't visible to end users until it's marked
        <DocsInlineCode> published</DocsInlineCode>. Keep it unpublished while
        you're still tracing paths and placing POIs.
      </DocsCallout>
      <DocsP>
        Buildings can also be exported/imported as JSON — useful for backing
        up a configuration or copying a building's structure as a starting
        point for a new one.
      </DocsP>

      <DocsH2 id="pois">POIs &amp; promotions</DocsH2>
      <DocsP>
        A POI (point of interest) is anything a visitor can search for, tap
        on, or navigate to — a shop, a landmark, a service desk. Each POI
        has a name, description, category (retail, attraction, service, or
        education), an optional image, and either:
      </DocsP>
      <DocsList>
        <DocsListItem>an indoor <strong>node</strong> reference, for POIs that live inside a building's floor graph, or</DocsListItem>
        <DocsListItem>a <strong>lat/lng</strong> pair directly, for outdoor POIs that aren't pinned to any indoor graph node.</DocsListItem>
      </DocsList>
      <DocsP>
        POIs can also carry <strong>promotions</strong> — a title, description,
        and discount badge shown on the POI card in the consumer app. Use
        "Featured" sparingly; it affects what surfaces first in search and
        the explore strip.
      </DocsP>

      <DocsH2 id="paths">Walking paths</DocsH2>
      <DocsP>
        The Paths section is where you trace the actual walkable network for
        the <strong>outdoor</strong> venue graph — nodes (junctions,
        entrances, landmarks) connected by paths (main, secondary, or steps).
        This is the graph the app's Dijkstra pathfinder routes over, and it's
        also exactly what's exposed through the partner API/SDK (see the{' '}
        <a href="/doc/api" className="underline" style={{ textDecorationColor: 'currentColor' }}>API &amp; SDK</a> page).
      </DocsP>
      <DocsCallout tone="warning" title="If outdoor routing looks wrong">
        Most "no route found" or oddly-shaped-route reports trace back to a
        gap in this graph — a missing connecting path, or a POI/node that
        isn't actually linked to anything. Trace along real, walkable
        surfaces (not straight lines through buildings or planters) when
        adding paths.
      </DocsCallout>

      <DocsH3>Satellite tracing</DocsH3>
      <DocsP>
        The path editor supports a satellite base layer specifically so you
        can trace real walkways from the actual imagery rather than
        guessing — switch map style to Satellite while placing nodes for the
        most accurate result.
      </DocsP>

      <DocsH2 id="layers">Layers</DocsH2>
      <DocsP>
        Layers control what's drawn on top of the base map — map type
        (Standard / Satellite / Terrain), custom overlay layers, and
        georeferenced image drapes (e.g. an event map or a hand-drawn venue
        illustration positioned over real GPS coordinates). Changes here are
        immediately live for anyone using the consumer app.
      </DocsP>

      <DocsH2 id="commerce">Commerce (merchant dashboard)</DocsH2>
      <DocsP>
        The Commerce tab shows merchant wallet activity — balances and
        transaction history for vendors selling through the platform. This
        section is read/reporting focused; wallet mutations happen through
        the underlying payment integrations, not by editing values here
        directly.
      </DocsP>

      <DocsH2 id="best-practices">Best practices</DocsH2>
      <DocsTable
        headers={['Task', 'Do', "Don't"]}
        rows={[
          ['Adding a building', 'Set the geo-anchor before adding indoor content', 'Leave origin lat/lng blank — indoor positioning needs it'],
          ['Publishing', 'Publish only once floors, POIs, and paths are in a good state', 'Publish a half-finished building — visitors will see it immediately'],
          ['Paths', 'Trace along real walkways using the satellite layer', 'Draw straight lines through buildings/obstacles'],
          ['POIs', 'Use "Featured" for a small, rotating set', 'Mark everything as Featured — it drowns out the real signal'],
        ]}
      />
    </DocsSection>
  </DocsShell>
);

export default DocsAdmin;
