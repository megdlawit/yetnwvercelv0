/**
 * useNavigation — React hook wrapper around NavigationController.
 * Supports multi-floor routing via BuildingGraph and voice control.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Building, NavNode } from '@/data/types';
import { BuildingGraph } from '@/lib/BuildingGraph';
import { NavigationController, NavSnapshot, NavControllerState } from '@/lib/NavigationController';
import { toast } from 'sonner';

const EMPTY_SNAPSHOT: NavSnapshot = {
  state: 'IDLE',
  position: { x: 0, y: 0 },
  progressIndex: 0,
  progressFraction: 0,
  distanceRemaining: 0,
  distanceToNextTurn: 0,
  currentInstruction: null,
  instructions: [],
  isOffRoute: false,
  completedPoints: '',
  remainingPoints: '',
  currentFloorId: null,
  floorTransitions: [],
  isMultiFloor: false,
  voiceEnabled: true,
  confidence: 1,
  confidenceLevel: 'HIGH',
  confidenceSnapshot: null,
};

export interface UseNavigationReturn {
  snapshot: NavSnapshot;
  path: NavNode[];
  startNavigation: (startNodeId: string, destinationNodeId: string) => boolean;
  stopNavigation: () => void;
  updatePosition: (x: number, y: number) => void;
  recordStep: (timestamp: number) => void;
  recordHeading: (deg: number) => void;
  recordNoise: (variance: number) => void;
  isActive: boolean;
  toggleVoice: () => void;
}

export function useNavigation(
  building: Building,
  onFloorChange?: (floorId: string) => void,
): UseNavigationReturn {
  const [snapshot, setSnapshot] = useState<NavSnapshot>(EMPTY_SNAPSHOT);
  const [path, setPath] = useState<NavNode[]>([]);
  const controllerRef = useRef<NavigationController | null>(null);
  const buildingGraphRef = useRef<BuildingGraph | null>(null);

  // Rebuild controller when building changes
  useEffect(() => {
    const bg = BuildingGraph.fromBuilding(building);
    buildingGraphRef.current = bg;

    const ctrl = new NavigationController(bg, {
      onStateChange: (snap) => setSnapshot(snap),
      onReroute: (newPath) => {
        setPath(newPath);
        toast.info('Recalculating route…', { duration: 2000 });
      },
      onArrival: () => {
        toast.success('🎉 You have arrived!', { duration: 4000 });
      },
      onFloorChange: (floorId, transition) => {
        const floor = bg.getFloor(floorId);
        const verb = transition.type === 'elevator' ? 'elevator' : 'stairs';
        toast.info(`Switching to ${floor?.name ?? floorId} via ${verb}`, { duration: 3000 });
        onFloorChange?.(floorId);
      },
    });
    controllerRef.current = ctrl;
  }, [building, onFloorChange]);

  const startNavigation = useCallback((startNodeId: string, destinationNodeId: string): boolean => {
    const ctrl = controllerRef.current;
    if (!ctrl) return false;
    const ok = ctrl.startNavigation(startNodeId, destinationNodeId);
    if (ok) {
      setPath([...ctrl.currentPath]);
      setSnapshot(ctrl.getSnapshot());
    }
    return ok;
  }, []);

  const stopNavigation = useCallback(() => {
    controllerRef.current?.stopNavigation();
    setPath([]);
    setSnapshot(EMPTY_SNAPSHOT);
  }, []);

  const updatePosition = useCallback((x: number, y: number) => {
    controllerRef.current?.updatePosition(x, y);
  }, []);

  const recordStep = useCallback((timestamp: number) => {
    controllerRef.current?.recordStep(timestamp);
  }, []);

  const recordHeading = useCallback((deg: number) => {
    controllerRef.current?.recordHeading(deg);
  }, []);

  const recordNoise = useCallback((variance: number) => {
    controllerRef.current?.recordNoise(variance);
  }, []);

  const toggleVoice = useCallback(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    const newVal = !ctrl.voiceEngine.isEnabled;
    ctrl.voiceEngine.setEnabled(newVal);
    setSnapshot(prev => ({ ...prev, voiceEnabled: newVal }));
    toast.info(newVal ? '🔊 Voice guidance on' : '🔇 Voice guidance off', { duration: 1500 });
  }, []);

  const isActive = snapshot.state === 'NAVIGATING' || snapshot.state === 'OFF_ROUTE' || snapshot.state === 'ROUTING' || snapshot.state === 'FLOOR_TRANSITION';

  return { snapshot, path, startNavigation, stopNavigation, updatePosition, recordStep, recordHeading, recordNoise, isActive, toggleVoice };
}
