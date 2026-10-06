// Live turn-by-turn guidance along a computed route. Progress comes from GPS
// or steps + compass (snapped onto the route), or plain step counts, and the visitor can tap
// Next/Back themselves. Speaks each new instruction if voice is on.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RouteNode, Step } from '@/lib/venue/routing';
import { ARRIVE_WITHIN_M, OFF_ROUTE_M, currentStepIndex, measureRoute, pointAlong, projectOntoRoute } from '@/lib/venue/guidance';

export function useGuidance({ path, steps, pxPerMeter, active, sensedPlan, walkedM }: {
  path: RouteNode[] | null; steps: Step[]; pxPerMeter: number; active: boolean;
  /** Where the visitor is on the plan (GPS, or steps + compass), if known. */
  sensedPlan: { x: number; y: number; floorId: string } | null;
  /** Metres walked (counted steps) since guidance started. */
  walkedM: number;
}) {
  const { cum, total } = useMemo(() => measureRoute(path ?? [], pxPerMeter), [path, pxPerMeter]);
  const [manual, setManual] = useState(0);    // metres the visitor moved on by tapping Next
  const [voice, setVoice] = useState(false);
  const walkedAtStart = useRef(walkedM);
  const sensedRef = useRef(0);

  // Restart from the beginning whenever a new route is followed.
  useEffect(() => { setManual(0); walkedAtStart.current = walkedM; sensedRef.current = 0; }, [path, active]); // eslint-disable-line react-hooks/exhaustive-deps

  let sensed = Math.max(0, walkedM - walkedAtStart.current);
  let offRouteM: number | null = null;
  if (sensedPlan && path) {
    const p = projectOntoRoute(path, cum, sensedPlan, pxPerMeter, sensedRef.current);
    offRouteM = p.offRouteM;
    if (p.offRouteM < OFF_ROUTE_M) sensed = Math.max(sensed, p.along);
  }
  sensedRef.current = sensed;
  const along = Math.min(total, Math.max(manual, sensed));
  const stepIndex = steps.length ? currentStepIndex(steps, cum, along) : 0;
  const arrived = !!path && total - along <= ARRIVE_WITHIN_M;
  const position = path ? pointAlong(path, cum, along) : null;
  const remainingM = Math.max(0, total - along);

  const next = useCallback(() => {
    const later = steps.slice(stepIndex + 1).find(s => s.icon !== 'start');
    setManual(m => Math.max(m, along, later ? cum[Math.min(later.pathIndex, cum.length - 1)] - (later.icon === 'straight' ? 0 : 1) : total));
  }, [steps, stepIndex, along, cum, total]);
  const back = useCallback(() => {
    const prev = [...steps.slice(0, stepIndex)].reverse().find(s => s.icon !== 'straight');
    const to = prev ? Math.max(0, (cum[Math.min(prev.pathIndex, cum.length - 1)] ?? 0) - 2) : 0;
    setManual(to);
    walkedAtStart.current += Math.max(0, sensed - to); // counted steps shouldn't push them forward again
    sensedRef.current = to;
  }, [steps, stepIndex, cum, sensed]);

  // Speak each new instruction.
  const spoken = useRef(-1);
  useEffect(() => {
    if (!active || !voice || !steps[stepIndex] || spoken.current === stepIndex) return;
    spoken.current = stepIndex;
    try {
      const u = new SpeechSynthesisUtterance(steps[stepIndex].text);
      u.rate = 1;
      window.speechSynthesis?.cancel();
      window.speechSynthesis?.speak(u);
    } catch { /* no speech on this device */ }
  }, [active, voice, stepIndex, steps]);
  useEffect(() => { if (!active) spoken.current = -1; }, [active]);

  return { along, total, remainingM, stepIndex, arrived, position, offRouteM, next, back, voice, setVoice };
}
