import { describe, expect, it } from 'vitest';
import { askFree, checkAction, freeProviderFromEnv, parseAnswer } from './freeProvider';

const provider = { url: 'https://api.example.com/openai/v1', key: 'k', model: 'some-free-model', jsonMode: true };
const reply = (content: string, status = 200) => async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });

describe('the free fallback', () => {
  it('is off unless the server is configured', () => {
    expect(freeProviderFromEnv({})).toBeNull();
    expect(freeProviderFromEnv({ ASSISTANT_FREE_URL: 'https://x/v1' })).toBeNull();     // no model
    expect(freeProviderFromEnv({ ASSISTANT_FREE_URL: 'https://x/v1', ASSISTANT_FREE_MODEL: 'm' })).toEqual({ url: 'https://x/v1', key: '', model: 'm', jsonMode: true });
    expect(freeProviderFromEnv({ ASSISTANT_FREE_URL: 'u', ASSISTANT_FREE_MODEL: 'm', ASSISTANT_FREE_JSON_MODE: 'off' })?.jsonMode).toBe(false);
  });

  it('sends one OpenAI-style chat request with the shared instructions', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    await askFree(provider, 'SYSTEM', 'They said: undo', {
      fetchFn: async (url, init) => { seen = { url, init }; return reply('{"actions":[{"op":"undo"}],"reply":null}')(); },
    });
    expect(seen!.url).toBe('https://api.example.com/openai/v1/chat/completions');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const body = JSON.parse(String(seen!.init.body));
    expect(body).toMatchObject({ model: 'some-free-model', temperature: 0, response_format: { type: 'json_object' } });
    expect(body.messages[0].content).toMatch(/^SYSTEM\n\nAnswer with ONE JSON object/);
    expect(body.messages[1]).toEqual({ role: 'user', content: 'They said: undo' });
  });

  it('checks every action: unknown actions, fields and values never reach the editor', async () => {
    const out = await askFree(provider, 's', 'u', { fetchFn: reply('Sure! ```json\n{"actions":[{"op":"resize","target":"Café","scale":"1.25","colour":"red"},{"op":"explode"},{"op":"tool","tool":"path"},{"op":"setting","setting":"grid","on":true}],"reply":""}\n```') });
    expect(out).toEqual({
      actions: [{ op: 'resize', target: 'Café', scale: 1.25 }, { op: 'tool' }, { op: 'setting', setting: 'grid', on: true }],
      reply: null,
    });
  });

  it('fails loudly (so Claude can take over) on errors and non-JSON answers', async () => {
    await expect(askFree(provider, 's', 'u', { fetchFn: reply('{}', 429) })).rejects.toThrow(/429/);
    await expect(askFree(provider, 's', 'u', { fetchFn: reply('I think you want to undo.') })).rejects.toThrow(/not JSON/);
  });

  it('parses a reply-only answer', () => {
    expect(parseAnswer('{"actions": [], "reply": "A room is an enclosed space."}')).toEqual({ actions: [], reply: 'A room is an enclosed space.' });
    expect(checkAction({ op: 'move', target: 'it', direction: 'sideways', amount: 'lot' })).toEqual({ op: 'move', target: 'it', amount: 'lot' });
  });
});
