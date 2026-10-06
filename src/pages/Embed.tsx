import { useMemo, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IndoorMap } from '../../packages/indoor-maps-sdk/src';
import type { IndoorMapStyle } from '../../packages/indoor-maps-sdk/src/types';

/**
 * Public embed surface for partner websites.
 *
 * Partners never touch React or npm — they just point an <iframe> at this
 * route with query params:
 *
 *   <iframe src="https://yourapp.vercel.app/embed?key=pk_live_...&building=unity-park"
 *           style="width:100%;height:480px;border:0" loading="lazy"></iframe>
 *
 * Supported params:
 *   key      (required) partner API key, checked server-side by indoor-maps-api
 *   building (required) building id
 *   floor    (optional) numeric floor, default 0
 *   style    (optional) 'standard' | 'satellite' | 'terrain'
 *   from/to  (optional) "lat,lng" pairs to draw a route between two points
 *   view     (optional) 'outdoor' | 'indoor' — which side to open on
 *
 * Tapping "Go" on a POI never routes inside the iframe — it opens this same
 * app's own origin (i.e. the full experience, not the embed) in a new tab so
 * the person gets live turn-by-turn navigation there.
 *
 * This reuses the exact same <IndoorMap> component + partner-key gating as
 * the npm-facing SDK — the embed and the SDK are two doors into the same
 * validated Edge Function, not two separate systems to keep in sync.
 */
export default function Embed() {
  const [params] = useSearchParams();

  const apiKey = params.get('key') ?? '';
  const buildingId = params.get('building') ?? '';
  const floorParam = params.get('floor');
  const floor = floorParam !== null ? Number(floorParam) : undefined;
  const mapStyle = (params.get('style') as IndoorMapStyle | null) ?? undefined;
  const viewParam = params.get('view');
  const initialView = viewParam === 'outdoor' || viewParam === 'indoor' ? viewParam : undefined;

  const route = useMemo(() => {
    const parsePoint = (raw: string | null) => {
      if (!raw) return null;
      const [lat, lng] = raw.split(',').map(Number);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    };
    const from = parsePoint(params.get('from'));
    const to = parsePoint(params.get('to'));
    return from && to ? { from, to } : undefined;
  }, [params]);

  if (!apiKey || !buildingId) {
    return (
      <div style={errorStyle}>
        Missing required <code>key</code> and/or <code>building</code> query params.
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <IndoorMap
        apiKey={apiKey}
        buildingId={buildingId}
        floor={floor}
        mapStyle={mapStyle}
        route={route}
        initialView={initialView}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}

const errorStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  padding: 24,
  textAlign: 'center',
  color: '#b91c1c',
  fontFamily: 'system-ui, sans-serif',
};