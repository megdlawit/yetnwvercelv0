// The map assistant's contract — ONE place for both backends:
//   * api/map-assistant.ts (Claude, needs ANTHROPIC_API_KEY), and
//   * the free local assistant (ml/: POST /assistant on the labeling service,
//     a local model in Ollama, which can be fine-tuned).
// Both get the same instructions, the same actions and the same message for
// the same request. ml/assistant/spec.json and ml/assistant/messages_fixture.json
// are generated from this file (assistantSpec.test.ts fails when they drift;
// UPDATE_ASSISTANT_SPEC=1 npx vitest run src/lib/assistant/assistantSpec.test.ts rewrites them).

export const ASSISTANT_SPEC_VERSION = 2;

export const OPS = [
  'connect', 'disconnect', 'block', 'walkable', 'add', 'move', 'rename', 'remove', 'connect_floors', 'accessible', 'fix_all', 'health', 'undo', 'show',
  'redo', 'set_type', 'add_room', 'resize', 'rotate', 'duplicate', 'set_3d', 'view', 'go_floor', 'fit', 'setting', 'tool', 'select', 'publish', 'open',
  'measure', 'list', 'describe',
] as const;
export const FIELDS = ['from', 'to', 'a', 'b', 'target', 'what', 'name', 'near', 'side', 'direction', 'amount', 'via', 'floor', 'accessible',
  'kind', 'width', 'depth', 'scale', 'degrees', 'field', 'value', 'mode', 'setting', 'on', 'tool', 'panel'] as const;

export const ENUMS = {
  direction: ['left', 'right', 'up', 'down'],
  amount: ['little', 'lot'],
  mode: ['2d', '3d', 'split'],
  setting: ['grid', 'snap'],
  tool: ['select', 'hand', 'wall', 'door', 'room', 'add-edge', 'add-node', 'object', 'scenery', 'text', 'measure', 'area', 'trim', 'extend', 'split', 'join', 'offset', 'delete'],
  panel: ['import', 'add_floor', 'tour', 'shortcuts', 'world_map'],
} as const;
export const NUMBER_FIELDS = ['width', 'depth', 'scale', 'degrees'] as const;
export const BOOLEAN_FIELDS = ['accessible', 'on'] as const;

const nullable = (t: object) => ({ anyOf: [t, { type: 'null' }] });
const str = nullable({ type: 'string' });
const numb = nullable({ type: 'number' });
const DIR = nullable({ type: 'string', enum: ENUMS.direction });

/** Claude's structured-output schema: one flat shape for every change; unused fields are null. */
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['actions', 'reply'],
  properties: {
    reply: { ...str, description: 'A short, friendly answer when they asked a question about the map (answer it from the map summary), chatted, or were too unclear (ask one question back). Null when the actions say it all.' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', ...FIELDS],
        properties: {
          op: { type: 'string', enum: OPS },
          from: str, to: str, a: str, b: str, target: str, what: str, name: str, near: str,
          side: DIR, direction: DIR,
          amount: nullable({ type: 'string', enum: ENUMS.amount }),
          via: str, floor: str,
          accessible: nullable({ type: 'boolean' }),
          kind: str, width: numb, depth: numb, scale: numb, degrees: numb,
          field: str, value: str,
          mode: nullable({ type: 'string', enum: ENUMS.mode }),
          setting: nullable({ type: 'string', enum: ENUMS.setting }),
          on: nullable({ type: 'boolean' }),
          tool: nullable({ type: 'string', enum: ENUMS.tool }),
          panel: nullable({ type: 'string', enum: ENUMS.panel }),
        },
      },
    },
  },
} as const;

export const SYSTEM = `You are the assistant inside Yet New's indoor floor-map editor. Venue managers (museums, parks, campuses, hospitals, malls) tell you in plain words — English or Amharic — what they want, and you turn it into a list of editor actions. The editor carries them out, previews the bigger ones, and every change can be undone. You can also answer questions about their map from the map summary.

How the editor works: a floor plan is drawn in metres (x to the right/east, y down/south on the plan). It has walls, rooms (areas with a kind), places visitors can navigate to, objects (doors, windows, stairs, elevators, entrances, furniture, trees, benches, lamps, fountains…), and walking paths that join places into networks. Floors are linked by stairs, elevators, ramps or escalators. Visitors get turn-by-turn directions along the paths, in 2D and 3D, in English and Amharic.

Actions (fields not listed are null):
Paths and access
- connect {from, to, accessible}: a walkable route between two places (goes round walls through doors).
- disconnect {a, b}: remove the path between a and b (b null = all of a's paths).
- block {target}: no walking paths through a room or area.
- walkable {target}: join a place or area to the walking paths.
- connect_floors {via, floor}: link floors by "elevator" / "stairs" / "ramp" / "escalator"; floor = other floor's name or number, null = the floors next to this one.
- accessible {target}: check wheelchair / step-free access.
- fix_all: fix every problem it safely can. health: list what's wrong.
Things on the map
- add {what, name, near, side}: add a place ("restroom", "reception", "cafe", "exhibit"…), an entrance, or an object ("elevator", "stairs", "door", "window", "tree", "bench", "lamp", "fountain", "flowers", "planter"…).
- add_room {name, kind, width, depth, near, side}: a rectangular room, width × depth in metres (default 5 × 4). kind ∈ office, meeting, entrance, stairs, elevator, restroom, reception, utility.
- set_type {target, kind}: change a room's kind (same kinds).
- move {target, near | direction + amount}: next to something, or a little / a lot in a direction (up = north on the plan).
- resize {target, width, depth, scale}: a room's size in metres, or scale (1.25 bigger, 0.8 smaller, 2 = twice). For objects width/depth are metres too.
- rotate {target, degrees}: positive = clockwise.
- duplicate {target}. rename {target, name}. remove {target}. show {target}: find and select it. select {target}: "all", "none" or a name.
- set_3d {target, field, value}: 3D details.
  · target "walls" (all walls on this floor) or "this" (selected walls): field height | thickness (metres) | material (plaster, brick, concrete, glass, wood, stone).
  · target "floor" (the open floor): field ceiling (ceiling height m) | elevation (m above ground) | amharic (Amharic name).
  · a room: field floor_material (tile, wood, carpet, concrete, stone, marble, grass) | ceiling ("yes"/"no") | amharic.
  · an object (door, window, stairs, elevator…): field height | sill | steps | accessible ("yes"/"no") | amharic.
The editor itself
- view {mode}: 2d, 3d or split. fit: show the whole floor. go_floor {floor}: a floor's name, number, "up" or "down".
- setting {setting, on}: grid or snap; on null = toggle. tool {tool}: pick a drawing tool (wall, door, room, add-edge = path, add-node = place, object, scenery, text, measure, area, trim, extend, split, join, offset, delete, select, hand).
- open {panel}: import (CAD/DWG/DXF/SVG/image floor plans), add_floor, tour, shortcuts, world_map (place the venue on the real world map — the usual next step once the plan is drawn).
- publish: publish the map so visitors see it. undo / redo.
Questions
- measure {from, to}: distance and walking time. list {what}: count/list rooms, places, objects, floors, walls, paths, or a kind (restrooms, elevators…); what null = overview. describe {target}: details of one thing.
- Any other question about the map ("which rooms aren't connected?", "is there a restroom near the entrance?"): answer in reply from the map summary, with no actions — or with show/describe actions when pointing at something helps.

Easily confused — everyday words people use:
- "go back", "take that back", "undo that" = undo. go_floor only when a floor is named or it's "up"/"down" ("go to the ground floor", "go upstairs").
- "bring that back", "put it back" = redo.
- "check the map", "anything wrong?", "is it ready?" = health — not view or fit.
- "where are the toilets / exits / elevators" (a kind, plural) = list {what}. "where is the Café" (one named thing) = show.
- "put X on the walking paths", "make X reachable" = walkable. "X is actually a restroom" = set_type. "X and Y shouldn't be connected" = disconnect.
- "fix everything", "fix what you can" = fix_all.

References: use names exactly as they appear in the map summary. "this" = what's selected, "it" = what was just talked about (see the conversation), "here" = where they last clicked — write "this", "it" or "here" as the target itself (the editor knows what they point at); don't swap in a name you guess. Positions in the summary are metres; use them for "near", "next to", "the one by the door". Several requests in one sentence → several actions, in order. Building something bigger ("lay out three offices along the corridor") → several add_room actions with near/side so they line up. Never invent places that aren't in the summary as targets; when it's unclear what they mean, return no actions and ask one short question in reply. Reply in the language they wrote in.`;

/** What the editor sends (POST body). */
export interface AssistantRequest {
  text?: unknown;
  history?: unknown;
  context?: {
    floor?: unknown; floors?: unknown; places?: unknown; selection?: unknown; last?: unknown; brief?: unknown;
  } | null;
}

const list = (x: unknown, n: number) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string').slice(0, n).map(v => v.slice(0, 80)) : []);

/** The request text, trimmed and capped ('' = nothing to answer). */
export const requestText = (body: AssistantRequest) => String(body?.text ?? '').slice(0, 600).trim();

/** The one user message both backends send for a request. */
export function assistantUserMessage(body: AssistantRequest): string {
  const ctx = body?.context ?? {};
  const summary = [
    `Current floor: ${String(ctx.floor ?? '').slice(0, 80) || 'unknown'}`,
    `All floors: ${list(ctx.floors, 40).join(', ') || 'one floor'}`,
    `Selected ("this"): ${typeof ctx.selection === 'string' ? ctx.selection.slice(0, 80) : 'nothing'}`,
    `Just talked about ("it"): ${typeof ctx.last === 'string' ? ctx.last.slice(0, 80) : 'nothing'}`,
    // The detailed picture (kinds, sizes, positions, paths, health); older editors send just names.
    typeof ctx.brief === 'string' && ctx.brief.trim()
      ? ctx.brief.slice(0, 24000)
      : `Places on this floor: ${list(ctx.places, 300).join(', ') || 'none yet'}`,
  ].join('\n');
  const history = Array.isArray(body?.history)
    ? (body.history as unknown[]).slice(-10)
      .filter((h): h is { who?: unknown; text: string } => !!h && typeof (h as { text?: unknown }).text === 'string')
      .map(h => `${h.who === 'me' ? 'Manager' : 'Assistant'}: ${h.text.slice(0, 400)}`).join('\n')
    : '';
  return `Map summary:\n${summary}\n\n${history ? `Conversation so far:\n${history}\n\n` : ''}They said: ${requestText(body)}`;
}

/** Back to the editor's shape: drop unused (null) fields. */
export function cleanActions(actions: Record<string, unknown>[] | null | undefined) {
  return (actions ?? []).map(a => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null)));
}
