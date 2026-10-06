/**
 * useLocationAnchor — Anchors user location from QR scan or manual selection.
 * Integrates with the routing engine, resets PDR drift, and manages anchor state.
 */

import { useState, useCallback } from 'react';
import { Building, NavNode } from '@/data/types';
import { QRAnchorPayload } from '@/lib/QRScanner';
import { slugify } from '@/lib/accounts';

export interface AnchorState {
  isAnchored: boolean;
  anchorNodeId: string | null;
  anchorBuildingId: string | null;
  anchorFloorId: string | null;
  anchorPosition: { x: number; y: number } | null;
  anchorName: string | null;
}

interface UseLocationAnchorProps {
  buildings: Building[];
  onBuildingChange: (id: string) => void;
  onFloorChange: (id: string) => void;
  onStartChange: (nodeId: string) => void;
  onClearPath: () => void;
}

export function useLocationAnchor({
  buildings,
  onBuildingChange,
  onFloorChange,
  onStartChange,
  onClearPath,
}: UseLocationAnchorProps) {
  const [anchor, setAnchor] = useState<AnchorState>({
    isAnchored: false,
    anchorNodeId: null,
    anchorBuildingId: null,
    anchorFloorId: null,
    anchorPosition: null,
    anchorName: null,
  });

  /** Anchor from a QR payload or manual selection. */
  const anchorLocation = useCallback(
    (payload: QRAnchorPayload): {
      success: boolean;
      error?: string;
      buildingName?: string;
      floorName?: string;
      nodeName?: string;
      /** The spot it resolved to (the payload may have named it). */
      nodeId?: string;
    } => {
      const building = buildings.find(b => b.id === payload.buildingId)
        ?? buildings.find(b => slugify(b.name) === payload.buildingId.toLowerCase());
      if (!building) {
        return { success: false, error: `Building "${payload.buildingId}" not found` };
      }

      // Venue QR links can name just the spot (?entry=main-entrance), with no floor.
      const wanted = payload.nodeId.toLowerCase();
      const located = building.floors.flatMap(f => f.nodes.map(n => ({ f, n })))
        .sort((a, b) => Number(b.f.id === payload.floorId) - Number(a.f.id === payload.floorId));
      const hit = located.find(({ n }) => n.id === payload.nodeId)
        ?? located.find(({ n }) => !n.isHallway && n.name && slugify(n.name) === wanted);
      if (!hit && payload.floorId && !building.floors.some(f => f.id === payload.floorId)) {
        return { success: false, error: `Floor "${payload.floorId}" not found` };
      }
      if (!hit) {
        return { success: false, error: `Node "${payload.nodeId}" not found on this floor` };
      }
      const { f: floor, n: node } = hit;
      payload = { buildingId: building.id, floorId: floor.id, nodeId: node.id };

      // Clear previous route and drift
      onClearPath();

      // Switch building and floor
      onBuildingChange(payload.buildingId);
      // Small delay to let building change propagate
      setTimeout(() => {
        onFloorChange(payload.floorId);
        onStartChange(payload.nodeId);
      }, 50);

      setAnchor({
        isAnchored: true,
        anchorNodeId: payload.nodeId,
        anchorBuildingId: payload.buildingId,
        anchorFloorId: payload.floorId,
        anchorPosition: { x: node.x, y: node.y },
        anchorName: node.name,
      });

      // FIX — callers (e.g. the QR scan toast in Index.tsx) previously had
      // no way to show *where* the anchor landed without reaching back into
      // `buildings` themselves, so they fell back to printing the raw
      // payload.nodeId (a UUID) instead of a name a person can read. This
      // hook already resolves building/floor/node right here — just hand
      // the names back.
      return {
        success: true,
        buildingName: building.name,
        floorName: floor.name,
        nodeName: node.name,
        nodeId: node.id,
      };
    },
    [buildings, onBuildingChange, onFloorChange, onStartChange, onClearPath]
  );

  /** Anchor from manual node selection. */
  const anchorManual = useCallback(
    (buildingId: string, floorId: string, nodeId: string) => {
      return anchorLocation({ buildingId, floorId, nodeId });
    },
    [anchorLocation]
  );

  const clearAnchor = useCallback(() => {
    setAnchor({
      isAnchored: false,
      anchorNodeId: null,
      anchorBuildingId: null,
      anchorFloorId: null,
      anchorPosition: null,
      anchorName: null,
    });
  }, []);

  return { anchor, anchorLocation, anchorManual, clearAnchor };
}