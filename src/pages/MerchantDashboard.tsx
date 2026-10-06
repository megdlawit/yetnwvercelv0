/**
 * MerchantDashboard — Module 4: Spatial Commerce
 *
 * Restyled to match the main park app's visual identity: dark-green header,
 * soft shadowed cards, all-caps tracking-wide section labels, tinted icon
 * badges, and pill-shaped controls — same language as ProfilePage and
 * IndoorTrackingModal.
 *
 * Metrics dashboard for a merchant / admin to inspect promotion performance
 * per POI: Views, Expands, Clicks, Dismissals, CTR, and wallet balance.
 *
 * Route: /merchant
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMerchantMetrics } from '@/hooks/useMerchantMetrics';
import { POI } from '@/data/poi';
import AdminHeader from '@/components/admin/AdminHeader';
import {
  Eye,
  MousePointerClick,
  Navigation,
  X,
  TrendingUp,
  Wallet,
  RefreshCw,
  Zap,
  AlertTriangle,
  Tag,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface WalletInfo {
  merchant_id: string;
  balance: number;
  currency: string;
}

// ─── Shared visual primitives (mirrors ProfilePage's Section/Row language) ──────

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <p
      className="text-[10px] font-black uppercase tracking-widest mb-2 px-1"
      style={{ color: 'hsl(var(--muted-foreground))' }}
    >
      {title}
    </p>
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'hsl(var(--card))', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
    >
      {children}
    </div>
  </div>
);

const ICON_BG: Record<string, string> = {
  green: 'hsl(152 70% 22% / 0.10)',
  amber: 'hsl(38 80% 50% / 0.12)',
  blue:  'hsl(210 80% 50% / 0.10)',
  red:   'hsl(var(--destructive) / 0.10)',
};
const ICON_COLOR: Record<string, string> = {
  green: 'hsl(152 70% 26%)',
  amber: 'hsl(38 70% 40%)',
  blue:  'hsl(210 70% 40%)',
  red:   'hsl(var(--destructive))',
};

// ─── Stat card — rounded thumbnail icon + bold figure, matches ProfilePage stat tiles ──

const StatCard: React.FC<{
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone: 'green' | 'amber' | 'blue' | 'red';
  sub?: string;
}> = ({ label, value, icon, tone, sub }) => (
  <div
    className="rounded-2xl p-4 flex items-center gap-3"
    style={{ background: 'hsl(var(--card))', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
  >
    <div
      className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: ICON_BG[tone], color: ICON_COLOR[tone] }}
    >
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-xl font-black leading-none" style={{ color: ICON_COLOR[tone] }}>{value}</p>
      <p className="text-[11px] text-muted-foreground font-semibold mt-1">{label}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: 'hsl(var(--destructive))' }}>{sub}</p>}
    </div>
  </div>
);

// ─── CTR bar ────────────────────────────────────────────────────────────────────

const CTRBar: React.FC<{ ctr: number }> = ({ ctr }) => {
  const pct = Math.round(ctr * 100);
  const color = pct >= 10 ? 'hsl(133 60% 45%)' : pct >= 5 ? 'hsl(38 80% 50%)' : 'hsl(152 70% 22%)';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'hsl(var(--muted))' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(pct, 100)}%`, background: color }}
        />
      </div>
      <span className="text-xs font-bold w-9 text-right" style={{ color: 'hsl(var(--foreground) / 0.7)' }}>
        {pct}%
      </span>
    </div>
  );
};

// ─── Main dashboard ─────────────────────────────────────────────────────────────

const MerchantDashboard: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [pois, setPois] = useState<POI[]>([]);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [loadingPois, setLoadingPois] = useState(true);

  useEffect(() => {
    async function load() {
      setLoadingPois(true);
      try {
        const { data } = await supabase
          .from('pois')
          .select('*, promotions(*)')
          .limit(50);

        if (data) {
          const withPromos = data.filter(
            (p: Record<string, unknown>) =>
              Array.isArray(p.promotions) && (p.promotions as unknown[]).length > 0
          );
          setPois(withPromos as unknown as POI[]);
        }
      } finally {
        setLoadingPois(false);
      }
    }
    void load();
  }, []);

  useEffect(() => {
    async function loadWallets() {
      const { data } = await supabase
        .from('merchant_wallets')
        .select('merchant_id, balance, currency');
      if (data) setWallets(data as WalletInfo[]);
    }
    void loadWallets();
  }, []);

  const poiIds = pois.map(p => p.id);
  const { metrics, loading: loadingMetrics, refresh } = useMerchantMetrics(poiIds);

  const totals = metrics.reduce(
    (acc, m) => ({
      views: acc.views + m.views,
      clicks: acc.clicks + m.clicks,
      expands: acc.expands + m.expands,
      dismissals: acc.dismissals + m.dismissals,
    }),
    { views: 0, clicks: 0, expands: 0, dismissals: 0 }
  );
  const globalCTR = totals.views > 0 ? totals.clicks / totals.views : 0;
  const totalWalletBalance = wallets.reduce((s, w) => s + w.balance, 0);
  const currency = wallets[0]?.currency ?? 'ETB';

  const statStrip = (
    <div
      className="grid grid-cols-3 rounded-2xl overflow-hidden mt-1"
      style={{ background: 'rgba(255,255,255,0.08)', gap: 1 }}
    >
      {[
        { value: totals.views.toLocaleString(), label: 'Views' },
        { value: totals.clicks.toLocaleString(), label: 'Clicks' },
        { value: `${Math.round(globalCTR * 100)}%`, label: 'CTR' },
      ].map(({ value, label }) => (
        <div
          key={label}
          className="flex flex-col items-center py-3"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        >
          <span className="text-[22px] font-black text-white leading-none">{value}</span>
          <span
            className="text-[9px] font-bold uppercase tracking-widest mt-1"
            style={{ color: 'rgba(255,255,255,0.45)' }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: 'hsl(var(--background))' }}>
      {!embedded && (
        <AdminHeader
          icon={Zap}
          title="Commerce Dashboard"
          subtitle="Promotion performance & wallet"
          actions={
            <button
              onClick={refresh}
              aria-label="Refresh"
              className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold tap-scale"
              style={{ background: 'rgba(255,255,255,0.10)', color: 'white', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          }
        >
          {statStrip}
        </AdminHeader>
      )}

      {embedded && (
        <div className="px-4 pt-5">
          <div className="rounded-2xl p-4 flex items-center justify-between" style={{ background: 'hsl(152 70% 18%)' }}>
            <div>
              <p className="text-sm font-black text-white">Commerce overview</p>
              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.55)' }}>Promotion performance &amp; wallet</p>
            </div>
            <button
              onClick={refresh}
              aria-label="Refresh"
              className="w-9 h-9 rounded-full flex items-center justify-center tap-scale flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.12)' }}
            >
              <RefreshCw className="w-4 h-4 text-white" />
            </button>
          </div>
          <div className="mt-2 rounded-2xl overflow-hidden" style={{ background: 'hsl(152 70% 18%)' }}>
            {statStrip}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="px-4 py-5 max-w-2xl mx-auto space-y-5">

        {/* Wallet balance highlight */}
        <div className="grid grid-cols-1 gap-3">
          <StatCard
            label={`Wallet Balance (${currency})`}
            value={totalWalletBalance.toLocaleString('en-ET', { maximumFractionDigits: 2 })}
            icon={<Wallet className="w-5 h-5" />}
            tone={totalWalletBalance < 50 ? 'red' : 'green'}
            sub={totalWalletBalance < 50 ? 'Low balance — top up needed' : undefined}
          />
        </div>

        {/* Wallet breakdown */}
        {wallets.length > 0 && (
          <Section title="Merchant Wallets">
            {wallets.map((w, i) => (
              <div
                key={w.merchant_id}
                className="flex items-center gap-3 px-4 py-3"
                style={{
                  borderBottom: i === wallets.length - 1 ? 'none' : '0.5px solid hsl(var(--border) / 0.5)',
                }}
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: ICON_BG[w.balance < 50 ? 'red' : 'green'], color: ICON_COLOR[w.balance < 50 ? 'red' : 'green'] }}
                >
                  <Wallet className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight truncate">{w.merchant_id}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {5} {w.currency} per navigate click
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p
                    className="text-sm font-black"
                    style={{ color: w.balance < 50 ? 'hsl(var(--destructive))' : 'hsl(133 60% 38%)' }}
                  >
                    {w.balance.toLocaleString('en-ET', { maximumFractionDigits: 2 })} {w.currency}
                  </p>
                  {w.balance < 50 && (
                    <p
                      className="text-[10px] flex items-center gap-0.5 justify-end mt-0.5"
                      style={{ color: 'hsl(var(--destructive))' }}
                    >
                      <AlertTriangle className="w-3 h-3" />
                      Top up needed
                    </p>
                  )}
                </div>
              </div>
            ))}
          </Section>
        )}

        {/* Per-POI metrics */}
        <div>
          <p
            className="text-[10px] font-black uppercase tracking-widest mb-2 px-1"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            Promoted Places
          </p>

          {(loadingPois || loadingMetrics) && (
            <div
              className="rounded-2xl px-4 py-6 text-center"
              style={{ background: 'hsl(var(--card))', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
            >
              <p className="text-sm text-muted-foreground animate-pulse">Loading metrics…</p>
            </div>
          )}

          {!loadingPois && pois.length === 0 && (
            <div
              className="rounded-2xl px-4 py-6 text-center"
              style={{ background: 'hsl(var(--card))', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
            >
              <p className="text-sm text-muted-foreground">No places with active promotions yet.</p>
            </div>
          )}

          <div className="space-y-3">
            {pois.map(poi => {
              const m = metrics.find(x => x.poi_id === poi.id);
              return (
                <div
                  key={poi.id}
                  className="rounded-2xl p-4 space-y-3"
                  style={{ background: 'hsl(var(--card))', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
                >
                  {/* POI header */}
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: ICON_BG.green, color: ICON_COLOR.green }}
                    >
                      <Tag className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate leading-tight">{poi.name}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                        {poi.category}
                      </p>
                    </div>
                    <span
                      className="text-[9px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
                      style={{ background: ICON_BG.green, color: ICON_COLOR.green }}
                    >
                      Sponsored
                    </span>
                  </div>

                  {/* Metrics row — rounded tinted tiles instead of flat muted boxes */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      { label: 'Views', value: m?.views ?? 0, icon: <Eye className="w-3.5 h-3.5" />, tone: 'green' as const },
                      { label: 'Expands', value: m?.expands ?? 0, icon: <MousePointerClick className="w-3.5 h-3.5" />, tone: 'blue' as const },
                      { label: 'Clicks', value: m?.clicks ?? 0, icon: <Navigation className="w-3.5 h-3.5" />, tone: 'amber' as const },
                      { label: 'Dismiss', value: m?.dismissals ?? 0, icon: <X className="w-3.5 h-3.5" />, tone: 'red' as const },
                    ].map(({ label, value, icon, tone }) => (
                      <div
                        key={label}
                        className="rounded-xl py-2.5 px-1"
                        style={{ background: ICON_BG[tone] }}
                      >
                        <div className="flex items-center justify-center mb-1" style={{ color: ICON_COLOR[tone] }}>
                          {icon}
                        </div>
                        <p className="text-sm font-black" style={{ color: ICON_COLOR[tone] }}>{value}</p>
                        <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* CTR */}
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wide">
                      CTR (views → navigate)
                    </p>
                    <CTRBar ctr={m?.ctr ?? 0} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MerchantDashboard;
