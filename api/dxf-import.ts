// api/dxf-import.ts
//
// POST /api/dxf-import
// body: {
//   buildingId: string, floorId: string,
//   dxfText: string,                 // raw .dxf file contents (ASCII DXF only)
//   wallLayers: string[],            // e.g. ["WALL","A-WALL"]
//   roomLayer?: string,              // e.g. "ROOM" — closed polylines here become rooms
//   doorLayer?: string,              // e.g. "DOOR"
//   textLayers?: string[],           // room-label layers; omit to search all TEXT/MTEXT
//   unitsPerMeter?: number | 'auto', // default 'auto': the file's $INSUNITS, else 1000 (millimetres)
//   pxPerMeter?: number,             // default 40 — FloorEditor's own working scale
//   flipY?: boolean,                 // default true
//   replaceExisting?: boolean,       // default true — see below
// }
//
// Auth: requires the same Supabase session FloorEditor already uses — reads
// the bearer token from the Authorization header and opens a Supabase
// client as that user, so the existing RLS ownership check
// (public.user_can_edit_building) applies exactly as it does for every
// other write in the app. No separate permission system to keep in sync.
//
// replaceExisting (default true): a DXF re-import is expected to happen
// more than once per floor (the architect revises the plan) — without this,
// every re-import would pile duplicate walls/rooms on top of the old ones.
// Only rows this endpoint itself created (source = 'dxf-import') are ever
// deleted; anything a human drew by hand in FloorEditor (source = 'manual')
// is left untouched.
//
// Also generates the walkable path graph itself (src/lib/dxf/generatePathGraph.ts)
// and writes it straight into nodes/edges — the same tables FloorEditor's
// manual Add Node / Add Edge tools write to — so the import is immediately
// routable, not just reference geometry a human has to trace. Each room row
// gets its node_id pointed at its generated anchor node, matching what
// manually creating a room via "Add Room" already does.
//
// This only reads ASCII DXF. DWG (AutoCAD's native binary format) isn't a
// documented, legally re-implementable format — there is no safe pure-JS
// DWG reader. If dxfText looks like a binary DWG, this returns a clear 422
// telling the caller to convert first (see api/dwg-convert.ts, which uses
// a hosted conversion API, or "Save As... DXF" in AutoCAD, which is free
// and one click).

import type { IncomingMessage, ServerResponse } from 'http';
/** What Vercel's Node runtime passes in: Node's request/response plus the parsed body and query. */
type ApiRequest = IncomingMessage & { body?: unknown; query?: Record<string, string | string[] | undefined> };
type ApiResponse = ServerResponse;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON sent by the client; every field is checked before use
type JsonBody = any;

/** A binary (DWG) file starts with a control character, not text. */
function isBinaryStart(text: string): boolean {
  const c = text.charCodeAt(0);
  return (c >= 0 && c <= 8) || (c >= 14 && c <= 31);
}

import { createClient } from '@supabase/supabase-js';
import { parseDxf, diagnoseDxf, unitsFromInsunits } from '../src/lib/dxf/parseDxf';
import { dxfToVenue, type ImportOptions } from '../src/lib/dxf/dxfToVenue';
import { generatePathGraph } from '../src/lib/dxf/generatePathGraph';

// Same dual-environment body reader as api/overpass.ts: on Vercel, req.body
// is already parsed; under `vite dev`'s middleware (see vite.config.ts),
// it isn't, so the raw stream has to be read and parsed by hand. Without
// this, every field below reads as undefined under `npm run dev` — this is
// what caused the "buildingId, floorId and dxfText are required" / 404-ish
// failure when testing locally.
async function readJsonBody(req: ApiRequest): Promise<JsonBody> {
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

function setCors(res: ApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const MAX_DXF_BYTES = 15 * 1024 * 1024; // 15MB — generous for a single-floor plan, blocks accidental whole-project exports

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'POST only' })); return; }

  try {
    const body = await readJsonBody(req);
    const {
      buildingId, floorId, dxfText,
      wallLayers, roomLayer = null, doorLayer = null, textLayers = null,
      unitsPerMeter: requestedUnits = 'auto', pxPerMeter = 40, flipY = true,
      replaceExisting = true,
    } = body || {};

    if (!buildingId || !floorId || !dxfText) {
      res.statusCode = 400; res.end(JSON.stringify({ error: 'buildingId, floorId and dxfText are required' })); return;
    }
    if (!Array.isArray(wallLayers) || wallLayers.length === 0) {
      res.statusCode = 400; res.end(JSON.stringify({ error: 'wallLayers must be a non-empty array, e.g. ["WALL"]' })); return;
    }
    if (typeof dxfText !== 'string' || dxfText.length > MAX_DXF_BYTES) {
      res.statusCode = 413; res.end(JSON.stringify({ error: `dxfText too large (max ${MAX_DXF_BYTES} bytes)` })); return;
    }

    const authHeader = String(req.headers?.authorization || '');  // Node lower-cases header names
    if (!authHeader) {
      res.statusCode = 401; res.end(JSON.stringify({ error: 'Missing Authorization header — sign in as the venue owner first' })); return;
    }

    // src/integrations/supabase/client.ts hardcodes these same two values
    // rather than reading them from env — they're the public project URL
    // and anon key, safe to embed, and this project's own convention.
    // Mirroring that here (instead of requiring env vars that `vite dev`'s
    // middleware never populates from .env in the first place — that's
    // what caused "SUPABASE_URL / SUPABASE_ANON_KEY not set") means this
    // works out of the box in both `npm run dev` and on Vercel. Env vars
    // are still checked first, so setting SUPABASE_URL / SUPABASE_ANON_KEY
    // on Vercel (e.g. to point a preview deploy at a different project)
    // still overrides this without editing code.
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
      || 'https://utlrpeyplazojlwostor.supabase.co';
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
      || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bHJwZXlwbGF6b2psd29zdG9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MTEzOTksImV4cCI6MjA4ODA4NzM5OX0.TS56oygBU-NGUGHjaABUpOuGOquvejNTnlkKAtx-YwI';
    // Client scoped to the caller's own JWT, not a service-role key — so
    // this insert is subject to the exact same RLS ownership policy a
    // browser-side insert from FloorEditor would be. No privilege escalation
    // via this endpoint.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    if (dxfText.slice(0, 6) === 'AC1032' || dxfText.slice(0, 4) === 'AC10' || isBinaryStart(dxfText)) {
      res.statusCode = 422;
      res.end(JSON.stringify({
        error: 'This looks like a binary DWG file, not ASCII DXF.',
        hint: 'In AutoCAD: File → Save As → choose "AutoCAD DXF (*.dxf)". Or POST it to /api/dwg-convert first, which converts DWG → DXF for you.',
      }));
      return;
    }

    let parsed;
    try {
      parsed = parseDxf(dxfText);
    } catch (e) {
      res.statusCode = 422; res.end(JSON.stringify({ error: `Could not parse DXF: ${e instanceof Error ? e.message : String(e)}` })); return;
    }
    if (parsed.entities.length === 0) {
      const diag = diagnoseDxf(dxfText);
      res.statusCode = 422;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: diag.hints[0] || 'No entities found in this DXF.',
        hints: diag.hints,
        diagnosis: { format: diag.format, sections: diag.sections, entityCounts: diag.entityCounts, blockEntityCounts: diag.blockEntityCounts, unsupported: diag.unsupported },
        layers: parsed.layers,
      }));
      return;
    }

    // Units: an explicit number from the dialog wins; otherwise trust the
    // drawing's own $INSUNITS; otherwise assume millimetres (the CAD default).
    const declared = unitsFromInsunits(parsed.insunits);
    const units = typeof requestedUnits === 'number' && requestedUnits > 0
      ? { perMeter: requestedUnits, name: 'set manually', source: 'manual' as const }
      : declared
        ? { ...declared, source: 'file' as const }
        : { perMeter: 1000, name: 'millimetres (assumed)', source: 'assumed' as const };
    const unitsPerMeter = units.perMeter;

    const opts: ImportOptions = {
      wallLayers, roomLayer, doorLayer, textLayers,
      unitsPerMeter, pxPerMeter, flipY,
    };
    const result = dxfToVenue(parsed, opts);

    const graph = generatePathGraph(result.walls, result.rooms, {});
    const allWarnings = [...result.warnings, ...graph.warnings];

    if (replaceExisting) {
      // Edges first (they reference nodes), then nodes, then rooms/walls.
      const { data: oldNodes } = await supabase.from('nodes').select('id').eq('floor_id', floorId).eq('source', 'dxf-import');
      if (oldNodes && oldNodes.length > 0) {
        const ids = oldNodes.map(n => n.id);
        const delEdges = await supabase.from('edges').delete().in('from_node', ids);
        if (delEdges.error) { res.statusCode = 500; res.end(JSON.stringify({ error: `Could not clear previous import (edges): ${delEdges.error.message}` })); return; }
      }
      const delNodes = await supabase.from('nodes').delete().eq('floor_id', floorId).eq('source', 'dxf-import');
      if (delNodes.error) { res.statusCode = 500; res.end(JSON.stringify({ error: `Could not clear previous import (nodes): ${delNodes.error.message}` })); return; }
      const delWalls = await supabase.from('walls').delete().eq('floor_id', floorId).eq('source', 'dxf-import');
      if (delWalls.error) { res.statusCode = 500; res.end(JSON.stringify({ error: `Could not clear previous import (walls): ${delWalls.error.message}` })); return; }
      const delRooms = await supabase.from('rooms').delete().eq('floor_id', floorId).eq('source', 'dxf-import');
      if (delRooms.error) { res.statusCode = 500; res.end(JSON.stringify({ error: `Could not clear previous import (rooms): ${delRooms.error.message}` })); return; }
    }

    let insertedWalls = 0, insertedRooms = 0, insertedNodes = 0, insertedEdges = 0;

    if (result.walls.length > 0) {
      const rows = result.walls.map(w => ({ building_id: buildingId, floor_id: floorId, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, source: 'dxf-import' }));
      const { error, count } = await supabase.from('walls').insert(rows, { count: 'exact' });
      if (error) { res.statusCode = 500; res.end(JSON.stringify({ error: `Insert walls failed: ${error.message}`, hint: 'Check you are signed in as this venue\'s owner (RLS).' })); return; }
      insertedWalls = count ?? rows.length;
    }

    // Nodes before rooms, so each room can be inserted with node_id already set.
    let nodeIds: string[] = [];
    if (graph.nodes.length > 0) {
      const rows = graph.nodes.map(n => ({
        building_id: buildingId, floor_id: floorId,
        name: n.isHallway ? '' : (result.rooms[n.roomIndex!]?.name || ''),
        x: Math.round(n.x), y: Math.round(n.y),
        is_hallway: n.isHallway, type: n.isHallway ? 'hallway' : 'room',
        source: 'dxf-import',
      }));
      const { data, error } = await supabase.from('nodes').insert(rows).select('id');
      if (error) { res.statusCode = 500; res.end(JSON.stringify({ error: `Insert nodes failed: ${error.message}` })); return; }
      nodeIds = (data || []).map(r => r.id);
      insertedNodes = nodeIds.length;

      if (graph.edges.length > 0 && nodeIds.length === graph.nodes.length) {
        const edgeRows = graph.edges.map(e => ({
          building_id: buildingId, from_node: nodeIds[e.from], to_node: nodeIds[e.to],
          weight: e.weight, source: 'dxf-import',
        }));
        const { error: edgeErr, count } = await supabase.from('edges').insert(edgeRows, { count: 'exact' });
        if (edgeErr) { res.statusCode = 500; res.end(JSON.stringify({ error: `Insert edges failed: ${edgeErr.message}` })); return; }
        insertedEdges = count ?? edgeRows.length;
      }
    }

    if (result.rooms.length > 0) {
      const roomNodeIdByIndex = new Map<number, string>();
      graph.nodes.forEach((n, i) => { if (!n.isHallway && n.roomIndex !== null) roomNodeIdByIndex.set(n.roomIndex, nodeIds[i]); });
      const rows = result.rooms.map((r, ri) => ({
        building_id: buildingId, floor_id: floorId, node_id: roomNodeIdByIndex.get(ri) ?? null,
        name: r.name, x: r.x, y: r.y, width: r.width, height: r.height,
        type: 'office', source: 'dxf-import',
      }));
      const { error, count } = await supabase.from('rooms').insert(rows, { count: 'exact' });
      if (error) { res.statusCode = 500; res.end(JSON.stringify({ error: `Insert rooms failed: ${error.message}` })); return; }
      insertedRooms = count ?? rows.length;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      layers: parsed.layers,       // every layer name found — feed back into the UI so the
                                    // person can fix wallLayers/roomLayer/doorLayer and retry
      importedWalls: insertedWalls,
      importedRooms: insertedRooms,
      importedNodes: insertedNodes,
      importedEdges: insertedEdges,
      doors: result.doors,         // NOT persisted as entities — shown so entrance-type nodes
                                    // can be marked by hand; the walkable graph already routes
                                    // through these points regardless
      warnings: allWarnings,
      units,                       // how drawing units were resolved (file / manual / assumed)
      cleanup: result.cleanup,     // duplicate and zero-length wall segments dropped
      mapping: result.mapping,     // which CAD layers became walls / rooms
    }));
  } catch (e) {
    console.error('[api/dxf-import]', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
}