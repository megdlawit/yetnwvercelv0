# @ethi/indoor-maps-sdk

Drop-in map widget for internal apps and partners.

```tsx
import { IndoorMap } from '@ethi/indoor-maps-sdk';

<IndoorMap
  apiKey="pk_live_..."
  buildingId="11111111-1111-1111-1111-111111111111"
  onPoiClick={(poi) => console.log(poi.name)}
/>
```

## No React? Use the iframe embed instead

Not every partner runs React. For those, point an `<iframe>` at the app's
`/embed` route — no npm install, no build step, works on any website:

```html
<iframe
  src="https://yourapp.vercel.app/embed?key=pk_live_...&building=unity-park"
  style="width:100%;height:480px;border:0"
  loading="lazy"
></iframe>
```

This is the *same* `<IndoorMap>` component and the *same* partner-key check
as the React SDK below — just served as a page instead of a package. Same
key, same revocation, same `allowed_building_ids` scoping. See
`src/pages/Embed.tsx` in the main app.

## No React, want more control than an iframe? Script-tag loader

Same idea as the iframe, but the partner gets a real DOM node they can size
and position with their own CSS, and a JS handle back (`destroy()`):

```html
<div id="map" style="width:100%;height:480px"></div>
<script src="https://yourapp.vercel.app/embed.js"></script>
<script>
  const map = EthiMaps.render('#map', {
    apiKey: 'pk_live_...',
    buildingId: 'unity-park',
    onPoiClick: (poi) => console.log(poi.name),
  });
  // map.destroy() later if #map is removed from the page
</script>
```

`embed.js` is a self-contained bundle (React + the SDK internals) built from
`src/embed-loader.tsx` via `npm run build:embed` — see `vite.embed.config.ts`.
It runs automatically as part of `npm run build`, so it can never go stale on
deploy. To test it locally: `npm run build:embed`, then open a plain HTML
file (via `npm run dev`'s static server, or any local server) pointing
`<script src="/embed.js">` at `http://localhost:8080/embed.js`.

📖 **[INTEGRATION.md](./INTEGRATION.md)** — step-by-step: run the migration,
deploy the Edge Function, issue a partner key, embed the component.

📖 **[API.md](./API.md)** — full prop reference, exported types, error codes.

## New in v0.2: the 3D building with turn-by-turn guidance

`<IndoorMap3D>` renders any published venue as an explorable 3D building —
walls with real door and window openings, floors, ceilings, stairs the route
actually climbs — and, given two places, guides the visitor there: route
ribbon with gliding chevrons, next-turn card with distance and ETA, a floor
indicator that flips as they climb, spoken instructions in English or
Amharic, off-route rerouting and an arrival moment. Same engine as the
visitor app (`@ethi/indoor-core`); everything stays inside the component's
own element. Peer dependencies: `react`, `react-dom`, `three`.

```tsx
import { IndoorMap3D } from '@ethi/indoor-maps-sdk';

<IndoorMap3D
  apiKey="pk_live_..."
  buildingId="unity-park"
  from="<entrance node id>" to="<place node id>"   // optional: without them, just explore
  lang="am"                                       // 'en' | 'am'
  stepFree                                        // lifts and ramps only
  position="simulate"                             // 'simulate' (demo) | 'pdr' (phone steps) | 'external'
  onReady={nav => { /* nav.setLang('en'), nav.scanQr(code), nav.pushFix(fix) */ }}
/>
```

No React? `embed.js` has it too:

```html
<script src="https://yourapp.vercel.app/embed.js"></script>
<script>
  EthiMaps.render3D('#map', { apiKey: 'pk_live_...', buildingId: 'unity-park', from: '…', to: '…', lang: 'am' })
    .then(nav => { /* nav.destroy() later */ });
</script>
```

The API's venue payload gained the 3D details additively (`walls3d`, door /
window anchoring, stairs' floors and steps, Amharic names); v0.1 widgets keep
working unchanged.

## What this covers today (v0.1, outdoor venue graph)

This renders the **outdoor GPS venue graph** — `venue_nodes` / `venue_paths` /
GPS-anchored `pois` — via your existing `VenueMapRenderer`. Good for
campus/park-style "walk between buildings" maps.

It does **not** yet cover the pixel-based **indoor floor plan** system
(`FloorMap.tsx` + `floors` / `nodes` / `rooms`, isometric room rendering).
That's a separate, meatier integration — say the word and we'll scaffold a
`floor` prop + adapter for it the same way.

## Setup

Quick version:

1. **Run the migrations**: `supabase/migrations/*_partner_keys*.sql` creates
   the `partner_keys` table and its RLS policies.
2. **Deploy the Edge Function**: `supabase functions deploy indoor-maps-api --no-verify-jwt`
3. **Generate a key from `/admin`** — Buildings tab → the `</>` icon on a
   building's card (or the Embed tab) → type a partner name → Generate.
   Both the iframe and script-tag snippets appear with the key already
   filled in, ready to copy. No SQL needed for day-to-day onboarding.
4. Copy the snippet that matches the partner (iframe / script-tag / React
   props) and send it to them.

Full walkthrough (what each door is for, what to send a partner, testing
your own integration first): **[INTEGRATION.md](./INTEGRATION.md)**.

## Known limitations (read before onboarding a partner)

- **No floor support yet.** The `floor` prop exists but is currently a
  no-op — this covers the outdoor venue graph only, which has no floor
  concept. Don't promise floor-switching.
- **Routes are straight lines**, not real routed paths. `route={{from,to}}`
  draws a line between two GPS points; it doesn't call the app's actual
  pathfinding (`HybridNavigationBrain`, Overpass fallback, etc).
- **No rate limiting** on the Edge Function yet — each `partner_keys` row
  can be deactivated (`is_active = false`) but isn't currently throttled.
- **CORS is wide open** (`Access-Control-Allow-Origin: *`) since the API
  key is the actual gate. Tighten this in `supabase/functions/indoor-maps-api/index.ts`
  if you want origin-level restriction too.

See [API.md](./API.md) for the full error-code reference and prop docs.

## Why an Edge Function instead of hitting Supabase directly?

The SDK never ships your Supabase URL or anon key. It only ever calls
`indoor-maps-api` with a partner-scoped key, which is validated server-side
and can be revoked/rotated/rate-limited independently of your main app's
auth. This also means internal schema changes (column renames, new tables)
don't break partner integrations — only `types.ts` and the Edge Function's
response mapping need to stay in sync.

## Phase 1 → Phase 2: done (not yet published)

The rendering internals (`VenueMapRenderer`, `BaseMap`, `BlueDot`,
`CustomLayerRenderer`, POI/geo helpers) have been copied into this
package's own `src/internal/` — no more relative imports back into the
main app's `src/`. `npm run build` (tsup) produces a real standalone
`dist/` — ESM, CJS, and `.d.ts` — verified to build clean.

What's *not* done yet: this hasn't been `npm publish`ed anywhere. Today
it's buildable and installable from a local path/tarball, but not
`npm install @ethi/indoor-maps-sdk`-able from outside this machine. When
you're ready to actually hand it to an external partner's separate repo:

```bash
cd packages/indoor-maps-sdk
npm run build
npm publish --access public   # or npm pack to test the tarball first
```