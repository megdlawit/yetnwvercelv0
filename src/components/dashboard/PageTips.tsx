// "How this page works" — shown the first time someone opens a dashboard
// page, then remembered as seen (per person, in this browser).

import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Lightbulb, X, MapPin, Landmark, CalendarDays, Route, BookOpen, Compass, Megaphone, Images, DoorOpen, QrCode, Square,
  Layers, Accessibility, Users, Globe, Settings2, Map as MapIcon,
} from 'lucide-react';

const TIPS: Record<string, { icon: typeof MapPin; title: string; points: string[] }> = {
  '/dashboard/map': { icon: MapIcon, title: 'This is exactly what visitors see', points: ['Switch between desktop and phone size.', 'It includes changes you haven\'t published yet — visitors only get them when you publish.'] },
  '/dashboard/places': { icon: MapPin, title: 'Places come from your map', points: ['Every named spot in the map editor shows up here automatically.', 'Click Edit to add photos, opening hours and accessibility.', 'Use the switches to hide a place or turn off directions to it.'] },
  '/dashboard/attractions': { icon: Landmark, title: 'Show off your highlights', points: ['Attractions, gardens, viewpoints, cultural sites and play areas live here.', 'Turn on Featured to put an attraction at the top of the visitor list.', 'A good photo makes all the difference.'] },
  '/dashboard/events': { icon: CalendarDays, title: 'Events appear under “What\'s on”', points: ['Give each event a start and end time — it disappears by itself when it ends.', 'Link it to a place so visitors can get directions there.'] },
  '/dashboard/tours': { icon: Route, title: 'Build a guided route', points: ['Pick the stops in visiting order; use the arrows to reorder.', 'Visitors press “Start the tour” and get directions stop by stop.'] },
  '/dashboard/stories': { icon: BookOpen, title: 'Tell the story behind your places', points: ['History, legends, nature facts — short and with a picture works best.', 'Link a story to a place and it appears when visitors open that place.'] },
  '/dashboard/guides': { icon: Compass, title: 'Help people plan their visit', points: ['Opening times, tickets, what to bring, visiting with children.', 'Guides show under “Discover” in the visitor app.'] },
  '/dashboard/announcements': { icon: Megaphone, title: 'Short notices for visitors', points: ['Closures, changes, special offers.', 'Set an end time and it disappears automatically.'] },
  '/dashboard/media': { icon: Images, title: 'All your photos in one place', points: ['Photos are added from a place or a piece of content.', 'Click any photo to open what it belongs to.'] },
  '/dashboard/entry-points': { icon: DoorOpen, title: 'Where visitors arrive', points: ['Mark your gates, entrances and car parks.', 'Each gets a QR code — scanning it starts the visitor at that spot with directions ready.'] },
  '/dashboard/qr': { icon: QrCode, title: 'Print and place your QR codes', points: ['Enter your public website address first, so phones can open the codes.', 'Print the whole sheet, or download one PNG at a time for signs.'] },
  '/dashboard/areas': { icon: Square, title: 'Name the parts of your venue', points: ['Areas are detected from your plan. Give each a name visitors understand.', 'Set Stairs and Elevator areas so step-free directions work.'] },
  '/dashboard/floors': { icon: Layers, title: 'Floors or zones', points: ['Buildings have floors; outdoor sites have zones like “Lake Area”.', 'Each one has its own map in the editor.'] },
  '/dashboard/accessibility': { icon: Accessibility, title: 'Make your venue welcoming for everyone', points: ['Tick what each place offers — it shows on the place for visitors.', 'Mark elevators under Areas so step-free routes can change floors.'] },
  '/dashboard/team': { icon: Users, title: 'Invite your team', points: ['Give each person their own username and password.', 'Editors can change everything except the team; owners manage the team too.'] },
  '/dashboard/publish': { icon: Globe, title: 'Nothing goes live by accident', points: ['Your edits stay private until you publish.', 'Share the public link, or take the venue offline any time.'] },
  '/dashboard/settings': { icon: Settings2, title: 'Make it yours', points: ['Place your venue on the world map: drag the satellite map until your plan lines up with the real site.', 'Pick a theme — it colours the 3D world, the outdoor map and the visitor app.', 'Add your logo and a short description for visitors.'] },
};

const KEY = 'yetnew-tips-seen';
const readSeen = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };

export default function PageTip({ hidden }: { hidden?: boolean }) {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState(readSeen);
  const tip = TIPS[pathname.replace(/\/$/, '')];
  if (hidden || !tip || seen.includes(pathname) || seen.includes('*')) return null;
  const dismiss = (all = false) => {
    const next = all ? [...seen, '*'] : [...seen, pathname];
    setSeen(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  return (
    <div className="relative mb-6 flex gap-4 overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5 print:hidden" role="note">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25"><tip.icon className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1 pr-6">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary"><Lightbulb className="h-3.5 w-3.5" /> How this page works</p>
        <p className="mt-0.5 font-semibold">{tip.title}</p>
        <ul className="mt-1.5 space-y-0.5 text-sm text-muted-foreground">{tip.points.map(p => <li key={p}>• {p}</li>)}</ul>
        <div className="mt-3 flex gap-3 text-xs font-medium">
          <button onClick={() => dismiss()} className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground hover:opacity-90">Got it</button>
          <button onClick={() => dismiss(true)} className="text-muted-foreground hover:text-foreground">Don't show tips</button>
        </div>
      </div>
      <button onClick={() => dismiss()} className="absolute right-3 top-3 rounded-lg p-1 text-muted-foreground hover:bg-background/60" aria-label="Dismiss tip"><X className="h-4 w-4" /></button>
    </div>
  );
}

/** Lets "Replay the tour" bring the page tips back too. */
export function resetPageTips() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
