import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { History, Trash2, MapPin, CheckCircle2, Navigation } from 'lucide-react';
import { POI } from '@/data/poi';
import { VisitedPlace, VisitedPOISnapshot, formatVisitedWhen } from '@/hooks/useVisitedPlaces';

interface VisitedPanelProps {
  visitedPlaces: VisitedPlace[];
  pois: POI[];
  /** Snapshot of each visited POI's name/image/category taken at visit time —
   *  covers places outside the currently-loaded building, where `pois`
   *  (scoped to the active building) won't have a match. Without this,
   *  every visited place from another building/venue silently fell back to
   *  a generic "Visited Place" placeholder card instead of its real info. */
  visitedPOIs?: Map<string, VisitedPOISnapshot>;
  loading?: boolean;
  onPOISelect?: (poi: POI) => void;
  onRemove?: (poiId: string) => void;
}

const PLACEHOLDER_IMAGES = [
  'https://images.unsplash.com/photo-1614846027182-cecf8fc9e5e0?w=800&q=80',
  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80',
];

const VisitedPanel: React.FC<VisitedPanelProps> = ({
  visitedPlaces, pois, visitedPOIs, loading = false, onPOISelect, onRemove,
}) => {
  const navigate = useNavigate();
  const visitedWithPoi = visitedPlaces.map((vp, index) => ({
    vp,
    // Full POI (has coordinates, so the card is tappable-to-navigate) if it's
    // in the currently-loaded building; otherwise fall back to the snapshot
    // taken at visit time so the name/image are still correct.
    poi: pois.find(p => p.id === vp.poi_id) ?? null,
    snapshot: visitedPOIs?.get(vp.poi_id) ?? null,
    index,
  }));

  if (loading) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
        Loading your history…
      </div>
    );
  }

  if (visitedWithPoi.length === 0) {
    return (
      <div className="px-6 py-14 flex flex-col items-center text-center gap-3">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: 'hsl(152 70% 22% / 0.08)' }}
        >
          <History className="w-6 h-6" style={{ color: 'hsl(152 70% 22%)' }} />
        </div>
        <p className="text-sm font-semibold text-foreground">No places visited yet</p>
        <p className="text-xs text-muted-foreground max-w-[240px]">
          Places you navigate to, scan into, or manually mark as visited will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-8 flex flex-col gap-3">
      <h3 className="text-sm font-bold text-foreground mb-1">Places You've Been</h3>
      <AnimatePresence>
        {visitedWithPoi.map(({ vp, poi, snapshot, index }) => {
          const fallbackImg = PLACEHOLDER_IMAGES[index % PLACEHOLDER_IMAGES.length];
          const photo = (poi?.imageUrl && poi.imageUrl.trim()) || (snapshot?.imageUrl && snapshot.imageUrl.trim()) || null;
          const name = poi?.name ?? snapshot?.name ?? 'Visited Place';
          const sub = poi?.subcategory || poi?.description?.slice(0, 28)
            || snapshot?.subcategory || snapshot?.description?.slice(0, 28) || '';
          // On the map now: select it. From another venue: open that venue at the place.
          const elsewhere = !poi && snapshot?.buildingId ? `/venue/${snapshot.buildingId}?place=${encodeURIComponent(snapshot.nodeId ?? vp.poi_id)}` : null;
          const clickable = !!poi || !!elsewhere;
          const venue = !poi ? snapshot?.venueName : null;

          return (
          <motion.div
            key={vp.poi_id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ delay: index * 0.04, duration: 0.22 }}
            className={`rounded-2xl overflow-hidden w-full ${clickable ? 'cursor-pointer' : ''}`}
            style={{ height: 96 }}
            onClick={() => { if (poi) onPOISelect?.(poi); else if (elsewhere) navigate(elsewhere); }}
          >
            <div className="relative w-full h-full flex">
              {photo ? (
                <img
                  src={photo}
                  alt={name}
                  className="w-24 h-full object-cover flex-shrink-0"
                  loading={index === 0 ? 'eager' : 'lazy'}
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (!target.dataset.errored) { target.dataset.errored = '1'; target.src = fallbackImg; }
                  }}
                />
              ) : (
                <div className="w-24 h-full flex-shrink-0 rounded-l-2xl grid place-items-center bg-gradient-to-br from-emerald-100 to-sky-100 dark:from-emerald-950 dark:to-sky-950">
                  <MapPin className="w-6 h-6 text-primary/60" />
                </div>
              )}
              <div className="flex-1 flex flex-col justify-center px-3 py-2 bg-card border-y border-r border-border/30 rounded-r-2xl min-w-0">
                <p className="text-sm font-bold text-foreground leading-tight truncate">{name}</p>
                <div className="flex items-center gap-1 mt-1">
                  <MapPin className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <p className="text-xs text-muted-foreground leading-tight truncate">{venue ? <><b className="font-semibold">{venue}</b>{sub ? ` · ${sub}` : ''}</> : sub}</p>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground/80">
                    {vp.source === 'manual' ? <CheckCircle2 className="w-3 h-3" /> : <Navigation className="w-3 h-3" />}
                    {formatVisitedWhen(vp.last_visited_at)}
                  </span>
                  {vp.visit_count > 1 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'hsl(152 70% 22% / 0.1)', color: 'hsl(152 70% 22%)' }}>
                      ×{vp.visit_count}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col justify-center gap-2 px-3">
                <button
                  onClick={e => { e.stopPropagation(); onRemove?.(vp.poi_id); }}
                  className="w-9 h-9 rounded-full flex items-center justify-center tap-scale bg-red-500/10"
                  aria-label={`Remove ${name} from history`}
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            </div>
          </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export default VisitedPanel;
