// What a route passes before you set off: toll plazas, speed cameras, and the
// R&Rs and lay-bys you can pull into. One request to OpenStreetMap covers every
// route on offer, so each can show its tolls without asking again.
import { CONFIG } from './config.js';
import { camerasOnRoute } from './cameras.js';
import { overpass, placeOnRoute } from './places.js';
import { tollsOnRoute } from './tolls.js';

const MAX_POINTS = 220;       // per route, to keep one request a sensible size
const TOLL_NEAR_M = 120;
const CAMERA_NEAR_M = 150;
const REST_NEAR_M = 700;      // a services area is wide, and its middle sits back from the road
export const REST_OFF_M = 450;
const SAME_REST_M = 400;
const ON_ROAD_M = 25;         // closer than this, it's on the road whichever side
const WAITS = { server: 22000 };

// The route as a line of points, spaced to suit its length.
export function linePoints(route, max = MAX_POINTS) {
  const { coords, cum } = route;
  const step = Math.max(200, route.length / max);
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

// Only what's wanted: no tolls for a motorcycle, no cameras if their warning is off.
export function alongQuery(routes, { tolls = true, cameras = true, rests = true } = {}) {
  const parts = routes.map((route) => {
    const line = linePoints(route).map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',');
    return (tolls ? `nwr["barrier"="toll_booth"](around:${TOLL_NEAR_M},${line});`
        + `node["highway"="toll_gantry"](around:${TOLL_NEAR_M},${line});` : '')
      + (cameras ? `node["highway"="speed_camera"](around:${CAMERA_NEAR_M},${line});` : '')
      + (rests ? `nwr["highway"~"^(services|rest_area)$"](around:${REST_NEAR_M},${line});` : '');
  });
  return `[out:json][timeout:25];(${parts.join('')});out center tags 1500;`;
}

export function parseAlong(json) {
  const tolls = [], cameras = [], rests = [];
  for (const el of json?.elements || []) {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const id = `${el.type}/${el.id}`;
    if (tags.barrier === 'toll_booth' || tags.highway === 'toll_gantry') {
      tolls.push({ id, lat, lng, name: tags.name || null, gantry: tags.highway === 'toll_gantry' });
    } else if (tags.highway === 'speed_camera') {
      const limit = parseInt(tags.maxspeed, 10);
      cameras.push({ id, lat, lng, limit: limit >= 5 && limit <= 130 ? limit : null });
    } else if (tags.highway === 'services' || tags.highway === 'rest_area') {
      rests.push({
        id, lat, lng,
        kind: tags.highway === 'services' ? 'rnr' : 'layby',
        name: tags.name || tags['name:ms'] || tags['name:en'] || '',
      });
    }
  }
  return { tolls, cameras, rests };
}

// R&Rs you can drive into from this route. Malaysia drives on the left, so the
// ones for your direction are on your left; those on the right are for traffic
// coming the other way.
export function restsOnRoute(route, rests) {
  const out = [];
  for (const rest of rests) {
    const where = placeOnRoute(route, rest, 0);
    if (!where || where.off > REST_OFF_M) continue;
    if (where.off > ON_ROAD_M && where.side === 'right') continue;
    // At the very start or end, it's where you are or where you're going.
    if (where.along < 300 || where.along > route.length - 300) continue;
    const same = out.find((r) => Math.abs(r.along - where.along) < SAME_REST_M);
    if (same) {
      if (!same.name && rest.name) same.name = rest.name;
      if (rest.kind === 'rnr') same.kind = 'rnr';
      continue;
    }
    out.push({ ...rest, along: where.along, off: where.off });
  }
  return out.sort((a, b) => a.along - b.along);
}

export function alongRoute(route, found) {
  return {
    tolls: tollsOnRoute(route, found.tolls),
    cameras: camerasOnRoute(route, found.cameras),
    rests: restsOnRoute(route, found.rests),
  };
}

const cache = new Map();
export const clearAlongCache = () => cache.clear();

export async function fetchAlong(routes, { signal, fetchImpl, servers = CONFIG.overpass, waits = WAITS, tolls = true, cameras = true, rests = true } = {}) {
  const key = `${routes.map((r) => r.id).join(',')}|${tolls}|${cameras}|${rests}`;
  if (cache.has(key)) return cache.get(key);
  const json = await overpass(alongQuery(routes, { tolls, cameras, rests }), { signal, fetchImpl, servers, waits });
  if (!json) throw new Error('no server answered');
  const found = parseAlong(json);
  cache.set(key, found);
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return found;
}
