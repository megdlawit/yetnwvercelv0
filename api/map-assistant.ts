// api/map-assistant.ts
//
// POST /api/map-assistant
// body: { text: string, context: { floor: string, floors: string[], places: string[], selection: string | null, last: string | null } }
// → 200 { actions: MapAction-like[], reply: string | null }
//
// The floor editor's assistant understands common requests on its own
// (src/lib/assistant/intent.ts). Anything it doesn't recognise comes here:
// Claude turns the sentence into the same small list of map changes, and the
// editor does the rest (finding the rooms, routing through doors, preview,
// undo). Only a compact summary of the map is sent — place names, floor
// names, what's selected — never geometry or personal data.
//
// Needs ANTHROPIC_API_KEY (server-side only). Without it this returns 501
// and the editor simply says it didn't understand.
//
// Auth: the editor's Supabase session (bearer token), so the endpoint can't
// be used by anyone who isn't signed in.

import type { IncomingMessage } from 'http';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

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

function send(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

const nullable = (t: object) => ({ anyOf: [t, { type: 'null' }] });
const str = nullable({ type: 'string' });
const DIR = nullable({ type: 'string', enum: ['left', 'right', 'up', 'down'] });

// One flat shape for every kind of change; fields a change doesn't use are null.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['actions', 'reply'],
  properties: {
    reply: { ...str, description: 'Only when the request is not a map change (a question, chit-chat, or too unclear): a short, friendly answer or one clarifying question. Otherwise null.' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'from', 'to', 'a', 'b', 'target', 'what', 'name', 'near', 'side', 'direction', 'amount', 'via', 'floor', 'accessible'],
        properties: {
          op: { type: 'string', enum: ['connect', 'disconnect', 'block', 'walkable', 'add', 'move', 'rename', 'remove', 'connect_floors', 'accessible', 'fix_all', 'health', 'undo', 'show'] },
          from: str, to: str, a: str, b: str, target: str, what: str, name: str, near: str,
          side: DIR, direction: DIR,
          amount: nullable({ type: 'string', enum: ['little', 'lot'] }),
          via: str, floor: str,
          accessible: nullable({ type: 'boolean' }),
        },
      },
    },
  },
} as const;

const SYSTEM = `You turn what a venue manager says about their indoor floor map into a list of map changes. The editor carries them out.

Changes (fields not listed are null):
- connect {from, to, accessible}: make a walkable route between two places.
- disconnect {a, b}: remove the path between a and b (b null = all of a's paths).
- block {target}: no walking paths through a room or area.
- walkable {target}: join a place or area to the walking paths.
- add {what, name, near, side}: add a place ("restroom", "reception", "cafe"…), an entrance, or an object ("elevator", "stairs", "door", "tree", "bench"…). near = where; side = which side of near.
- move {target, near | direction + amount}: move something next to something else, or a little / a lot in a direction (up = north on the plan).
- rename {target, name}. remove {target}. show {target}: find it on the map.
- connect_floors {via, floor}: link floors by "elevator" / "stairs" / "ramp" / "escalator"; floor = the other floor's name or number, null = the floors next to this one.
- accessible {target}: check wheelchair / step-free access.
- fix_all: fix every problem it safely can. health: list what's wrong. undo: take back the last change.

References: use the place names exactly as they appear in the map summary when the person means one of them. Use "this" for what's selected, "it" for what was just talked about, "here" for the spot they clicked. Several requests in one sentence → several changes, in order. If the request isn't about changing or checking the map, or you can't tell what they mean, return no changes and a short reply (a question back when it's unclear).`;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return send(res, 501, { error: 'The map assistant needs ANTHROPIC_API_KEY on the server.' });

  try {
    const token = String(req.headers?.authorization || req.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!token) return send(res, 401, { error: 'Sign in first.' });
    if (supabaseUrl && supabaseAnonKey) {
      const { data, error } = await createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } }).auth.getUser(token);
      if (error || !data.user) return send(res, 401, { error: 'Sign in first.' });
    }

    const body = await readJsonBody(req);
    const text = String(body?.text ?? '').slice(0, 600).trim();
    if (!text) return send(res, 400, { error: 'text is required' });
    const ctx = body?.context ?? {};
    const list = (x: unknown, n: number) => (Array.isArray(x) ? x.filter(v => typeof v === 'string').slice(0, n).map(v => v.slice(0, 80)) : []);
    const summary = [
      `Current floor: ${String(ctx.floor ?? '').slice(0, 80) || 'unknown'}`,
      `All floors: ${list(ctx.floors, 40).join(', ') || 'one floor'}`,
      `Places on this floor: ${list(ctx.places, 300).join(', ') || 'none yet'}`,
      `Selected ("this"): ${typeof ctx.selection === 'string' ? ctx.selection.slice(0, 80) : 'nothing'}`,
      `Just talked about ("it"): ${typeof ctx.last === 'string' ? ctx.last.slice(0, 80) : 'nothing'}`,
    ].join('\n');

    const client = new Anthropic({ apiKey: key });
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Map summary:\n${summary}\n\nThey said: ${text}` }],
    });

    if (msg.stop_reason === 'refusal') return send(res, 200, { actions: [], reply: "I can't help with that one — try describing the change to the map." });
    const out = msg.content.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined;
    if (!out) return send(res, 502, { error: 'No answer' });
    const parsed = JSON.parse(out.text) as { actions: Record<string, unknown>[]; reply: string | null };
    // Back to the editor's shape: drop the unused (null) fields.
    const actions = (parsed.actions ?? []).map(a => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null)));
    return send(res, 200, { actions, reply: parsed.reply ?? null });
  } catch (err) {
    console.error('map-assistant failed:', err);
    return send(res, 500, { error: 'The assistant is unavailable right now.' });
  }
}
