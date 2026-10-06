/**
 * POICard — Figma-accurate redesign.
 * 
 * Two variants:
 * - auto-toast: mini toast at bottom with thumbnail, name, navigate btn
 * - modal: full bottom sheet with hero image, name, type, description, navigate pill
 */
import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Navigation, Volume2, Star, Flame, MapPin, Zap, ChevronUp, CheckCircle2, Footprints, Clock, Layers, ArrowRight } from 'lucide-react';
import { POI, Promotion, POI_CATEGORY_META, getPOIIcon, getActivePromotions } from '@/data/poi';
import { logPromotionEvent, UserPosition } from '@/lib/commerce/PromotionEventLogger';
import { chargeNavigateClick } from '@/lib/commerce/MerchantWallet';

export type POICardVariant = 'toast' | 'expanded';

interface POICardProps {
  poi: POI | null;
  onClose: () => void;
  onNavigate?: (poi: POI) => void;
  onSpeak?: (poi: POI) => void;
  variant?: 'modal' | 'auto-toast';
  userPosition?: UserPosition;
  isVisited?: boolean;
  onMarkVisited?: (poi: POI) => void;
  /** Name of the venue currently loaded (e.g. building.name) — shown under
   *  an outdoor POI's name. This app isn't built for one specific park, so
   *  this must come from whatever venue is actually loaded, not a fixed
   *  string. Omitted from display entirely if not provided. */
  venueName?: string | null;
  /** How far it is to walk there (and from where), when known. */
  walk?: WalkInfo | null;
}

/** The walk to a place. `unknown` = we don't know where the visitor is yet (only the floor is shown). */
export interface WalkInfo { metres: number; minutes: number; from: string; floor?: string | null; unknown?: boolean }

const SponsoredLabel: React.FC = () => (
  <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-lg bg-muted/80 text-muted-foreground/70 border border-border/40 tracking-wide">
    <Zap className="w-2 h-2" /> Sponsored
  </span>
);

/** Mini toast card at bottom — matching Figma's map overlay style */
const ToastCard: React.FC<{
  poi: POI; promos: Promotion[];
  onClose: () => void; onExpand: () => void;
  onNavigate?: (poi: POI) => void;
  onLogEvent?: (type: 'promotion_dismiss' | 'promotion_click_navigate') => void;
}> = ({ poi, promos, onClose, onExpand, onNavigate, onLogEvent }) => {
  const hasPromos = promos.length > 0;
  const image = poi.imageUrl || 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=200&q=70';

  return (
    <motion.div
      initial={{ y: 120, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 120, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className="fixed bottom-[7.5rem] inset-x-4 z-40 lg:left-auto lg:right-[92px] lg:bottom-6 lg:w-[380px]"
    >
      <div className="overflow-hidden rounded-[20px] border border-white/80 bg-[rgba(255,253,248,.92)] font-inter text-ink shadow-[0_16px_40px_rgba(30,20,10,.18)] backdrop-blur-[16px]">
        <button onClick={onExpand} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
          {/* Thumbnail */}
          <div className="w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0 bg-muted">
            <img src={image} alt={poi.name} className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="truncate font-news text-[17px] font-semibold leading-tight">{poi.name}</p>
              {hasPromos && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-lg bg-orange-500 text-white flex-shrink-0">OFFER</span>}
              {hasPromos && <SponsoredLabel />}
              {poi.isFeatured && !hasPromos && <Star className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
            </div>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              {hasPromos ? promos[0].discountText || promos[0].title : (poi.subcategory || poi.description?.slice(0, 35))}
            </p>
          </div>
          <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </button>
        <div className="flex gap-2 px-4 pb-4">
          {onNavigate && (
            <button
              onClick={(e) => { e.stopPropagation(); onLogEvent?.('promotion_click_navigate'); onNavigate(poi); }}
              className="flex-1 h-10 rounded-full bg-ink text-[13px] font-semibold text-white flex items-center justify-center gap-1.5 tap-scale"
            >
              <Navigation className="w-3.5 h-3.5" /> Navigate
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onLogEvent?.('promotion_dismiss'); onClose(); }}
            aria-label="Close"
            className="h-10 w-10 rounded-full bg-ink/[.07] flex items-center justify-center"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
    </motion.div>
  );
};

/** The full place card, in the Indoor design: category tile, a big serif
 *  name, walking chips and an ink "Navigate here" pill. Floats beside the
 *  map on desktop, rises as a sheet on phones. */
const ExpandedCard: React.FC<{
  poi: POI; promos: Promotion[];
  onClose: () => void; onNavigate?: (poi: POI) => void; onSpeak?: (poi: POI) => void;
  onLogEvent?: (type: 'promotion_dismiss' | 'promotion_click_navigate') => void;
  isVisited?: boolean; onMarkVisited?: (poi: POI) => void;
  venueName?: string | null;
  walk?: WalkInfo | null;
}> = ({ poi, promos, onClose, onNavigate, onSpeak, onLogEvent, isVisited, onMarkVisited, venueName, walk }) => {
  const meta = POI_CATEGORY_META[poi.category];
  const Icon = getPOIIcon(poi);
  const hasPromos = promos.length > 0;
  const kind = poi.subcategory ? poi.subcategory.charAt(0).toUpperCase() + poi.subcategory.slice(1) : meta.label;
  const close = () => { onLogEvent?.('promotion_dismiss'); onClose(); };
  const chip = 'inline-flex items-center gap-1.5 rounded-full bg-ink/[.06] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#3f4a43]';

  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 360, damping: 34 }}
      className="fixed inset-x-0 bottom-0 z-50 font-inter text-ink lg:inset-x-auto lg:bottom-6 lg:right-[92px] lg:w-[400px]"
    >
      {/* Backdrop (phones only — on desktop the card floats over the map) */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 -z-10 bg-ink/30 lg:hidden" onClick={close} />

      <div className="max-h-[86vh] overflow-y-auto overscroll-contain rounded-t-[24px] bg-white px-6 pb-7 pt-5 shadow-[0_18px_50px_rgba(20,50,30,.18)] lg:rounded-[18px] lg:px-7 lg:pb-[26px] lg:pt-[26px]">
        <div className="mx-auto -mt-1 mb-3 h-1 w-10 rounded-full bg-ink/15 lg:hidden" />

        {/* category tile + eyebrow */}
        <div className="flex items-center gap-3">
          <span className="grid h-[46px] w-[46px] flex-none place-items-center rounded-[14px] text-white shadow-[0_8px_18px_rgba(20,40,25,.18)]" style={{ background: meta.tone }}>
            <Icon className="h-[22px] w-[22px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[.14em] text-moss">
              {kind}
              {poi.isFeatured && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
              {hasPromos && <SponsoredLabel />}
            </div>
            {(poi.isOutdoor && venueName) ? (
              <div className="mt-0.5 flex items-center gap-1 truncate text-[13px] font-extrabold text-sub"><MapPin className="h-3.5 w-3.5" />{venueName}</div>
            ) : walk?.floor ? <div className="mt-0.5 flex items-center gap-1 truncate text-[13px] font-extrabold text-sub"><Layers className="h-3.5 w-3.5" />{walk.floor}</div> : null}
          </div>
          <button onClick={close} aria-label="Close" className="grid h-8 w-8 flex-none place-items-center rounded-full bg-ink/[.07] text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        {poi.imageUrl && (
          <div className="mt-4 aspect-[16/10] overflow-hidden rounded-2xl bg-[#e9e1d0]">
            <img src={poi.imageUrl} alt={poi.name} className="block h-full w-full animate-[fin_.4s_both] object-cover" />
          </div>
        )}

        <h2 className="mb-0.5 mt-3 font-news text-[34px] font-semibold leading-none tracking-[-.03em] lg:text-[38px]">{poi.name}</h2>
        {poi.description && <p className="mb-4 mt-2 text-[15px] leading-[1.55] text-sub">{poi.description}</p>}

        {walk && !walk.unknown && (
          <div className="mb-4 mt-3 flex flex-wrap gap-2">
            <span className={chip}><Footprints className="h-3.5 w-3.5" />{Math.round(walk.metres)} m</span>
            <span className={chip}><Clock className="h-3.5 w-3.5" />{walk.minutes < 1 ? '< 1 min' : `${walk.minutes} min`}</span>
          </div>
        )}

        {hasPromos && (
          <div className="mb-4 space-y-2">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-[#c2410c]"><Flame className="h-3 w-3" /> Offers</p>
            {promos.map(p => (
              <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-[rgba(240,160,32,.12)] px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{p.title}</p>
                  {p.description && <p className="mt-0.5 text-[11.5px] leading-tight text-[#8a5a12]">{p.description}</p>}
                </div>
                {p.discountText && <span className="flex-none rounded-full px-2.5 py-1 text-[11px] font-bold text-white" style={{ background: p.badgeColor || '#e08a1a' }}>{p.discountText}</span>}
              </div>
            ))}
          </div>
        )}

        {walk && !walk.unknown && (
          <span className="mb-[18px] inline-flex items-center gap-1.5 rounded-full bg-[rgba(80,190,90,.16)] px-3.5 py-[7px] text-[13px] font-semibold text-ink">
            <Footprints className="h-3.5 w-3.5" />{walk.minutes < 1 ? 'Under a minute' : `${walk.minutes} min`} walk {walk.from}
          </span>
        )}

        <div className="flex flex-wrap gap-2.5">
          {onNavigate && (
            <button onClick={() => { onLogEvent?.('promotion_click_navigate'); onNavigate(poi); }}
              className="inline-flex flex-1 items-center justify-center gap-2.5 rounded-full bg-ink px-[22px] py-[13px] text-[15px] font-semibold text-white">
              <Navigation className="h-4 w-4" /> Navigate here <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {onSpeak && (
            <button onClick={() => onSpeak(poi)} aria-label="Listen"
              className="grid h-[46px] w-[46px] place-items-center rounded-full text-ink shadow-[inset_0_0_0_1.5px_rgba(120,130,120,.35)]">
              <Volume2 className="h-[18px] w-[18px]" />
            </button>
          )}
          {onMarkVisited && (
            <button onClick={() => !isVisited && onMarkVisited(poi)} disabled={isVisited}
              aria-label={isVisited ? 'Already marked as visited' : 'Mark as visited'}
              className={`inline-flex h-[46px] items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold ${isVisited ? 'bg-[rgba(80,190,90,.16)] text-ink' : 'text-ink shadow-[inset_0_0_0_1.5px_rgba(120,130,120,.35)]'}`}>
              <CheckCircle2 className="h-4 w-4" /> {isVisited ? 'Visited' : 'Mark visited'}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

const POICard: React.FC<POICardProps> = ({ poi, onClose, onNavigate, onSpeak, variant = 'modal', userPosition, isVisited, onMarkVisited, venueName, walk }) => {
  const [expanded, setExpanded] = useState(false);
  const promos = poi ? getActivePromotions(poi) : [];
  const primaryPromoId = promos[0]?.id ?? null;

  const log = useCallback((eventType: Parameters<typeof logPromotionEvent>[0]) => {
    if (!poi) return;
    logPromotionEvent(eventType, poi.id, primaryPromoId, userPosition);
  }, [poi, primaryPromoId, userPosition]);

  useEffect(() => {
    if (!poi || promos.length === 0) return;
    log('promotion_view');
  }, [poi?.id]);

  const handleNavigate = useCallback(async (targetPoi: POI) => {
    if (!onNavigate) return;
    if (promos.length > 0) {
      const merchantId = (targetPoi as POI & { merchantId?: string }).merchantId ?? targetPoi.id;
      try { await chargeNavigateClick(targetPoi.id, merchantId); } catch { /* non-blocking */ }
    }
    onNavigate(targetPoi);
  }, [onNavigate, promos.length]);

  const handleClose = useCallback(() => { setExpanded(false); onClose(); }, [onClose]);
  useEffect(() => { setExpanded(false); }, [poi?.id]);

  return (
    <AnimatePresence mode="wait">
      {poi && (
        <>
          {variant === 'auto-toast' && !expanded && (
            <ToastCard key={`toast-${poi.id}`} poi={poi} promos={promos}
              onClose={handleClose}
              onExpand={() => { log('promotion_expand'); setExpanded(true); }}
              onNavigate={handleNavigate}
              onLogEvent={(t) => log(t)} />
          )}
          {(variant === 'modal' || expanded) && (
            <ExpandedCard key={`expanded-${poi.id}`} poi={poi} promos={promos}
              onClose={handleClose} onNavigate={handleNavigate} onSpeak={onSpeak}
              onLogEvent={(t) => log(t)}
              isVisited={isVisited} onMarkVisited={onMarkVisited}
              venueName={venueName} walk={walk} />
          )}
        </>
      )}
    </AnimatePresence>
  );
};

export default POICard;