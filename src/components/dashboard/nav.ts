// The dashboard's sections, in sidebar order.

import {
  LayoutDashboard, Map, PenTool, Square, MapPin, Layers, Landmark, CalendarDays, Route, Accessibility,
  BookOpen, Compass, Images, Megaphone, DoorOpen, QrCode, Settings2, Users, Globe,
} from 'lucide-react';
import type { ContentKind } from '@/lib/venue/places';

export interface NavItem { label: string; icon: typeof Map; to?: string; editor?: true }
export const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'Overview', items: [{ label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' }] },
  {
    title: 'My venue', items: [
      { label: 'View Map', icon: Map, to: '/dashboard/map' },
      { label: 'Map Editor', icon: PenTool, editor: true },
      { label: 'Areas', icon: Square, to: '/dashboard/areas' },
      { label: 'Places', icon: MapPin, to: '/dashboard/places' },
      { label: 'Floors', icon: Layers, to: '/dashboard/floors' },
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
