/**
 * MerchantWallet — Module 4: Spatial Commerce
 *
 * Client-side wallet service that:
 *  1. Fetches merchant balance from Supabase
 *  2. Checks balance before allowing a promotion to display
 *  3. Charges 5 ETB per "Navigate Here" click (debit via RPC)
 *  4. Debounces charges: one charge per poi per session
 *
 * Server-side safety:
 *  The Supabase function `deduct_merchant_balance` runs in a transaction,
 *  returning {ok: true} only if balance >= cost. The client treats any
 *  non-ok response as "insufficient funds" and blocks the navigate action.
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Constants ──────────────────────────────────────────────────────────────────

const COST_PER_CLICK_ETB = 5;

// ─── Session dedup ──────────────────────────────────────────────────────────────

/** Tracks POI IDs that have already been charged this session. */
const chargedPois = new Set<string>();

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface MerchantBalance {
  merchant_id: string;
  balance: number;
}

export interface ChargeResult {
  success: boolean;
  newBalance?: number;
  reason?: 'insufficient_funds' | 'already_charged' | 'no_merchant' | 'rpc_error';
}

// ─── Balance fetch ───────────────────────────────────────────────────────────────

export async function getMerchantBalance(merchantId: string): Promise<MerchantBalance | null> {
  const { data, error } = await supabase
    .from('merchant_wallets')
    .select('merchant_id, balance')
    .eq('merchant_id', merchantId)
    .single();

  if (error || !data) return null;
  return data as MerchantBalance;
}

// ─── Guard: is promotion payable? ───────────────────────────────────────────────

/**
 * Returns true if the merchant has sufficient balance to show a promoted POI.
 * Cached per-poi for 60 s to avoid hammering the DB on every proximity update.
 */
const balanceCache = new Map<string, { ok: boolean; ts: number }>();
const CACHE_TTL_MS = 60_000;

export async function isPromotionPayable(merchantId: string): Promise<boolean> {
  const cached = balanceCache.get(merchantId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.ok;

  const wallet = await getMerchantBalance(merchantId);
  const ok = wallet != null && wallet.balance > 0;
  balanceCache.set(merchantId, { ok, ts: Date.now() });
  return ok;
}

/** Invalidate balance cache entry (call after a successful charge). */
function invalidateBalanceCache(merchantId: string): void {
  balanceCache.delete(merchantId);
}

// ─── Charge on navigate click ────────────────────────────────────────────────────

/**
 * Deducts COST_PER_CLICK_ETB from the merchant's wallet.
 * Returns ChargeResult — callers MUST check `.success` before proceeding.
 *
 * Guarantees:
 *  • Only one charge per (poiId, session) — subsequent calls return already_charged.
 *  • Server-side RPC enforces balance >= cost atomically.
 */
export async function chargeNavigateClick(
  poiId: string,
  merchantId: string
): Promise<ChargeResult> {
  // Session dedup — only one charge per POI per session
  if (chargedPois.has(poiId)) {
    return { success: true, reason: 'already_charged' };
  }

  // Call the server-side RPC for atomic deduction
  const { data, error } = await supabase.rpc('deduct_merchant_balance', {
    p_merchant_id: merchantId,
    p_amount: COST_PER_CLICK_ETB,
  }) as { data: { ok: boolean; new_balance: number } | null; error: unknown };

  if (error || !data) {
    console.warn('[MerchantWallet] RPC error:', error);
    return { success: false, reason: 'rpc_error' };
  }

  if (!data.ok) {
    return { success: false, reason: 'insufficient_funds' };
  }

  // Mark as charged for this session & bust cache
  chargedPois.add(poiId);
  invalidateBalanceCache(merchantId);

  return { success: true, newBalance: data.new_balance };
}

/** Expose cost for UI display. */
export const NAVIGATE_CLICK_COST_ETB = COST_PER_CLICK_ETB;
