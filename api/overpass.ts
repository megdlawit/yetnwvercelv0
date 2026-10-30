import type { IncomingMessage, ServerResponse } from 'http';
/** What Vercel's Node runtime passes in: Node's request/response plus the parsed body and query. */
type ApiRequest = IncomingMessage & { body?: unknown; query?: Record<string, string | string[] | undefined> };
type ApiResponse = ServerResponse;


// Proxy for Overpass requests. Adds CORS headers and forwards the incoming
// POST body to a live Overpass mirror. This lets the browser call
// `/api/overpass` without running into CORS restrictions.
//
// This used to forward to a single hardcoded mirror. That made the proxy
// only as reliable as whichever one instance OVERPASS_ENDPOINT pointed at —
// if that mirror rate-limited or was slow to respond to Vercel's IP, every
// request failed even though the other public mirrors were fine. We now
// race all of them here, server-side, and forward whichever one answers
// first with actual data. Racing from Vercel (fast, stable networking)
// instead of from the end user's device also means mirror flakiness no
// longer compounds with a user's own slow/unreliable mobile connection.

const MIRRORS = (process.env.OVERPASS_ENDPOINT
  ? [process.env.OVERPASS_ENDPOINT]
  : []
).concat([
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
]);

// Kept comfortably under Vercel's default 10s serverless function limit
// (Hobby plan) even though every mirror is raced in parallel, not chained.
const MIRROR_TIMEOUT_MS = 8_000;

function setCorsHeaders(res: ApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

interface MirrorResult {
  status: number;
  contentType: string;
  text: string;
  hasElements: boolean;
}

async function fetchMirror(url: string, body: string): Promise<MirrorResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body || '',
      signal: controller.signal,
    });
    const text = await resp.text();
    let hasElements = false;
    if (resp.ok) {
      try {
        const parsed = JSON.parse(text);
        hasElements = Array.isArray(parsed.elements) && parsed.elements.length > 0;
      } catch {
        // Non-JSON (e.g. an HTML rate-limit page) — treat as no data below.
      }
    }
    return {
      status: resp.status,
      contentType: resp.headers.get('content-type') || 'application/json',
      text,
      hasElements,
    };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    // Read raw body (works whether Vercel/Next parsed it or not)
    const rawBody = await new Promise<string>((resolve, reject) => {
      if (req.body && typeof req.body === 'string') return resolve(req.body as string);
      if (req.body && Object.keys(req.body).length) return resolve(typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body));
      let data = '';
      (req as IncomingMessage).on('data', (chunk) => (data += chunk));
      (req as IncomingMessage).on('end', () => resolve(data));
      (req as IncomingMessage).on('error', reject);
    });

    // If the client sent nothing, allow a query via ?q= or ?data=
    let body = rawBody;
    if (!body) {
      const q = (req.query && (req.query.q || req.query.data)) || '';
      body = q ? String(q) : '';
    }

    const results = await Promise.allSettled(MIRRORS.map((url) => fetchMirror(url, body)));

    // Prefer a mirror that actually returned routable data. A mirror can
    // respond 200 with a well-formed but empty `elements: []` — that's
    // Overpass correctly saying "nothing matched here", not a failure, but
    // it's not useful to prefer over a different mirror that *did* find
    // data for the same bbox (transient indexing lag, differing mirror
    // freshness, etc).
    const withData = results.find(
      (r): r is PromiseFulfilledResult<MirrorResult> => r.status === 'fulfilled' && r.value.status === 200 && r.value.hasElements
    );
    if (withData) {
      res.statusCode = 200;
      res.setHeader('Content-Type', withData.value.contentType);
      res.end(withData.value.text);
      return;
    }

    // No mirror had data. Fall back to the first well-formed 200 (an
    // honest "no ways here" answer) so the client's own empty-result
    // handling applies, otherwise the first response of any kind so the
    // client at least sees a real status code instead of a generic 500.
    const okEmpty = results.find(
      (r): r is PromiseFulfilledResult<MirrorResult> => r.status === 'fulfilled' && r.value.status === 200
    );
    const anyResponse = results.find((r): r is PromiseFulfilledResult<MirrorResult> => r.status === 'fulfilled');
    const chosen = okEmpty ?? anyResponse;

    if (chosen) {
      res.statusCode = chosen.value.status;
      res.setHeader('Content-Type', chosen.value.contentType);
      res.end(chosen.value.text);
      return;
    }

    // Every mirror rejected (timeout/network error).
    const firstError = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason;
    console.error('[api/overpass] all mirrors failed', firstError);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'all Overpass mirrors failed', detail: String(firstError) }));
  } catch (e) {
    console.error('[api/overpass] proxy error', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e) }));
  }
}
