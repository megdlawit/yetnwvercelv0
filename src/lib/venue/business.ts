// Business places (business plan §18): what a hotel, restaurant, café or shop tells visitors —
// contact, prices, amenities — and how visitors reach them. Visitors contact the business
// directly; Yet New takes no bookings or payments (plan §18.2–18.3, DR-004).

import type { Tables } from '@/integrations/supabase/types';
import type { PlaceType } from './places';

export type BusinessProfileRow = Tables<'business_profiles'>;

export const AMENITIES = {
  wifi: 'Wi-Fi',
  card: 'Cards accepted',
  mobile_money: 'Mobile money (telebirr)',
  parking: 'Parking',
  wheelchair: 'Wheelchair access',
  outdoor_seating: 'Outdoor seating',
  family: 'Family friendly',
  vegetarian: 'Vegetarian options',
  fasting: 'Fasting food (ጾም)',
  breakfast: 'Breakfast',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
  air_conditioning: 'Air conditioning',
  restaurant: 'Restaurant on site',
  pool: 'Swimming pool',
  airport_shuttle: 'Airport shuttle',
  meeting_room: 'Meeting room',
  guided_tours: 'Guided tours',
  souvenirs: 'Souvenirs',
} as const;
export type Amenity = keyof typeof AMENITIES;
export const isAmenity = (a: string): a is Amenity => a in AMENITIES;

/** The amenities worth offering first for a kind of place (all are always available). */
export function suggestedAmenities(type: PlaceType | null | undefined): Amenity[] {
  if (type === 'hotel') return ['wifi', 'breakfast', 'parking', 'restaurant', 'pool', 'airport_shuttle', 'air_conditioning', 'meeting_room', 'card', 'mobile_money', 'wheelchair'];
  if (type === 'shop') return ['card', 'mobile_money', 'souvenirs', 'delivery', 'parking', 'wheelchair'];
  return ['wifi', 'card', 'mobile_money', 'outdoor_seating', 'vegetarian', 'fasting', 'takeaway', 'delivery', 'family', 'wheelchair', 'parking'];
}

export const PRICE_RANGES = { $: 'Budget', $$: 'Moderate', $$$: 'Upscale', $$$$: 'Luxury' } as const;
export type PriceRange = keyof typeof PRICE_RANGES;
export const isPriceRange = (p: unknown): p is PriceRange => typeof p === 'string' && p in PRICE_RANGES;

/** Digits only, Ethiopian numbers made international: "0911 22 33 44" → "251911223344". */
export function internationalDigits(phone: string): string | null {
  let d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) {
    d = d.slice(1);
  } else if (d.startsWith('00')) {
    d = d.slice(2);
  } else if (d.startsWith('0') && d.length === 10) {
    d = `251${d.slice(1)}`;            // local Ethiopian number: 09…, 07…, 011…
  } else if (d.length === 9 && /^[79]/.test(d)) {
    d = `251${d}`;                     // mobile number without its leading 0
  } else {
    // already international, or something we leave as typed
  }
  d = d.replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export const telHref = (phone: string | null | undefined): string | null => {
  const d = phone ? internationalDigits(phone) : null;
  return d ? `tel:+${d}` : null;
};
export const whatsappHref = (phone: string | null | undefined): string | null => {
  const d = phone ? internationalDigits(phone) : null;
  return d ? `https://wa.me/${d}` : null;
};
/** A website as a safe link: http(s) only; "tomoca.com" becomes "https://tomoca.com". */
export function websiteHref(site: string | null | undefined): string | null {
  const s = site?.trim();
  if (!s) {
    return null;
  } else {
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
    } catch {
      return null;
    }
  }
}
export const mailHref = (email: string | null | undefined): string | null =>
  email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? `mailto:${email.trim()}` : null;
/** "tomoca.com" from "https://www.tomoca.com/menu". */
export const websiteLabel = (href: string): string => { try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return href; } };

/** What the visitor app shows about a business place (null when there's nothing worth showing). */
export interface BusinessInfo {
  about: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  priceRange: PriceRange | null;
  priceNote: string | null;
  amenities: Amenity[];
  bookingNote: string | null;
  /** A business manages this listing (its claim was approved). */
  claimed: boolean;
}

export function businessInfo(row: Partial<BusinessProfileRow> | null | undefined): BusinessInfo | null {
  if (row) {
    const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
    const info: BusinessInfo = {
      about: clean(row.about), phone: clean(row.phone), whatsapp: clean(row.whatsapp), email: clean(row.email), website: clean(row.website),
      priceRange: isPriceRange(row.price_range) ? row.price_range : null, priceNote: clean(row.price_note),
      amenities: (row.amenities ?? []).filter(isAmenity), bookingNote: clean(row.booking_note), claimed: !!row.business_id,
    };
    const empty = !info.about && !info.phone && !info.whatsapp && !info.email && !info.website && !info.priceRange && !info.priceNote
      && !info.amenities.length && !info.bookingNote && !info.claimed;
    return empty ? null : info;
  } else {
    return null;
  }
}

// ── Reviews ──────────────────────────────────────────────────────────────────

export type ReviewRow = Tables<'place_reviews'>;
export interface ReviewSummary { rating: number; reviews: number }

/** "4.5" or "4" — one decimal only when it says something. */
export const ratingText = (r: number): string => (Math.round(r * 10) % 10 === 0 ? String(Math.round(r)) : r.toFixed(1));
export const reviewsText = (n: number): string => `${n.toLocaleString('en')} review${n === 1 ? '' : 's'}`;

/** How many of each star, 5 down to 1, for the bars above a list of reviews. */
export function starCounts(reviews: Pick<ReviewRow, 'rating'>[]): { stars: number; count: number }[] {
  return [5, 4, 3, 2, 1].map(stars => ({ stars, count: reviews.filter(r => r.rating === stars).length }));
}

export const REVIEW_MAX = 1500;
export const REVIEW_NAME_MAX = 60;

/** Where a review's text and stars stand before posting: null when it can go. */
export function reviewProblem(rating: number, name: string, body: string): string | null {
  if (!(rating >= 1 && rating <= 5)) {
    return 'Choose 1 to 5 stars.';
  } else if (!name.trim()) {
    return 'Add the name to show with your review.';
  } else if (name.trim().length > REVIEW_NAME_MAX) {
    return `Keep the name under ${REVIEW_NAME_MAX} characters.`;
  } else if (body.length > REVIEW_MAX) {
    return `Keep it under ${REVIEW_MAX.toLocaleString('en')} characters.`;
  } else {
    return null;
  }
}
