// Small talk in the floor editor's chat: "hi", "thanks", "what can you do?".
// Answered instantly and locally — never sent to the (slow) AI — with a reply
// that fits the map as it is and suggestions to tap. Only when the WHOLE
// message is small talk: "hi, connect Room 1 and Room 2" is a request
// (intent.ts strips the greeting and does it).

import { healthOf, suggestions, type Chip, type MapState } from './engine';
import { SMALL_TALK } from './lexicon';

export type SmallTalkKind = 'greeting' | 'howareyou' | 'thanks' | 'help' | 'who' | 'maker' | 'bye' | 'yes' | 'no' | 'ack'
  | 'confused' | 'compliment' | 'complaint';

const PATTERNS: [SmallTalkKind, RegExp][] = [
  ['greeting', /^(hi+|hello+|hey+|heya|hey there|hi there|hello there|yo|hiya|howdy|good (morning|afternoon|evening|day)|greetings|selam|salam|ሰላም|ጤና ይስጥልኝ|tena yistilign|what's up|whats up|what is up|sup|wassup|wazzup|whaddup|what is good|whats good|what's good|what is happening|hey hey|hi hi|ello|oi|yo yo)$/],
  ['howareyou', /^((hi|hey|hello|selam|ሰላም),? )?(how are (you|u|ya)( doing| today)?|how r u|how're you|how's it going|hows it going|how is it going|how have you been|how's your day|you ok|are you ok|how you doing|how you doin|how are things|how is everything|how is life|how is your day( going)?|how is it going|you good|u good|how are you holding up|how is your day been|how have you been doing|what is new|እንዴት ነህ|እንዴት ነሽ|እንዴት ናችሁ|ደህና ነህ|ደህና ነሽ|endet neh|endet nesh|dehna neh)$/],
  ['thanks', /^((thanks|thank you|thx|ty|cheers)( (so|very) much| a lot)?( for (that|this|the help|your help))?|አመሰግናለሁ|amesegnalehu|great,? thanks|perfect,? thanks)$/],
  ['help', /^(help|help me|what can (you|u) do|what (do|can) (you|u) (do|help with)|what are (you|u) (for|able to do)|how (does|do) (this|it|you) work|how do i use (you|this chat)|what should i (do|say|ask)|commands|options|what now|now what|where do i start|ideas)$/],
  ['who', /^(who are (you|u)|what are (you|u)|are (you|u) (a bot|an? ai|human|real)|what is this|what's your name|whats your name|what is your name|do you have a name)$/],
  ['maker', /^(who (made|built|created|trained|programmed) (you|u|this)|who is your (creator|maker))$/],
  ['bye', /^(bye|goodbye|see (you|ya)|later|good night|ciao|ቻው|chaw)$/],
  ['yes', /^(yes|yeah|yep|yup|sure|ok do it|do it|go ahead|apply( it)?|confirm|sounds good|ok sure)$/],
  ['no', /^(no|nope|nah|cancel|don't|do not|stop|never mind|leave it)$/],
  ['ack', /^(ok|okay|k|cool|nice|great|good|perfect|awesome|got it|alright|fine|wow|👍|🙏|😊|🙂)$/],
  ['compliment', /^(good job|well done|great job|nice work|you('re| are) (great|awesome|amazing|smart|the best|helpful|so helpful|good)|good (bot|assistant)|i love (it|this|you)|love it|thank you,? you('re| are) (great|awesome|amazing))$/],
  ['confused', /^(i('m| am) (confused|lost|stuck|new here)|i don't (understand|get it|know what to do|know how)|i dont (understand|get it|know what to do)|i'm not sure what to do|this is (confusing|hard|difficult)|what do i do( now)?|where do i begin)$/],
  ['complaint', /^(that's wrong|thats wrong|that is wrong|wrong|you('re| are) wrong|not what i (wanted|meant|asked)|that's not (it|right|what i (wanted|meant))|it('s| is) (not working|broken)|this (doesn't|does not|isn't|is not) work(ing)?|it didn't work|you (made a mistake|messed up|broke it)|useless|stupid|bad bot)$/],
];

/** Lower-cased, trimmed, without trailing punctuation or emoji-only noise. */
const normalise = (text: string) => text.toLowerCase().replace(/[!?.,…]+$/g, '').replace(/\s+/g, ' ').trim();

export function smallTalkKind(text: string): SmallTalkKind | null {
  const t = normalise(text);
  if (!t) return null;
  const hit = PATTERNS.find(([, re]) => re.test(t))?.[0];
  if (hit) return hit;
  // The word bank's phrases, also with a friendly word after ("thanks mate", "hey everyone").
  const core = t.replace(/[,!]/g, '').replace(/\s+(mate|bro|buddy|friend|pal|guys|everyone|all|there|man|dude|again|so much|a lot)$/, '');
  return BANK.get(t) ?? BANK.get(core) ?? null;
}

/** Small talk from the word bank: phrase → kind. */
const BANK = new Map<string, SmallTalkKind>(
  (Object.entries(SMALL_TALK) as [SmallTalkKind, string[]][]).flatMap(([kind, phrases]) => phrases.map(p => [p, kind] as [string, SmallTalkKind])),
);

const isAmharic = (text: string) => /[ሀ-፿]/.test(text) || /^(selam|salam|tena yistilign|amesegnalehu|chaw)\b/i.test(text.trim());

/** What the assistant can do, in a few plain lines. */
export const CAPABILITIES = [
  'Connect places with walking paths ("connect the café and the entrance")',
  'Add, move, rename or remove rooms, places and objects ("add a restroom here")',
  'Fix problems on the map ("fix everything") and check wheelchair access',
  'Change the 3D look ("make the walls 3 m high"), switch views and floors',
  'Answer questions ("how far is the café from the entrance?")',
  'Explain how Yet New works ("what is a walkable path?", "how do I publish?")',
];

export interface SmallTalkReply { reply: string; chips: Chip[] }

/**
 * The reply for a small-talk message, or null when it isn't small talk.
 * `pending`: a change is waiting for Apply — "yes"/"no" are handled by the
 * chat itself then, so they are not small talk here.
 */
export function smallTalk(text: string, s: MapState | null, opts: { pending?: boolean } = {}): SmallTalkReply | null {
  const kind = smallTalkKind(text);
  if (!kind || ((kind === 'yes' || kind === 'no') && opts.pending)) return null;
  const chips = s ? suggestions(s) : [];
  const issues = s ? healthOf(s).length : 0;
  const empty = !!s && !s.rows.walls.some(w => w.floor_id === s.floorId) && !s.rows.rooms.some(r => r.floor_id === s.floorId);
  const hello = isAmharic(text) ? 'ሰላም!' : 'Hi!';
  const state = !s ? 'The map is still loading.'
    : empty ? 'This floor is empty — import your floor plan, or start drawing walls.'
      : issues ? `I see ${issues} thing${issues === 1 ? '' : 's'} on this floor that need${issues === 1 ? 's' : ''} attention — I can fix most of them for you.`
        : 'Your map looks good. What would you like to change?';
  switch (kind) {
    case 'greeting':
      return { reply: `${hello} I'm your map assistant. ${state}`, chips };
    case 'howareyou':
      return { reply: `${isAmharic(text) ? 'ደህና ነኝ፣ አመሰግናለሁ!' : "I'm doing great, thanks for asking!"} ${state}`, chips };
    case 'maker':
      return { reply: "I was built by the Yet New team to help you make your venue's map — in your own words, no CAD skills needed.", chips };
    case 'compliment':
      return { reply: "Thank you — that's kind of you! What shall we do next?", chips };
    case 'confused':
      return { reply: "No problem, let's take it one step at a time. Tell me what you want on the map in your own words — like “add a restroom near the lobby” or “connect the café and the entrance” — or ask me what something is (“what's a walkable path?”). Or tap one of these:", chips };
    case 'complaint':
      return { reply: 'Sorry about that! Say “undo” to take back my last change, then tell me again in other words — naming the place exactly as it’s written on the map, or selecting it and saying “this”, helps me get it right.', chips: [{ label: 'Undo', say: 'Undo' }, ...chips.slice(0, 2)] };
    case 'thanks':
      return { reply: `${isAmharic(text) ? 'ምንም አይደለም!' : "You're welcome!"} Anything else you'd like to change?`, chips };
    case 'help':
      return { reply: `I can change this map for you — just say it in your own words:\n• ${CAPABILITIES.join('\n• ')}\nEvery change can be undone.`, chips };
    case 'who':
      return { reply: "I'm Yet New's map assistant. Tell me what you want on the map in plain words and I'll do it — with a preview for bigger changes, and Undo after every one.", chips };
    case 'bye':
      return { reply: 'Bye! Your changes are saved as you go.', chips: [] };
    case 'yes':
      return { reply: "There's nothing waiting for a yes right now. What would you like to do?", chips };
    case 'no':
      return { reply: 'Okay — nothing changed. Tell me whenever you want something done.', chips };
    case 'ack':
      return { reply: issues ? state : 'Great! What next?', chips };
  }
}
