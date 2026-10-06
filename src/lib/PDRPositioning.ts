/**
 * Pedestrian Dead Reckoning (PDR) positioning engine.
 * Combines step detection + heading to compute position updates.
 */

// Map scale: 1 pixel ≈ 1 unit. Step length in map pixels.
// Typical indoor step ≈ 0.7m. At scale ~2px/m → 1.4px per step.
// But our map is stylized so we use a larger step for usability.
const STEP_LENGTH = 12; // pixels per step on map

export interface PDRPosition {
  x: number;
  y: number;
}

export function computeStepPosition(
  current: PDRPosition,
  headingRad: number
): PDRPosition {
  // heading: 0=North(up), π/2=East(right), π=South(down), 3π/2=West(left)
  // SVG: x+ is right, y+ is down
  // So: dx = sin(heading), dy = -cos(heading)
  return {
    x: current.x + STEP_LENGTH * Math.sin(headingRad),
    y: current.y - STEP_LENGTH * Math.cos(headingRad),
  };
}

export { STEP_LENGTH };
