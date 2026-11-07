// Speed cameras along the route, from OpenStreetMap. Only cameras someone has
// mapped are known, so silence never means there's no camera.
import { CONFIG } from './config.js';
import { clamp } from './geo.js';
import { overpass, placeOnRoute } from './places.js';

// A camera mapped this close to the route watches it. Further away, it's more
// likely to be on the other side of a divided road.
export const CAMERA_OFF_M = 18;
const NEAR_M = 150;          // asked for generously, then checked properly here
const MAX_POINTS = 400;
const SAME_CAMERA_M = 40;
const BEHIND_M = 20;

// The whole route, thinned out to a sensible size for one request.
export function samplePoints(route) {
  const { coords, cum } = route;
  const step = Math.max(150, route.length / MAX_POINTS);
  const out = [];
  let next = 0;
  for (let i = 0; i < coords.length; i++) {
    if (cum[i] >= next) {
      out.push(coords[i]);
      next = cum[i] + step;
    }
  }
  const last = coords[coords.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export function cameraQuery(points) {
  const line = points.map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',');
  return `[out:json][timeout:20];node["highway"="speed_camera"](around:${NEAR_M},${line});out tags 400;`;
}

export function parseCameras(json) {
  const out = [];
  for (const el of json.elements || []) {
    if (!Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
    const limit = parseInt(el.tags?.maxspeed, 10);
    out.push({ id: `node/${el.id}`, lat: el.lat, lng: el.lon, limit: limit >= 5 && limit <= 130 ? limit : null });
  }
  return out;
}

export function camerasOnRoute(route, cameras) {
  const out = [];
  for (const cam of cameras) {
    const where = placeOnRoute(route, cam, 0);
    if (!where || where.off > CAMERA_OFF_M) continue;
    // The same camera, mapped twice.
    if (out.some((c) => Math.abs(c.along - where.along) < SAME_CAMERA_M)) continue;
    out.push({ ...cam, along: where.along });
  }
  return out.sort((a, b) => a.along - b.along);
}

// Far enough ahead to slow down in time, at any speed.
export const alertDistance = (speed) => clamp((speed || 0) * 25, 300, 800);

// The next camera, if it's close enough to mention.
export function cameraAhead(cameras, s, speed) {
  for (const camera of cameras || []) {
    const ahead = camera.along - s;
    if (ahead < -BEHIND_M) continue;
    return ahead <= alertDistance(speed) ? { camera, ahead: Math.max(0, ahead) } : null;
  }
  return null;
}

export async function fetchCameras(route, { signal, fetchImpl, servers = CONFIG.overpass } = {}) {
  const json = await overpass(cameraQuery(samplePoints(route)), { signal, fetchImpl, servers });
  if (!json) throw new Error('no server answered');
  return parseCameras(json);
}
