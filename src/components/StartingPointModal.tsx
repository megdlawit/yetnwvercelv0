/**
 * StartingPointModal — lets the person set an outdoor route's starting
 * point to somewhere other than their live GPS position (the "From" field
 * in Google Maps). Two ways in, same as the destination-picking flow
 * already used elsewhere in the app:
 *   • Search — reuses useOutdoorPlaceSearch (OpenStreetMap/Nominatim),
 *     the same source MapSearchBar's outdoor results come from.
 *   • Tap the map — closes this sheet and hands off to the parent, which
 *     arms map-tap mode (see Index.tsx's pickingOriginOnMap) the same way
 *     handleOutdoorMapClick already does for picking a destination.
 * A third option, "Use my current location", clears any override and goes
 * back to routing from the live GPS fix.
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, X, Navigation, Search, Loader2, Crosshair } from 'lucide-react';
import { useOutdoorPlaceSearch, type OutdoorPlaceResult } from '@/hooks/useOutdoorPlaceSearch';
import type { GeoCoord } from '@/lib/geo/GeoTypes';

interface StartingPointModalProps {
  open: boolean;
  /** Bias point for search results (e.g. the venue/park center). */
  center: GeoCoord;
  /** True if the person currently has a custom origin set. */
  hasCustomOrigin: boolean;
  onClose: () => void;
  onUseCurrentLocation: () => void;
  onSelectPlace: (place: OutdoorPlaceResult) => void;
  onPickOnMap: () => void;
}

const StartingPointModal: React.FC<StartingPointModalProps> = ({
  open, center, hasCustomOrigin, onClose, onUseCurrentLocation, onSelectPlace, onPickOnMap,
}) => {
  const [query, setQuery] = useState('');
  const { results, loading } = useOutdoorPlaceSearch(query, center);

  const handleClose = () => {
    setQuery('');
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="bg-card rounded-t-[28px] w-full max-w-md overflow-hidden shadow-2xl border-t border-x border-border/30"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-12 h-1.5 rounded-full bg-muted-foreground/20" />
            </div>

            <div className="flex items-center justify-between px-5 pt-2 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Navigation className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">Starting point</h3>
                  <p className="text-xs text-muted-foreground">Route from somewhere other than here</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="w-9 h-9 rounded-2xl bg-muted/70 flex items-center justify-center hover:bg-muted border border-border/50"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="px-5 pb-2 space-y-3">
              {/* Use current location */}
              <button
                onClick={() => { onUseCurrentLocation(); handleClose(); }}
                className={`w-full h-12 rounded-2xl font-bold text-sm flex items-center gap-3 px-4 tap-scale border ${
                  hasCustomOrigin
                    ? 'bg-muted/50 border-border/60 text-foreground hover:bg-muted'
                    : 'bg-primary/10 border-primary/30 text-primary'
                }`}
              >
                <Crosshair className="w-4 h-4 shrink-0" />
                Use my current location
              </button>

              {/* Tap on map */}
              <button
                onClick={() => { onPickOnMap(); handleClose(); }}
                className="w-full h-12 rounded-2xl font-bold text-sm flex items-center gap-3 px-4 tap-scale bg-muted/50 border border-border/60 text-foreground hover:bg-muted"
              >
                <MapPin className="w-4 h-4 shrink-0" />
                Choose on the map
              </button>

              {/* Search */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search for a starting point"
                  className="w-full h-12 rounded-2xl bg-muted/50 border border-border/60 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {loading && (
                  <Loader2 className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />
                )}
              </div>
            </div>

            <div className="px-5 pb-8 pt-1 max-h-[280px] overflow-y-auto scroll-touch">
              {query.trim().length >= 2 && !loading && results.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No places found</p>
              )}
              <div className="space-y-1">
                {results.map((place) => (
                  <button
                    key={place.id}
                    onClick={() => { onSelectPlace(place); handleClose(); }}
                    className="w-full flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/60 text-left tap-scale"
                  >
                    <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{place.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{place.displayName}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default StartingPointModal;
