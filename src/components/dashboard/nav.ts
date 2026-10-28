// The dashboard's sections, in sidebar order.

import {
  LayoutDashboard, Map, PenTool, Square, MapPin, Layers, Landmark, CalendarDays, Route, Accessibility,
  BookOpen, Compass, Images, Megaphone, DoorOpen, QrCode, Settings2, Users, Globe, Flag, BarChart3,
} from 'lucide-react';
import type { ContentKind } from '@/lib/venue/places';

export interface NavItem { label: string; icon: typeof Map; to?: string; editor?: true }
export const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'Overview', items: [{ label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' }, { label: 'Insights', icon: BarChart3, to: '/dashboard/insights' }] },
  {
    title: 'My venue', items: [
      { label: 'View Map', icon: Map, to: '/dashboard/map' },
      { label: 'Map Editor', icon: PenTool, editor: true },
      { label: 'Areas', icon: Square, to: '/dashboard/areas' },
      { label: 'Places', icon: MapPin, to: '/dashboard/places' },
      { label: 'Floors', icon: Layers, to: '/dashboard/floors' },
      { label: 'Reports', icon: Flag, to: '/dashboard/reports' },
    ],
  },
  {
    title: 'Experience', items: [
      { label: 'Attractions', icon: Landmark, to: '/dashboard/attractions' },
      { label: 'Events', icon: CalendarDays, to: '/dashboard/events' },
      { label: 'Tours', icon: Route, to: '/dashboard/tours' },
      { label: 'Accessibility', icon: Accessibility, to: '/dashboard/accessibility' },
    ],
  },
  {
    title: 'Content', items: [
      { label: 'Stories', icon: BookOpen, to: '/dashboard/stories' },
      { label: 'Visitor Guides', icon: Compass, to: '/dashboard/guides' },
      { label: 'Media', icon: Images, to: '/dashboard/media' },
      { label: 'Announcements', icon: Megaphone, to: '/dashboard/announcements' },
    ],
  },
  {
    title: 'QR & Entry', items: [
      { label: 'Entry Points', icon: DoorOpen, to: '/dashboard/entry-points' },
      { label: 'QR Codes', icon: QrCode, to: '/dashboard/qr' },
    ],
  },
  {
    title: 'Settings', items: [
      { label: 'Venue Settings', icon: Settings2, to: '/dashboard/settings' },
      { label: 'Team', icon: Users, to: '/dashboard/team' },
      { label: 'Publish Settings', icon: Globe, to: '/dashboard/publish' },
    ],
  },
];

/**
 * The sidebar: six plain sections. Related pages are tabs inside a section,
 * so nothing is hidden — there's just less to read at once.
 */
export interface Section { label: string; icon: typeof Map; hint: string; tabs: { label: string; to: string }[] }
export const SECTIONS: Section[] = [
  { label: 'Home', icon: LayoutDashboard, hint: 'How your venue is doing', tabs: [{ label: 'Home', to: '/dashboard' }, { label: 'Insights', to: '/dashboard/insights' }] },
  { label: 'Map', icon: Map, hint: 'See and edit your map', tabs: [
    { label: 'Your map', to: '/dashboard/map' }, { label: 'Floors', to: '/dashboard/floors' }, { label: 'Areas', to: '/dashboard/areas' },
  ] },
  { label: 'Places', icon: MapPin, hint: 'What visitors can find', tabs: [
    { label: 'All places', to: '/dashboard/places' }, { label: 'Attractions', to: '/dashboard/attractions' }, { label: 'Accessibility', to: '/dashboard/accessibility' },
    { label: 'Reports', to: '/dashboard/reports' },
  ] },
  { label: "What's on", icon: CalendarDays, hint: 'Events, tours and stories', tabs: [
    { label: 'Events', to: '/dashboard/events' }, { label: 'Tours', to: '/dashboard/tours' }, { label: 'Stories', to: '/dashboard/stories' },
    { label: 'Visitor guides', to: '/dashboard/guides' }, { label: 'Announcements', to: '/dashboard/announcements' }, { label: 'Photos', to: '/dashboard/media' },
  ] },
  { label: 'Share', icon: QrCode, hint: 'QR codes and going live', tabs: [
    { label: 'QR codes', to: '/dashboard/qr' }, { label: 'Entrances', to: '/dashboard/entry-points' }, { label: 'Publishing', to: '/dashboard/publish' },
  ] },
  { label: 'Settings', icon: Settings2, hint: 'Your venue and team', tabs: [
    { label: 'Venue', to: '/dashboard/settings' }, { label: 'Team', to: '/dashboard/team' },
  ] },
];

/** The section a page belongs to. */
export function sectionOf(pathname: string): Section | undefined {
  const p = pathname.replace(/\/$/, '') || '/dashboard';
  return SECTIONS.find(s => s.tabs.some(t => t.to === p));
}

/** Where each kind of content is managed. */
export function contentPath(kind: ContentKind): string {
  switch (kind) {
    case 'event': return '/dashboard/events';
    case 'tour': return '/dashboard/tours';
    case 'guide': return '/dashboard/guides';
    case 'announcement': return '/dashboard/announcements';
    default: return '/dashboard/stories';
  }
}
