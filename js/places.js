// Stops along a route. The map's own tiles come first: if the map shows, they
// work, and they answer quickly. The Overpass API and the search service fill
// in what the tiles don't carry, or step in if the tiles can't be read.
import { CONFIG } from './config.js';
import { bearing, haversine, projectOnSegment } from './geo.js';
import { cancelled, within } from './net.js';
import { readPlaces, tileAddress, tilesAlongRoute } from './tiles.js';

const MUSLIM_NAME = /masjid|surau|musolla|musalla|musala|mosque|madrasah|مسجد|\bal[- ]/i;
const REST_NAME = /\br\s?&\s?r\b|\brnr\b|kawasan rehat|hentian rehat|rehat dan rawat|hentian sebelah|rest area/i;
const FOOD = new Set(['restaurant', 'fast_food', 'food_court', 'cafe']);

// `tile` picks a category's places out of a map tile. `partial` means the tiles
// don't reliably hold them all, so Overpass is asked as well, and a blank result
// can't be taken as there being none.
export const CATEGORIES = {
  fuel: {
    filter: '["amenity"="fuel"]', radius: 1500, photon: ['osm.amenity.fuel'],
    tile: (p) => p.class === 'fuel' || p.subclass === 'fuel',
  },
  ev: {
    filter: '["amenity"="charging_station"]', radius: 2500, photon: ['osm.amenity.charging_station'],
    tile: (p) => p.subclass === 'charging_station', partial: true,
  },
  rest: {
    filter: '["highway"~"^(services|rest_area)$"]', radius: 1500, photon: ['osm.highway.services', 'osm.highway.rest_area'],
    tile: (p) => REST_NAME.test(p.name), partial: true,
  },
  surau: {
    filter: '["amenity"="place_of_worship"]["religion"="muslim"]', radius: 1500, photon: ['osm.amenity.place_of_worship'],
    tile: (p) => p.subclass === 'place_of_worship' && MUSLIM_NAME.test(p.name),
  },
  food: {
    filter: '["amenity"~"^(restaurant|fast_food|cafe|food_court)$"]["name"]', radius: 700, photon: ['osm.amenity.restaurant', 'osm.amenity.fast_food'],
    tile: (p) => !!p.name && (FOOD.has(p.subclass) || FOOD.has(p.class)),
  },
};

const MAX_AHEAD = 200000;   // look this far along the route
const MAX_POINTS = 100;     // keep the Overpass request a reasonable size
const CACHE_MS = 15 * 60000;
const REST_MS = 60000;      // a struggling server gets left alone for a while
const TILES_AT_ONCE = 6;
const TILE_FAILS_TO_QUIT = 6;
const MAX_PER_TILE = 8;     // a busy street shouldn't fill the list by itself
const REPORT_MS = 250;
// However bad the network is, a search ends within these limits.
const WAITS = { tile: 6000, server: 10000, search: 5000, total: 22000 };

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

function rankInto(ranked, route, place, fromS) {
  const where = placeOnRoute(route, place, fromS);
  if (!where) return;
  // Found for a stretch of road further back, and now out of reach of this one.
  const radius = CATEGORIES[place.category]?.radius;
  if (radius && where.off > radius * 1.3) return;
  // The same place is sometimes mapped twice, once as a point and once as a building.
  const dup = ranked.find((q) => q.name === place.name && haversine([q.lng, q.lat], [place.lng, place.lat]) < 120);
  if (!dup) ranked.push({ ...place, ...where });
}

export function rankAlongRoute(route, places, fromS) {
  const ranked = [];
  for (const place of places) rankInto(ranked, route, place, fromS);
  return ranked.sort((a, b) => a.ahead - b.ahead);
}

// A short list that still covers the whole way, closest to the road first.
export function thinAlong(places, max = 40, stretch = 5000) {
  if (places.length <= max) return places;
  const groups = new Map();
  for (const p of places) {
    const key = Math.floor(p.ahead / stretch);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  for (const g of groups.values()) g.sort((a, b) => a.off - b.off);
  const out = [];
  for (let round = 0; out.length < max; round++) {
    let any = false;
    for (const g of groups.values()) {
      if (!g[round]) continue;
      any = true;
      out.push(g[round]);
      if (out.length === max) break;
    }
    if (!any) break;
  }
  return out.sort((a, b) => a.ahead - b.ahead);
}

const cache = new Map();
const resting = new Map();
export const clearPlacesCache = () => { cache.clear(); resting.clear(); };

// The map's tiles along the route, the nearest first, reporting as they come.
async function fromTiles(route, category, fromS, { signal, fetchImpl, tileUrl, waits }, report) {
  const cat = CATEGORIES[category];
  const toS = Math.min(route.length, fromS + MAX_AHEAD);
  const tiles = tilesAlongRoute(route, fromS, toS, Math.min(cat.radius, 1500));
  const seen = new Set();
  let next = 0, read = 0, failsInARow = 0, quit = false;

  const readTile = async (tile) => {
    const res = await within(waits.tile, signal, async (s) => {
      const r = await fetchImpl(tileAddress(tileUrl, tile), { signal: s });
      // Nothing on this bit of the Earth: an empty tile, not a fault.
      if (r.status === 404 || r.status === 204) return new ArrayBuffer(0);
      if (!r.ok) throw new Error(`tile ${r.status}`);
      return r.arrayBuffer();
    });
    const places = [];
    for (const p of readPlaces(res, tile)) {
      if (seen.has(p.id) || !cat.tile(p)) continue;
      seen.add(p.id);
      const where = placeOnRoute(route, p, fromS);
      if (where) places.push({ id: p.id, category, name: p.name, brand: '', lat: p.lat, lng: p.lng, off: where.off });
    }
    return places.sort((a, b) => a.off - b.off).slice(0, MAX_PER_TILE).map(({ off, ...p }) => p);
  };

  const worker = async () => {
    while (next < tiles.length && !quit && !signal.aborted) {
      const tile = tiles[next++];
      try {
        report(await readTile(tile));
        read++;
        failsInARow = 0;
      } catch {
        if (++failsInARow >= TILE_FAILS_TO_QUIT) quit = true;
      }
    }
  };
  await Promise.all(Array.from({ length: TILES_AT_ONCE }, worker));
  return !quit && !signal.aborted && read >= tiles.length / 2;
}

// One server, given a fair time to answer. Anything else counts as no answer.
function askServer(server, body, signal, fetchImpl, waits) {
  return within(waits.server, signal, async (s) => {
    // A form post, so the browser doesn't need to ask permission first.
    const res = await fetchImpl(server, { method: 'POST', body, signal: s });
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    const json = await res.json();
    // Running out of time still comes back as "OK", with a note and no results.
    if (json.remark && !(json.elements || []).length) throw new Error(`overpass: ${json.remark}`);
    return json;
  });
}

// Two different servers at once and the first good answer wins. Each only ever
// gets one request, and one that fails isn't asked again for a while, because
// these servers ban clients that keep asking after being told to stop.
export async function overpass(query, {
  signal = new AbortController().signal,
  fetchImpl = (...a) => fetch(...a),
  servers = CONFIG.overpass,
  waits = WAITS,
} = {}) {
  const body = new URLSearchParams({ data: query });
  const open = servers.filter((server) => Date.now() >= (resting.get(server) || 0));
  for (let i = 0; i < open.length && !signal.aborted; i += 2) {
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    signal.addEventListener('abort', stop);
    try {
      return await Promise.any(open.slice(i, i + 2).map(async (server) => {
        try {
          return await askServer(server, body, ctrl.signal, fetchImpl, waits);
        } catch (err) {
          if (!ctrl.signal.aborted) resting.set(server, Date.now() + REST_MS);
          throw err;
        }
      }));
    } catch {
      // Neither answered: on to the next pair, if there is one.
    } finally {
      ctrl.abort();
      signal.removeEventListener('abort', stop);
    }
  }
  return null;
}

async function fromOverpass(route, category, fromS, { signal, fetchImpl, servers, waits }) {
  const json = await overpass(buildQuery(category, routeSample(route, fromS)), { signal, fetchImpl, servers, waits });
  return json ? parseElements(json, category) : null;
}

// The search service, asked what it knows around a few points along the way.
async function fromPhoton(route, category, fromS, { signal, fetchImpl, waits }) {
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
    if (signal.aborted) break;
    const params = new URLSearchParams({ lat: lat.toFixed(4), lon: lng.toFixed(4), limit: '15' });
    for (const include of photon) params.append('include', include);
    try {
      const json = await within(waits.search, signal, async (s) => {
        const res = await fetchImpl(`${CONFIG.search.url}?${params}`, { signal: s });
        if (!res.ok) throw new Error(`search ${res.status}`);
        return res.json();
      });
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
    } catch { /* this point stays unknown */ }
  }
  return answered ? found : null;
}

export async function findAlongRoute(route, category, fromS, {
  signal,
  onProgress,
  fetchImpl = (...a) => fetch(...a),
  servers = CONFIG.overpass,
  tileUrl = CONFIG.poiTiles,
  waits = WAITS,
} = {}) {
  // Moving a few km along the same route doesn't need a fresh search.
  const key = `${route.id}:${category}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return rankAlongRoute(route, hit.places, fromS);

  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  const deadline = setTimeout(stop, waits.total);
  if (signal?.aborted) stop();
  signal?.addEventListener('abort', stop);

  const places = [];
  const ranked = [];
  let lastReport = 0;
  const report = (list) => {
    if (!list.length) return;
    for (const place of list) {
      places.push(place);
      rankInto(ranked, route, place, fromS);
    }
    const now = Date.now();
    if (onProgress && now - lastReport >= REPORT_MS) {
      lastReport = now;
      onProgress([...ranked].sort((a, b) => a.ahead - b.ahead));
    }
  };

  const { partial } = CATEGORIES[category];
  const opts = { signal: ctrl.signal, fetchImpl, servers, tileUrl, waits };
  const moreFromServers = async () => {
    const found = (await fromOverpass(route, category, fromS, opts)) ?? (await fromPhoton(route, category, fromS, opts));
    if (found) report(found);
    return !!found;
  };

  try {
    // Nothing is left waiting on a job that's stuck: the deadline stops them all.
    const stopped = new Promise((resolve) => ctrl.signal.addEventListener('abort', () => resolve(false)));
    const settle = (job) => Promise.race([job.catch(() => false), stopped]);
    const tiles = settle(fromTiles(route, category, fromS, opts, report));
    const others = partial ? settle(moreFromServers()) : null;
    const tilesOk = await tiles;
    let sure = partial ? await others : tilesOk;
    // Nothing yet, or the tiles couldn't be read: worth asking elsewhere before giving up.
    if (!partial && !ranked.length && !ctrl.signal.aborted) sure = (await settle(moreFromServers())) || tilesOk;

    if (signal?.aborted) throw cancelled();
    if (sure) cache.set(key, { at: Date.now(), places });
    else if (!ranked.length) throw new Error('no server answered');
    return ranked.sort((a, b) => a.ahead - b.ahead);
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', stop);
  }
}
