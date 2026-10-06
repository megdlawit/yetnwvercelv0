/**
 * useIndoorRouting — React hook for modular indoor routing.
 * Wraps GraphEngine for single-floor or BuildingGraph for multi-floor,
 * returns FullRoute with nodes, distance, walking time, and visualization.
 */

import { useState, useMemo, useCallback } from 'react';
import { NavNode, NavEdge, Building } from '@/data/types';
import { GraphEngine } from '@/lib/GraphEngine';
import { BuildingGraph } from '@/lib/BuildingGraph';
import { buildRouteVisualization, calcRouteDistance } from '@/lib/RouteRenderer';
import {
  FullRoute,
  estimateWalkingTime,
  formatWalkingTime,
} from '@/lib/RouteTypes';

export interface UseIndoorRoutingReturn {
  route: FullRoute | null;
  startNodeId: string | null;
  endNodeId: string | null;
  setStart: (nodeId: string | null) => void;
  setEnd: (nodeId: string | null) => void;
  calculate: () => FullRoute | null;
  clear: () => void;
  graph: GraphEngine;
  buildingGraph: BuildingGraph | null;
}

/** Single-floor routing (backward compatible) */
export function useIndoorRouting(
  nodes: NavNode[],
  edges: NavEdge[],
  building?: Building | null,
): UseIndoorRoutingReturn {
  const [startNodeId, setStartNodeId] = useState<string | null>(null);
  const [endNodeId, setEndNodeId] = useState<string | null>(null);
  const [route, setRoute] = useState<FullRoute | null>(null);

  const graph = useMemo(() => GraphEngine.fromNavData(nodes, edges), [nodes, edges]);
  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const buildingGraph = useMemo(
    () => (building ? BuildingGraph.fromBuilding(building) : null),
    [building],
  );

  const calculate = useCallback((): FullRoute | null => {
    if (!startNodeId || !endNodeId) return null;

    // Prefer multi-floor graph when available
    if (buildingGraph) {
      const result = buildingGraph.findPath(startNodeId, endNodeId);
      if (result) {
        const pathCoords = result.nodes.map(n => ({ x: n.x, y: n.y, id: n.id }));
        result.visualization = buildRouteVisualization(pathCoords);
        setRoute(result);
        return result;
      }
    }

    // Fallback: single-floor graph
    const result = graph.findShortestPath(startNodeId, endNodeId);
    if (!result) {
      setRoute(null);
      return null;
    }

    const pathNodes = result.nodeIds
      .map(id => nodeMap.get(id))
      .filter((n): n is NavNode => n !== undefined);

    const pathCoords = pathNodes.map(n => ({ x: n.x, y: n.y, id: n.id }));
    const visualization = buildRouteVisualization(pathCoords);
    const distance = calcRouteDistance(pathCoords);
    const seconds = estimateWalkingTime(distance);

    const fullRoute: FullRoute = {
      nodeIds: result.nodeIds,
      nodes: pathNodes,
      distance,
      estimatedSeconds: seconds,
      estimatedTimeLabel: formatWalkingTime(seconds),
      floors: [],
      floorTransitions: [],
      visualization,
    };

    setRoute(fullRoute);
    return fullRoute;
  }, [startNodeId, endNodeId, graph, nodeMap, buildingGraph]);

  const clear = useCallback(() => {
    setStartNodeId(null);
    setEndNodeId(null);
    setRoute(null);
  }, []);

  const setStart = useCallback((nodeId: string | null) => {
    setStartNodeId(nodeId);
    setRoute(null);
  }, []);

  const setEnd = useCallback((nodeId: string | null) => {
    setEndNodeId(nodeId);
    setRoute(null);
  }, []);

  return {
    route,
    startNodeId,
    endNodeId,
    setStart,
    setEnd,
    calculate,
    clear,
    graph,
    buildingGraph,
  };
}
