// Stops along a route, from OpenStreetMap through the Overpass API.
import { CONFIG } from './config.js';
import { bearing, haversine, projectOnSegment } from './geo.js';

export const CATEGORIES = {
  fuel: { filter: '["amenity"="fuel"]', radius: 1500 },
  ev: { filter: '["amenity"="charging_station"]', radius: 2500 },
  rest: { filter: '["highway"~"^(services|rest_area)$"]', radius: 1500 },
  surau: { filter: '["amenity"="place_of_worship"]["religion"="muslim"]', radius: 1500 },
  food: { filter: '["amenity"~"^(restaurant|fast_food|cafe|food_court)$"]["name"]', radius: 700 },
};

const MAX_AHEAD = 300000;   // look this far along the route
const MAX_POINTS = 120;     // keep the request a reasonable size
const CACHE_MS = 15 * 60000;

// The stretch of route to search along, thinned out to a sensible size.
export function routeSample(route, fromS) {
  const { coords, cum } = route;
  const toS = Math.min(route.length, fromS + MAX_AHEAD);
  const step = Math.max(250, (toS - fromS) / MAX_POINTS);
  const out = [];
  let nextS = fromS;
  for (let i = 0; i < coords.length; i++) {
    if (cum[i] < fromS) continue;
    if (cum[i] > toS) break;
    if (cum[i] >= nextS) {
      out.push(coords[i]);
      nextS = cum[i] + step;
    }
  }
  if (out.length < 2) out.push(coords[coords.length - 1]);
  return out;
}

export function buildQuery(category, points) {
  const { filter, radius } = CATEGORIES[category];
  const line = points.map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',');
  return `[out:json][timeout:20];nwr${filter}(around:${radius},${line});out center tags 150;`;
}

export function parseElements(json, category) {
  const out = [];
  for (const el of json.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const tags = el.tags || {};
    out.push({
      id: `${el.type}/${el.id}`,
      category,
      name: tags.name || tags['name:ms'] || tags['name:en'] || tags.brand || tags.operator || '',
      brand: tags.brand || '',
      lat,
      lng,
    });
  }
  return out;
}

// Where a place sits relative to the route ahead of you.
export function placeOnRoute(route, place, fromS) {
  const { coords, cum } = route;
  const p = [place.lng, place.lat];
  let best = null;
  // Check every few points first, then look closely around the best one.
  const stride = Math.max(1, Math.floor(coords.length / 1500));
  let bestI = -1, bestD = Infinity;
  for (let i = 0; i < coords.length - 1; i += stride) {
    if (cum[i + 1] < fromS) continue;
    const d = haversine(p, coords[i]);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  if (bestI < 0) return null;
  for (let i = Math.max(0, bestI - stride); i <= Math.min(coords.length - 2, bestI + stride); i++) {
    if (cum[i + 1] < fromS) continue;
    const pr = projectOnSegment(p, coords[i], coords[i + 1]);
    if (!best || pr.dist < best.dist) {
      best = { dist: pr.dist, i, s: cum[i] + (cum[i + 1] - cum[i]) * pr.t };
    }
  }
  // Nearest to a stretch you've already driven: it's behind you.
  if (!best || best.s < fromS - 5) return null;
  const a = coords[best.i], b = coords[best.i + 1];
  const k = Math.cos((p[1] * Math.PI) / 180);
  const cross = (b[0] - a[0]) * k * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) * k;
  return {
    along: best.s,
    ahead: best.s - fromS,
    off: best.dist,
    side: best.dist < 12 ? null : cross > 0 ? 'left' : 'right',
    bearing: bearing(a, b),
  };
}

export function rankAlongRoute(route, places, fromS) {
  const seen = [];
  const ranked = [];
  for (const place of places) {
    const where = placeOnRoute(route, place, fromS);
    if (!where) continue;
    // Found for a stretch of road further back, and now out of reach of this one.
    const radius = CATEGORIES[place.category]?.radius;
    if (radius && where.off > radius * 1.3) continue;
    // The same place is sometimes mapped twice, once as a point and once as a building.
    const dup = seen.find((q) => q.name === place.name && haversine([q.lng, q.lat], [place.lng, place.lat]) < 120);
    if (dup) continue;
    seen.push(place);
    ranked.push({ ...place, ...where });
  }
  return ranked.sort((a, b) => a.ahead - b.ahead);
}

const cache = new Map();
export const clearPlacesCache = () => cache.clear();

export async function findAlongRoute(route, category, fromS, { signal, fetchImpl = (...a) => fetch(...a), servers = CONFIG.overpass } = {}) {
  // Moving a few km along the same route doesn't need a fresh search.
  const key = `${route.id}:${category}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return rankAlongRoute(route, hit.places, fromS);

  const body = new URLSearchParams({ data: buildQuery(category, routeSample(route, fromS)) });
  let lastError = new Error('no server answered');
  for (const server of servers) {
    let res;
    try {
      // A form post, so the browser doesn't need to ask permission first.
      res = await fetchImpl(server, { method: 'POST', body, signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
      continue;
    }
    if (!res.ok) { lastError = new Error(`overpass ${res.status}`); continue; }
    const places = parseElements(await res.json(), category);
    cache.set(key, { at: Date.now(), places });
    return rankAlongRoute(route, places, fromS);
  }
  throw lastError;
}
