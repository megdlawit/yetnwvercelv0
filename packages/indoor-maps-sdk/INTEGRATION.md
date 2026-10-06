# Integration Guide — @ethi/indoor-maps-sdk

This is the step-by-step guide for getting a partner or internal app from
zero to a rendered map. For the prop-by-prop reference, see
[`API.md`](./API.md). For what this package does and doesn't cover yet, see
[`README.md`](./README.md).

## 1. One-time backend setup (you, the platform owner, do this once)

These three steps only need to happen once per Supabase project — not once
per partner.

### 1a. Run the migrations

```bash
supabase migration up
```

This applies two files:

- `20260706123220_partner_keys.sql` — creates the `partner_keys` table
- `20260727090000_partner_keys_rls.sql` — adds RLS policies for it

Note: `partner_keys` is **not** locked to service-role only. It uses the
same permissive `anon`/`authenticated` policy pattern as every other
admin-managed table in this app (`buildings`, `pois`, etc.) — see the
comment at the top of the RLS migration. That's what lets the admin panel
(§1c below) read/generate keys directly with the public anon key. The
actual security boundary partners hit is the Edge Function's own key check
(§1b) — partners never get a Supabase credential of any kind, only an
`api_key` value.

### 1b. Deploy the Edge Function

```bash
supabase functions deploy indoor-maps-api
```

This deploys `supabase/functions/indoor-maps-api/index.ts`, which is the
**only** network endpoint the SDK ever calls. It validates the partner's
key, checks it against `allowed_building_ids`, then reads `venue_nodes` /
`venue_paths` / `pois` with the service-role client and returns a
purpose-built shape (see `types.ts`) — never raw table rows, and never your
Supabase URL or anon key.

### 1c. Issue a key per partner

Use the admin panel — no SQL needed:

- **From a specific building**: `/admin` → Buildings tab → click the
  <kbd>&lt;/&gt;</kbd> icon on that building's card → "Get embed code"
- **From scratch**: `/admin` → Embed tab → pick the building first

Either way: type the partner's name, hit **Generate key**, and both the
iframe snippet and the script-tag snippet appear with the real key and
`buildingId` already filled in, plus a Copy button on each. That snippet
*is* what you send the partner — see §2.

(Fallback, if you ever need to do this outside the admin UI — e.g. a
scripted onboarding — the equivalent raw SQL is:

```sql
insert into public.partner_keys (partner_name, api_key, allowed_building_ids)
values (
  'acme-corp',
  'pk_live_' || encode(gen_random_bytes(24), 'hex'),
  array['11111111-1111-1111-1111-111111111111'] -- null/empty = unrestricted
);
```

but the admin UI is the normal path now.)

To revoke a key later (compromised, contract ended, etc.), flip
`is_active` to `false` on its `partner_keys` row (via SQL, or add an admin
control for this if it becomes a frequent need). Takes effect immediately
since the Edge Function checks it on every request.

## 2. What you hand the partner

Depends which door fits them — the admin panel generates the exact snippet
for whichever one you pick, so you're just copying, not writing this by
hand:

1. **No code at all** → the iframe snippet (Option A in the admin dialog).
   They paste an `<iframe>` tag. Done.
2. **Wants their own CSS/positioning, still no React** → the script-tag
   snippet (Option B). They paste a `<div>` + two `<script>` tags.
3. **Runs React themselves** → the npm package (below). Give them the
   `api_key` and `buildingId` shown in the admin dialog; they write the
   `<IndoorMap>` JSX themselves. Only relevant if they're inside this repo
   today — see the "Phase 1 vs Phase 2" note in the README for why external
   npm installs don't work yet.

For (1) and (2) there's nothing else to send — the snippet is fully
self-contained. For (3), send the `api_key` + `buildingId` alongside the
example below.

## 3. What the partner does (React/npm door only)

If they're not using React, skip this — the iframe or script-tag snippet
from the admin panel is already everything they need.

```bash
npm install @ethi/indoor-maps-sdk
```

```tsx
import { IndoorMap } from '@ethi/indoor-maps-sdk';

function VenuePage() {
  return (
    <div style={{ height: 480 }}>
      <IndoorMap
        apiKey={process.env.NEXT_PUBLIC_ETHI_API_KEY!}
        buildingId="11111111-1111-1111-1111-111111111111"
        onPoiClick={(poi) => console.log('tapped', poi.name)}
      />
    </div>
  );
}
```

That's it — no Supabase client, no auth setup on their end. The `apiKey`
is safe to ship in a client bundle: it's scoped server-side to specific
buildings, rate-limited (see §5), and revocable independently of any of
your own users' credentials.

## 4. Rendering a route

Pass a `route` prop with two GPS coordinates to draw a line between them:

```tsx
<IndoorMap
  apiKey={apiKey}
  buildingId={buildingId}
  route={{
    from: { lat: 9.0234, lng: 38.7468 },
    to:   { lat: 9.0251, lng: 38.7481 },
  }}
/>
```

This draws a straight line today — it does **not** call the app's
turn-by-turn routing engine (`HybridNavigationBrain`, Dijkstra pathfinding,
Overpass fallback, etc.). That routing stack stays internal; the SDK is a
rendering surface, not a routing service. If a partner needs real routed
directions (not just a straight line), that's a Phase 2 conversation — see
the Roadmap in the README.

## 5. Operational notes

- **CORS**: the Edge Function allows all origins today (`Access-Control-
  Allow-Origin: *`) since it's already gated by the API key. Tighten this
  to specific partner origins in `index.ts` if you want defense-in-depth.
- **Rate limiting**: not implemented in the Edge Function yet. If a
  partner's traffic needs a cap, add a request-count check against
  `partner_keys` (e.g. a `requests_today` column + reset trigger) before
  publishing this widely.
- **Floors**: the `floor` prop exists on `IndoorMapProps` but is currently
  a no-op — see the README's "What this covers today" section. Don't
  advertise floor-switching to partners until Phase 2 lands.
- **Errors**: `onError` fires for both network failures and API errors
  (invalid key, building not allowed, etc.) — the `Error.message` is
  whatever the Edge Function returned, safe to show to end users.

## 6. Testing your own integration before onboarding partners

```bash
cd packages/indoor-maps-sdk
npm run typecheck
```

Then run the app locally, generate yourself a test key from `/admin` (see
§1c), and either:

- open `http://localhost:8080/embed?key=...&building=...` directly (the
  iframe door), or
- drop `<IndoorMap apiKey="..." buildingId="..." />` into any page (the
  React door)

to confirm the Edge Function round-trip works end-to-end before handing
credentials to an external partner.
