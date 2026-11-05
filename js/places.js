// Stops along a route, from OpenStreetMap through the Overpass API.
import { CONFIG } from './config.js';
import { bearing, haversine, projectOnSegment } from './geo.js';

export const CATEGORIES = {
  fuel: { filter: '["amenity"="fuel"]', radius: 1500, photon: ['osm.amenity.fuel'] },
  ev: { filter: '["amenity"="charging_station"]', radius: 2500, photon: ['osm.amenity.charging_station'] },
  rest: { filter: '["highway"~"^(services|rest_area)$"]', radius: 1500, photon: ['osm.highway.services', 'osm.highway.rest_area'] },
  surau: { filter: '["amenity"="place_of_worship"]["religion"="muslim"]', radius: 1500, photon: ['osm.amenity.place_of_worship'] },
  food: { filter: '["amenity"~"^(restaurant|fast_food|cafe|food_court)$"]["name"]', radius: 700, photon: ['osm.amenity.restaurant', 'osm.amenity.fast_food'] },
};

const MAX_AHEAD = 200000;   // look this far along the route
const MAX_POINTS = 100;     // keep the request a reasonable size
const CACHE_MS = 15 * 60000;
const SERVER_WAIT_MS = 12000;   // a server that's said nothing by now isn't going to
const REST_MS = 60000;          // and one that's struggling gets left alone for a while
const MUSLIM_NAME = /masjid|surau|musolla|musala|mosque/i;

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
  return `[out:json][timeout:12];nwr${filter}(around:${radius},${line});out center tags 150;`;
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
const resting = new Map();
export const clearPlacesCache = () => { cache.clear(); resting.clear(); };

// One server, given a fair time to answer. Anything else counts as no answer.
async function askServer(server, body, signal, fetchImpl) {
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  const timer = setTimeout(stop, SERVER_WAIT_MS);
  signal?.addEventListener('abort', stop);
  try {
    // A form post, so the browser doesn't need to ask permission first.
    const res = await fetchImpl(server, { method: 'POST', body, signal: ctrl.signal });
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    const json = await res.json();
    // Running out of time still comes back as "OK", with a note and no results.
    if (json.remark && !(json.elements || []).length) throw new Error(`overpass: ${json.remark}`);
    return json;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

async function fromOverpass(route, category, fromS, { signal, fetchImpl, servers }) {
  const body = new URLSearchParams({ data: buildQuery(category, routeSample(route, fromS)) });
  for (const server of servers) {
    if (Date.now() < (resting.get(server) || 0)) continue;
    try {
      return parseElements(await askServer(server, body, signal, fetchImpl), category);
    } catch (err) {
      if (signal?.aborted) throw err;
      // These servers ban clients that keep asking after being told to stop.
      resting.set(server, Date.now() + REST_MS);
    }
  }
  return null;
}

// A second source, if every Overpass server is struggling: the search service,
// asked what it knows around a few points along the way.
async function fromPhoton(route, category, fromS, { signal, fetchImpl }) {
  const { photon } = CATEGORIES[category];
  const toS = Math.min(route.length, fromS + MAX_AHEAD);
  const points = [];
  for (const part of [0.08, 0.36, 0.64, 0.92]) {
    const at = fromS + (toS - fromS) * part;
    const i = route.cum.findIndex((c) => c >= at);
    if (i >= 0) points.push(route.coords[i]);
  }
  const found = [];
  let answered = false;
  for (const [lng, lat] of points) {
    const params = new URLSearchParams({ lat: lat.toFixed(4), lon: lng.toFixed(4), limit: '15' });
    for (const include of photon) params.append('include', include);
    try {
      const res = await fetchImpl(`${CONFIG.search.url}?${params}`, { signal });
      if (!res.ok) continue;
      const json = await res.json();
      answered = true;
      for (const f of json.features || []) {
        const p = f.properties || {};
        // Only what was asked for, in case a server ignores the filter.
        if (!photon.includes(`osm.${p.osm_key}.${p.osm_value}`)) continue;
        // This source can't tell a mosque from any other place of worship by tag.
        if (category === 'surau' && !MUSLIM_NAME.test(p.name || '')) continue;
        const [fLng, fLat] = f.geometry.coordinates;
        found.push({ id: `${p.osm_type}/${p.osm_id}`, category, name: p.name || '', brand: '', lat: fLat, lng: fLng });
      }
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }
  return answered ? found : null;
}

export async function findAlongRoute(route, category, fromS, { signal, fetchImpl = (...a) => fetch(...a), servers = CONFIG.overpass } = {}) {
  // Moving a few km along the same route doesn't need a fresh search.
  const key = `${route.id}:${category}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return rankAlongRoute(route, hit.places, fromS);

  const opts = { signal, fetchImpl, servers };
  const places = (await fromOverpass(route, category, fromS, opts)) ?? (await fromPhoton(route, category, fromS, opts));
  if (!places) throw new Error('no server answered');
  cache.set(key, { at: Date.now(), places });
  return rankAlongRoute(route, places, fromS);
}
