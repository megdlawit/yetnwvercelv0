/**
 * POIRanker — Module 4: Spatial Commerce
 *
 * Upgrades nearby POI sorting from Module 3's simple
 * (promoted → distance) to a weighted scoring model:
 *
 *   score = (promotionBoost × 0.5) + (distanceScore × 0.35) + (interactionScore × 0.15)
 *
 * Weights are intentionally conservative to keep discovery fair —
 * promoted POIs still surface higher, but nearby un-promoted POIs
 * don't get buried.
 */

import { POI, getActivePromotions } from '@/data/poi';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface RankInput {
  poi: POI;
  /** Distance in meters (outdoor) or map units (indoor). */
  distance: number;
  /** True if the user has previously interacted with this POI (viewed/expanded). */
  hasInteracted?: boolean;
}

export interface RankedPOI {
  poi: POI;
  distance: number;
  score: number;
  hasPromotion: boolean;
  isSponsored: boolean;
}

// ─── Scoring weights ─────────────────────────────────────────────────────────────

const W_PROMOTION = 0.50;
const W_DISTANCE  = 0.35;
const W_HISTORY   = 0.15;

/** Reference distance beyond which score → 0. Set to 200 m / px. */
const MAX_DISTANCE = 200;

// ─── Ranker ──────────────────────────────────────────────────────────────────────

export function rankNearbyPOIs(
  inputs: RankInput[],
  options: { maxResults?: number } = {}
): RankedPOI[] {
  const { maxResults = 10 } = options;

  const ranked: RankedPOI[] = inputs.map(({ poi, distance, hasInteracted }) => {
    const promos = getActivePromotions(poi);
    const hasPromotion = promos.length > 0;

    // Promotion boost: 1.0 if has active promo, else 0
    const promotionBoost = hasPromotion ? 1.0 : 0.0;

    // Distance score: linear decay from 1.0 at 0 m → 0.0 at MAX_DISTANCE
    const distanceScore = Math.max(0, 1 - distance / MAX_DISTANCE);

    // Interaction score: mild boost if user has seen/tapped this POI before
    const interactionScore = hasInteracted ? 1.0 : 0.0;

    const score =
      promotionBoost  * W_PROMOTION +
      distanceScore   * W_DISTANCE +
      interactionScore * W_HISTORY;

    return {
      poi,
      distance,
      score,
      hasPromotion,
      // "Sponsored" = has an active promotion (shown in UI with label)
      isSponsored: hasPromotion,
    };
  });

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
