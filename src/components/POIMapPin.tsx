/**
 * POIMapPin — The outdoor POI map pins shown directly on the map.
 * Figma shows: rounded-square image thumbnail with optional badge overlays
 * (orange dot for promotions, blue circle with B for bookmarks/attractions),
 * connected to a white teardrop pin anchor below.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { POI, getPOIIcon, hasActivePromotions } from '@/data/poi';

interface POIMapPinProps {
  poi: POI;
  x: number;   // absolute px position on map
  y: number;
  isNearby?: boolean;
  isSelected?: boolean;
  onClick?: (poi: POI) => void;
}

// Placeholder images by subcategory for demo
const PIN_IMAGES: Record<string, string> = {
  animal:   'https://images.unsplash.com/photo-1614846027182-cecf8fc9e5e0?w=120&q=70',
  garden:   'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=120&q=70',
  cafe:     'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=120&q=70',
  market:   'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=120&q=70',
  landmark: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&q=70',
  exhibit:  'https://images.unsplash.com/photo-1534759846116-5799c33ce22a?w=120&q=70',
  default:  'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=120&q=70',
};

function getPinImage(poi: POI): string {
  if (poi.imageUrl) return poi.imageUrl;
  return PIN_IMAGES[poi.subcategory?.toLowerCase()] || PIN_IMAGES.default;
}

const POIMapPin: React.FC<POIMapPinProps> = ({ poi, x, y, isNearby = false, isSelected = false, onClick }) => {
  const hasPromo = hasActivePromotions(poi);
  const image = getPinImage(poi);
  const size = isSelected ? 64 : isNearby ? 56 : 52;

  return (
    <motion.button
      onClick={() => onClick?.(poi)}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 380, damping: 24 }}
      className="absolute flex flex-col items-center"
      style={{
        left: x - size / 2,
        top: y - size - 10, // pin sits above its anchor point
        zIndex: isSelected ? 20 : isNearby ? 12 : 10,
      }}
      aria-label={poi.name}
    >
      {/* Thumbnail image with rounded-square shape */}
      <div
        className="relative overflow-hidden bg-white"
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.22,
          border: isSelected ? '3px solid hsl(133 60% 48%)' : '2.5px solid white',
          boxShadow: isSelected
            ? '0 4px 20px hsl(133 60% 48% / 0.5)'
            : '0 2px 12px hsl(152 40% 10% / 0.2)',
        }}
      >
        <img src={image} alt={poi.name} className="w-full h-full object-cover" />

        {/* Promo badge — orange dot top-left */}
        {hasPromo && (
          <div className="absolute top-1 left-1 w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-black"
            style={{ background: 'hsl(22 90% 55%)' }}>
            %
          </div>
        )}

        {/* Category badge — blue circle top-right (like the B in Figma) */}
        {poi.isFeatured && !hasPromo && (
          <div className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-black"
            style={{ background: 'hsl(210 80% 55%)' }}>
            ★
          </div>
        )}

        {/* Nearby pulse ring */}
        {isNearby && !isSelected && (
          <div className="absolute inset-0 rounded-[inherit]"
            style={{ boxShadow: '0 0 0 3px hsl(133 60% 48% / 0.3)' }} />
        )}
      </div>

      {/* Anchor pin teardrop */}
      <div className="flex flex-col items-center" style={{ marginTop: -1 }}>
        <div className="w-2 h-3 rounded-b-full"
          style={{ background: 'white', boxShadow: '0 1px 4px hsl(152 40% 10% / 0.2)' }} />
        <div className="w-1.5 h-1.5 rounded-full bg-white/60" style={{ marginTop: -2 }} />
      </div>
    </motion.button>
  );
};

export default POIMapPin;
