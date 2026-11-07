// Toll plazas and gantries along the route, from OpenStreetMap, so the HUD can
// say one is coming and there's time to get the Touch 'n Go card ready. Only
// plazas someone has mapped are known.
import { CONFIG } from './config.js';
import { samplePoints } from './cameras.js';
import { overpass, placeOnRoute } from './places.js';

const NEAR_M = 120;            // asked for generously, then checked properly here
// A plaza is wide, and its booths are often mapped on lanes beside the line the
// route follows. On a stretch the route says is tolled, that much is allowed;
// anywhere else, only a booth right on the road counts.
export const TOLL_OFF_M = 60;
export const TOLL_OFF_ELSEWHERE_M = 20;
const TOLLED_MARGIN_M = 300;   // the plaza can sit just past where the toll road ends
const SAME_PLAZA_M = 300;      // booths for each lane and direction are one plaza
const BEHIND_M = 30;
export const TOLL_NOTICE_M = 2000;

export function tollQuery(points) {
  const line = points.map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',');
  return `[out:json][timeout:20];(nwr["barrier"="toll_booth"](around:${NEAR_M},${line});`
    + `node["highway"="toll_gantry"](around:${NEAR_M},${line}););out center tags 300;`;
}

export function parseTolls(json) {
  const out = [];
  for (const el of json.elements || []) {
    const gantry = el.tags?.highway === 'toll_gantry';
    if (el.tags?.barrier !== 'toll_booth' && !gantry) continue;
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ id: `${el.type}/${el.id}`, lat, lng, name: el.tags?.name || null, gantry });
  }
  return out;
}

// Whether distance s along the route is on, or just beside, a tolled stretch.
export function tolledAt(route, s) {
  const ms = route.maneuvers || [];
  for (let i = 0; i < ms.length; i++) {
    if (!ms[i].toll) continue;
    const begin = ms[i].beginDist ?? 0;
    const end = ms[i + 1]?.beginDist ?? route.length;
    if (s >= begin - TOLLED_MARGIN_M && s <= end + TOLLED_MARGIN_M) return true;
  }
  return false;
}

export function tollsOnRoute(route, tolls) {
  const out = [];
  for (const toll of tolls) {
    const where = placeOnRoute(route, toll, 0);
    if (!where) continue;
    const limit = tolledAt(route, where.along) ? TOLL_OFF_M : TOLL_OFF_ELSEWHERE_M;
    if (where.off > limit) continue;
    const same = out.find((t) => Math.abs(t.along - where.along) < SAME_PLAZA_M);
    if (same) {
      same.name ??= toll.name;
      continue;
    }
    out.push({ ...toll, along: where.along });
  }
  return out.sort((a, b) => a.along - b.along);
}

// The next plaza, if it's close enough to mention.
export function tollAhead(tolls, s, range = TOLL_NOTICE_M) {
  for (const toll of tolls || []) {
    const ahead = toll.along - s;
    if (ahead < -BEHIND_M) continue;
    return ahead <= range ? { toll, ahead: Math.max(0, ahead) } : null;
  }
  return null;
}

export async function fetchTolls(route, { signal, fetchImpl, servers = CONFIG.overpass } = {}) {
  const json = await overpass(tollQuery(samplePoints(route)), { signal, fetchImpl, servers });
  if (!json) throw new Error('no server answered');
  return parseTolls(json);
}
