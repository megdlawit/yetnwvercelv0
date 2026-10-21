import React from 'react';
import DocsShell from '@/components/docs/DocsShell';
import {
  DocsTitle, DocsDescription, DocsH2, DocsH3, DocsP, DocsList, DocsListItem,
  DocsInlineCode, DocsCodeBlock, DocsCallout, DocsSection, DocsTable, DocsEyebrow,
} from '@/components/docs/DocsTypography';

const DocsApi: React.FC = () => (
  <DocsShell>
    <DocsSection>
      <DocsEyebrow>Developers</DocsEyebrow>
      <DocsTitle>API &amp; embeds</DocsTitle>
      <DocsDescription>
        Put a venue’s indoor and outdoor map on another website or app with a scoped partner API key —
        three ways in, one Edge Function underneath.
      </DocsDescription>

      <DocsP>
        None of the three options below ever talk to Supabase directly — each
        calls one purpose-built endpoint (an Edge Function) with your API
        key, which is validated server-side and scoped to specific
        buildings. Nothing a partner receives ever contains your Supabase
        URL, anon key, or raw table access.
      </DocsP>

      <DocsH2 id="getting-a-key">Getting an API key</DocsH2>
      <DocsP>
        Keys are generated in the Yet New control center — no SQL required day to day:
      </DocsP>
      <DocsList>
        <DocsListItem><DocsInlineCode>/admin/tools/embed</DocsInlineCode> (<b>Platform tools → Embed codes</b>) → pick a venue, or</DocsListItem>
        <DocsListItem><DocsInlineCode>/admin/tools/buildings</DocsInlineCode> → the <DocsInlineCode>{'</>'}</DocsInlineCode> icon on a building’s card.</DocsListItem>
      </DocsList>
      <DocsP>
        Either path opens the same dialog: type a partner name, hit
        <DocsInlineCode>Generate key</DocsInlineCode>, and both the iframe
        and script-tag snippets below appear pre-filled with the real key
        and building id — copy button included. If you're integrating a
        partner app rather than issuing the key yourself, just ask whoever
        administers the platform for the snippet or the raw{' '}
        <DocsInlineCode>apiKey</DocsInlineCode> + <DocsInlineCode>buildingId</DocsInlineCode> pair.
      </DocsP>
      <DocsCallout tone="info" title="Revoking a key">
        Flip <DocsInlineCode>is_active</DocsInlineCode> to <DocsInlineCode>false</DocsInlineCode>{' '}
        on that key's <DocsInlineCode>partner_keys</DocsInlineCode> row to
        revoke it instantly — no redeploy needed, takes effect on the key's
        very next request.
      </DocsCallout>

      <DocsH2 id="option-a-iframe">Option A — iframe (no code)</DocsH2>
      <DocsP>
        For partners who don't run React at all — WordPress, Wix, plain
        HTML, anything. Paste one tag:
      </DocsP>
      <DocsCodeBlock>{`
<iframe
  src="https://yourapp.vercel.app/embed?key=pk_live_...&building=11111111-1111-1111-1111-111111111111"
  style="width:100%;height:480px;border:0"
  loading="lazy"
></iframe>
      `}</DocsCodeBlock>
      <DocsP>
        This is the same <DocsInlineCode>{"<IndoorMap />"}</DocsInlineCode>{' '}
        component and the same key check as every other option here — just
        served as a page instead of a package.
      </DocsP>

      <DocsH2 id="option-b-script-tag">Option B — script tag</DocsH2>
      <DocsP>
        Same no-React promise as the iframe, but the partner gets a real DOM
        node they size and position with their own CSS, plus a JS handle
        back:
      </DocsP>
      <DocsCodeBlock>{`
<div id="map" style="width:100%;height:480px"></div>
<script src="https://yourapp.vercel.app/embed.js"></script>
<script>
  const map = EthiMaps.render('#map', {
    apiKey: 'pk_live_...',
    buildingId: '11111111-1111-1111-1111-111111111111',
    onPoiClick: (poi) => console.log(poi.name),
  });
  // map.destroy() later if #map is removed from the page
</script>
      `}</DocsCodeBlock>
      <DocsP>
        <DocsInlineCode>embed.js</DocsInlineCode> is a self-contained bundle
        (React + the rendering internals) — nothing else to install on the
        partner's side.
      </DocsP>

      <DocsH2 id="option-c-npm">Option C — npm package (React apps)</DocsH2>
      <DocsP>
        For partners running React themselves, inside this repo today (see
        the Limitations section on the package's README for the npm-publish
        status):
      </DocsP>
      <DocsCodeBlock>{`
npm install @ethi/indoor-maps-sdk
      `}</DocsCodeBlock>
      <DocsCodeBlock>{`
import { IndoorMap } from '@ethi/indoor-maps-sdk';

<IndoorMap
  apiKey="pk_live_..."
  buildingId="11111111-1111-1111-1111-111111111111"
  onPoiClick={(poi) => console.log(poi.name)}
/>
      `}</DocsCodeBlock>
      <DocsP>
        No Supabase client, no auth flow to build. The map fills its
        container, so give the wrapping element an explicit height.
      </DocsP>

      <DocsH2 id="props">Component reference (Option C)</DocsH2>
      <DocsTable
        headers={['Prop', 'Type', 'Required', 'Notes']}
        rows={[
          [<DocsInlineCode>apiKey</DocsInlineCode>, 'string', 'Yes', 'Partner key scoped server-side to allowed buildings.'],
          [<DocsInlineCode>buildingId</DocsInlineCode>, 'string', 'Yes', 'Which building\'s venue graph to render.'],
          [<DocsInlineCode>floor</DocsInlineCode>, 'number', 'No', 'Which floor to open (defaults to the ground floor).'],
          [<DocsInlineCode>initialView</DocsInlineCode>, "'outdoor' | 'indoor'", 'No', 'Which side to open on (outdoor when the venue has a location).'],
          [<DocsInlineCode>mapStyle</DocsInlineCode>, "'standard' | 'satellite' | 'terrain'", 'No', "Defaults to 'standard'."],
          [<DocsInlineCode>route</DocsInlineCode>, '{ from, to }', 'No', 'Draws a straight line between two GPS points.'],
          [<DocsInlineCode>onPoiClick</DocsInlineCode>, '(poi) => void', 'No', 'Fires when a POI marker is tapped.'],
          [<DocsInlineCode>onNavigate</DocsInlineCode>, '(poi) => void', 'No', 'Replaces the default “Go” behaviour (opening the full app in a new tab for live turn-by-turn).'],
          [<DocsInlineCode>mainAppUrl</DocsInlineCode>, 'string', 'No', 'Where “Go” sends people; defaults to the app the embed is served from.'],
          [<DocsInlineCode>apiBaseUrl</DocsInlineCode>, 'string', 'No', 'Override the API endpoint (defaults to production).'],
          [<DocsInlineCode>onError</DocsInlineCode>, '(error) => void', 'No', 'error.message is safe to show end users.'],
        ]}
      />
      <DocsP>
        Options A and B accept the same parameters by name (<DocsInlineCode>key</DocsInlineCode>/<DocsInlineCode>apiKey</DocsInlineCode>,
        <DocsInlineCode>building</DocsInlineCode>/<DocsInlineCode>buildingId</DocsInlineCode>, <DocsInlineCode>floor</DocsInlineCode>,{' '}
        <DocsInlineCode>style</DocsInlineCode>/<DocsInlineCode>mapStyle</DocsInlineCode>, <DocsInlineCode>view</DocsInlineCode>/<DocsInlineCode>initialView</DocsInlineCode>, and <DocsInlineCode>from</DocsInlineCode>/<DocsInlineCode>to</DocsInlineCode> as <DocsInlineCode>lat,lng</DocsInlineCode> for a route) — as URL query params for the iframe, as an options object for the script tag.
      </DocsP>

      <DocsH3>Error codes</DocsH3>
      <DocsTable
        headers={['Status', 'Meaning']}
        rows={[
          ['401', 'Missing, invalid, or inactive API key'],
          ['403', 'Key is valid but not scoped to the requested building'],
          ['404', 'Unknown route — check apiBaseUrl'],
          ['500', 'Server-side data error'],
        ]}
      />

      <DocsH2 id="how-it-works">How it works</DocsH2>
      <DocsList>
        <DocsListItem>All three doors — the <DocsInlineCode>{"<IndoorMap />"}</DocsInlineCode> component, the <DocsInlineCode>/embed</DocsInlineCode> iframe page, and the <DocsInlineCode>embed.js</DocsInlineCode> script loader — call the same Supabase Edge Function (<DocsInlineCode>indoor-maps-api</DocsInlineCode>).</DocsListItem>
        <DocsListItem>The function checks the <DocsInlineCode>x-api-key</DocsInlineCode> header against <DocsInlineCode>partner_keys</DocsInlineCode>, confirms it's scoped to the requested building, then reads the venue’s published data (floors, places, paths and outdoor graph) with a service-role client.</DocsListItem>
        <DocsListItem>It reshapes that into a stable public JSON contract — never raw table rows.</DocsListItem>
        <DocsListItem>Each door adapts that response and renders it with the same map renderers the main app uses — the outdoor map and the indoor floor plan. “Go” opens the full app for live turn-by-turn.</DocsListItem>
      </DocsList>

      <DocsH2 id="limitations">Limitations (today)</DocsH2>
      <DocsCallout tone="warning">
        <DocsList>
          <DocsListItem><strong>Routes are straight lines</strong>, not real routed paths — <DocsInlineCode>route</DocsInlineCode> doesn't call the app's actual pathfinding engine.</DocsListItem>
          <DocsListItem><strong>No rate limiting</strong> on the Edge Function yet — only manual key revocation.</DocsListItem>
          <DocsListItem><strong>Option C only builds from within this repo</strong> — the npm package isn't published standalone yet.</DocsListItem>
        </DocsList>
      </DocsCallout>

      <DocsP>
        Full setup steps (migrations, deploying the function, generating
        keys) and the complete type reference live alongside the package
        source at <DocsInlineCode>packages/indoor-maps-sdk/INTEGRATION.md</DocsInlineCode>{' '}
        and <DocsInlineCode>packages/indoor-maps-sdk/API.md</DocsInlineCode>.
      </DocsP>
    </DocsSection>
  </DocsShell>
);

export default DocsApi;
