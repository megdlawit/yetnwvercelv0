/**
 * POI (Points of Interest) types — Experience layer for the navigation platform.
 * POIs are attached to navigation nodes and provide context-aware information,
 * media, and commercial promotions during navigation.
 */

import {
  ShoppingBag, Sparkles, Info, GraduationCap,
  Store, UtensilsCrossed, Coffee, Croissant, Shirt,
  PawPrint, Image as ImageIcon, Landmark, Trees, Droplets,
  Wallet, MessageCircle, DoorOpen, Plug, Shield,
  School, FlaskConical, BookOpen, Mic,
  type LucideIcon,
} from 'lucide-react';

export type POICategory = 'retail' | 'attraction' | 'service' | 'education';

export interface POI {
  id: string;
  /** Indoor graph node id. Optional for outdoor-only POIs. */
  nodeId: string | null;
  buildingId: string;
  name: string;
  description: string;
  category: POICategory;
  subcategory: string;
  imageUrl?: string | null;
  audioUrl?: string | null;
  isFeatured: boolean;
  triggerRadius: number; // meters / map units
  promotions: Promotion[];
  /** Outdoor POIs carry GPS coordinates instead of (or in addition to) a node id. */
  lat?: number | null;
  lng?: number | null;
  isOutdoor: boolean;
}

export interface Promotion {
  id: string;
  poiId: string;
  title: string;
  description: string;
  discountText: string;
  badgeColor: string;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive: boolean;
}

/** Visual mapping for category → icon + accent color */
export const POI_CATEGORY_META: Record<POICategory, { icon: LucideIcon; label: string; tone: string }> = {
  retail:     { icon: ShoppingBag,    label: 'Shop',       tone: 'hsl(280 70% 55%)' },
  attraction: { icon: Sparkles,       label: 'Attraction', tone: 'hsl(35 90% 55%)' },
  service:    { icon: Info,           label: 'Service',    tone: 'hsl(200 80% 50%)' },
  education:  { icon: GraduationCap,  label: 'Education',  tone: 'hsl(150 60% 45%)' },
};

/** Sub-category specific icons (fallback to category icon). */
export const POI_SUBCATEGORY_ICON: Record<string, LucideIcon> = {
  // retail
  shop: Store, restaurant: UtensilsCrossed, cafe: Coffee, bakery: Croissant, boutique: Shirt,
  // attractions
  animal: PawPrint, exhibit: ImageIcon, landmark: Landmark, garden: Trees, fountain: Droplets,
  // service
  atm: Wallet, info: MessageCircle, restroom: DoorOpen, charging: Plug, security: Shield,
  // education
  classroom: School, lab: FlaskConical, library: BookOpen, auditorium: Mic,
};

export function getPOIIcon(poi: POI): LucideIcon {
  return POI_SUBCATEGORY_ICON[poi.subcategory?.toLowerCase()] || POI_CATEGORY_META[poi.category].icon;
}

export function hasActivePromotions(poi: POI): boolean {
  const now = Date.now();
  return poi.promotions.some(p => {
    if (!p.isActive) return false;
    if (p.startsAt && new Date(p.startsAt).getTime() > now) return false;
    if (p.endsAt && new Date(p.endsAt).getTime() < now) return false;
    return true;
  });
}

export function getActivePromotions(poi: POI): Promotion[] {
  const now = Date.now();
  return poi.promotions.filter(p => {
    if (!p.isActive) return false;
    if (p.startsAt && new Date(p.startsAt).getTime() > now) return false;
    if (p.endsAt && new Date(p.endsAt).getTime() < now) return false;
    return true;
  });
}
