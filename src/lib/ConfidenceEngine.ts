/**
 * ConfidenceEngine — Evaluates reliability of current PDR position.
 * Monitors step frequency, heading stability, route proximity, and sensor noise.
 * Outputs a 0–1 confidence score with discrete levels.
 */

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ConfidenceSnapshot {
  score: number;
  level: ConfidenceLevel;
  factors: {
    stepConsistency: number;
    headingStability: number;
    routeProximity: number;
    sensorNoise: number;
  };
  driftVector: { dx: number; dy: number };
  correctionCount: number;
  isFloorTransition: boolean;
}

interface StepRecord {
  timestamp: number;
  interval: number;
}

// ─── Constants ───────────────────────────────────────────────────────

const IDEAL_STEP_INTERVAL = 550; // ms — average walking cadence
const STEP_INTERVAL_TOLERANCE = 250; // ms
const HEADING_WINDOW = 8; // samples for heading stability
const MAX_HEADING_JUMP = 45; // degrees — beyond this is suspicious
const ROUTE_PROXIMITY_GOOD = 10;
const ROUTE_PROXIMITY_BAD = 40;
const NOISE_WINDOW = 12;
const RE_ANCHOR_CONFIDENCE = 0.4;
const RE_ANCHOR_DISTANCE = 25;
const DRIFT_DECAY = 0.92;

// ─── Helpers ─────────────────────────────────────────────────────────

function classifyLevel(score: number): ConfidenceLevel {
  if (score >= 0.8) return 'HIGH';
  if (score >= 0.5) return 'MEDIUM';
  return 'LOW';
}

function headingDelta(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

// ─── Engine ──────────────────────────────────────────────────────────

export class ConfidenceEngine {
  private stepHistory: StepRecord[] = [];
  private headingHistory: number[] = [];
  private noiseHistory: number[] = [];
  private lastRouteDistance = 0;
  private _score = 1;
  private _driftVector = { dx: 0, dy: 0 };
  private _correctionCount = 0;
  private _isFloorTransition = false;
  private _floorTransitionWeight = 1;

  // ── Public API ─────────────────────────────────────────────────────

  get confidence(): number { return this._score; }
  get level(): ConfidenceLevel { return classifyLevel(this._score); }
  get driftVector() { return { ...this._driftVector }; }
  get correctionCount() { return this._correctionCount; }

  /** Should we auto-re-anchor? */
  shouldReAnchor(distToNearestNode: number): boolean {
    return this._score < RE_ANCHOR_CONFIDENCE && distToNearestNode < RE_ANCHOR_DISTANCE;
  }

  /** Full snapshot for debug/UI. */
  getSnapshot(): ConfidenceSnapshot {
    return {
      score: this._score,
      level: this.level,
      factors: {
        stepConsistency: this.calcStepConsistency(),
        headingStability: this.calcHeadingStability(),
        routeProximity: this.calcRouteProximity(),
        sensorNoise: this.calcSensorNoise(),
      },
      driftVector: { ...this._driftVector },
      correctionCount: this._correctionCount,
      isFloorTransition: this._isFloorTransition,
    };
  }

  // ── Input feeds ────────────────────────────────────────────────────

  /** Feed a new step event. */
  recordStep(timestamp: number) {
    const last = this.stepHistory[this.stepHistory.length - 1];
    const interval = last ? timestamp - last.timestamp : IDEAL_STEP_INTERVAL;
    this.stepHistory.push({ timestamp, interval });
    if (this.stepHistory.length > 20) this.stepHistory.shift();
    this.recalc();
  }

  /** Feed heading sample (degrees). */
  recordHeading(deg: number) {
    this.headingHistory.push(deg);
    if (this.headingHistory.length > HEADING_WINDOW * 2) this.headingHistory.shift();
    this.recalc();
  }

  /** Feed accelerometer variance / noise level. */
  recordNoise(variance: number) {
    this.noiseHistory.push(variance);
    if (this.noiseHistory.length > NOISE_WINDOW) this.noiseHistory.shift();
    this.recalc();
  }

  /** Feed distance from current position to nearest route segment. */
  recordRouteDistance(dist: number) {
    this.lastRouteDistance = dist;
    this.recalc();
  }

  /** Accumulate drift vector (raw PDR minus snapped). */
  recordDrift(dx: number, dy: number) {
    this._driftVector.dx = this._driftVector.dx * DRIFT_DECAY + dx;
    this._driftVector.dy = this._driftVector.dy * DRIFT_DECAY + dy;
  }

  /** Called when a correction (snap/re-anchor) occurs. */
  recordCorrection() {
    this._correctionCount++;
    // After correction, partially restore confidence
    this._score = Math.min(1, this._score + 0.15);
  }

  /** Signal floor transition state. */
  setFloorTransition(active: boolean) {
    this._isFloorTransition = active;
    this._floorTransitionWeight = active ? 0.5 : 1;
    this.recalc();
  }

  /** Full reset (e.g., after QR re-anchor). */
  reset() {
    this.stepHistory = [];
    this.headingHistory = [];
    this.noiseHistory = [];
    this.lastRouteDistance = 0;
    this._score = 1;
    this._driftVector = { dx: 0, dy: 0 };
    this._correctionCount = 0;
    this._isFloorTransition = false;
    this._floorTransitionWeight = 1;
  }

  // ── Internal calculations ──────────────────────────────────────────

  private recalc() {
    const step = this.calcStepConsistency();
    const heading = this.calcHeadingStability();
    const route = this.calcRouteProximity();
    const noise = this.calcSensorNoise();

    // Weighted average — route proximity matters most
    const raw = (step * 0.2 + heading * 0.25 + route * 0.35 + noise * 0.2) * this._floorTransitionWeight;
    // Smooth toward new value
    this._score = this._score * 0.7 + raw * 0.3;
    this._score = Math.max(0, Math.min(1, this._score));
  }

  private calcStepConsistency(): number {
    if (this.stepHistory.length < 3) return 0.8; // not enough data — assume ok
    const recent = this.stepHistory.slice(-6);
    const deviations = recent.map(s => Math.abs(s.interval - IDEAL_STEP_INTERVAL));
    const avgDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    return Math.max(0, 1 - avgDev / (STEP_INTERVAL_TOLERANCE * 3));
  }

  private calcHeadingStability(): number {
    if (this.headingHistory.length < 3) return 0.9;
    const recent = this.headingHistory.slice(-HEADING_WINDOW);
    let maxJump = 0;
    for (let i = 1; i < recent.length; i++) {
      maxJump = Math.max(maxJump, headingDelta(recent[i - 1], recent[i]));
    }
    return Math.max(0, 1 - maxJump / (MAX_HEADING_JUMP * 2));
  }

  private calcRouteProximity(): number {
    if (this.lastRouteDistance <= ROUTE_PROXIMITY_GOOD) return 1;
    if (this.lastRouteDistance >= ROUTE_PROXIMITY_BAD) return 0;
    return 1 - (this.lastRouteDistance - ROUTE_PROXIMITY_GOOD) / (ROUTE_PROXIMITY_BAD - ROUTE_PROXIMITY_GOOD);
  }

  private calcSensorNoise(): number {
    if (this.noiseHistory.length < 3) return 0.85;
    const avg = this.noiseHistory.reduce((a, b) => a + b, 0) / this.noiseHistory.length;
    // Normalize: low noise (< 0.5) = good, high noise (> 5) = bad
    return Math.max(0, Math.min(1, 1 - avg / 6));
  }
}
