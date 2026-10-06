/**
 * BlueDot — animated user position indicator for the yet nw route finder.
 *
 * Renders:
 *  • Pulsing blue dot (position)
 *  • Direction cone (heading)
 *  • Accuracy circle (radius = accuracy meters, scaled to canvas)
 *
 * Animates at 60fps using requestAnimationFrame + linear interpolation.
 * Handles environment transitions with cross-fades and smooth blending.
 *
 * Props supply a HybridPosition; all motion is internally interpolated.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import type { HybridPosition } from '@/lib/geo/HybridPositioningEngine';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface BlueDotViewport {
  /** Project a {x,y} indoor pixel to SVG canvas coords. */
  projectIndoor?: (x: number, y: number) => { cx: number; cy: number };
  /** Project a {lat,lng} to SVG canvas coords. */
  projectGeo?: (lat: number, lng: number) => { cx: number; cy: number };
  /** Meters-per-pixel of the current canvas (for accuracy circle sizing). */
  metersPerPixel: number;
  /** Current map camera bearing in degrees (0 = north-up). The heading cone
   *  is drawn in screen space, so once the map itself can rotate (see
   *  BaseMap's dragRotate), the cone's screen angle needs to be the
   *  device's compass heading *minus* the map's bearing — otherwise it
   *  would keep pointing at its old screen angle instead of still pointing
   *  the person's real-world direction once the map underneath has spun. */
  bearing?: number;
}

export interface BlueDotProps {
  position: HybridPosition;
  viewport: BlueDotViewport;
  /** Override dot size in px (default 10). */
  dotRadius?: number;
  /** Show direction cone. Default true when heading is finite. */
  showCone?: boolean;
  /** Show accuracy circle. Default true. */
  showAccuracy?: boolean;
  /** Is the user currently walking? Controls pulse animation. */
  isWalking?: boolean;
}

// ─── Lerp helpers ──────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  if (!isFinite(a)) return b;
  if (!isFinite(b)) return a;
  const delta = ((b - a + 540) % 360) - 180;
  return a + delta * t;
}

// ─── Component ─────────────────────────────────────────────────────────────────

const BlueDot: React.FC<BlueDotProps> = ({
  position,
  viewport,
  dotRadius = 10,
  showCone = true,
  showAccuracy = true,
  isWalking = false,
}) => {
  // Rendered (interpolated) state
  const renderRef = useRef({
    cx: 0,
    cy: 0,
    heading: NaN,
    accuracy: 20,
    alpha: 0,         // 0=invisible, 1=visible
    coneAlpha: 0,
    accuracyAlpha: 0,
    pulseR: dotRadius,
    pulseAlpha: 0,
    initialized: false,
  });

  // Target state (from props)
  const targetRef = useRef({
    cx: 0,
    cy: 0,
    heading: NaN,
    accuracy: 20,
    visible: false,
  });

  // SVG refs for direct DOM mutation (avoids React re-renders for 60fps)
  const dotRef = useRef<SVGCircleElement>(null);
  const highlightRef = useRef<SVGCircleElement>(null);
  const glowRef = useRef<SVGCircleElement>(null);
  const pulseRef = useRef<SVGCircleElement>(null);
  const accuracyRef = useRef<SVGCircleElement>(null);
  const coneRef = useRef<SVGPathElement>(null);
  const coneGroupRef = useRef<SVGGElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const pulsePhaseRef = useRef<number>(0);

  // Compute projected position whenever position or viewport changes
  const projected = useMemo((): { cx: number; cy: number } | null => {
    if (position.source === 'none') return null;

    if (
      (position.environment === 'indoor' || position.environment === 'transitioning') &&
      position.x != null &&
      position.y != null &&
      viewport.projectIndoor
    ) {
      return viewport.projectIndoor(position.x, position.y);
    }

    if (position.lat != null && position.lng != null && viewport.projectGeo) {
      return viewport.projectGeo(position.lat, position.lng);
    }

    return null;
  }, [position, viewport]);

  // Accuracy radius in canvas pixels
  const accuracyPx = useMemo(() => {
    if (!isFinite(position.accuracy) || position.accuracy > 500) return 0;
    return Math.max(dotRadius * 1.5, position.accuracy / viewport.metersPerPixel);
  }, [position.accuracy, viewport.metersPerPixel, dotRadius]);

  // Update targets
  useEffect(() => {
    const t = targetRef.current;
    if (projected) {
      t.cx = projected.cx;
      t.cy = projected.cy;
      t.visible = true;
    } else {
      t.visible = false;
    }
    t.heading = isFinite(position.heading) ? position.heading - (viewport.bearing ?? 0) : position.heading;
    t.accuracy = accuracyPx;
  }, [projected, position.heading, accuracyPx, viewport.bearing]);

  // rAF loop
  useEffect(() => {
    const SPEED = 8; // interpolation speed (units/s)

    function frame(ts: number): void {
      const dt = Math.min(0.1, (ts - lastFrameRef.current) / 1000);
      lastFrameRef.current = ts;

      const r = renderRef.current;
      const t = targetRef.current;

      // Skip if SVG elements not mounted
      if (!dotRef.current || !groupRef.current) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      // Initialize on first frame with data
      if (!r.initialized && t.visible) {
        r.cx = t.cx;
        r.cy = t.cy;
        r.heading = t.heading;
        r.accuracy = t.accuracy;
        r.initialized = true;
      }

      const k = 1 - Math.pow(1 - Math.min(1, dt * SPEED), 1);

      // Interpolate position
      r.cx = lerp(r.cx, t.cx, k);
      r.cy = lerp(r.cy, t.cy, k);

      // Interpolate heading (circular)
      r.heading = lerpAngle(r.heading, isFinite(t.heading) ? t.heading : r.heading, k * 0.4);

      // Interpolate accuracy circle radius
      r.accuracy = lerp(r.accuracy, t.accuracy, k * 0.3);

      // Fade visibility
      const targetAlpha = t.visible ? 1 : 0;
      r.alpha = lerp(r.alpha, targetAlpha, k);
      r.coneAlpha = lerp(r.coneAlpha, isFinite(r.heading) && showCone ? 1 : 0, k);
      r.accuracyAlpha = lerp(r.accuracyAlpha, showAccuracy && r.accuracy > dotRadius ? 1 : 0, k * 0.3);

      // Pulse animation
      pulsePhaseRef.current = (pulsePhaseRef.current + dt * (isWalking ? 0.9 : 0.4)) % 1;
      const phase = pulsePhaseRef.current;
      r.pulseR = dotRadius + phase * dotRadius * 2.5;
      r.pulseAlpha = (1 - phase) * (isWalking ? 0.5 : 0.2) * r.alpha;

      // Apply to DOM
      const group = groupRef.current!;
      group.style.opacity = String(r.alpha);

      // Position all elements via group transform
      group.setAttribute('transform', `translate(${r.cx.toFixed(2)},${r.cy.toFixed(2)})`);

      // Shadow
      if (shadowRef.current) {
        shadowRef.current.setAttribute('cy', '2');
      }

      // Glow ring
      if (glowRef.current) {
        glowRef.current.setAttribute('r', String((dotRadius * 2.2).toFixed(1)));
      }

      // Pulse ring
      if (pulseRef.current) {
        pulseRef.current.setAttribute('r', r.pulseR.toFixed(1));
        pulseRef.current.style.opacity = r.pulseAlpha.toFixed(3);
      }

      // Accuracy circle
      if (accuracyRef.current) {
        accuracyRef.current.setAttribute('r', r.accuracy.toFixed(1));
        accuracyRef.current.style.opacity = (r.accuracyAlpha * 0.18).toFixed(3);
        if (accuracyRef.current.parentElement) {
          (accuracyRef.current.parentElement as SVGElement).style.opacity =
            (r.accuracyAlpha * 0.7).toFixed(3);
        }
      }

      // Direction cone
      if (coneGroupRef.current) {
        coneGroupRef.current.style.opacity = (r.coneAlpha * r.alpha).toFixed(3);
        if (isFinite(r.heading)) {
          coneGroupRef.current.setAttribute('transform', `rotate(${r.heading.toFixed(1)})`);
        }
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    lastFrameRef.current = performance.now();
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [dotRadius, showCone, showAccuracy, isWalking]);

  const coneLength = dotRadius * 3.5;
  const coneWidth = dotRadius * 1.2;
  const conePath = `M 0 ${-dotRadius - 2} L ${-coneWidth} ${-dotRadius - coneLength + coneWidth} Q 0 ${-dotRadius - coneLength + 4} ${coneWidth} ${-dotRadius - coneLength + coneWidth} Z`;

  // Environment-specific color tints
  // Outdoor + default: vibrant green matching reference (green user dot)
  // Transitioning: purple-ish blend
  const isTransitioning = position.environment === 'transitioning';

  // Green for outdoor/default, purple tint when transitioning (indoor→outdoor)
  const dotColor    = isTransitioning ? 'hsl(280 70% 55%)' : 'hsl(133 65% 42%)';
  const dotColorHi  = isTransitioning ? 'hsl(280 70% 72%)' : 'hsl(133 60% 58%)';
  const dotColorGlow = isTransitioning ? 'hsl(280 70% 55% / 0.12)' : 'hsl(133 65% 42% / 0.14)';

  return (
    <g ref={groupRef} style={{ pointerEvents: 'none', opacity: 0 }}>
      {/* Accuracy circle */}
      <g style={{ opacity: 0 }}>
        <circle
          ref={accuracyRef}
          r={20}
          fill={dotColor}
          stroke={dotColor}
          strokeWidth={1}
          style={{
            transition: 'fill 1s ease, stroke 1s ease',
            opacity: 0,
          }}
        />
      </g>

      {/* Glow ring */}
      <circle
        ref={glowRef}
        r={dotRadius * 2.2}
        fill={dotColorGlow}
        stroke="none"
        style={{ transition: 'fill 1s ease' }}
      />

      {/* Pulse ring */}
      <circle
        ref={pulseRef}
        r={dotRadius}
        fill="none"
        stroke={dotColor}
        strokeWidth={1.5}
        style={{ opacity: 0, transition: 'stroke 1s ease' }}
      />

      {/* Direction cone */}
      <g ref={coneGroupRef} style={{ opacity: 0 }}>
        <defs>
          <radialGradient id="ethi-cone-grad" cx="50%" cy="80%" r="80%">
            <stop offset="0%" stopColor={dotColorHi} stopOpacity="0.55" />
            <stop offset="100%" stopColor={dotColorHi} stopOpacity="0" />
          </radialGradient>
        </defs>
        <path
          ref={coneRef}
          d={conePath}
          fill="url(#ethi-cone-grad)"
        />
      </g>

      {/* Shadow */}
      <ellipse
        ref={shadowRef}
        cx={0}
        cy={2}
        rx={dotRadius * 0.8}
        ry={dotRadius * 0.35}
        fill="rgba(0,0,0,0.16)"
      />

      {/* Main dot */}
      <defs>
        <radialGradient id="ethi-dot-grad" cx="35%" cy="35%">
          <stop offset="0%" stopColor={dotColorHi} />
          <stop offset="100%" stopColor={dotColor} />
        </radialGradient>
      </defs>
      <circle
        ref={dotRef}
        r={dotRadius}
        fill="url(#ethi-dot-grad)"
        stroke="white"
        strokeWidth={2.5}
      />

      {/* Specular highlight */}
      <circle
        ref={highlightRef}
        cx={-dotRadius * 0.28}
        cy={-dotRadius * 0.28}
        r={dotRadius * 0.3}
        fill="white"
        opacity={0.7}
      />
    </g>
  );
};

export default BlueDot;