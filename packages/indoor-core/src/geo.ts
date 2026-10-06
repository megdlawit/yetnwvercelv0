// Earth ↔ model metres. Same projection and rotation convention as the app's
// GeoMath (indoorToGeo / geoToIndoor), so a plan venue and its outdoor GPS
// paths line up in one frame.

import type { GeoFrame, Vec2 } from './model';

const R = 6_371_000; // same as the app's GeoMath
const DEG = Math.PI / 180;

/** GPS → model metres (x right, z down) for a venue placed at `frame`. */
export function geoToModel(frame: GeoFrame, lat: number, lng: number): Vec2 {
  const north = (lat - frame.lat) * DEG * R;
  const east = (lng - frame.lng) * DEG * R * Math.cos(frame.lat * DEG);
  const th = -frame.rotationDeg * DEG;
  const k = frame.scale ?? 1;
  const x = east * Math.cos(th) + north * Math.sin(th);
  const up = -east * Math.sin(th) + north * Math.cos(th);
  return { x: x / k, z: -up / k };
}

/** Model metres → GPS. */
export function modelToGeo(frame: GeoFrame, p: Vec2): { lat: number; lng: number } {
  const th = frame.rotationDeg * DEG;
  const k = frame.scale ?? 1;
  const px = p.x * k, up = -p.z * k;
  const east = px * Math.cos(th) + up * Math.sin(th);
  const north = -px * Math.sin(th) + up * Math.cos(th);
  return { lat: frame.lat + north / R / DEG, lng: frame.lng + east / (R * Math.cos(frame.lat * DEG)) / DEG };
}
