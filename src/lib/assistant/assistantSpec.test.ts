// Keeps the free local assistant (Python, ml/) in step with this spec:
// ml/assistant/spec.json and ml/assistant/messages_fixture.json must equal what
// this module produces. To regenerate after changing the spec:
//   UPDATE_ASSISTANT_SPEC=1 npx vitest run src/lib/assistant/assistantSpec.test.ts

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ASSISTANT_SPEC_VERSION, BOOLEAN_FIELDS, ENUMS, FIELDS, NUMBER_FIELDS, OPS, SCHEMA, SYSTEM, assistantUserMessage, cleanActions, type AssistantRequest } from './assistantSpec';

const ML = join(__dirname, '..', '..', '..', 'ml', 'assistant');

/** Requests covering every branch of the message builder. */
export const FIXTURE_REQUESTS: AssistantRequest[] = [
  { text: 'connect the cafe to the main entrance', context: { floor: 'Ground', floors: ['Ground', 'First'], selection: 'Room 1', last: 'Cafe', brief: 'Floors (low→high): Ground [level 0, OPEN]; First [level 1]\nRooms on this floor (1) — name | kind | size m | centre x,y m | reachable:\n- Cafe | office | 6.0×4.0 | 3.0,2.0 | yes' } },
  { text: '  add a restroom here please  ', history: [{ who: 'me', text: 'hi' }, { who: 'map', text: 'Hello!' }], context: { floor: 'G', places: ['Lobby', 'Cafe', 42], selection: null } },
  { text: 'ሽንት ቤት የት ነው?', context: {} },
  { text: 'x'.repeat(700), context: { floor: 'F'.repeat(100), floors: Array.from({ length: 45 }, (_, i) => `Floor ${i}`) } },
  { text: 'undo', history: Array.from({ length: 14 }, (_, i) => ({ who: i % 2 ? 'map' : 'me', text: `turn ${i}` })).concat([{ who: 'me' } as never]), context: { brief: '   ' } },
  { text: 'what is wrong with my map', context: null },
];

function expected() {
  return {
    spec: { version: ASSISTANT_SPEC_VERSION, system: SYSTEM, ops: OPS, fields: FIELDS, enums: ENUMS, number_fields: NUMBER_FIELDS, boolean_fields: BOOLEAN_FIELDS, claude_schema: SCHEMA },
    messages: FIXTURE_REQUESTS.map(body => ({ body, message: assistantUserMessage(body) })),
  };
}

describe('assistant spec shared with the local assistant', () => {
  it('ml/assistant files match this spec', () => {
    const want = expected();
    const files = { 'spec.json': want.spec, 'messages_fixture.json': want.messages };
    if (process.env.UPDATE_ASSISTANT_SPEC === '1') {
      for (const [name, data] of Object.entries(files)) {
        const path = join(ML, name);
        if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      }
    }
    for (const [name, data] of Object.entries(files)) {
      const path = join(ML, name);
      expect(existsSync(path), `${path} is missing — run with UPDATE_ASSISTANT_SPEC=1`).toBe(true);
      expect(JSON.parse(readFileSync(path, 'utf8')), `${name} is out of date — run with UPDATE_ASSISTANT_SPEC=1`).toEqual(JSON.parse(JSON.stringify(data)));
    }
  });

  it('builds the message the Claude route always sent', () => {
    expect(assistantUserMessage(FIXTURE_REQUESTS[1])).toBe(
      'Map summary:\nCurrent floor: G\nAll floors: one floor\nSelected ("this"): nothing\nJust talked about ("it"): nothing\nPlaces on this floor: Lobby, Cafe'
      + '\n\nConversation so far:\nManager: hi\nAssistant: Hello!\n\nThey said: add a restroom here please');
  });

  it('drops unused fields from actions', () => {
    expect(cleanActions([{ op: 'connect', from: 'A', to: 'B', accessible: null }])).toEqual([{ op: 'connect', from: 'A', to: 'B' }]);
    expect(cleanActions(null)).toEqual([]);
  });
});
