import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { POI, POI_CATEGORY_META, getPOIIcon, hasActivePromotions } from '@/data/poi';
import { POIWithDistance } from '@/hooks/usePOIProximity';

interface NearbyExperiencesProps {
  items: POIWithDistance[];
  onSelect: (poi: POI) => void;
}

const NearbyExperiences: React.FC<NearbyExperiencesProps> = ({ items, onSelect }) => {
  if (items.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
      <div className="flex items-center gap-1.5 px-0.5">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nearby</span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
        {items.map(({ poi, distance }) => {
          const meta = POI_CATEGORY_META[poi.category];
          const promo = hasActivePromotions(poi);
          const Icon = getPOIIcon(poi);
          return (
            <button
              key={poi.id}
              onClick={() => onSelect(poi)}
              className="flex-shrink-0 w-36 rounded-2xl bg-muted/50 hover:bg-muted/80 border border-border/50 tap-scale transition-all p-3 text-left"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${meta.tone}20`, color: meta.tone }}>
                  <Icon className="w-4 h-4" />
                </div>
                {promo && (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-lg bg-orange-500 text-white">DEAL</span>
                )}
                {poi.isFeatured && !promo && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-lg bg-primary/15 text-primary">★</span>
                )}
              </div>
              <p className="text-xs font-bold text-foreground truncate">{poi.name}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{Math.round(distance)}m away</p>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
};

export default NearbyExperiences;
