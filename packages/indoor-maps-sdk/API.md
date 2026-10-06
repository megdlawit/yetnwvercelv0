# API Reference — @ethi/indoor-maps-sdk

## `<IndoorMap />`

The only component partners need.

```tsx
import { IndoorMap } from '@ethi/indoor-maps-sdk';
```

### Props

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `apiKey` | `string` | ✅ | — | Partner API key. Scoped server-side to `allowed_building_ids`; see `INTEGRATION.md` §1c. |
| `buildingId` | `string` | ✅ | — | Which building's venue graph to render. |
| `floor` | `number` | | `0` | **Currently a no-op.** Accepted for forward-compatibility with the future indoor floor-plan integration; today's outdoor venue graph has no floor concept. Don't build UI around this yet. |
| `mapStyle` | `'standard' \| 'satellite' \| 'terrain'` | | `'standard'` | Base map visual style. Mirrors the main app's `MapTypeSwitcher`. |
| `route` | `{ from: GeoCoord; to: GeoCoord }` | | — | Draws a straight line between two GPS points. Not routed via the app's real pathfinding — see `INTEGRATION.md` §4. |
| `apiBaseUrl` | `string` | | production Edge Function URL | Override for local dev / staging against a different Supabase project. |
| `onPoiClick` | `(poi: IndoorMapPoi) => void` | | — | Fired when a POI marker is tapped. |
| `onError` | `(error: Error) => void` | | — | Fired on network failure or a non-2xx API response. `error.message` is safe to show to end users. |
| `className` | `string` | | — | Applied to the outer wrapping `<div>`. |
| `style` | `React.CSSProperties` | | — | Applied to the outer wrapping `<div>`. The map fills its container — give the container an explicit height. |

### Behavior notes

- Renders a centered `"Loading map…"` placeholder while the graph fetches,
  and a red error placeholder (using `error.message` or `"Map unavailable"`)
  if the fetch fails. Both respect `className`/`style` sizing.
- Re-fetches automatically whenever `apiKey`, `buildingId`, `floor`, or
  `apiBaseUrl` change (aborts the in-flight request first).
- The map itself is `VenueMapRenderer` under the hood, so it supports pan,
  zoom, and the same interaction model as the main app's outdoor map — POI
  taps, route line rendering, style switching.

## Types

All exported from the package root (`import type { ... } from '@ethi/indoor-maps-sdk'`).

### `GeoCoord`

```ts
interface GeoCoord {
  lat: number;
  lng: number;
}
```

### `IndoorMapPoiCategory`

```ts
type IndoorMapPoiCategory = 'retail' | 'attraction' | 'service' | 'education';
```

### `IndoorMapPoi`

```ts
interface IndoorMapPoi {
  id: string;
  name: string;
  description: string;
  category: IndoorMapPoiCategory;
  lat: number | null;
  lng: number | null;
  imageUrl?: string | null;
}
```

### `IndoorMapNode`

```ts
interface IndoorMapNode {
  id: string;
  lat: number;
  lng: number;
  kind: 'junction' | 'entrance' | 'landmark';
}
```

### `IndoorMapPath`

```ts
interface IndoorMapPath {
  id: string;
  fromId: string;
  toId: string;
  pathType: 'main' | 'secondary' | 'steps';
  distanceM: number; // haversine distance, computed server-side
}
```

### `IndoorMapGraph`

The raw shape returned by the Edge Function (you generally won't touch
this directly unless you're calling `fetchBuildingGraph` yourself):

```ts
interface IndoorMapGraph {
  buildingId: string;
  floor: number;
  nodes: IndoorMapNode[];
  paths: IndoorMapPath[];
  pois: IndoorMapPoi[];
}
```

### `IndoorMapRoute`

```ts
interface IndoorMapRoute {
  from: GeoCoord;
  to: GeoCoord;
}
```

### `IndoorMapStyle`

```ts
type IndoorMapStyle = 'standard' | 'satellite' | 'terrain';
```

## Low-level: `fetchBuildingGraph`

Exposed in case you want to fetch the graph yourself (e.g. server-side, or
to build a custom renderer instead of using `<IndoorMap />`):

```ts
import { fetchBuildingGraph, IndoorMapApiError } from '@ethi/indoor-maps-sdk';

const graph = await fetchBuildingGraph({
  apiKey: 'pk_live_...',
  buildingId: '11111111-1111-1111-1111-111111111111',
  floor: 0,          // optional
  apiBaseUrl: '...', // optional, defaults to the production Edge Function
  signal: controller.signal, // optional, for cancellation
});
```

Throws `IndoorMapApiError` (has `.status` and `.message`) on any non-2xx
response — `401` for a missing/invalid/inactive key, `403` if the key
isn't scoped to the requested `buildingId`, `404` for an unknown route,
`500` for a server-side data error.

## Error reference

| Status | Meaning | Likely fix |
|---|---|---|
| 401 | Missing `x-api-key` header, or the key doesn't match any row in `partner_keys`, or `is_active = false` | Check the key was copied correctly; check it hasn't been revoked |
| 403 | Key exists and is active, but `allowed_building_ids` doesn't include the requested `buildingId` | Add the building to that key's allow-list, or use a different key |
| 404 | Wrong path — only `GET /buildings/:id/graph` exists | Check `apiBaseUrl` isn't pointing somewhere stale |
| 500 | The Edge Function's Supabase queries failed | Check Supabase project health / RLS hasn't been changed to block the service-role client (it shouldn't) |

## Multi-floor venues

`GET /buildings/:id/graph` now also returns `venue` for buildings with floor plans:

```jsonc
{
  "venue": {
    "pxPerMeter": 40,                       // plan units per metre
    "floors": [{
      "id": "…", "level": 0, "name": "Ground floor",
      "bounds": { "minX": 0, "minY": 0, "maxX": 960, "maxY": 560 },
      "nodes": [{ "id": "…", "name": "Café", "x": 400, "y": 120, "isHallway": false }],
      "edges": [{ "id": "…", "fromNodeId": "…", "toNodeId": "…", "weight": 160 }],
      "rooms": [{ "id": "…", "name": "Café", "type": "office", "nodeId": "…", "outline": [[0, 0], [400, 0], [400, 240], [0, 240]] }],
      "walls": [[0, 0, 960, 0]],
      "features": [{ "id": "…", "kind": "door", "x": 460, "y": 240, "rotationDeg": 0, "width": null, "depth": null, "label": null }]
    }],
    "connections": [
      { "id": "…", "fromNodeId": "…", "toNodeId": "…", "fromLevel": 0, "toLevel": 1, "kind": "elevator", "accessible": true }
    ]
  }
}
```

`schematic` (the single requested floor) is unchanged, so existing integrations keep working.

## Routing

`GET /buildings/:id/route?from=<placeId>&to=<placeId>&stepFree=1`

Walking directions between two places (node ids from `venue.floors[].nodes`), across floors if needed. `stepFree=1` avoids stairs and escalators and uses lifts and ramps instead. Unpublished venues return 404.

```jsonc
{
  "found": true,
  "path": [{ "placeId": "…", "floorLevel": 0, "x": 400, "y": 120 }],
  "steps": [{ "text": "Take the elevator up to First floor", "metres": 0, "floorLevel": 0, "icon": "floor" }],
  "metres": 37,
  "minutes": 2
}
```

From the SDK:

```ts
import { fetchBuildingGraph, fetchRoute } from '@ethi/indoor-maps-sdk';

const graph = await fetchBuildingGraph({ apiKey, buildingId });
const route = await fetchRoute({ apiKey, buildingId, from: cafeId, to: galleryId, stepFree: true });
```

The `<IndoorMap>` widget shows a floor switcher for buildings with more than one floor.
