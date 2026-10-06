# @ethi/indoor-core

The indoor engine shared by the visitor app, the admin console and the SDK:
one metre-based venue model, a 3D renderer, routing, turn-by-turn guidance
(English and Amharic, spoken), position sources and plan checks. Framework-free
(React binding in `@ethi/indoor-core/react`), no globals, peer dependency: `three`.

## The pieces

| Module | What it does |
| --- | --- |
| `model.ts` | The venue in metres (x right, z down the plan, y up): floors, walls, openings (door / arch / window), rooms, stairs & lifts, places, path graph. |
| `normalize.ts` | `fromPlan(rows)` — editor / CAD venues (plan px, 40 px = 1 m). `fromGeo(rows)` — venues drawn in lat/lng. Snaps loose doors onto walls, stacks floors, works out stairs nobody drew. |
| `path3d.ts` | A route as a 3D line: up the real stairs, floor flips half way up. |
| `nav/router.ts` | A* over walking time, multi-floor, step-free option. |
| `nav/steps.ts`, `nav/i18n.ts` | Turn-by-turn steps and every word in English and Amharic (keys, no inline strings). |
| `nav/session.ts` | Progress, next turn, distance and ETA, floor, off-route detection and rerouting, announcements, arrival. |
| `nav/positioning.ts` | `SimulatedWalk` (demos), `PDRSource` (phone steps + compass), `parseQrAnchor` (QR calibration). |
| `nav/voice.ts` | Speech: Amharic voice when the device has one, otherwise a chime and the words on screen. |
| `render/viewer.ts` | `IndoorViewer3D`: extruded walls with real openings, slabs with stairwells, ceilings, parametric stairs and lifts, scenery; floors built lazily and faded; overview / top / follow / walk cameras; route ribbon with chevrons; labels; picking. |
| `render/hud.ts`, `mount.ts` | The guidance HUD and `mountNavigation()` — the whole experience in one call. |
| `validate.ts` | Plan checks for the editor: unclosed rooms, doors off walls, disconnected paths, stairs to nowhere. |

## Use

```ts
import { fromPlan, mountNavigation } from '@ethi/indoor-core';

const venue = fromPlan(rows);                       // floors, walls, rooms, map_features, nodes, edges, pois
const nav = mountNavigation(element, { venue, from: entranceNodeId, to: cafeNodeId, lang: 'am', position: 'simulate' });
nav.setLang('en');
nav.scanQr('https://…/venue/b1?entry=main-entrance');
nav.destroy();
```

Just the 3D building: `new IndoorViewer3D(element, { venue })`; with React:
`<IndoorViewer3DView venue={venue} route={path} position={pose} />`.

## Tests

`npx vitest run packages/indoor-core` — model, stairs and floor switching,
routing (step-free), steps in both languages, rerouting, PDR, QR, plan checks.
