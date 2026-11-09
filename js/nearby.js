// Places worth going to near you: from the map's own tiles first, and from
// OpenStreetMap when the tiles have too few.
import { CONFIG } from './config.js';
import { haversine } from './geo.js';
import { within } from './net.js';
import { tilesAround } from './parking.js';
import { overpass } from './places.js';
import { readPlaces, tileAddress } from './tiles.js';

const FOOD = new Set(['restaurant', 'fast_food', 'food_court', 'cafe']);
const SIGHTS = new Set(['attraction', 'museum', 'viewpoint', 'theme_park', 'zoo', 'aquarium', 'gallery', 'monument', 'memorial', 'castle', 'ruins', 'fort']);
const STAYS = new Set(['hotel', 'motel', 'guest_house', 'hostel', 'resort']);

// `radius` is how far OpenStreetMap is asked to look when the tiles aren't enough.
export const NEARBY = {
  sights: {
    tile: (p) => !!p.name && (SIGHTS.has(p.subclass) || SIGHTS.has(p.class)),
    query: '["tourism"~"^(attraction|museum|viewpoint|theme_park|zoo|aquarium|gallery)$"]["name"]',
    radius: 10000,
  },
  food: {
    tile: (p) => !!p.name && (FOOD.has(p.subclass) || FOOD.has(p.class)),
    query: '["amenity"~"^(restaurant|fast_food|cafe|food_court)$"]["name"]',
    radius: 3000,
  },
  fuel: { tile: (p) => p.class === 'fuel' || p.subclass === 'fuel', query: '["amenity"="fuel"]', radius: 6000 },
  ev: { tile: (p) => p.subclass === 'charging_station', query: '["amenity"="charging_station"]', radius: 15000 },
  hospital: { tile: (p) => p.subclass === 'hospital', query: '["amenity"="hospital"]', radius: 30000 },
  hotel: {
    tile: (p) => !!p.name && (p.class === 'lodging' || STAYS.has(p.subclass)),
    query: '["tourism"~"^(hotel|motel|guest_house|hostel|resort)$"]["name"]',
    radius: 10000,
  },
};
export const NEARBY_ORDER = ['sights', 'food', 'fuel', 'ev', 'hotel', 'hospital'];

const TILE_RADIUS = 2500;
const TILE_WAIT_MS = 6000;
const ENOUGH = 8;
const MAX_SHOWN = 30;

export function nearbyQuery(category, center) {
  const { query, radius } = NEARBY[category];
  return `[out:json][timeout:15];nwr${query}(around:${radius},${center.lat.toFixed(5)},${center.lng.toFixed(5)});out center tags 120;`;
}

export function parseNearby(json) {
  const out = [];
  for (const el of json.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const tags = el.tags || {};
    out.push({
      id: `${el.type}/${el.id}`,
      name: tags.name || tags['name:ms'] || tags['name:en'] || tags.brand || tags.operator || '',
      kind: tags.tourism || tags.amenity || '',
      lng,
      lat,
    });
  }
  return out;
}

// Closest first, each place once, never more than a screenful or two.
export function rankNearby(places, center, radius) {
  const near = places
    .map((p) => ({ ...p, distance: haversine([center.lng, center.lat], [p.lng, p.lat]) }))
    .filter((p) => p.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
  const out = [];
  for (const p of near) {
    const twin = out.find((q) => haversine([q.lng, q.lat], [p.lng, p.lat]) < (p.name && p.name === q.name ? 120 : 30));
    if (!twin) out.push(p);
    if (out.length === MAX_SHOWN) break;
  }
  return out;
}

async function fromTiles(center, category, { signal, fetchImpl, tileUrl }) {
  const cat = NEARBY[category];
  const tiles = tilesAround(center.lng, center.lat, TILE_RADIUS);
  let read = 0;
  const found = [];
  await Promise.all(tiles.map(async (tile) => {
    try {
      const buffer = await within(TILE_WAIT_MS, signal, async (s) => {
        const r = await fetchImpl(tileAddress(tileUrl, tile), { signal: s });
        if (r.status === 404 || r.status === 204) return new ArrayBuffer(0);
        if (!r.ok) throw new Error(`tile ${r.status}`);
        return r.arrayBuffer();
      });
      for (const p of readPlaces(buffer, tile)) {
        if (cat.tile(p)) found.push({ id: p.id, name: p.name, kind: p.subclass || p.class, lng: p.lng, lat: p.lat });
      }
      read++;
    } catch { /* the rest may still answer */ }
  }));
  return { found, ok: read >= tiles.length / 2 };
}

export async function findNearby(center, category, {
  signal = new AbortController().signal,
  fetchImpl = (...a) => fetch(...a),
  tileUrl = CONFIG.poiTiles,
  servers = CONFIG.overpass,
} = {}) {
  const { radius } = NEARBY[category];
  const tiles = await fromTiles(center, category, { signal, fetchImpl, tileUrl });
  let ranked = rankNearby(tiles.found, center, radius);
  if (ranked.length >= ENOUGH) return ranked;
  // Too few close by, or the tiles couldn't be read: OpenStreetMap, further out.
  const json = await overpass(nearbyQuery(category, center), { signal, fetchImpl, servers }).catch(() => null);
  if (json) ranked = rankNearby([...tiles.found, ...parseNearby(json)], center, radius);
  else if (!tiles.ok) throw new Error('nothing answered');
  return ranked;
}
