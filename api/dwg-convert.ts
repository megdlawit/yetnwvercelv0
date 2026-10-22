// api/dwg-convert.ts
//
// POST /api/dwg-convert
//   body: the DWG file's bytes (Content-Type: application/octet-stream),
//         or JSON { dwgBase64, fileName } (older clients)
// → { dxfText: string }
//
// DWG is AutoCAD's binary format. It's converted to DXF right here on the
// server with LibreDWG (compiled to WebAssembly: @mlightcad/libredwg-web) —
// no account, no API key, and the drawing never leaves our server. The DXF
// then goes through the same importer as any DXF upload.
//
// Licence note: LibreDWG is GPL-3.0. It runs only on the server and is never
// sent to visitors' browsers, so it isn't distributed with the app — keep it
// that way (don't import it from src/).
//
// If CLOUDCONVERT_API_KEY is set, CloudConvert is the fallback for the rare
// DWG that LibreDWG can't read.
//
// Vercel limits a request body (and the answer) to about 4.5 MB, so on the
// website bigger DWGs come back 413 and the client asks for a DXF instead.
// Run locally (`vite dev`), any DWG up to MAX_DWG_BYTES converts here.

import type { IncomingMessage } from 'http';
import { createRequire } from 'module';
import path from 'path';

// LibreDWG, loaded once per server instance.
let libredwg: Promise<{ dwg_write_dxf(data: ArrayBuffer): Uint8Array | null }> | null = null;
function loadLibreDwg() {
  libredwg ??= (async () => {
    const { LibreDwg } = await import('@mlightcad/libredwg-web');
    const entry = createRequire(import.meta.url).resolve('@mlightcad/libredwg-web');
    const wasmDir = path.join(path.dirname(entry), '..', 'wasm') + '/';
    return LibreDwg.create(wasmDir);
  })();
  return libredwg;
}

/** DWG bytes → DXF text, on this server. Throws when LibreDWG can't read the file. */
async function convertLocally(buf: Buffer): Promise<string> {
  const lib = await loadLibreDwg();
  const out = lib.dwg_write_dxf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  if (!out || !out.length) throw new Error('This DWG could not be read.');
  return new TextDecoder().decode(out);
}

/** The request body as bytes (raw upload) — or null if it's JSON. */
async function readRawBody(req: IncomingMessage & { body?: unknown }): Promise<Buffer | null> {
  const type = String(req.headers['content-type'] || '');
  if (!type.startsWith('application/octet-stream')) return null;
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks: Buffer[] = await new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => resolve(parts));
    req.on('error', reject);
  });
  return Buffer.concat(chunks);
}

function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-File-Name');
}

// Same dual-environment body reader as api/dxf-import.ts / api/overpass.ts —
// see the comment there. Needed here too since this is also a POST with a
// JSON body, and `vite dev` doesn't pre-parse it the way Vercel does.
async function readJsonBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const raw: string = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

const CLOUDCONVERT_API = 'https://api.cloudconvert.com/v2';
const MAX_DWG_BYTES = 60 * 1024 * 1024;
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

  try {
    let buf = await readRawBody(req);
    let fileName = decodeURIComponent(String(req.headers?.['x-file-name'] || 'upload.dwg'));
    if (!buf) {
      const body = await readJsonBody(req);
      if (!body?.dwgBase64 || typeof body.dwgBase64 !== 'string') {
        res.statusCode = 400; res.end(JSON.stringify({ error: 'Send the DWG file (application/octet-stream), or JSON { dwgBase64 }.' })); return;
      }
      buf = Buffer.from(body.dwgBase64, 'base64');
      fileName = body.fileName || fileName;
    }
    if (buf.byteLength > MAX_DWG_BYTES) {
      res.statusCode = 413; res.end(JSON.stringify({ error: `This DWG is too large (max ${MAX_DWG_BYTES / 1024 / 1024} MB).`, hint: 'In AutoCAD choose File → Save As → AutoCAD DXF and upload the DXF instead.' })); return;
    }

    // Here on the server, with LibreDWG.
    try {
      const dxfText = await convertLocally(buf);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ dxfText, converter: 'libredwg' }));
      return;
    } catch (local) {
      console.warn('[api/dwg-convert] LibreDWG could not convert', fileName, local);
      if (!apiKey) {
        res.statusCode = 422;
        res.end(JSON.stringify({
          error: 'This DWG file could not be read.',
          hint: 'It may be damaged or from a very new AutoCAD release. In AutoCAD choose File → Save As → AutoCAD DXF and upload the DXF instead.',
        }));
        return;
      }
    }

    // Fallback: CloudConvert. 1. Create a job: import/upload -> convert (dwg->dxf) -> export/url
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