// Proxy for OSRM routing requests — used for long-distance street routing
// (e.g. walking or driving to Unity Park from elsewhere in the city), where
// the local Overpass+Dijkstra graph (see OutdoorMapEngine / MAX_ROUTE_SPAN_M)
// would mean fetching and solving a city-scale graph client-side. OSRM
// already maintains a routable street network for the whole region.
//
// Mirrors api/overpass.ts's approach: race public instances server-side and
// forward whichever answers first with a real route, adding CORS so the
// browser can call `/api/osrm` directly without hitting cross-origin
// restrictions on the public OSRM servers.

// The public demo at router.project-osrm.org only serves the `driving`
// profile — there's no public "foot" demo instance there. routing.
// openstreetmap.de runs a separate routed-foot deployment that does
// support walking, so it's the primary (and, for foot, only) mirror;
// project-osrm.org is kept as a second opinion for car routing only.
//
// routed-foot is raced under *both* URL profile names: some FOSSGIS OSRM
// deployments only accept the literal "driving" segment in the URL path
// even though the backend itself is compiled with the foot profile (the
// REST layer's profile-name check doesn't necessarily match how the
// server was built) — using only "/foot/" 400s on those and every
// long-range route silently falls through to the direct-line fallback.
// Racing both means whichever one the server actually accepts just works,
// without needing to know which quirk this particular deployment has.
const FOOT_MIRRORS = [
  'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
];
const CAR_MIRRORS = [
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  'https://router.project-osrm.org/route/v1/driving',
];

// Kept comfortably under Vercel's default 10s serverless function limit
// (Hobby plan) even with mirrors raced in parallel, not chained.
const MIRROR_TIMEOUT_MS = 8_000;

function setCorsHeaders(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

interface MirrorResult {
  status: number;
  text: string;
  isOk: boolean;
}

async function fetchMirror(base: string, coords: string): Promise<MirrorResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);
  try {
    const url = `${base}/${coords}?overview=full&geometries=geojson`;
    const resp = await fetch(url, { signal: controller.signal });
    const text = await resp.text();
    let isOk = false;
    if (resp.ok) {
      try {
        isOk = JSON.parse(text)?.code === 'Ok';
      } catch {
        // Non-JSON — treated as not-ok below.
      }
    }
    return { status: resp.status, text, isOk };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    // Don't rely on req.query — Vercel's Node runtime populates it, but the
    // Vite dev middleware (see vite.config.ts) hands this handler a raw
    // http.IncomingMessage with no query parsing at all, so req.query is
    // always undefined there and every request 400'd on "missing coords"
    // before ever reaching OSRM. Parsing req.url directly works in both.
    const parsedUrl = new URL(req.url, 'http://internal');
    const profile = parsedUrl.searchParams.get('profile') === 'car' ? 'car' : 'foot';
    const coords = parsedUrl.searchParams.get('coords') || '';
    if (!coords) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'missing coords' }));
      return;
    }
    const mirrors = profile === 'car' ? CAR_MIRRORS : FOOT_MIRRORS;

    const results = await Promise.allSettled(mirrors.map((base) => fetchMirror(base, coords)));

    // Prefer a mirror that actually found a route.
    const withRoute = results.find(
      (r): r is PromiseFulfilledResult<MirrorResult> => r.status === 'fulfilled' && r.value.isOk
    );
    if (withRoute) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(withRoute.value.text);
      return;
    }

    // No mirror found a route — fall back to the first well-formed response
    // (an honest "no route" answer) so the client's own handling applies,
    // otherwise any response at all so it sees a real status instead of a
    // generic failure.
    const anyOk = results.find(
      (r): r is PromiseFulfilledResult<MirrorResult> => r.status === 'fulfilled' && r.value.status === 200
    );
    const anyResponse = results.find((r): r is PromiseFulfilledResult<MirrorResult> => r.status === 'fulfilled');
    const chosen = anyOk ?? anyResponse;

    if (chosen) {
      res.statusCode = chosen.value.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(chosen.value.text);
      return;
    }

    const firstError = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason;
    console.error('[api/osrm] all mirrors failed', firstError);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'all OSRM mirrors failed', detail: String(firstError) }));
  } catch (e: any) {
    console.error('[api/osrm] proxy error', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: String(e) }));
  }
}
