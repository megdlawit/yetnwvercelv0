// api/map-assistant.ts
//
// POST /api/map-assistant
// body: { text, history?: { who: 'me' | 'map', text }[], context: { floor, floors[], places[], selection, last, brief? } }
//   brief = the editor's plain-text picture of the map (kinds, sizes, positions in metres, paths, health).
// → 200 { actions: MapAction-like[], reply: string | null }
//
// The floor editor's assistant understands common requests on its own
// (src/lib/assistant/intent.ts). Anything it doesn't recognise goes first to
// the free local assistant (ml/ service, a local model) when it runs, and
// here otherwise:
// Claude turns the sentence into the same small list of map changes, and the
// editor does the rest (finding the rooms, routing through doors, preview,
// undo). It gets a compact text summary of the map — names, kinds, sizes and
// rough positions in metres, paths, health — never raw plan files or personal data.
//
// Backends, in order (server-side settings only; none set → 501, and the
// editor simply says it didn't understand):
//   1. a FREE hosted model, when ASSISTANT_FREE_URL + ASSISTANT_FREE_MODEL are
//      set (+ ASSISTANT_FREE_KEY): any OpenAI-compatible API — Groq,
//      OpenRouter, Gemini's OpenAI-compatible endpoint, a self-hosted Ollama.
//      Its answers are checked action by action (src/lib/assistant/freeProvider.ts).
//      ASSISTANT_FREE_JSON_MODE=off for a service that rejects response_format.
//   2. Claude, when ANTHROPIC_API_KEY is set — also if the free model fails.
//
// Auth: the editor's Supabase session (bearer token), so the endpoint can't
// be used by anyone who isn't signed in.

import type { IncomingMessage } from 'http';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
// Instructions, actions and the message: shared with the free local assistant (ml/, POST /assistant).
import { SCHEMA, SYSTEM, assistantUserMessage, cleanActions, requestText } from '../src/lib/assistant/assistantSpec';
import { askFree, freeProviderFromEnv } from '../src/lib/assistant/freeProvider';

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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const key = process.env.ANTHROPIC_API_KEY;
  const free = freeProviderFromEnv(process.env);
  if (!key && !free) return send(res, 501, { error: 'The map assistant needs a free model (ASSISTANT_FREE_URL, ASSISTANT_FREE_MODEL) or ANTHROPIC_API_KEY on the server.' });

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
    if (!requestText(body)) return send(res, 400, { error: 'text is required' });

    if (free) {
      try {
        const out = await askFree(free, SYSTEM, assistantUserMessage(body));
        return send(res, 200, { ...out, source: 'free' });
      } catch (err) {
        console.error('free assistant failed:', err);
      }
    }
    if (!key) return send(res, 502, { error: 'The assistant is unavailable right now.' });

    const client = new Anthropic({ apiKey: key });
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> } },
      // The instructions never change between requests: cache them.
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: assistantUserMessage(body) }],
    });

    if (msg.stop_reason === 'refusal') return send(res, 200, { actions: [], reply: "I can't help with that one — try describing the change to the map." });
    const out = msg.content.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined;
    if (!out) return send(res, 502, { error: 'No answer' });
    const parsed = JSON.parse(out.text) as { actions: Record<string, unknown>[]; reply: string | null };
    return send(res, 200, { actions: cleanActions(parsed.actions), reply: parsed.reply ?? null, source: 'claude' });
  } catch (err) {
    console.error('map-assistant failed:', err);
    return send(res, 500, { error: 'The assistant is unavailable right now.' });
  }
}
