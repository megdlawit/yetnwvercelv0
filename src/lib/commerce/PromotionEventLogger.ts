/**
 * PromotionEventLogger — Module 4: Spatial Commerce
 *
 * Logs promotion interaction events to Supabase.
 * Events fired: promotion_view | promotion_expand | promotion_click_navigate | promotion_dismiss
 *
 * Design:
 *  • Fire-and-forget with local in-memory queue for retries
 *  • Attaches user_position, environment, poi_id, promotion_id, timestamp
 *  • Exported as a singleton so POICard & HOOKs share the same instance
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type PromotionEventType =
  | 'promotion_view'
  | 'promotion_expand'
  | 'promotion_click_navigate'
  | 'promotion_dismiss';

export type Environment = 'indoor' | 'outdoor' | 'unknown';

export interface PromotionEventPayload {
  event_type: PromotionEventType;
  poi_id: string;
  promotion_id: string | null;
  timestamp: string;        // ISO-8601
  user_lat: number | null;
  user_lng: number | null;
  user_x: number | null;
  user_y: number | null;
  environment: Environment;
  session_id: string;
}

export interface UserPosition {
  lat?: number | null;
  lng?: number | null;
  x?: number | null;
  y?: number | null;
  environment?: Environment;
}

// ─── Singleton ──────────────────────────────────────────────────────────────────

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `sess-${Date.now()}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}

const SESSION_ID = createSessionId();

/** In-memory retry queue for events that failed to flush. */
const retryQueue: PromotionEventPayload[] = [];

async function flushRetryQueue(): Promise<void> {
  if (retryQueue.length === 0) return;
  const batch = retryQueue.splice(0, retryQueue.length);
  const { error } = await supabase.from('promotion_events').insert(batch);
  if (error) {
    // Put them back (avoid infinite growth — drop after 50 events)
    retryQueue.push(...batch.slice(0, 50 - retryQueue.length));
  }
}

async function sendEvent(payload: PromotionEventPayload): Promise<void> {
  try {
    const { error } = await supabase.from('promotion_events').insert([payload]);
    if (error) {
      console.warn('[PromotionEventLogger] insert error, queuing:', error.message);
      retryQueue.push(payload);
    }
  } catch (err) {
    console.warn('[PromotionEventLogger] network error, queuing:', err);
    retryQueue.push(payload);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────────

export function logPromotionEvent(
  eventType: PromotionEventType,
  poiId: string,
  promotionId: string | null,
  userPosition: UserPosition = {}
): void {
  const payload: PromotionEventPayload = {
    event_type: eventType,
    poi_id: poiId,
    promotion_id: promotionId,
    timestamp: new Date().toISOString(),
    user_lat: userPosition.lat ?? null,
    user_lng: userPosition.lng ?? null,
    user_x: userPosition.x ?? null,
    user_y: userPosition.y ?? null,
    environment: userPosition.environment ?? 'unknown',
    session_id: SESSION_ID,
  };

  // Fire-and-forget; also attempt to drain retry queue opportunistically
  void sendEvent(payload);
  void flushRetryQueue();
}
