// A free hosted model as the assistant's fallback — any service with an
// OpenAI-compatible chat API (Groq, OpenRouter, Google Gemini's
// OpenAI-compatible endpoint, a self-hosted Ollama, …). Configured on the
// server only (api/map-assistant.ts): nothing is sent to any service unless
// ASSISTANT_FREE_URL is set.
//
// Free models follow instructions less reliably than Claude's structured
// output, so every answer is checked the way the local model's are
// (ml/yetnew_layers/assistant.py clean_action): only known actions and
// fields, numbers as numbers, choices from their list. Anything else is
// dropped — the editor never sees a malformed action.

import { BOOLEAN_FIELDS, ENUMS, FIELDS, NUMBER_FIELDS, OPS } from './assistantSpec';

export interface FreeProvider {
  /** Base URL of the OpenAI-compatible API ("https://api.groq.com/openai/v1"), or the full …/chat/completions URL. */
  url: string;
  /** API key; may be empty for a self-hosted server. */
  key: string;
  model: string;
  /** Ask for a JSON object (response_format). Off for services that reject it. */
  jsonMode: boolean;
}

/** The fallback from the server's environment, or null when none is configured. */
export function freeProviderFromEnv(env: Record<string, string | undefined>): FreeProvider | null {
  const url = env.ASSISTANT_FREE_URL?.trim();
  const model = env.ASSISTANT_FREE_MODEL?.trim();
  if (!url || !model) return null;
  return { url, key: env.ASSISTANT_FREE_KEY?.trim() ?? '', model, jsonMode: env.ASSISTANT_FREE_JSON_MODE !== 'off' };
}

/** What a free model must answer with — Claude gets this as a schema; free models as words. */
export const JSON_ANSWER = `Answer with ONE JSON object and nothing else — no code fences, no explanations:
{"actions": [{"op": "<one of the actions above>", ...only the fields that action uses}], "reply": "<short answer>" or null}
Use only the actions and fields listed above, with names exactly as in the map summary. A question, small talk or an unclear request: "actions": [] and a short "reply".`;

const OP_SET = new Set<string>(OPS);
const NUMBERS = new Set<string>(NUMBER_FIELDS);
const BOOLEANS = new Set<string>(BOOLEAN_FIELDS);
const CHOICES: Record<string, readonly string[]> = { ...ENUMS, side: ENUMS.direction };

/** One action as the editor accepts it, or null. Unknown fields and bad values are dropped. */
export function checkAction(a: unknown): Record<string, unknown> | null {
  if (!a || typeof a !== 'object') return null;
  const raw = a as Record<string, unknown>;
  if (typeof raw.op !== 'string' || !OP_SET.has(raw.op)) return null;
  const out: Record<string, unknown> = { op: raw.op };
  for (const f of FIELDS) {
    const v = raw[f];
    if (v === null || v === undefined) continue;
    if (NUMBERS.has(f)) {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
      if (typeof n === 'number' && Number.isFinite(n)) out[f] = n;
    } else if (BOOLEANS.has(f)) {
      if (typeof v === 'boolean') out[f] = v;
    } else if (typeof v === 'string' && v.trim()) {
      const s = v.trim();
      if (!CHOICES[f] || CHOICES[f].includes(s)) out[f] = s;
    }
  }
  return out;
}

/** The JSON object in a model's answer — also when wrapped in code fences or a sentence. */
export function parseAnswer(content: string): { actions: Record<string, unknown>[]; reply: string | null } | null {
  const start = content.indexOf('{'), end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try { data = JSON.parse(content.slice(start, end + 1)); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const d = data as { actions?: unknown; reply?: unknown };
  const actions = (Array.isArray(d.actions) ? d.actions : []).map(checkAction).filter((x): x is Record<string, unknown> => !!x);
  const reply = typeof d.reply === 'string' && d.reply.trim() ? d.reply.trim().slice(0, 1200) : null;
  return { actions, reply };
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** Ask the free model. Throws on a network error, a non-OK answer, or an answer that isn't JSON. */
export async function askFree(p: FreeProvider, system: string, user: string,
                              opts: { fetchFn?: FetchFn; timeoutMs?: number } = {}): Promise<{ actions: Record<string, unknown>[]; reply: string | null }> {
  const url = /\/chat\/completions\/?$/.test(p.url) ? p.url : `${p.url.replace(/\/+$/, '')}/chat/completions`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 25_000);
  try {
    const resp = await (opts.fetchFn ?? fetch)(url, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(p.key ? { Authorization: `Bearer ${p.key}` } : {}) },
      body: JSON.stringify({
        model: p.model,
        temperature: 0,
        max_tokens: 800,
        ...(p.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'system', content: `${system}\n\n${JSON_ANSWER}` }, { role: 'user', content: user }],
      }),
    });
    if (!resp.ok) throw new Error(`free assistant answered ${resp.status}`);
    const data = await resp.json() as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    const parsed = typeof content === 'string' ? parseAnswer(content) : null;
    if (!parsed) throw new Error('free assistant: the answer was not JSON');
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
