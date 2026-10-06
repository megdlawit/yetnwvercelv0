/**
 * LocationSplash — initial screen shown on app open.
 *
 * 1. Requests browser geolocation.
 * 2. Renders a live OpenStreetMap tile view centered on the user with a blue dot.
 * 3. Shows two mode-select buttons: "Outdoor Map" and "Indoor Map".
 * 4. Picking "Outdoor Map" reveals a second step — "Walking" or "Driving" —
 *    before calling onSelectMode('outdoor', travelMode). Indoor is always
 *    on foot, so it calls onSelectMode('indoor', 'walk') directly.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Trees, Building2, Loader2, AlertTriangle, Navigation, X, Footprints, Car, ChevronLeft } from 'lucide-react';
import type { TravelMode } from '@/lib/geo/GeoTypes';

export type MapMode = 'outdoor' | 'indoor';

interface LocationSplashProps {
  onSelectMode: (mode: MapMode, travelMode?: TravelMode) => void;
  onClose?: () => void;
}

// ─── OSM tile helpers ──────────────────────────────────────────────────────────
const ZOOM = 17;
const TILE_SIZE = 256;

function lon2tile(lon: number, z: number) { return Math.floor(((lon + 180) / 360) * Math.pow(2, z)); }
function lat2tile(lat: number, z: number) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}
function tile2lon(x: number, z: number) { return (x / Math.pow(2, z)) * 360 - 180; }
function tile2lat(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

interface LatLng { lat: number; lng: number }

function latLngToPixel(
  coord: LatLng,
  centerTileX: number, centerTileY: number,
  canvasW: number, canvasH: number,
  z: number,
): { x: number; y: number } {
  const worldX = ((coord.lng + 180) / 360) * Math.pow(2, z) * TILE_SIZE;
  const r = coord.lat * Math.PI / 180;
  const worldY = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z) * TILE_SIZE;
  const centerWorldX = centerTileX * TILE_SIZE;
  const centerWorldY = centerTileY * TILE_SIZE;
  return {
    x: worldX - centerWorldX + canvasW / 2,
    y: worldY - centerWorldY + canvasH / 2,
  };
}

// ─── Mode chooser panel (shared by mobile sheet + desktop sidebar) ─────────────

interface SplashChooserPanelProps {
  step: 'chooseMode' | 'chooseTravel';
  setStep: (s: 'chooseMode' | 'chooseTravel') => void;
  gpsState: 'idle' | 'requesting' | 'ok' | 'error';
  errorMsg: string;
  locationPermission: PermissionState | 'unknown';
  position: LatLng | null;
  requestLocationAccess: () => void;
  onSelectMode: (mode: MapMode, travelMode?: TravelMode) => void;
  onClose?: () => void;
  onDismiss?: () => void;
  variant: 'mobile' | 'desktop';
}

const SplashChooserPanel: React.FC<SplashChooserPanelProps> = ({
  step, setStep, gpsState, errorMsg, locationPermission, position,
  requestLocationAccess, onSelectMode, onClose, onDismiss, variant,
}) => {
  const isDesktop = variant === 'desktop';

  return (
    <>
      {/* Header row — mobile only (desktop brand lives in sidebar header) */}
      {!isDesktop && (
        <div className="flex items-center justify-between gap-3 mb-5">
          {step === 'chooseTravel' ? (
            <button
              type="button"
              onClick={() => setStep('chooseMode')}
              className="w-10 h-10 rounded-full bg-muted/80 flex items-center justify-center tap-scale"
              aria-label="Back"
            >
              <ChevronLeft className="w-4 h-4 text-foreground" />
            </button>
          ) : (
            <div className="w-10 h-1 rounded-full" style={{ background: '#d0d8d0' }} />
          )}
          <button
            type="button"
            onClick={() => { onDismiss?.(); onClose?.(); }}
            className="w-10 h-10 rounded-full bg-muted/80 flex items-center justify-center tap-scale"
            aria-label="Close view chooser"
          >
            <X className="w-4 h-4 text-foreground" />
          </button>
        </div>
      )}

      {isDesktop && step === 'chooseTravel' && (
        <button
          type="button"
          onClick={() => setStep('chooseMode')}
          className="flex items-center gap-1.5 text-sm font-medium mb-4 transition-colors hover:opacity-70"
          style={{ color: '#5a7a5a' }}
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
      )}

      <p className={`font-bold mb-1 ${isDesktop ? 'text-2xl' : 'text-lg'}`} style={{ color: 'hsl(152 70% 22%)' }}>
        {step === 'chooseTravel'
          ? 'Walking or driving?'
          : gpsState === 'ok' ? 'Location found!' : 'Choose your view'}
      </p>
      <p className={`mb-6 ${isDesktop ? 'text-[15px] leading-relaxed' : 'text-sm'}`} style={{ color: '#5a7a5a' }}>
        {step === 'chooseTravel'
          ? 'Pick how you\'ll get around outdoors.'
          : gpsState === 'ok'
            ? 'How would you like to explore Unity Park?'
            : gpsState === 'requesting'
              ? 'Waiting for GPS signal…'
              : 'Select a map mode to continue.'}
      </p>

      <AnimatePresence>
        {position && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 mb-5"
            style={{
              background: 'hsl(152 70% 22% / 0.08)',
              fontSize: 11,
              fontWeight: 600,
              color: 'hsl(152 70% 22%)',
            }}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: 'hsl(133 60% 42%)', display: 'inline-block' }} />
            {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
          </motion.div>
        )}
      </AnimatePresence>

      {(gpsState !== 'ok') && step === 'chooseMode' && (
        <div className="space-y-3 mb-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {gpsState === 'requesting'
              ? 'Requesting location permission from your browser...'
              : locationPermission === 'denied'
                ? 'Location access is blocked. Open your browser settings and allow location access for this site.'
                : errorMsg || 'Location access is required to show your position on the map.'}
          </p>
          <button
            type="button"
            onClick={requestLocationAccess}
            disabled={gpsState === 'requesting'}
            className="w-full rounded-2xl px-4 py-3 font-semibold text-sm text-white"
            style={{ background: 'hsl(152 70% 22%)', opacity: gpsState === 'requesting' ? 0.7 : 1 }}
          >
            {gpsState === 'requesting' ? 'Awaiting permission…' : 'Allow Location Access'}
          </button>
        </div>
      )}

      {step === 'chooseMode' ? (
        <div className="flex flex-col gap-3">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setStep('chooseTravel')}
            className="w-full flex items-center gap-4 rounded-2xl p-4 text-left"
            style={{
              background: 'linear-gradient(135deg, hsl(152 70% 22%) 0%, hsl(152 60% 28%) 100%)',
              boxShadow: '0 4px 20px hsl(152 70% 22% / 0.35)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.18)' }}>
              <Trees className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Outdoor Map</p>
              <p style={{ fontSize: 12, opacity: 0.82 }}>Explore Unity Park grounds, paths & attractions</p>
            </div>
            <span style={{ fontSize: 20, opacity: 0.7 }}>›</span>
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onSelectMode('indoor', 'walk')}
            className="w-full flex items-center gap-4 rounded-2xl p-4 text-left"
            style={{
              background: '#fff',
              border: '1.5px solid hsl(152 70% 22% / 0.2)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              color: '#111',
              cursor: 'pointer',
            }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'hsl(152 70% 22% / 0.08)' }}>
              <Building2 className="w-6 h-6" style={{ color: 'hsl(152 70% 22%)' }} />
            </div>
            <div className="flex-1">
              <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 2, color: 'hsl(152 70% 22%)' }}>Indoor Map</p>
              <p style={{ fontSize: 12, color: '#666' }}>Navigate buildings, floors & indoor exhibits</p>
            </div>
            <span style={{ fontSize: 20, color: '#ccc' }}>›</span>
          </motion.button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onSelectMode('outdoor', 'walk')}
            className="w-full flex items-center gap-4 rounded-2xl p-4 text-left"
            style={{
              background: 'linear-gradient(135deg, hsl(152 70% 22%) 0%, hsl(152 60% 28%) 100%)',
              boxShadow: '0 4px 20px hsl(152 70% 22% / 0.35)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.18)' }}>
              <Footprints className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Walking</p>
              <p style={{ fontSize: 12, opacity: 0.82 }}>Routes along footpaths, trails & sidewalks</p>
            </div>
            <span style={{ fontSize: 20, opacity: 0.7 }}>›</span>
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onSelectMode('outdoor', 'car')}
            className="w-full flex items-center gap-4 rounded-2xl p-4 text-left"
            style={{
              background: '#fff',
              border: '1.5px solid hsl(152 70% 22% / 0.2)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              color: '#111',
              cursor: 'pointer',
            }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'hsl(152 70% 22% / 0.08)' }}>
              <Car className="w-6 h-6" style={{ color: 'hsl(152 70% 22%)' }} />
            </div>
            <div className="flex-1">
              <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 2, color: 'hsl(152 70% 22%)' }}>Driving</p>
              <p style={{ fontSize: 12, color: '#666' }}>Routes along roads for drivable directions</p>
            </div>
            <span style={{ fontSize: 20, color: '#ccc' }}>›</span>
          </motion.button>
        </div>
      )}

      {gpsState === 'error' && (
        <p className="text-xs text-center mt-4" style={{ color: '#dc2626' }}>
          {errorMsg}
        </p>
      )}
    </>
  );
};

// ─── Component ─────────────────────────────────────────────────────────────────

const LocationSplash: React.FC<LocationSplashProps> = ({ onSelectMode, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState({ w: 390, h: 844 });
  const [position, setPosition] = useState<LatLng | null>(null);
  const [gpsState, setGpsState] = useState<'idle' | 'requesting' | 'ok' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [step, setStep] = useState<'chooseMode' | 'chooseTravel'>('chooseMode');
  const [locationPermission, setLocationPermission] = useState<PermissionState | 'unknown'>('unknown');
  const [tilesLoaded, setTilesLoaded] = useState(0);
  const [totalTiles, setTotalTiles] = useState(0);
  const [pulse, setPulse] = useState(false);

  // Pulse animation for blue dot
  useEffect(() => {
    if (!position) return;
    const id = setInterval(() => setPulse(p => !p), 900);
    return () => clearInterval(id);
  }, [position]);

  // ── Geolocation ──────────────────────────────────────────────────────────────
  const watchIdRef = useRef<number | null>(null);

  const requestLocationAccess = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsState('error');
      setErrorMsg('Geolocation not supported on this device.');
      return;
    }

    setGpsState('requesting');
    setErrorMsg('');

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsState('ok');
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });

        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }

        watchIdRef.current = navigator.geolocation.watchPosition(
          (livePos) => {
            setGpsState('ok');
            setPosition({ lat: livePos.coords.latitude, lng: livePos.coords.longitude });
          },
          (watchErr) => {
            if (watchErr.code === 1) {
              setGpsState('error');
              setErrorMsg('Location access is blocked. Open your browser settings and allow location access for this site.');
            }
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
        );
      },
      (err) => {
        setGpsState('error');
        setErrorMsg(
          err.code === 1
            ? 'Location access denied. Please allow location in your browser settings or retry.'
            : 'Unable to determine your location. Try again.',
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  }, []);

  useEffect(() => {
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' })
        .then((status) => {
          setLocationPermission(status.state);
          status.onchange = () => setLocationPermission(status.state);
        })
        .catch(() => setLocationPermission('unknown'));
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [requestLocationAccess]);

  // Size the map canvas to its container (desktop split layout + window resize).
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      setMapSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // ── Draw OSM tiles on canvas ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !position) return;
    canvas.width = mapSize.w;
    canvas.height = mapSize.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = mapSize.w;
    const H = mapSize.h;

    setTilesLoaded(0);

    // Center tile (float)
    const centerTileXf = ((position.lng + 180) / 360) * Math.pow(2, ZOOM);
    const centerTileYf = (() => {
      const r = position.lat * Math.PI / 180;
      return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, ZOOM);
    })();

    // Integer tile at top-left of viewport
    const tilesX = Math.ceil(W / TILE_SIZE) + 2;
    const tilesY = Math.ceil(H / TILE_SIZE) + 2;
    const startTileX = Math.floor(centerTileXf - tilesX / 2);
    const startTileY = Math.floor(centerTileYf - tilesY / 2);
    const maxTile = Math.pow(2, ZOOM) - 1;

    const offsetX = (centerTileXf - startTileX) * TILE_SIZE - W / 2;
    const offsetY = (centerTileYf - startTileY) * TILE_SIZE - H / 2;

    const tiles: Array<{ tx: number; ty: number; dx: number; dy: number }> = [];
    for (let ix = 0; ix < tilesX; ix++) {
      for (let iy = 0; iy < tilesY; iy++) {
        const tx = Math.max(0, Math.min(maxTile, startTileX + ix));
        const ty = Math.max(0, Math.min(maxTile, startTileY + iy));
        const dx = ix * TILE_SIZE - offsetX;
        const dy = iy * TILE_SIZE - offsetY;
        tiles.push({ tx, ty, dx, dy });
      }
    }

    setTotalTiles(tiles.length);
    let loaded = 0;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#e8f0e8';
    ctx.fillRect(0, 0, W, H);

    tiles.forEach(({ tx, ty, dx, dy }) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.drawImage(img, Math.round(dx), Math.round(dy), TILE_SIZE, TILE_SIZE);
        loaded++;
        setTilesLoaded(loaded);

        // Draw blue dot on top each time a tile loads (so it's always on top)
        drawBlueDot(ctx, W, H);
      };
      img.onerror = () => {
        loaded++;
        setTilesLoaded(loaded);
        // Draw a gray tile placeholder
        ctx.fillStyle = '#d8e8d8';
        ctx.fillRect(Math.round(dx), Math.round(dy), TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = '#c8d8c8';
        ctx.strokeRect(Math.round(dx), Math.round(dy), TILE_SIZE, TILE_SIZE);
        drawBlueDot(ctx, W, H);
      };
      img.src = `https://tile.openstreetmap.org/${ZOOM}/${tx}/${ty}.png`;
    });

    function drawBlueDot(ctx: CanvasRenderingContext2D, W: number, H: number) {
      const cx = W / 2;
      const cy = H / 2;

      // Accuracy ring (outer glow)
      const grad = ctx.createRadialGradient(cx, cy, 6, cx, cy, 48);
      grad.addColorStop(0, 'rgba(59,130,246,0.22)');
      grad.addColorStop(1, 'rgba(59,130,246,0)');
      ctx.beginPath();
      ctx.arc(cx, cy, 48, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // White halo
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Blue dot
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#2563eb';
      ctx.fill();

      // Inner shine
      ctx.beginPath();
      ctx.arc(cx - 2.5, cy - 2.5, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
    }
  }, [position, mapSize]);

  const mapReady = !!position && tilesLoaded > 0;

  const chooserProps = {
    step,
    setStep,
    gpsState,
    errorMsg,
    locationPermission,
    position,
    requestLocationAccess,
    onSelectMode,
    onClose,
  };

  return (
    <div
      className="h-[100dvh] w-screen overflow-hidden flex flex-col lg:flex-row"
      style={{ background: '#f0f4f0', fontFamily: "'Inter', 'Plus Jakarta Sans', sans-serif" }}
    >
      {/* ── Map pane ── */}
      <div ref={mapContainerRef} className="relative flex-1 min-h-[42vh] lg:min-h-0 min-w-0">
        <canvas
          ref={canvasRef}
          width={mapSize.w}
          height={mapSize.h}
          className="w-full h-full"
          style={{ display: mapReady ? 'block' : 'none' }}
        />

        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #e8f0e8 0%, #d4e8d4 100%)' }}>
            <div className="text-center space-y-3">
              <div className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto"
                style={{ background: 'hsl(152 70% 22% / 0.12)' }}>
                {gpsState === 'requesting' || gpsState === 'idle'
                  ? <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'hsl(152 70% 22%)' }} />
                  : gpsState === 'error'
                    ? <AlertTriangle className="h-8 w-8" style={{ color: '#dc2626' }} />
                    : <MapPin className="h-8 w-8" style={{ color: 'hsl(152 70% 22%)' }} />
                }
              </div>
              <div>
                <p className="text-base font-bold" style={{ color: 'hsl(152 70% 22%)' }}>
                  {gpsState === 'requesting' ? 'Finding your location…'
                    : gpsState === 'error' ? 'Location unavailable'
                      : 'Loading map…'}
                </p>
                {gpsState === 'error'
                  ? <p className="text-sm mt-1 px-8 text-center" style={{ color: '#666' }}>{errorMsg}</p>
                  : <p className="text-sm mt-1" style={{ color: '#5a7a5a' }}>
                    Opening OpenStreetMap
                  </p>
                }
              </div>
            </div>
          </div>
        )}

        <AnimatePresence>
          {mapReady && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute bottom-0 left-0 z-10 px-2 py-1"
              style={{ fontSize: 9, color: 'rgba(0,0,0,0.55)', background: 'rgba(255,255,255,0.7)', borderRadius: '0 6px 0 0' }}
            >
              © OpenStreetMap contributors
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile-only top header */}
        <div className="absolute top-0 left-0 right-0 z-20 px-4 pt-12 pb-3 lg:hidden"
          style={{
            background: 'linear-gradient(to bottom, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.85) 70%, rgba(255,255,255,0) 100%)',
          }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'hsl(152 70% 22%)', boxShadow: '0 4px 16px hsl(152 70% 22% / 0.35)' }}>
              <Navigation className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-base font-bold" style={{ color: 'hsl(152 70% 22%)' }}>Unity Park</p>
              <p className="text-xs" style={{ color: '#5a7a5a' }}>Addis Ababa, Ethiopia</p>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {mapReady && (
            <motion.div
              key="youarehere"
              initial={{ opacity: 0, y: -10, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="absolute z-20 flex items-center gap-1.5 rounded-full px-3 py-1.5 pointer-events-none"
              style={{
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -72px)',
                background: 'rgba(255,255,255,0.96)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
                fontSize: 12,
                fontWeight: 700,
                color: '#1a3a1a',
                backdropFilter: 'blur(8px)',
              }}
            >
              <span className="text-blue-500">●</span>
              <span>You are here</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Desktop side panel ── */}
      <aside
        className="hidden lg:flex lg:w-[420px] xl:w-[460px] flex-shrink-0 flex-col bg-white border-l"
        style={{ borderColor: '#ebe9e4' }}
      >
        <div className="px-8 pt-10 pb-6 border-b" style={{ borderColor: '#ebe9e4' }}>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'hsl(152 70% 22%)', boxShadow: '0 4px 16px hsl(152 70% 22% / 0.25)' }}>
              <Navigation className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-xl font-bold tracking-tight" style={{ color: 'hsl(152 70% 22%)' }}>Yet NW</p>
              <p className="text-sm mt-0.5" style={{ color: '#5a7a5a' }}>Unity Park · Addis Ababa</p>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-8 py-8">
          <SplashChooserPanel {...chooserProps} variant="desktop" />
        </div>
        <p className="px-8 pb-8 text-[11px]" style={{ color: '#b3b0a8' }}>
          Location is used to center the map on you. You can change this in browser settings.
        </p>
      </aside>

      {/* ── Mobile bottom sheet ── */}
      <AnimatePresence>
        {!dismissed && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 24, stiffness: 240 }}
            className="lg:hidden fixed bottom-0 left-0 right-0 z-20"
            style={{
              background: 'rgba(255,255,255,0.97)',
              backdropFilter: 'blur(20px)',
              borderRadius: '28px 28px 0 0',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.1)',
              padding: '24px 20px',
              paddingBottom: 'max(28px, env(safe-area-inset-bottom, 28px))',
            }}
          >
            <SplashChooserPanel {...chooserProps} variant="mobile" onDismiss={() => setDismissed(true)} />
          </motion.div>
        )}
      </AnimatePresence>

      {dismissed && (
        <button
          type="button"
          onClick={() => setDismissed(false)}
          className="lg:hidden fixed bottom-6 right-6 z-30 rounded-full bg-white shadow-lg p-3 flex items-center justify-center"
          aria-label="Reopen view chooser"
        >
          <Navigation className="w-5 h-5 text-foreground" />
        </button>
      )}
    </div>
  );
};

export default LocationSplash;