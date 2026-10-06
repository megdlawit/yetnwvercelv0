// What the visitor app works with: places (map spots enriched with the
// institution's details), floors, and the category icons.

import { Landmark, Flower2, Baby, Coffee, Bath, SquareParking, DoorOpen, Info } from 'lucide-react';
import type { Room } from '@/data/types';
import type { Accessibility } from '@/lib/venue/places';
import type { DiscoverPlace, VisitorCategory } from '@/lib/venue/discover';

export const PX_PER_METER = 40;

export interface Place extends DiscoverPlace {
  /** The node id — what routing navigates to. */
  id: string;
  floorName: string;
  floorLevel: number;
  room?: Room;
  /** The institution's details row, when there is one. */
  poiId?: string;
  access: Accessibility;
  navigable: boolean;
  gps: { lat: number; lng: number } | null;
  /** Greet visitors within this many metres (0 = only when inside the place's area). */
  greetRadiusM: number;
}

export interface Floor {
  id: string; name: string; level: number;
  // Indoor 3D model (20261006090000); absent until that migration has run.
  elevation_m?: number | null; ceiling_height_m?: number | null; sort_order?: number | null; name_am?: string | null;
}

export const CATEGORY_ICONS: Record<VisitorCategory, typeof Landmark> = {
  attractions: Landmark, gardens: Flower2, family: Baby, food: Coffee, restrooms: Bath, parking: SquareParking, entrances: DoorOpen, facilities: Info,
};

/** One colour per kind of place: map pins (2D and 3D), list icons and chips all match. */
export const CATEGORY_COLORS: Record<VisitorCategory, string> = {
  attractions: '#7c3aed', gardens: '#16a34a', family: '#db2777', food: '#d97706',
  restrooms: '#0284c7', parking: '#475569', entrances: '#059669', facilities: '#4f46e5',
};

/** Where the visitor is, and how we know. */
export interface VisitorPosition { x: number; y: number; floorId: string; floorLevel: number; source: 'qr' | 'gps' | 'steps' | 'picked' }
