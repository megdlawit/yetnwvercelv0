// <IndoorMap3D> — a venue as an explorable 3D building, with optional
// turn-by-turn guidance between two places (English or Amharic, spoken).
//
//   <IndoorMap3D apiKey="pk_live_…" buildingId="unity-park" from="<node id>" to="<node id>" lang="am" />
//
// Same renderer, routing and guidance as the visitor app (@ethi/indoor-core).
// Everything lives inside the component's own element — no globals, no
// global CSS. Peer dependencies: react, react-dom, three.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { mountNavigation, type Lang, type MountedNavigation, type SessionState, type ViewerTheme, type Selection } from '@ethi/indoor-core';
import { fetchBuildingGraph, IndoorMapApiError } from './api';
import { venueFromGraph } from './model3d';

export interface IndoorMap3DProps {
  apiKey: string;
  buildingId: string;
  apiBaseUrl?: string;
  /** Route between these path points (node ids, e.g. from the graph's venue floors). */
  from?: string | null;
  to?: string | null;
  lang?: Lang;
  stepFree?: boolean;
  /** 'simulate' walks the route (demos); 'pdr' uses the phone's steps; 'external' — push positions via the ref. */
  position?: 'simulate' | 'pdr' | 'external';
  voice?: boolean;
  theme?: Partial<ViewerTheme>;
  onPlaceSelect?: (sel: Selection | null) => void;
  onGuidance?: (state: SessionState) => void;
  onError?: (err: Error) => void;
  /** Gets the live handle (setLang, scanQr, pushFix…) once mounted. */
  onReady?: (nav: MountedNavigation) => void;
  className?: string;
  style?: CSSProperties;
}

export function IndoorMap3D(props: IndoorMap3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const nav = useRef<MountedNavigation | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    const ac = new AbortController();
    setStatus('loading');
    fetchBuildingGraph({ apiKey: props.apiKey, buildingId: props.buildingId, apiBaseUrl: props.apiBaseUrl, signal: ac.signal })
      .then(graph => {
        if (ac.signal.aborted || !host.current) return;
        const venue = venueFromGraph(graph);
        if (!venue) throw new IndoorMapApiError('This building has no indoor map yet', 404);
        nav.current = mountNavigation(host.current, {
          venue, from: props.from, to: props.to, lang: props.lang, stepFree: props.stepFree, position: props.position, voice: props.voice, theme: props.theme,
          onSelect: s => cb.current.onPlaceSelect?.(s), onState: s => cb.current.onGuidance?.(s),
        });
        setStatus('ready');
        cb.current.onReady?.(nav.current);
      })
      .catch(err => {
        if (ac.signal.aborted) return;
        setStatus('error');
        setMessage(err instanceof Error ? err.message : String(err));
        cb.current.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    return () => { ac.abort(); nav.current?.destroy(); nav.current = null; };
    // A new building or route re-mounts; language and step-free switch in place.
  }, [props.apiKey, props.buildingId, props.apiBaseUrl, props.from, props.to, props.position]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (props.lang) nav.current?.setLang(props.lang); }, [props.lang]);
  useEffect(() => { if (props.stepFree != null) nav.current?.setStepFree(props.stepFree); }, [props.stepFree]);

  return (
    <div className={props.className} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 320, background: '#f8f6f1', ...props.style }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      {status !== 'ready' && (
        <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: status === 'error' ? '#b42318' : '#6b7168', font: '500 14px system-ui, sans-serif', padding: 16, textAlign: 'center' }}>
          {status === 'loading' ? 'Loading the 3D map…' : message}
        </div>
      )}
    </div>
  );
}

export default IndoorMap3D;
