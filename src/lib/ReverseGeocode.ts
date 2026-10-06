/**
 * reverseGeocode — resolves a tapped (lat, lng) point on the outdoor map
 * into a real place name + details, via OpenStreetMap's Nominatim reverse
 * endpoint. This is the reverse-lookup counterpart to useOutdoorPlaceSearch
 * (which does forward text search on the same Nominatim service) — used
 * when the user taps an empty spot on the map rather than typing a query,
 * so that tap can show something better than a generic "Selected location"
 * placeholder.
 */

const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
/** Hard cap on how long we wait for the lookup before giving up and letting
 *  the caller fall back to a generic label. Without this, a slow/hanging
 *  Nominatim response left the tapped pin stuck on its "Locating…"
 *  placeholder indefinitely. */
const REVERSE_GEOCODE_TIMEOUT_MS = 7_000;

export interface ReverseGeocodeResult {
  /** Short label — best available name for the point, e.g. "Meskel Square". */
  name: string;
  /** Full OSM display name, e.g. "Meskel Square, Kirkos, Addis Ababa". */
  displayName: string;
  /** OSM place/category type, e.g. "square", "cafe", "road". */
  type: string;
}

interface NominatimReverseResponse {
  name?: string;
  display_name?: string;
  type?: string;
  category?: string;
  address?: Record<string, string>;
}

/** Address-tag priority order for picking a short label when Nominatim's
 *  top-level `name` is blank (very common for plain address-level results —
 *  it only fills `name` for named features like squares, parks, venues). */
const NAME_FALLBACK_KEYS = [
  'amenity', 'shop', 'tourism', 'leisure', 'building',
  'road', 'neighbourhood', 'suburb',
] as const;

function pickFallbackName(address: Record<string, string> | undefined, displayName: string): string {
  if (address) {
    for (const key of NAME_FALLBACK_KEYS) {
      if (address[key]) return address[key];
    }
  }
  // Last resort: first comma-separated segment of the full display name.
  const firstSegment = displayName.split(',')[0]?.trim();
  return firstSegment || 'Selected location';
}

/** Resolves a lat/lng into a name/details, or null if the lookup fails or
 *  returns nothing usable. Never throws — callers should just keep the
 *  placeholder pin on null. */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<ReverseGeocodeResult | null> {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), REVERSE_GEOCODE_TIMEOUT_MS);
  // Combine the caller's abort signal (e.g. a newer tap superseding this
  // one) with our own timeout, so either can cut the request short.
  const onCallerAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', onCallerAbort);

  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: String(lat),
      lon: String(lng),
      zoom: '18',
    });

    const res = await fetch(`${NOMINATIM_REVERSE_URL}?${params.toString()}`, {
      signal: timeoutController.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Nominatim reverse ${res.status}`);

    const data = (await res.json()) as NominatimReverseResponse;
    const displayName = data.display_name ?? '';
    if (!displayName) return null;

    const name = data.name?.trim() || pickFallbackName(data.address, displayName);
    const type = data.type || data.category || 'place';

    return { name, displayName, type };
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return null;
    // eslint-disable-next-line no-console
    console.warn('[reverseGeocode] lookup failed', e);
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}