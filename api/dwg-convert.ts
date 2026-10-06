// api/dwg-convert.ts
//
// POST /api/dwg-convert   body: { dwgBase64: string, fileName?: string }
// → { dxfText: string }
//
// Why this file exists at all: DWG is AutoCAD's native format, and unlike
// DXF it's binary and was never fully published by Autodesk. There is no
// safe, legal, pure-JS/Node DWG reader — the only options are the
// GPL-licensed LibreDWG C library (not an npm package, can't run in a
// Vercel function), Autodesk's own Platform Services API, or a hosted
// conversion API. This uses CloudConvert because it needs nothing more
// than an API key and a fetch call — no binary, no native build step,
// which matters for staying inside a Vercel serverless function.
//
// *** THIS FILE IS UNVERIFIED. *** I wrote it against CloudConvert's
// documented v2 REST API shape, but this sandbox has no network access to
// cloudconvert.com, so I could not actually run a conversion end to end
// the way parseDxf.ts / dxfToVenue.ts / generatePathGraph.ts were tested.
// Before relying on it: get a CloudConvert API key (they have a free tier,
// https://cloudconvert.com/api/v2), set CLOUDCONVERT_API_KEY in your Vercel
// env, and test with one real DWG file end to end. If CloudConvert has
// changed their task/job shape since this was written, the error message
// from their API will show up directly in the response — check that first.
//
// The free, zero-dependency alternative that needs none of this: in
// AutoCAD, File → Save As → "AutoCAD DXF (*.dxf)" — one click, no API key,
// and it's what I'd actually recommend leading with in the product UI.
// This endpoint exists for the "upload literally any CAD export" case.
//
// Flow: upload the DWG to CloudConvert → convert task (dwg → dxf) →
// export/url task → download the result → return its text. All four
// CloudConvert steps happen inside this one request, so it's slow (expect
// several seconds to tens of seconds depending on file size) — the client
// should show a spinner, not a tight timeout.

import type { IncomingMessage } from 'http';

function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Same dual-environment body reader as api/dxf-import.ts / api/overpass.ts —
// see the comment there. Needed here too since this is also a POST with a
// JSON body, and `vite dev` doesn't pre-parse it the way Vercel does.
async function readJsonBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const raw: string = await new Promise((resolve, reject) => {
    let data = '';
    (req as IncomingMessage).on('data', (chunk) => (data += chunk));
    (req as IncomingMessage).on('end', () => resolve(data));
    (req as IncomingMessage).on('error', reject);
  });
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

const CLOUDCONVERT_API = 'https://api.cloudconvert.com/v2';
const MAX_DWG_BYTES = 20 * 1024 * 1024;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 55000; // stay under typical serverless function limits

async function cc(path: string, apiKey: string, init?: RequestInit) {
  const resp = await fetch(`${CLOUDCONVERT_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`CloudConvert ${path} failed: ${resp.status} ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'POST only' })); return; }

  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  if (!apiKey) {
    res.statusCode = 501;
    res.end(JSON.stringify({
      error: 'DWG conversion is not configured on this server.',
      hint: 'Set CLOUDCONVERT_API_KEY, or just export the file as DXF from AutoCAD (File → Save As → AutoCAD DXF) and upload that instead — no conversion step needed.',
    }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    const { dwgBase64, fileName = 'upload.dwg' } = body || {};
    if (!dwgBase64 || typeof dwgBase64 !== 'string') {
      res.statusCode = 400; res.end(JSON.stringify({ error: 'dwgBase64 is required (base64-encoded DWG file contents, no data: prefix)' })); return;
    }
    const buf = Buffer.from(dwgBase64, 'base64');
    if (buf.byteLength > MAX_DWG_BYTES) {
      res.statusCode = 413; res.end(JSON.stringify({ error: `DWG too large (max ${MAX_DWG_BYTES} bytes)` })); return;
    }

    // 1. Create a job: import/upload -> convert (dwg->dxf) -> export/url
    const job = await cc('/jobs', apiKey, {
      method: 'POST',
      body: JSON.stringify({
        tasks: {
          'import-file': { operation: 'import/upload' },
          'convert-file': { operation: 'convert', input: 'import-file', input_format: 'dwg', output_format: 'dxf' },
          'export-file': { operation: 'export/url', input: 'convert-file' },
        },
      }),
    });

    const importTask = job.data.tasks.find((t: any) => t.name === 'import-file');
    const uploadUrl = importTask?.result?.form?.url;
    const uploadParams = importTask?.result?.form?.parameters;
    if (!uploadUrl) throw new Error('CloudConvert did not return an upload URL — check the job response shape hasn\'t changed.');

    // 2. Upload the actual file bytes (multipart form, per CloudConvert's "import/upload" contract)
    const form = new FormData();
    Object.entries(uploadParams || {}).forEach(([k, v]) => form.append(k, v as string));
    form.append('file', new Blob([buf]), fileName);
    const uploadResp = await fetch(uploadUrl, { method: 'POST', body: form as any });
    if (!uploadResp.ok) throw new Error(`Upload to CloudConvert failed: ${uploadResp.status}`);

    // 3. Poll the job until the export task finishes
    const jobId = job.data.id;
    let exportUrl: string | null = null;
    const start = Date.now();
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const status = await cc(`/jobs/${jobId}`, apiKey);
      const exportTask = status.data.tasks.find((t: any) => t.name === 'export-file');
      if (exportTask?.status === 'error') throw new Error(`Conversion failed: ${exportTask.message || 'unknown CloudConvert error'}`);
      if (exportTask?.status === 'finished') {
        exportUrl = exportTask.result?.files?.[0]?.url;
        break;
      }
    }
    if (!exportUrl) {
      res.statusCode = 504;
      res.end(JSON.stringify({ error: 'Conversion timed out. Try again, or use a smaller file / Save As DXF directly in AutoCAD.' }));
      return;
    }

    // 4. Download the converted DXF text
    const dxfResp = await fetch(exportUrl);
    if (!dxfResp.ok) throw new Error(`Could not download converted DXF: ${dxfResp.status}`);
    const dxfText = await dxfResp.text();

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ dxfText }));
  } catch (e: any) {
    console.error('[api/dwg-convert]', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
}