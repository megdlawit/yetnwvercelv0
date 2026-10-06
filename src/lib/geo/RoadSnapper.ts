/**
 * RoadSnapper — projects a GPS fix onto the nearest edge of an outdoor graph.
 * This reduces drift while a user walks along a known footway.
 */

import type { GeoCoord, OutdoorEdge, OutdoorGraph, OutdoorNode } from './GeoTypes';
import { haversineMeters, latLngToMeters, metersToLatLng } from './GeoMath';

export interface RoadSnapResult {
  snapped: GeoCoord;
  distanceM: number;
  edge: OutdoorEdge;
  /** 0..1 along the edge from `from` to `to`. */
  t: number;
}

export class RoadSnapper {
  private graph: OutdoorGraph | null = null;
  private nodeById = new Map<string, OutdoorNode>();

  setGraph(graph: OutdoorGraph | null): void {
    this.graph = graph;
    this.nodeById.clear();
    if (graph) for (const n of graph.nodes) this.nodeById.set(n.id, n);
  }

  hasGraph(): boolean {
    return !!this.graph && this.graph.edges.length > 0;
  }

  /**
   * Snap to nearest edge. Uses local equirectangular meters around the query
   * point (fast and accurate at city scale).
   */
  snap(point: GeoCoord, maxDistanceM = 30): RoadSnapResult | null {
    if (!this.graph) return null;
    let best: RoadSnapResult | null = null;
    for (const edge of this.graph.edges) {
      const a = this.nodeById.get(edge.fromNodeId);
      const b = this.nodeById.get(edge.toNodeId);
      if (!a || !b) continue;
      const pa = latLngToMeters(point, a);
      const pb = latLngToMeters(point, b);
      const ab = { east: pb.east - pa.east, north: pb.north - pa.north };
      const len2 = ab.east * ab.east + ab.north * ab.north;
      if (len2 < 1e-6) continue;
      const ap = { east: -pa.east, north: -pa.north }; // point - a
      let t = (ap.east * ab.east + ap.north * ab.north) / len2;
      t = Math.max(0, Math.min(1, t));
      const projE = pa.east + ab.east * t;
      const projN = pa.north + ab.north * t;
      const distM = Math.hypot(projE, projN);
      if (distM > maxDistanceM) continue;
      if (!best || distM < best.distanceM) {
        const snapped = metersToLatLng(point, projE, projN);
        best = { snapped, distanceM: distM, edge, t };
      }
    }
    return best;
  }

  nearestNode(point: GeoCoord, maxDistanceM = 200): OutdoorNode | null {
    if (!this.graph) return null;
    let best: { node: OutdoorNode; d: number } | null = null;
    for (const n of this.graph.nodes) {
      const d = haversineMeters(point, n);
      if (d > maxDistanceM) continue;
      if (!best || d < best.d) best = { node: n, d };
    }
    return best?.node ?? null;
  }
}
