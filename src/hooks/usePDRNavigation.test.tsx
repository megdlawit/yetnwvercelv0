import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StepDetector } from '@/lib/StepDetector';
import { usePDRNavigation } from './usePDRNavigation';

describe('usePDRNavigation', () => {
  beforeEach(() => {
    vi.stubGlobal('performance', { now: () => 0 });
    vi.stubGlobal('DeviceMotionEvent', class DeviceMotionEvent {});
    vi.stubGlobal('DeviceOrientationEvent', class DeviceOrientationEvent {});

    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
    vi.spyOn(window, 'setInterval').mockReturnValue(1 as unknown as ReturnType<typeof setInterval>);
    vi.spyOn(window, 'clearInterval');
    vi.spyOn(window, 'setTimeout').mockReturnValue(1 as unknown as ReturnType<typeof setTimeout>);
    vi.spyOn(window, 'clearTimeout');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts sensor listeners even when permission is denied so navigation can still proceed', async () => {
    const requestMotionPermission = vi.fn().mockResolvedValue('denied');
    const requestOrientationPermission = vi.fn().mockResolvedValue('denied');

    (DeviceMotionEvent as typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> }).requestPermission = requestMotionPermission;
    (DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> }).requestPermission = requestOrientationPermission;

    const path = [
      { id: 'a', floorId: '1', name: 'A', x: 0, y: 0, isHallway: true },
      { id: 'b', floorId: '1', name: 'B', x: 10, y: 0, isHallway: true },
    ];

    const { result } = renderHook(() => usePDRNavigation(path, [], [], 'b'));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state.isNavigating).toBe(true);
    expect(window.addEventListener).toHaveBeenCalledWith('devicemotion', expect.any(Function), { passive: true });
    expect(window.addEventListener).toHaveBeenCalledWith('deviceorientationabsolute', expect.any(Function), { passive: true });
    expect(window.addEventListener).toHaveBeenCalledWith('deviceorientation', expect.any(Function), { passive: true });
  });

  it('counts lower-amplitude motion as a step', () => {
    let steps = 0;
    const detector = new StepDetector(() => { steps += 1; }, () => {});
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 50;
      return now;
    });

    detector.handleMotion(0.2, 0, 0);
    detector.handleMotion(0.45, 0, 0);
    detector.handleMotion(0.7, 0, 0);
    detector.handleMotion(1.15, 0, 0);
    detector.handleMotion(0.75, 0, 0);
    detector.handleMotion(0.35, 0, 0);
    detector.handleMotion(1.05, 0, 0);
    detector.handleMotion(0.65, 0, 0);
    detector.handleMotion(0.25, 0, 0);

    expect(steps).toBeGreaterThan(0);
  });
});
