// What a route passes before you set off: toll plazas, speed cameras, and the
// R&Rs and lay-bys you can pull into. One request to OpenStreetMap covers every
// route on offer, so each can show its tolls without asking again.
import { CONFIG } from './config.js';
import { camerasOnRoute } from './cameras.js';
import { overpass, placeOnRoute } from './places.js';
import { tollsOnRoute } from './tolls.js';
import { BUMPS, featuresOnRoute, parseFeature } from './road-features.js';
import { dataNear, loadAlongData, nearRoute } from './along-data.js';

const MAX_POINTS = 220;       // per route, to keep one request a sensible size
const TOLL_NEAR_M = 120;
const CAMERA_NEAR_M = 150;
const REST_NEAR_M = 700;      // a services area is wide, and its middle sits back from the road
export const REST_OFF_M = 450;
const SAME_REST_M = 400;
const ON_ROAD_M = 25;         // closer than this, it's on the road whichever side
const WAITS = { server: 22000 };
// The tolls, cameras and R&Rs come first and quickly; lights and bumps, which
// are many more and slower to find, are asked for separately afterwards.
export const QUICK_WAITS = { server: 15000 };
export const SLOW_WAITS = { server: 25000 };

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

// The squares of a grid (about 2 km) that the routes pass through, with a
// margin, joined along each row: [south, west, north, east] boxes.
const CELL_DEG = 0.02;
export function routeBoxes(routes, marginM) {
  const m = marginM / 111320;
  const rows = new Map();
  for (const route of routes) {
    for (const [lng, lat] of linePoints(route, Infinity)) {
      for (const dx of [-m, m]) {
        for (const dy of [-m, m]) {
          const col = Math.floor((lng + dx) / CELL_DEG), row = Math.floor((lat + dy) / CELL_DEG);
          if (!rows.has(row)) rows.set(row, new Set());
          rows.get(row).add(col);
        }
      }
    }
  }
  const boxes = [];
  const deg = (n) => +(n * CELL_DEG).toFixed(4);
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const cols = [...rows.get(row)].sort((a, b) => a - b);
    let from = cols[0], to = cols[0];
    for (const col of [...cols.slice(1), Infinity]) {
      if (col === to + 1) { to = col; continue; }
      boxes.push([deg(row), deg(from), deg(row + 1), deg(to + 1)]);
      from = to = col;
    }
  }
  return boxes;
}

// Only what's wanted: no tolls for a motorcycle, no cameras if their warning is off.
// Each kind is asked for by its exact name within small boxes along the routes,
// which a map server answers in seconds; the distance from each route is
// measured here afterwards. (Asking for "within so many metres of this line"
// instead took the servers most of a minute on a long trip.)
export function alongQuery(routes, { tolls = true, cameras = true, rests = true, features = true, timeout = 25 } = {}) {
  const near = routeBoxes(routes, CAMERA_NEAR_M);
  const wide = rests ? routeBoxes(routes, REST_NEAR_M) : [];
  const each = (filter, boxes) => boxes.map((b) => `${filter}(${b.join(',')});`).join('');
  const parts = (tolls ? each('nwr["barrier"="toll_booth"]', near) + each('node["highway"="toll_gantry"]', near) : '')
    + (cameras ? each('node["highway"="speed_camera"]', near) : '')
    + (rests ? each('nwr["highway"="services"]', wide) + each('nwr["highway"="rest_area"]', wide) : '')
    + (features ? each('node["highway"="traffic_signals"]', near) + each(`node["traffic_calming"~"${BUMPS}"]`, near)
      + each('node["railway"="level_crossing"]', near) : '');
  return `[out:json][timeout:${timeout}];(${parts});out center tags 6000;`;
}

export function parseAlong(json) {
  const tolls = [], cameras = [], rests = [], features = [];
  for (const el of json?.elements || []) {
    const tags = el.tags || {};
    const feature = parseFeature(el);
    if (feature) { features.push(feature); continue; }
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
  return { tolls, cameras, rests, features };
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
  // Anything not even near this route is left out before it's measured against it.
  const near = nearRoute(route);
  return {
    tolls: tollsOnRoute(route, found.tolls.filter(near)),
    cameras: camerasOnRoute(route, found.cameras.filter(near)),
    rests: restsOnRoute(route, found.rests.filter(near)),
    features: featuresOnRoute(route, (found.features || []).filter(near)),
  };
}

const cache = new Map();
export const clearAlongCache = () => cache.clear();

// Tolls, cameras and R&Rs: from the copy kept with the app, or, if that can't be
// had, from a map server. Lights, bumps and crossings always come from a server.
export async function findAlong(routes, { tolls = true, cameras = true, rests = true, ...opts } = {}) {
  try {
    const data = await loadAlongData(opts);
    return { ...dataNear(data, routes, { tolls, cameras, rests }), fromData: true };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
  }
  return fetchAlong(routes, { ...opts, tolls, cameras, rests, features: false });
}

export async function fetchAlong(routes, { signal, fetchImpl, servers = CONFIG.overpass, waits = WAITS, tolls = true, cameras = true, rests = true, features = true } = {}) {
  const key = `${routes.map((r) => r.id).join(',')}|${tolls}|${cameras}|${rests}|${features}`;
  if (cache.has(key)) return cache.get(key);
  const timeout = Math.max(5, Math.round((waits.server || 22000) / 1000));
  const json = await overpass(alongQuery(routes, { tolls, cameras, rests, features, timeout }), { signal, fetchImpl, servers, waits });
  if (!json) throw new Error('no server answered');
  const found = parseAlong(json);
  cache.set(key, found);
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return found;
}
