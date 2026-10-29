/**
 * Enhanced Heading Tracker using DeviceOrientationEvent compass (alpha).
 * - Continuous 0–360° heading (not just cardinal)
 * - Exponential smoothing with circular interpolation
 * - Screen orientation offset compensation
 * - Freeze smoothing when stationary (optional)
 */

export type HeadingCallback = (headingRad: number) => void;

const SMOOTH_ALPHA = 0.2; // smoothing factor (0.2 = 80% old + 20% new)

export class HeadingTracker {
  private _heading = 0; // radians
  private onChange: HeadingCallback;
  private rawHeading = 0;
  private frozen = false;

  constructor(onChange: HeadingCallback) {
    this.onChange = onChange;
  }

  get heading() { return this._heading; }
  get headingDeg() { return (this._heading * 180) / Math.PI; }

  /** Freeze heading smoothing (when stationary) */
  setFrozen(frozen: boolean) {
    this.frozen = frozen;
  }

  /**
   * Feed orientation data.
   *
   * IMPORTANT cross-browser gotcha this fixes:
   * - `DeviceOrientationEvent.alpha` per spec increases as the device
   *   rotates LEFT (counter-clockwise) around a reference that is only
   *   earth-fixed ("absolute") on some platforms/events.
   * - True compass heading increases as you turn RIGHT (clockwise) toward
   *   East. So a raw, unconverted `alpha` moves the map marker in the
   *   OPPOSITE rotational direction from how you actually turned.
   * - iOS Safari exposes `webkitCompassHeading` directly (already correct,
   *   0=N, increases clockwise) — always prefer it when present.
   * - Android/Chrome only gives an earth-referenced alpha via the
   *   `deviceorientationabsolute` event (or `event.absolute === true`).
   *   In that case: compassHeading = (360 - alpha) % 360.
   * - A plain, non-absolute `deviceorientation.alpha` is NOT earth-fixed
   *   (it drifts / is relative to device start orientation) — it's kept
   *   only as a last-resort fallback so heading isn't frozen at 0 on
   *   devices/browsers that never fire an absolute event.
   */
  handleOrientation(
    alpha: number | null,
    opts?: { absolute?: boolean; webkitCompassHeading?: number }
  ) {
    if (alpha === null && opts?.webkitCompassHeading == null) return;

    let compassDeg: number;
    if (opts?.webkitCompassHeading != null) {
      // iOS Safari: already a true compass heading, 0=N, clockwise.
      compassDeg = opts.webkitCompassHeading;
    } else if (opts?.absolute) {
      // Earth-referenced alpha (Android deviceorientationabsolute): flip
      // rotation direction to match clockwise compass convention.
      compassDeg = (360 - (alpha as number)) % 360;
    } else {
      // Best-effort fallback (not earth-referenced, may drift): still
      // flip so at least turning right increases heading like a compass.
      compassDeg = (360 - (alpha as number)) % 360;
    }

    // Apply screen orientation offset
    const screenOffset = this.getScreenOrientationOffset();
    const corrected = ((compassDeg + screenOffset) % 360 + 360) % 360;

    // Convert to radians. 0=north, increases clockwise.
    const rad = (corrected * Math.PI) / 180;

    if (this.frozen) {
      // Still update raw but don't smooth — heading stays locked
      return;
    }

    // Circular interpolation for smooth heading
    let delta = rad - this.rawHeading;
    // Normalize delta to [-π, π]
    delta = ((delta + Math.PI) % (2 * Math.PI)) - Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;

    this.rawHeading += delta * SMOOTH_ALPHA;
    // Normalize to [0, 2π]
    this.rawHeading = ((this.rawHeading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    this._heading = this.rawHeading;
    this.onChange(this._heading);
  }

  /** Get screen orientation offset in degrees */
  private getScreenOrientationOffset(): number {
    if (typeof screen !== 'undefined' && screen.orientation) {
      return screen.orientation.angle || 0;
    }
    // Fallback for older browsers
    return (window as Window & { orientation?: number }).orientation || 0;
  }

  /** Get cardinal direction string */
  getCardinal(): string {
    const deg = this.headingDeg;
    if (deg >= 337.5 || deg < 22.5) return 'North';
    if (deg >= 22.5 && deg < 67.5) return 'NE';
    if (deg >= 67.5 && deg < 112.5) return 'East';
    if (deg >= 112.5 && deg < 157.5) return 'SE';
    if (deg >= 157.5 && deg < 202.5) return 'South';
    if (deg >= 202.5 && deg < 247.5) return 'SW';
    if (deg >= 247.5 && deg < 292.5) return 'West';
    return 'NW';
  }

  /** Get continuous heading in degrees (0–360) */
  getHeadingDegrees(): number {
    return ((this.headingDeg % 360) + 360) % 360;
  }
}
