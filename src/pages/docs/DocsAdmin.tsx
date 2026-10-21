import React from 'react';
import DocsShell from '@/components/docs/DocsShell';
import {
  DocsEyebrow, DocsTitle, DocsDescription, DocsH2, DocsH3, DocsP, DocsList, DocsListItem, DocsInlineCode,
  DocsCallout, DocsTable, DocsCodeBlock, DocsSteps, DocsStep, DocsFaq,
} from '@/components/docs/DocsTypography';

const DocsAdmin: React.FC = () => (
  <DocsShell>
    <DocsEyebrow>Guide · Platform admins</DocsEyebrow>
    <DocsTitle>Run the Yet New control center</DocsTitle>
    <DocsDescription>
      For the Yet New team: approving institutions, keeping the directory healthy, managing people, the platform
      tools and map layers — plus how the platform is set up and deployed.
    </DocsDescription>

    <DocsH2 id="access">Getting in</DocsH2>
    <DocsP>
      The control center lives at <DocsInlineCode>/admin</DocsInlineCode>. Sign in at <DocsInlineCode>/login</DocsInlineCode> with
      a platform-admin account; anyone else who opens <DocsInlineCode>/admin</DocsInlineCode> is sent to their own dashboard.
      Platform admins are listed in the <DocsInlineCode>platform_admins</DocsInlineCode> table — the first one is seeded by
      migration <DocsInlineCode>20261002090000_institution_accounts.sql</DocsInlineCode>, and after that you promote people from
      <b> People</b>.
    </DocsP>

    <DocsH2 id="overview">Overview</DocsH2>
    <DocsP>
      The home page shows what’s waiting for your approval, how many institutions and venues there are (new in the last
      30 days, suspended), what’s live, and the latest activity. “Needs your decision” lists the oldest waiting items
      first with a <b>Review</b> button.
    </DocsP>

    <DocsH2 id="approvals">Approvals</DocsH2>
    <DocsP>Two things wait for you:</DocsP>
    <DocsList>
      <DocsListItem><b>New institutions.</b> Approve to let them publish; decline (with an optional note) if the account isn’t a real place. Approving an institution also puts its waiting venues live straight away.</DocsListItem>
      <DocsListItem><b>Publish requests.</b> A new institution’s first publish of a venue. Open the preview, then approve or decline with a note — the team sees your note.</DocsListItem>
    </DocsList>
    <DocsCallout tone="tip" title="What to check before approving">
      The venue is a real, public place; the name and description are accurate; the map roughly matches the place;
      and photos are the institution’s own. Later publishes don’t need approval.
    </DocsCallout>

    <DocsH2 id="institutions">Institutions</DocsH2>
    <DocsP>
      Every institution with its owner, status (<DocsInlineCode>pending</DocsInlineCode>, <DocsInlineCode>approved</DocsInlineCode>,{' '}
      <DocsInlineCode>rejected</DocsInlineCode>, <DocsInlineCode>suspended</DocsInlineCode>), venues and last activity. From here you can:
    </DocsP>
    <DocsList>
      <DocsListItem><b>Approve, decline, suspend or reinstate.</b> Declining or suspending takes the institution’s venues offline and stops it publishing — nothing is deleted. Reinstating lets the team publish again.</DocsListItem>
      <DocsListItem><b>Open its dashboard</b> (support view) to see exactly what the team sees and help them — the header shows “Yet New support” while you’re in it.</DocsListItem>
    </DocsList>

    <DocsH2 id="venues">Venues</DocsH2>
    <DocsP>
      Every venue on the platform: building or outdoor site, its institution, when it was last published and whether
      it’s live. You can take a venue offline or put it back, and <b>feature</b> it on the public home page (featured
      venues show first, marked with a star).
    </DocsP>

    <DocsH2 id="people">People and activity</DocsH2>
    <DocsP>
      <b>People</b> lists every account with its institution, role and last sign-in. Make someone a <b>Yet New admin</b>{' '}
      (or remove it) here. <b>Activity</b> is the platform-wide log — publishes, review requests and decisions, team
      changes — newest first.
    </DocsP>

    <DocsH2 id="tools">Platform tools</DocsH2>
    <DocsTable
      headers={['Tool', 'What it does']}
      rows={[
        ['Buildings & floors', 'Every building and floor directly, across institutions — for fixes the dashboard doesn’t cover.'],
        ['Points of interest', 'Places across all venues, indoor and outdoor.'],
        ['Outdoor paths', 'The curated walking-path network that outdoor directions follow.'],
        ['Map layers', 'Buildings, parking, walkways, entrances, stores and events on every visitor’s outdoor map (below).'],
        ['Embed codes', 'Partner API keys and the snippets partners paste into their sites (see API & embeds).'],
      ]}
    />

    <DocsH3 id="layers">Map layers</DocsH3>
    <DocsP>
      Layers are drawn straight on the world map and saved as you go — the status next to the title reads
      “Saved · live for visitors”. Visitors’ outdoor maps load them from the database (and keep a copy for offline),
      drawn by the same renderer, so what you see is what they get.
    </DocsP>
    <DocsSteps>
      <DocsStep title="Add a layer">Click <b>New layer</b> and pick a kind: buildings (3D, height from floors), parking (with live free spaces), walkways (flowing, coloured by difficulty), service routes, entrances (step-free badge), stores (open/closed) or events (pulse while live).</DocsStep>
      <DocsStep title="Draw it">For points, click the map. For walkways and routes, click along the way and double-click (or press Enter) to finish. For buildings and parking, click the corners. Backspace removes the last point; Esc cancels.</DocsStep>
      <DocsStep title="Fill in the details">Name it and set its fields — floors, capacity and free spaces, times, step-free and so on. Drag the white handles on the map to move or reshape it.</DocsStep>
      <DocsStep title="Show or hide">The switch beside each layer controls whether visitors see it. Visitors can also hide layers for themselves from the map’s layers panel.</DocsStep>
    </DocsSteps>
    <DocsP>
      Switch to <b>3D scene</b> for the stylised overview, tilt the world map for extruded buildings, use <b>Go to a venue</b> to
      jump to any venue, and <b>JSON</b> to back up, move or bulk-edit layers.
    </DocsP>
    <DocsCallout tone="warning" title="Platform layers are Yet New–only">
      Migration <DocsInlineCode>20261009090000_platform_layers_admin_only.sql</DocsInlineCode> makes platform-wide layers writable
      only by platform admins. Apply it on the live database — before it, any signed-in account could change them.
    </DocsCallout>

    <DocsH2 id="setup">Setup and operations</DocsH2>
    <DocsH3>Services</DocsH3>
    <DocsTable
      headers={['Piece', 'Where', 'Notes']}
      rows={[
        ['Web app', 'Vercel', 'Vite + React. The /api routes below run as Vercel functions.'],
        ['Database, auth, storage', 'Supabase', 'Row-level security on every table; migrations in supabase/migrations.'],
        [<DocsInlineCode>institution-accounts</DocsInlineCode>, 'Supabase edge function', 'Username sign-up, adding and removing team members.'],
        [<DocsInlineCode>indoor-maps-api</DocsInlineCode>, 'Supabase edge function', 'The partner API behind embeds and the SDK.'],
        [<DocsInlineCode>/api/map-assistant</DocsInlineCode>, 'Vercel', 'The editor’s AI: a free hosted model first (when configured), then Claude. Signed-in users only.'],
        [<DocsInlineCode>/api/dwg-convert</DocsInlineCode>, 'Vercel', 'Turns DWG into DXF on our server (LibreDWG); drawings never leave it.'],
        [<DocsInlineCode>/api/osrm</DocsInlineCode>, <DocsInlineCode>/api/overpass</DocsInlineCode>, 'Outdoor routing and map data proxies.'],
      ]}
    />
    <DocsH3>Environment variables</DocsH3>
    <DocsTable
      headers={['Variable', 'Used by', 'Notes']}
      rows={[
        [<DocsInlineCode>VITE_SUPABASE_URL</DocsInlineCode>, 'Web app, API routes', 'Your Supabase project URL.'],
        [<DocsInlineCode>VITE_SUPABASE_PUBLISHABLE_KEY</DocsInlineCode>, 'Web app, API routes', 'The public (anon) key.'],
        [<DocsInlineCode>ASSISTANT_FREE_URL</DocsInlineCode>, '/api/map-assistant', 'Optional, server-side: a free model with an OpenAI-compatible API (e.g. Groq, OpenRouter, Gemini’s OpenAI-compatible endpoint, or your own Ollama server at …/v1). Tried before Claude. The map summary is sent to that service — check its data terms.'],
        [<DocsInlineCode>ASSISTANT_FREE_MODEL</DocsInlineCode>, '/api/map-assistant', 'The model name at that service. Both URL and model must be set to turn the free fallback on.'],
        [<DocsInlineCode>ASSISTANT_FREE_KEY</DocsInlineCode>, '/api/map-assistant', 'Its API key (empty for your own server). ASSISTANT_FREE_JSON_MODE=off if it rejects JSON mode.'],
        [<DocsInlineCode>ANTHROPIC_API_KEY</DocsInlineCode>, '/api/map-assistant', 'Optional, paid: Claude, used when no free model is set or it fails. Without any of these, the assistant still understands common requests on the device, plus the free local model when it runs.'],
        [<DocsInlineCode>OVERPASS_ENDPOINT</DocsInlineCode>, '/api/overpass', 'Optional: a different Overpass server.'],
        [<DocsInlineCode>CLOUDCONVERT_API_KEY</DocsInlineCode>, '/api/dwg-convert', 'Optional fallback converter for unusual DWG files.'],
        [<DocsInlineCode>SUPABASE_SERVICE_ROLE_KEY</DocsInlineCode>, 'Edge functions', 'Set in Supabase, never in the web app.'],
      ]}
    />
    <DocsH3>Database changes</DocsH3>
    <DocsP>
      Migrations are idempotent and safe to re-run. Apply new ones in order from the Supabase SQL editor (or
      <DocsInlineCode>supabase db push</DocsInlineCode>), then deploy the edge functions:
    </DocsP>
    <DocsCodeBlock language="shell">{`
supabase db push
supabase functions deploy institution-accounts
supabase functions deploy indoor-maps-api
    `}</DocsCodeBlock>

    <DocsH2 id="faq">Questions</DocsH2>
    <DocsFaq q="An institution says sign-up fails with “Accounts service isn’t set up”.">
      <p>The <DocsInlineCode>institution-accounts</DocsInlineCode> edge function isn’t deployed (or is missing <DocsInlineCode>SUPABASE_SERVICE_ROLE_KEY</DocsInlineCode>). Deploy it as above.</p>
    </DocsFaq>
    <DocsFaq q="The map layers page says the layers table is missing.">
      <p>Apply <DocsInlineCode>20260930090000_foundation_institutions_rooms.sql</DocsInlineCode> (it creates <DocsInlineCode>custom_layers</DocsInlineCode>), then the layers admin-only migration.</p>
    </DocsFaq>
    <DocsFaq q="An editor can’t save 3D details (wall height, ceilings…).">
      <p>Apply <DocsInlineCode>20261006090000_indoor_3d_model.sql</DocsInlineCode>. Scenery objects need <DocsInlineCode>20261008090000_scenery_kinds.sql</DocsInlineCode>.</p>
    </DocsFaq>
    <DocsFaq q="Where did Commerce go?">
      <p>The merchant and commerce dashboard has been removed from the control center.</p>
    </DocsFaq>
  </DocsShell>
);

export default DocsAdmin;
