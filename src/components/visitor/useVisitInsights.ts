// The visitor map's anonymous counting (src/lib/analytics/visits.ts): one recorder per venue
// visit, off for previews and for browsers that ask not to be tracked.

import { useEffect, useMemo } from 'react';
import { createVisitRecorder, doNotTrack, type VisitSource } from '@/lib/analytics/visits';

/** How this visit arrived. */
export function visitSource(params: URLSearchParams, referrer = typeof document === 'undefined' ? '' : document.referrer): VisitSource {
  if (typeof window !== 'undefined' && window.self !== window.top) return 'embed';
  if (params.get('from') || params.get('entry')) return 'qr';
  if (params.get('place')) return 'link';
  try {
    if (referrer && typeof location !== 'undefined' && new URL(referrer).origin === location.origin) return 'home';
  } catch { /* not a URL */ }
  return 'direct';
}

export function useVisitInsights(buildingId: string | undefined, enabled: boolean, source: VisitSource) {
  const on = enabled && !!buildingId && !doNotTrack();
  const recorder = useMemo(() => (buildingId ? createVisitRecorder({ buildingId, source, enabled: on }) : null), [buildingId, on]); // eslint-disable-line react-hooks/exhaustive-deps -- the source is how the visit began
  useEffect(() => {
    if (!recorder) return;
    recorder.track({ kind: 'visit' });
    return () => recorder.dispose();
  }, [recorder]);
  return recorder;
}
