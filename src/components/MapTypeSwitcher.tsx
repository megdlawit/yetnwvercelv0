/**
 * MapTypeSwitcher — Standard / Satellite / Terrain picker + custom image layer.
 *
 * Two variants:
 *   - "panel"   → larger thumbnail tiles with labels (used inside MapLayersPanel)
 *   - "compact" → small icon-only segmented control (admin live preview)
 *
 * Thumbnails: real OSM tile screenshots loaded via a static tile URL so they
 * look like actual map previews, not illustrative SVG swatches.
 * The "+" tile lets users upload a custom image as an overlay layer.
 */
import React, { useRef, useState } from 'react';
import { ImagePlus, Check } from 'lucide-react';
import { MAP_STYLES, type MapStyleId } from '@/lib/mapStyles';

const ACTIVE_COLOR = 'hsl(152 68% 22%)';

// ─── Real tile preview URLs (Unity Park, Addis Ababa z=13) ───────────────────
// Using static OSM tile coords: z=13 x=4955 y=3968 (≈ 9.02°N 38.76°E)
const TILE_PREVIEWS: Record<MapStyleId, string> = {
  standard:
    'https://tile.openstreetmap.org/13/4955/3968.png',
  satellite:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/13/3968/4955',
  terrain:
    'https://a.tile.opentopomap.org/13/4955/3968.png',
};

// Fallback SVG swatches if tiles fail to load
function StandardSwatch() {
  return (
    <svg viewBox="0 0 72 72" className="w-full h-full">
      <rect width="72" height="72" fill="#f3efe6" />
      <rect x="0" y="28" width="72" height="7" fill="#fdf6e3" stroke="#e3dcc8" strokeWidth="0.5" />
      <rect x="30" y="0" width="7" height="72" fill="#fdf6e3" stroke="#e3dcc8" strokeWidth="0.5" />
      <rect x="6" y="8" width="16" height="12" rx="1" fill="#cfe3bd" />
      <rect x="44" y="44" width="18" height="14" rx="1" fill="#cfe3bd" />
      <rect x="8" y="42" width="12" height="8" rx="1" fill="#d4c9b0" />
    </svg>
  );
}
function SatelliteSwatch() {
  return (
    <svg viewBox="0 0 72 72" className="w-full h-full">
      <defs>
        <linearGradient id="sg2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5a7a4a" />
          <stop offset="60%" stopColor="#3a5a32" />
          <stop offset="100%" stopColor="#2a4528" />
        </linearGradient>
      </defs>
      <rect width="72" height="72" fill="url(#sg2)" />
      <rect x="10" y="12" width="20" height="16" fill="#7a8a6a" opacity="0.7" rx="1" />
      <rect x="38" y="36" width="26" height="18" fill="#6a5a4a" opacity="0.6" rx="1" />
      <circle cx="52" cy="18" r="8" fill="#3a6a8a" opacity="0.8" />
      <circle cx="22" cy="52" r="5" fill="#3a6a8a" opacity="0.5" />
    </svg>
  );
}
function TerrainSwatch() {
  return (
    <svg viewBox="0 0 72 72" className="w-full h-full">
      <rect width="72" height="72" fill="#ede3d3" />
      <path d="M0 52 Q18 38 36 48 T72 40" fill="none" stroke="#b08a5a" strokeWidth="2" opacity="0.7" />
      <path d="M0 38 Q20 24 38 34 T72 26" fill="none" stroke="#8a9a5a" strokeWidth="2" opacity="0.7" />
      <path d="M0 22 Q22 10 40 18 T72 12" fill="none" stroke="#6a8a4a" strokeWidth="2" opacity="0.6" />
      <path d="M0 8 Q16 2 28 6 T72 2" fill="none" stroke="#5a7a3a" strokeWidth="1.5" opacity="0.5" />
    </svg>
  );
}

const SWATCHES: Record<MapStyleId, React.FC> = {
  standard: StandardSwatch,
  satellite: SatelliteSwatch,
  terrain: TerrainSwatch,
};

export interface CustomImageLayer {
  id: string;
  name: string;
  dataUrl: string; // base64 data URL of the uploaded image
}

interface MapTypeSwitcherProps {
  value: MapStyleId;
  onChange: (id: MapStyleId) => void;
  variant?: 'panel' | 'compact';
  /** Custom image layers added by user */
  customImageLayers?: CustomImageLayer[];
  /** Called when user uploads a new image to create a custom layer */
  onAddImageLayer?: (layer: CustomImageLayer) => void;
  /** Currently selected custom image layer id (null = none) */
  activeImageLayerId?: string | null;
  onSelectImageLayer?: (id: string | null) => void;
}

// ─── Tile thumbnail with real-tile fetch + SVG fallback ──────────────────────
const TileThumbnail: React.FC<{ styleId: MapStyleId }> = ({ styleId }) => {
  const [failed, setFailed] = useState(false);
  const Swatch = SWATCHES[styleId];

  if (failed) return <Swatch />;

  return (
    <img
      src={TILE_PREVIEWS[styleId]}
      alt=""
      className="w-full h-full object-cover"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
};

const MapTypeSwitcher: React.FC<MapTypeSwitcherProps> = ({
  value,
  onChange,
  variant = 'panel',
  customImageLayers = [],
  onAddImageLayer,
  activeImageLayerId = null,
  onSelectImageLayer,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      onAddImageLayer?.({
        id: `img-${Date.now()}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        dataUrl,
      });
      setUploading(false);
    };
    reader.readAsDataURL(file);
    // reset so same file can be re-selected
    e.target.value = '';
  }

  // ── Compact variant ────────────────────────────────────────────────────────
  if (variant === 'compact') {
    return (
      <div
        className="flex items-center gap-0.5 rounded-full p-0.5"
        style={{ background: '#efefef' }}
      >
        {MAP_STYLES.map((s) => {
          const active = s.id === value;
          return (
            <button
              key={s.id}
              onClick={() => onChange(s.id)}
              className="px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-150"
              style={
                active
                  ? { background: ACTIVE_COLOR, color: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }
                  : { color: '#6b7280' }
              }
            >
              {s.label}
            </button>
          );
        })}
      </div>
    );
  }

  // ── Panel variant ──────────────────────────────────────────────────────────
  const allTiles = [
    ...MAP_STYLES.map((s) => ({ kind: 'style' as const, s })),
    ...customImageLayers.map((img) => ({ kind: 'image' as const, img })),
  ];

  return (
    <div className="px-5">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
        {/* Built-in style tiles */}
        {allTiles.map((item) => {
          if (item.kind === 'style') {
            const { s } = item;
            const active = s.id === value;
            return (
              <button
                key={s.id}
                onClick={() => {
                  onChange(s.id);
                  onSelectImageLayer?.(null); // deselect custom image
                }}
                className="flex flex-col items-center gap-2 flex-shrink-0"
                style={{ width: 72 }}
              >
                {/* Tile frame */}
                <div
                  className="relative rounded-2xl overflow-hidden transition-all duration-150"
                  style={{
                    width: 72,
                    height: 72,
                    border: active ? `2.5px solid ${ACTIVE_COLOR}` : '2.5px solid transparent',
                    boxShadow: active
                      ? `0 0 0 3px ${ACTIVE_COLOR}22, 0 4px 12px rgba(0,0,0,0.15)`
                      : '0 2px 8px rgba(0,0,0,0.10)',
                    outline: active ? 'none' : undefined,
                  }}
                >
                  <TileThumbnail styleId={s.id} />
                  {/* Active check badge */}
                  {active && (
                    <div
                      className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: ACTIVE_COLOR }}
                    >
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </div>
                  )}
                </div>
                <span
                  className="text-[11px] font-semibold leading-none"
                  style={{ color: active ? ACTIVE_COLOR : '#6b7280' }}
                >
                  {s.label}
                </span>
              </button>
            );
          }

          // Custom image tile
          const { img } = item;
          const active = img.id === activeImageLayerId;
          return (
            <button
              key={img.id}
              onClick={() => onSelectImageLayer?.(active ? null : img.id)}
              className="flex flex-col items-center gap-2 flex-shrink-0"
              style={{ width: 72 }}
            >
              <div
                className="relative rounded-2xl overflow-hidden transition-all duration-150"
                style={{
                  width: 72,
                  height: 72,
                  border: active ? `2.5px solid ${ACTIVE_COLOR}` : '2.5px solid #e0e0e0',
                  boxShadow: active
                    ? `0 0 0 3px ${ACTIVE_COLOR}22, 0 4px 12px rgba(0,0,0,0.15)`
                    : '0 2px 8px rgba(0,0,0,0.10)',
                }}
              >
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="w-full h-full object-cover"
                  draggable={false}
                />
                {active && (
                  <div
                    className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: ACTIVE_COLOR }}
                  >
                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
                  </div>
                )}
              </div>
              <span
                className="text-[11px] font-semibold leading-none truncate w-full text-center"
                style={{ color: active ? ACTIVE_COLOR : '#6b7280', maxWidth: 72 }}
              >
                {img.name}
              </span>
            </button>
          );
        })}

        {/* Add image tile */}
        {onAddImageLayer && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-2 flex-shrink-0"
            style={{ width: 72 }}
            disabled={uploading}
            aria-label="Add custom image layer"
          >
            <div
              className="rounded-2xl flex flex-col items-center justify-center transition-all duration-150 active:scale-95"
              style={{
                width: 72,
                height: 72,
                border: '2px dashed #d0d0d0',
                background: '#fafafa',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                gap: 4,
              }}
            >
              {uploading ? (
                <div
                  className="w-5 h-5 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin"
                />
              ) : (
                <>
                  <ImagePlus className="w-5 h-5" style={{ color: '#9ca3af' }} />
                  <span className="text-[9px] font-semibold text-gray-400 leading-none">
                    Add Image
                  </span>
                </>
              )}
            </div>
            <span className="text-[11px] font-semibold text-gray-400 leading-none">
              Custom
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

export default MapTypeSwitcher;