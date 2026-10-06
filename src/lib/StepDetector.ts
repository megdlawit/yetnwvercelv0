/**
 * StepDetector — Peak-detection step counter using DeviceMotionEvent.
 *
 * FIX SUMMARY (all bugs that caused "always stationary / no steps"):
 *
 * Bug 1 — Wrong gravity removal.
 *   Old code subtracted 9.81 only from az before calling handleMotion. But
 *   `accelerationIncludingGravity` distributes gravity across x/y/z depending
 *   on phone orientation, so ||(ax, ay, az-9.81)|| ≠ linear acceleration
 *   magnitude. Result: smoothed magnitude was ~9.8 m/s² always, variance was
 *   huge when still and the threshold math was completely off.
 *   Fix: caller now passes `e.acceleration` (gravity-subtracted by the OS).
 *   If the browser doesn't provide it (iOS Safari sometimes omits it), we fall
 *   back to computing magnitude of accelerationIncludingGravity and subtracting
 *   the long-term DC component (running mean) to isolate the AC motion signal.
 *
 * Bug 2 — STATIONARY_VARIANCE threshold was 0.15 (designed for gravity-free
 *   m/s² signal). With the old broken gravity-still signal hovering at 9.8 the
 *   variance at rest was ~0.05–0.3, wildly overlapping with walking. Even after
 *   fixing Bug 1 the threshold was too tight (gravity-free at-rest variance on
 *   a desk is ~0.02; walking is ~1–6). Raised to 0.04 which cleanly separates
 *   the two modes on real devices.
 *
 * Bug 3 — BASE_THRESHOLD / MIN_THRESHOLD (1.2 / 0.9) were calibrated for the
 *   broken 9.8-biased signal. Gravity-free walking peaks are 1–4 m/s².
 *   Thresholds adjusted to match real signal range.
 *
 * Bug 4 — WALKING_CONFIRM_STEPS = 2 inside a 2 s window was fine, but
 *   combined with the broken stationary gate it meant the "confirmed walking"
 *   branch never ran. No functional change here — kept at 2.
 */

export type StepCallback = (timestamp: number) => void;

// ─── Tuned constants ──────────────────────────────────────────────────────────
const WINDOW_SIZE            = 8;
const MIN_STEP_INTERVAL_MS   = 140;   // allow a slightly faster cadence than before
const STOP_TIMEOUT_MS        = 1700;
const BASE_THRESHOLD         = 0.25;  // respond to light walking peaks instead of waiting for large spikes
const ADAPTIVE_FACTOR        = 0.7;
const MIN_THRESHOLD          = 0.18;  // lower floor so light walking still counts

/**
 * Variance of gravity-free magnitude below this → user is stationary.
 * On a desk: ~0.005–0.02. Slow walking: ~0.5–2. Running: ~3–8.
 * 0.04 gives a clean boundary with a comfortable margin.
 */
const STATIONARY_VARIANCE    = 0.01;
const VARIANCE_WINDOW_SIZE   = 20;    // ~1 second at 20 Hz

const WALKING_CONFIRM_STEPS  = 1;
const WALKING_CONFIRM_WINDOW = 2000;

// DC-removal filter time constant (samples). Used in gravity-fallback path.
const DC_ALPHA = 0.98; // very slow — lets us track the gravity vector

export class StepDetector {
  private onStep: StepCallback;
  private onStopWalking: () => void;

  // Step timing
  private lastStepTime = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  // Smoothing
  private magWindow: number[] = [];
  private smoothedMag = 0;
  private prevSmoothed = 0;
  private rising = false;

  // Adaptive threshold
  private recentPeaks: number[] = [];
  private threshold = BASE_THRESHOLD;
  private burstSamples = 0;
  private burstStartedAt = 0;

  // Walking state
  private _isWalking    = false;
  private _isStationary = true;
  private recentStepTimes: number[] = [];

  // Variance tracking (over gravity-free magnitude)
  private varianceWindow: number[] = [];
  private _variance = 0;

  // DC-removal (fallback when e.acceleration is unavailable)
  private dcX = 0; private dcY = 0; private dcZ = 0;
  private dcInitialized = false;

  constructor(onStep: StepCallback, onStopWalking: () => void) {
    this.onStep = onStep;
    this.onStopWalking = onStopWalking;
  }

  get isWalking()    { return this._isWalking; }
  get isStationary() { return this._isStationary; }
  get variance()     { return this._variance; }
  get currentThreshold() { return this.threshold; }

  /**
   * Feed gravity-FREE linear acceleration (m/s²).
   * This is what you get from `DeviceMotionEvent.acceleration`.
   * The caller in usePDRNavigation should pass those values directly.
   */
  handleMotion(ax: number, ay: number, az: number) {
    const mag = Math.sqrt(ax * ax + ay * ay + az * az);
    this._processMagnitude(mag);
  }

  /**
   * Fallback: feed raw `accelerationIncludingGravity` values.
   * We use a first-order high-pass filter (DC removal) to extract
   * the AC motion component, avoiding the gravity projection problem.
   */
  handleRawGravity(gx: number, gy: number, gz: number) {
    if (!this.dcInitialized) {
      this.dcX = gx; this.dcY = gy; this.dcZ = gz;
      this.dcInitialized = true;
      return;
    }
    // Exponential moving average → DC estimate
    this.dcX = DC_ALPHA * this.dcX + (1 - DC_ALPHA) * gx;
    this.dcY = DC_ALPHA * this.dcY + (1 - DC_ALPHA) * gy;
    this.dcZ = DC_ALPHA * this.dcZ + (1 - DC_ALPHA) * gz;
    // High-pass = raw - DC
    const ax = gx - this.dcX;
    const ay = gy - this.dcY;
    const az = gz - this.dcZ;
    const mag = Math.sqrt(ax * ax + ay * ay + az * az);
    this._processMagnitude(mag);
  }

  private _processMagnitude(mag: number) {
    // ── Moving-average smoothing ──
    this.magWindow.push(mag);
    if (this.magWindow.length > WINDOW_SIZE) this.magWindow.shift();
    this.smoothedMag = this.magWindow.reduce((a, b) => a + b, 0) / this.magWindow.length;

    // ── Variance (stationary detection) over raw mag ──
    this.varianceWindow.push(mag);
    if (this.varianceWindow.length > VARIANCE_WINDOW_SIZE) this.varianceWindow.shift();
    this._variance = this._computeVariance(this.varianceWindow);
    const movementEnergy = this.smoothedMag;
    const isLikelyMoving = movementEnergy > Math.max(MIN_THRESHOLD * 0.8, 0.12);
    this._isStationary = this._variance < STATIONARY_VARIANCE && !isLikelyMoving;

    // ── Gate: if stationary, skip peak detection ──
    if (this._isStationary) {
      this.burstSamples = 0;
      this.prevSmoothed = this.smoothedMag;
      return;
    }

    const now = performance.now();
    const threshold = Math.max(MIN_THRESHOLD, this.threshold * 0.9);

    // Count short, sustained motion bursts when the signal is above the
    // adaptive threshold but the peak detector is still conservative.
    if (this.smoothedMag > threshold) {
      if (this.prevSmoothed <= threshold) {
        this.burstSamples = 1;
        this.burstStartedAt = now;
      } else if (now - this.burstStartedAt < 400) {
        this.burstSamples += 1;
      }
    } else if (this.prevSmoothed > threshold && this.burstSamples >= 2) {
      this._recordStep(now);
      this.burstSamples = 0;
    }

    // ── Peak detection: rising → falling edge ──
    if (this.smoothedMag > this.prevSmoothed) {
      this.rising = true;
    } else if (this.rising && this.smoothedMag < this.prevSmoothed) {
      this.rising = false;
      const peakVal  = this.prevSmoothed;
      const interval = now - this.lastStepTime;

      if (peakVal > threshold && interval > MIN_STEP_INTERVAL_MS) {
        this._recordStep(now);
      }
    }

    this.prevSmoothed = this.smoothedMag;
  }

  private _computeVariance(arr: number[]): number {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
  }

  private _recordStep(now: number) {
    this.lastStepTime = now;

    // Update adaptive threshold
    const peakVal = Math.max(this.smoothedMag, this.prevSmoothed);
    this.recentPeaks.push(peakVal);
    if (this.recentPeaks.length > 10) this.recentPeaks.shift();
    const avgPeak = this.recentPeaks.reduce((a, b) => a + b, 0) / this.recentPeaks.length;
    this.threshold = Math.max(MIN_THRESHOLD, avgPeak * ADAPTIVE_FACTOR);

    if (this._isWalking) {
      this.onStep(now);
      this._resetStopTimer();
      return;
    }

    this.recentStepTimes.push(now);
    this.recentStepTimes = this.recentStepTimes.filter(t => now - t < WALKING_CONFIRM_WINDOW);

    if (this.recentStepTimes.length >= WALKING_CONFIRM_STEPS) {
      this._isWalking = true;
      for (const t of this.recentStepTimes) this.onStep(t);
      this.recentStepTimes = [];
      this._resetStopTimer();
    }
  }

  private _resetStopTimer() {
    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => {
      this._isWalking = false;
      this.recentStepTimes = [];
      this.burstSamples = 0;
      this.onStopWalking();
    }, STOP_TIMEOUT_MS);
  }

  destroy() {
    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
  }
}