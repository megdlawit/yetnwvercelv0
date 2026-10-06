// Every word the guidance shows or speaks, in English and Amharic.
// Keys, not inline strings: t(lang, 'step.right.at', { landmark }).
// Numbers stay in Western digits (how Amharic signage and phones write them).

import { t2, type IndoorFloor, type Lang, type Text2 } from '../model';
import type { Step, StepKind } from './steps';

type Dict = Record<string, string>;

const en: Dict = {
  'step.start': 'Start at {place}',
  'step.start.plain': 'Start walking',
  'step.continue': 'Continue straight for {distance}',
  'step.continue.to': 'Continue straight to {landmark}',
  'step.slight-left': 'Bear left',
  'step.slight-right': 'Bear right',
  'step.left': 'Turn left',
  'step.right': 'Turn right',
  'step.sharp-left': 'Turn sharp left',
  'step.sharp-right': 'Turn sharp right',
  'step.u-turn': 'Turn around',
  'step.slight-left.at': 'Bear left at {landmark}',
  'step.slight-right.at': 'Bear right at {landmark}',
  'step.left.at': 'Turn left at {landmark}',
  'step.right.at': 'Turn right at {landmark}',
  'step.sharp-left.at': 'Turn sharp left at {landmark}',
  'step.sharp-right.at': 'Turn sharp right at {landmark}',
  'step.u-turn.at': 'Turn around at {landmark}',
  'step.door': '{instruction} through the door',
  'step.stairs-up': 'Take the stairs up to {floor}',
  'step.stairs-down': 'Take the stairs down to {floor}',
  'step.elevator-up': 'Take the lift up to {floor}',
  'step.elevator-down': 'Take the lift down to {floor}',
  'step.escalator-up': 'Take the escalator up to {floor}',
  'step.escalator-down': 'Take the escalator down to {floor}',
  'step.ramp-up': 'Take the ramp up to {floor}',
  'step.ramp-down': 'Take the ramp down to {floor}',
  'step.destination-ahead': '{place} is ahead',
  'step.arrive': 'You have arrived at {place}',
  'step.arrive.plain': 'You have arrived',
  'step.in': 'In {distance}, {instruction}',
  'step.then': 'Then {instruction}',
  'now': 'Now',
  'hud.left': '{distance} left',
  'hud.arrive-at': 'arrive {time}',
  'hud.floor': 'Floor',
  'hud.step-free': 'Step-free route',
  'hud.steps-walked': '{n} steps',
  'nav.start': 'Starting your route to {place}',
  'nav.off-route': "You're off the route — finding a new way",
  'nav.rerouted': 'New route found',
  'nav.no-route': 'No route found to {place}',
  'nav.no-step-free': 'No step-free route to {place}',
  'nav.floor-now': "You're on {floor}",
  'nav.gps-lost': "GPS can't follow us in here — indoor guidance takes over",
  'nav.welcome': 'Welcome to {venue}',
  'nav.calibrate': 'Scan a QR code nearby so we know where you are',
  'nav.calibrated': 'Position set at {place}',
  'nav.arrived.title': "You're here",
  'nav.now-outside': "You're outside — continuing on the map",
  'nav.approaching-entrance': 'Approaching the entrance',
  'nav.entering': 'Entering {venue}',
  'hud.to': 'To {place}',
  'hud.from': 'From {place}',
  'hud.walking': 'Walking',
  'hud.paused': 'Paused',
  'hud.start-walking': 'Start walking',
  'hud.walked': '{n} m walked',
  'hud.recalculating': 'Recalculating route',
  'hud.getting-route': 'Getting your route',
  'hud.voice-on': 'Unmute voice guidance',
  'hud.voice-off': 'Mute voice guidance',
  'hud.cancel': 'End navigation',
  'hud.language': 'Language',
  'issue.room-unclosed': 'Room “{name}” isn’t a closed shape — redraw its outline',
  'issue.room-open-walls': 'Room “{name}” is only {percent}% walled in — add the missing walls',
  'issue.door-off-wall': 'This {kind} isn’t on a wall — move it onto one so an opening is cut',
  'issue.graph-disconnected': '{count} path points aren’t joined to the rest{name} — connect them',
  'issue.stairs-no-floor': 'These {kind} don’t lead to another floor — add the floor above or set where they go',
  'issue.stairs-unlinked': 'No path climbs these {kind} — join a path point on each floor to them',
  'issue.place-unroutable': '“{name}” can’t be reached by any path',
  'issue.path-through-wall': 'A path goes through a wall here — add a door or move the path',
  'walk.where': 'Where do you want to go?',
  'walk.from': 'From {place}',
  'walk.entrance': 'the entrance',
  'walk.to': 'Walking to {place}',
  'walk.walking': 'Walking…',
  'walk.arrived': "You're at {place} — where next?",
  'walk.stop': 'Stop',
  'list.heading': 'Directions',
  'list.arrive': 'Arrive at {place}',
  'list.your-location': 'your location',
  'list.destination': 'your destination',
  'unit.m': '{n} m',
  'unit.km': '{n} km',
  'unit.min': '{n} min',
  'unit.lt-min': 'under a minute',
  'unit.lt-min.short': '< 1 min',
  'floor.ground': 'the ground floor',
  'floor.level': 'floor {n}',
  'floor.basement': 'basement {n}',
  'mode.overview': 'Overview',
  'mode.top': 'Top',
  'mode.follow': 'Follow',
  'mode.walk': 'Walk',
};

const am: Dict = {
  'step.start': 'ከ{place} ይጀምሩ',
  'step.start.plain': 'መጓዝ ይጀምሩ',
  'step.continue': 'ለ{distance} ቀጥ ብለው ይሂዱ',
  'step.continue.to': 'እስከ {landmark} ቀጥ ብለው ይሂዱ',
  'step.slight-left': 'በትንሹ ወደ ግራ ይታጠፉ',
  'step.slight-right': 'በትንሹ ወደ ቀኝ ይታጠፉ',
  'step.left': 'ወደ ግራ ይታጠፉ',
  'step.right': 'ወደ ቀኝ ይታጠፉ',
  'step.sharp-left': 'ሙሉ በሙሉ ወደ ግራ ይታጠፉ',
  'step.sharp-right': 'ሙሉ በሙሉ ወደ ቀኝ ይታጠፉ',
  'step.u-turn': 'ወደ ኋላ ይዙሩ',
  'step.slight-left.at': '{landmark} ጋ በትንሹ ወደ ግራ ይታጠፉ',
  'step.slight-right.at': '{landmark} ጋ በትንሹ ወደ ቀኝ ይታጠፉ',
  'step.left.at': '{landmark} ጋ ወደ ግራ ይታጠፉ',
  'step.right.at': '{landmark} ጋ ወደ ቀኝ ይታጠፉ',
  'step.sharp-left.at': '{landmark} ጋ ሙሉ በሙሉ ወደ ግራ ይታጠፉ',
  'step.sharp-right.at': '{landmark} ጋ ሙሉ በሙሉ ወደ ቀኝ ይታጠፉ',
  'step.u-turn.at': '{landmark} ጋ ወደ ኋላ ይዙሩ',
  'step.door': 'በበሩ በኩል {instruction}',
  'step.stairs-up': 'በደረጃው ወደ {floor} ይውጡ',
  'step.stairs-down': 'በደረጃው ወደ {floor} ይውረዱ',
  'step.elevator-up': 'በሊፍቱ ወደ {floor} ይውጡ',
  'step.elevator-down': 'በሊፍቱ ወደ {floor} ይውረዱ',
  'step.escalator-up': 'በተንቀሳቃሹ ደረጃ ወደ {floor} ይውጡ',
  'step.escalator-down': 'በተንቀሳቃሹ ደረጃ ወደ {floor} ይውረዱ',
  'step.ramp-up': 'በተዳፋቱ መንገድ ወደ {floor} ይውጡ',
  'step.ramp-down': 'በተዳፋቱ መንገድ ወደ {floor} ይውረዱ',
  'step.destination-ahead': '{place} ከፊትዎ ነው',
  'step.arrive': '{place} ደርሰዋል',
  'step.arrive.plain': 'ደርሰዋል',
  'step.in': 'ከ{distance} በኋላ {instruction}',
  'step.then': 'ከዚያ {instruction}',
  'now': 'አሁን',
  'hud.left': '{distance} ቀርቷል',
  'hud.arrive-at': '{time} ይደርሳሉ',
  'hud.floor': 'ፎቅ',
  'hud.step-free': 'ደረጃ የሌለው መንገድ',
  'hud.steps-walked': '{n} እርምጃ',
  'nav.start': 'ወደ {place} የሚወስደውን መንገድ እንጀምራለን',
  'nav.off-route': 'ከመንገዱ ወጥተዋል — አዲስ መንገድ እየፈለግን ነው',
  'nav.rerouted': 'አዲስ መንገድ ተገኝቷል',
  'nav.no-route': 'ወደ {place} የሚወስድ መንገድ አልተገኘም',
  'nav.no-step-free': 'ወደ {place} ደረጃ የሌለው መንገድ አልተገኘም',
  'nav.floor-now': 'አሁን {floor} ላይ ነዎት',
  'nav.gps-lost': 'ጂፒኤስ እዚህ ውስጥ ሊከተለን አይችልም — የውስጥ መመሪያ ይቀጥላል',
  'nav.welcome': 'እንኳን ወደ {venue} በደህና መጡ',
  'nav.calibrate': 'ያሉበትን እንድናውቅ በአቅራቢያ ያለውን QR ኮድ ይቃኙ',
  'nav.calibrated': 'ቦታዎ {place} ላይ ተቀምጧል',
  'nav.arrived.title': 'ደርሰዋል',
  'nav.now-outside': 'አሁን ውጭ ነዎት — ጉዞውን በካርታው እንቀጥላለን',
  'nav.approaching-entrance': 'ወደ መግቢያው እየተቃረቡ ነው',
  'nav.entering': 'ወደ {venue} እየገቡ ነው',
  'hud.to': 'ወደ {place}',
  'hud.from': 'ከ{place}',
  'hud.walking': 'እየተጓዙ ነው',
  'hud.paused': 'ቆሟል',
  'hud.start-walking': 'መጓዝ ይጀምሩ',
  'hud.walked': '{n} ሜትር ተጉዘዋል',
  'hud.recalculating': 'መንገዱን እንደገና እያሰላን ነው',
  'hud.getting-route': 'መንገድዎን እያዘጋጀን ነው',
  'hud.voice-on': 'የድምፅ መመሪያን ያብሩ',
  'hud.voice-off': 'የድምፅ መመሪያን ያጥፉ',
  'hud.cancel': 'ጉዞውን ያቁሙ',
  'hud.language': 'ቋንቋ',
  'issue.room-unclosed': '“{name}” ክፍል የተዘጋ ቅርጽ አይደለም — ዙሪያውን እንደገና ይሳሉ',
  'issue.room-open-walls': '“{name}” ክፍል {percent}% ብቻ በግድግዳ የተከበበ ነው — የጎደሉትን ግድግዳዎች ይጨምሩ',
  'issue.door-off-wall': 'ይህ {kind} ግድግዳ ላይ አይደለም — ክፍተት እንዲቆረጥ ወደ ግድግዳ ያንቀሳቅሱት',
  'issue.graph-disconnected': '{count} የመንገድ ነጥቦች ከሌሎቹ ጋር አልተገናኙም{name} — ያገናኟቸው',
  'issue.stairs-no-floor': 'እነዚህ {kind} ወደ ሌላ ፎቅ አይወስዱም — ከላይ ያለውን ፎቅ ይጨምሩ ወይም መድረሻቸውን ይወስኑ',
  'issue.stairs-unlinked': 'እነዚህን {kind} የሚወጣ መንገድ የለም — በእያንዳንዱ ፎቅ ያለ የመንገድ ነጥብ ያገናኙ',
  'issue.place-unroutable': '“{name}” በየትኛውም መንገድ ሊደረስበት አይችልም',
  'issue.path-through-wall': 'እዚህ አንድ መንገድ በግድግዳ ውስጥ ያልፋል — በር ይጨምሩ ወይም መንገዱን ያንቀሳቅሱ',
  'walk.where': 'ወዴት መሄድ ይፈልጋሉ?',
  'walk.from': 'ከ{place}',
  'walk.entrance': 'መግቢያው',
  'walk.to': 'ወደ {place} እየሄዱ ነው',
  'walk.walking': 'እየሄዱ ነው…',
  'walk.arrived': '{place} ደርሰዋል — ቀጥሎ ወዴት?',
  'walk.stop': 'አቁም',
  'list.heading': 'አቅጣጫዎች',
  'list.arrive': '{place} ይደርሳሉ',
  'list.your-location': 'ያሉበት ቦታ',
  'list.destination': 'መድረሻዎ',
  'unit.m': '{n} ሜትር',
  'unit.km': '{n} ኪሎ ሜትር',
  'unit.min': '{n} ደቂቃ',
  'unit.lt-min': 'ከአንድ ደቂቃ ባነሰ',
  'unit.lt-min.short': '< 1 ደቂቃ',
  'floor.ground': 'ምድር ቤት',
  'floor.level': '{n}ኛ ፎቅ',
  'floor.basement': 'ምድር ቤት {n}',
  'mode.overview': 'አጠቃላይ እይታ',
  'mode.top': 'ከላይ',
  'mode.follow': 'ተከተል',
  'mode.walk': 'ተራመድ',
};

export const STRINGS: Record<Lang, Dict> = { en, am };

/** A string by key, with {params} filled in. Falls back to English, then to the key. */
export function t(lang: Lang, key: string, params: Record<string, string | number> = {}): string {
  const s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : ''));
}

/** "12 m", "1.2 km"; short distances rounded to 5 m once past 30 m (as people say them). */
export function formatDistance(m: number, lang: Lang): string {
  if (m >= 1000) return t(lang, 'unit.km', { n: (m / 1000).toFixed(1) });
  const n = m < 30 ? Math.max(1, Math.round(m)) : Math.round(m / 5) * 5;
  return t(lang, 'unit.m', { n });
}

export function formatDuration(seconds: number, lang: Lang, short = true): string {
  if (seconds < 60) return t(lang, short ? 'unit.lt-min.short' : 'unit.lt-min');
  return t(lang, 'unit.min', { n: Math.round(seconds / 60) });
}

/** A floor's name in the visitor's language; generic "floor 2" when the venue named it in English only. */
export function floorName(floor: IndoorFloor | undefined, lang: Lang): string {
  if (!floor) return '';
  if (lang === 'am' && floor.name.am) return floor.name.am;
  if (lang === 'en' && floor.name.en) return floor.name.en;
  if (floor.level === 0) return t(lang, 'floor.ground');
  return floor.level > 0 ? t(lang, 'floor.level', { n: floor.level }) : t(lang, 'floor.basement', { n: -floor.level });
}

const TURNS: StepKind[] = ['slight-left', 'left', 'sharp-left', 'slight-right', 'right', 'sharp-right', 'u-turn'];

/** One step as words: "Turn left at the Café", "Take the stairs up to floor 1", "You have arrived at the Gallery". */
export function stepText(step: Step, lang: Lang, floors: IndoorFloor[] = []): string {
  const name = (x: Text2 | null | undefined) => t2(x, lang);
  const floor = floorName(floors.find(f => f.id === step.toFloorId), lang);
  switch (step.kind) {
    case 'start': return name(step.place) ? t(lang, 'step.start', { place: name(step.place) }) : t(lang, 'step.start.plain');
    case 'continue': return name(step.landmark) ? t(lang, 'step.continue.to', { landmark: name(step.landmark) }) : t(lang, 'step.continue', { distance: formatDistance(step.distance, lang) });
    case 'arrive': return name(step.place) ? t(lang, 'step.arrive', { place: name(step.place) }) : t(lang, 'step.arrive.plain');
    default: break;
  }
  if (TURNS.includes(step.kind)) {
    const base = name(step.landmark) ? t(lang, `step.${step.kind}.at`, { landmark: name(step.landmark) }) : t(lang, `step.${step.kind}`);
    return step.door ? t(lang, 'step.door', { instruction: base }) : base;
  }
  return t(lang, `step.${step.kind}`, { floor });
}

/** The spoken form ahead of a step: "In 12 m, turn left". */
export function stepAhead(step: Step, metres: number, lang: Lang, floors: IndoorFloor[] = []): string {
  return t(lang, 'step.in', { distance: formatDistance(metres, lang), instruction: lowerFirst(stepText(step, lang, floors), lang) });
}

const lowerFirst = (s: string, lang: Lang) => (lang === 'en' ? s.charAt(0).toLowerCase() + s.slice(1) : s);
