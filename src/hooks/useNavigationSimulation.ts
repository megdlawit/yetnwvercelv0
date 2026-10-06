import { useState, useRef, useCallback, useEffect } from 'react';
import { NavNode } from '@/data/types';

export interface NavigationState {
  isNavigating: boolean;
  isPaused: boolean;
  currentPosition: { x: number; y: number };
  currentNodeIndex: number;
  progress: number; // 0-1 between current and next node
  isComplete: boolean;
}

interface UseNavigationSimulationOptions {
  speed?: number; // pixels per second
  onComplete?: () => void;
}

export function useNavigationSimulation(
  path: NavNode[] | null,
  options: UseNavigationSimulationOptions = {}
) {
  const { speed = 80, onComplete } = options;
  const [state, setState] = useState<NavigationState>({
    isNavigating: false,
    isPaused: false,
    currentPosition: { x: 0, y: 0 },
    currentNodeIndex: 0,
    progress: 0,
    isComplete: false,
  });

  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const segmentRef = useRef({ fromIndex: 0, progress: 0 });

  const stop = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    setState(s => ({ ...s, isNavigating: false, isPaused: false, isComplete: false, currentNodeIndex: 0, progress: 0 }));
    segmentRef.current = { fromIndex: 0, progress: 0 };
  }, []);

  const animate = useCallback((timestamp: number) => {
    if (!path || path.length < 2) return;

    if (lastTimeRef.current === 0) lastTimeRef.current = timestamp;
    const dt = (timestamp - lastTimeRef.current) / 1000;
    lastTimeRef.current = timestamp;

    const seg = segmentRef.current;
    const from = path[seg.fromIndex];
    const to = path[seg.fromIndex + 1];
    if (!from || !to) {
      setState(s => ({
        ...s,
        isNavigating: false,
        isPaused: false,
        isComplete: true,
        currentPosition: { x: path[path.length - 1].x, y: path[path.length - 1].y },
        currentNodeIndex: path.length - 1,
        progress: 1,
      }));
      onComplete?.();
      return;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    const increment = (speed * dt) / segLen;

    seg.progress += increment;

    if (seg.progress >= 1) {
      seg.fromIndex += 1;
      seg.progress = 0;

      if (seg.fromIndex >= path.length - 1) {
        setState(s => ({
          ...s,
          isNavigating: false,
          isPaused: false,
          isComplete: true,
          currentPosition: { x: path[path.length - 1].x, y: path[path.length - 1].y },
          currentNodeIndex: path.length - 1,
          progress: 1,
        }));
        onComplete?.();
        return;
      }
    }

    const cf = path[seg.fromIndex];
    const ct = path[seg.fromIndex + 1];
    const x = cf.x + (ct.x - cf.x) * seg.progress;
    const y = cf.y + (ct.y - cf.y) * seg.progress;

    setState(s => ({
      ...s,
      currentPosition: { x, y },
      currentNodeIndex: seg.fromIndex,
      progress: seg.progress,
    }));

    animFrameRef.current = requestAnimationFrame(animate);
  }, [path, speed, onComplete]);

  const start = useCallback(() => {
    if (!path || path.length < 2) return;
    cancelAnimationFrame(animFrameRef.current);
    segmentRef.current = { fromIndex: 0, progress: 0 };
    lastTimeRef.current = 0;
    setState({
      isNavigating: true,
      isPaused: false,
      currentPosition: { x: path[0].x, y: path[0].y },
      currentNodeIndex: 0,
      progress: 0,
      isComplete: false,
    });
    animFrameRef.current = requestAnimationFrame(animate);
  }, [path, animate]);

  const pause = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    setState(s => ({ ...s, isPaused: true }));
  }, []);

  const resume = useCallback(() => {
    if (!path) return;
    lastTimeRef.current = 0;
    setState(s => ({ ...s, isPaused: false }));
    animFrameRef.current = requestAnimationFrame(animate);
  }, [path, animate]);

  useEffect(() => {
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  return { state, start, pause, resume, stop };
}
