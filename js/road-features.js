// Traffic lights, speed bumps and railway crossings on your road, as they are
// marked in OpenStreetMap. Pintu knows where a light is, not whether it's red:
// Malaysia's signal timings aren't shared openly.
import { CONFIG } from './config.js';
import { clamp } from './geo.js';
import { overpass, placeOnRoute } from './places.js';
import { samplePoints } from './cameras.js';

export const KINDS = ['light', 'bump', 'rail'];
export const NEAR_M = 60;                                   // asked for this wide, then placed exactly
const OFF_M = { light: 15, bump: 8, rail: 15 };             // how close to your line it must be
const SAME_M = { light: 70, bump: 20, rail: 60 };           // one junction's lights count once
const BEHIND_M = 15;
const BUMPS = '^(bump|hump|table|cushion|yes)$';

// The three questions, around a line of points.
export function featureStatements(line, radius = NEAR_M) {
  return `node["highway"="traffic_signals"](around:${radius},${line});`
    + `node["traffic_calming"~"${BUMPS}"](around:${radius},${line});`
    + `node["railway"="level_crossing"](around:${radius},${line});`;
}

export function parseFeature(el) {
  const tags = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const id = `${el.type}/${el.id}`;
  // A fire station's own signal stops nobody else.
  if (tags.highway === 'traffic_signals' && tags.traffic_signals !== 'emergency') return { id, lat, lng, kind: 'light' };
  if (tags.traffic_calming && new RegExp(BUMPS).test(tags.traffic_calming)) return { id, lat, lng, kind: 'bump' };
  if (tags.railway === 'level_crossing') return { id, lat, lng, kind: 'rail' };
  return null;
}

export function parseFeatures(json) {
  return (json?.elements || []).map(parseFeature).filter(Boolean);
}

// Those on your road, in the order you reach them.
export function featuresOnRoute(route, features) {
  const out = [];
  for (const f of features || []) {
    const where = placeOnRoute(route, f, 0);
    if (!where || where.off > OFF_M[f.kind]) continue;
    if (out.some((g) => g.kind === f.kind && Math.abs(g.along - where.along) < SAME_M[f.kind])) continue;
    out.push({ ...f, along: where.along });
  }
  return out.sort((a, b) => a.along - b.along);
}

export const countLights = (placed) => (placed || []).filter((f) => f.kind === 'light').length;

// Far enough ahead to matter at this speed (m/s), and no further.
export function warnDistance(kind, speed) {
  const v = speed || 0;
  if (kind === 'rail') return clamp(v * 18, 200, 600);
  if (kind === 'bump') return clamp(v * 6, 60, 200);
  return clamp(v * 10, 120, 350);
}

// The next one worth showing. `wanted` says which kinds are switched on.
export function featureAhead(placed, s, speed, wanted = { light: true, bump: true, rail: true }) {
  for (const feature of placed || []) {
    if (!wanted[feature.kind]) continue;
    const ahead = feature.along - s;
    if (ahead < -BEHIND_M) continue;
    if (ahead <= warnDistance(feature.kind, speed)) return { feature, ahead: Math.max(0, ahead) };
    // A railway crossing further on matters more than the next light.
    if (feature.kind !== 'rail' && ahead > warnDistance('rail', speed)) return null;
  }
  return null;
}

export function featureQuery(points) {
  const line = points.map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',');
  return `[out:json][timeout:25];(${featureStatements(line, 40)});out center tags 3000;`;
}

// For a route found while driving, when the plan's own answer doesn't cover it.
export async function fetchFeatures(route, { signal, fetchImpl, servers = CONFIG.overpass } = {}) {
  const json = await overpass(featureQuery(samplePoints(route)), { signal, fetchImpl, servers });
  if (!json) throw new Error('no server answered');
  return parseFeatures(json);
}
