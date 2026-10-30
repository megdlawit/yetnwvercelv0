import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { IndoorMap } from '../packages/indoor-maps-sdk/src';
import type { IndoorMapProps } from '../packages/indoor-maps-sdk/src/types';
import { fetchBuildingGraph } from '../packages/indoor-maps-sdk/src/api';
import { venueFromGraph } from '../packages/indoor-maps-sdk/src/model3d';
import { mountNavigation, type MountOptions, type MountedNavigation } from '@ethi/indoor-core';

/**
 * Standalone script-tag loader — the "Google Maps JS API" style door into
 * the map, as opposed to the npm package (React apps) or /embed (iframe).
 *
 * Partner site usage, no build step, no React required on their side:
 *
 *   <div id="map" style="width:100%;height:480px"></div>
 *   <script src="https://yourapp.vercel.app/embed.js"></script>
 *   <script>
 *     const map = EthiMaps.render('#map', {
 *       apiKey: 'pk_live_...',
 *       buildingId: 'unity-park',
 *       onPoiClick: (poi) => console.log(poi.name),
 *     });
 *     // later, if the div is removed from the page:
 *     // map.destroy();
 *   </script>
 *
 * This bundles React + ReactDOM + the SDK's rendering internals into one
 * file specifically so partner pages don't need React installed at all —
 * everything the widget needs travels with it. That's why this has its own
 * Vite build (vite.embed.config.ts) instead of reusing the main app bundle.
 */
export type EthiMapsRenderOptions = Omit<IndoorMapProps, 'className' | 'style'>;

export interface EthiMapsHandle {
  destroy: () => void;
}

function resolveTarget(target: string | HTMLElement): HTMLElement {
  if (typeof target !== 'string') return target;
  const el = document.querySelector(target);
  if (!el) throw new Error(`EthiMaps.render: no element found for selector "${target}"`);
  return el as HTMLElement;
}

function render(target: string | HTMLElement, options: EthiMapsRenderOptions): EthiMapsHandle {
  const container = resolveTarget(target);
  // The widget fills whatever box the partner gives it — they control size
  // via the container div's own CSS, same as Google Maps' embed model.
  container.style.position = container.style.position || 'relative';

  const root: Root = createRoot(container);
  root.render(createElement(IndoorMap, { ...options, style: { width: '100%', height: '100%' } }));

  return {
    destroy: () => root.unmount(),
  };
}

/**
 * The 3D building with turn-by-turn guidance — no React involved at all:
 *
 *   const nav = await EthiMaps.render3D('#map', { apiKey: 'pk_live_…', buildingId: 'unity-park', from: '<node>', to: '<node>', lang: 'am' });
 *   nav.setLang('en'); nav.scanQr(code); nav.destroy();
 */
export interface EthiMaps3DOptions extends Omit<MountOptions, 'venue'> {
  apiKey: string;
  buildingId: string;
  apiBaseUrl?: string;
}

async function render3D(target: string | HTMLElement, options: EthiMaps3DOptions): Promise<MountedNavigation> {
  const container = resolveTarget(target);
  container.style.position = container.style.position || 'relative';
  const { apiKey, buildingId, apiBaseUrl, ...rest } = options;
  const graph = await fetchBuildingGraph({ apiKey, buildingId, apiBaseUrl });
  const venue = venueFromGraph(graph);
  if (!venue) throw new Error('EthiMaps.render3D: this building has no indoor map yet');
  return mountNavigation(container, { ...rest, venue });
}

declare global {
  interface Window {
    EthiMaps: { render: typeof render; render3D: typeof render3D };
  }
}

window.EthiMaps = { render, render3D };
