// Car parks near where you're going, from the map's own tiles.
import { CONFIG } from './config.js';
import { haversine } from './geo.js';
import { within } from './net.js';
import { TILE_Z, lngLatToTile, readPlaces, tileAddress } from './tiles.js';

export const PARKING_RADIUS_M = 500;
const MAX_SHOWN = 6;
const TILE_WAIT_MS = 6000;

export function isParking(p, mode = 'car') {
  if (p.subclass === 'bicycle_parking') return false;
  if (p.subclass === 'motorcycle_parking') return mode === 'motorcycle';
  return p.class === 'parking' || p.subclass === 'parking' || p.subclass === 'parking_entrance';
}

// The tiles that cover a circle around a point.
export function tilesAround(lng, lat, radius, z = TILE_Z) {
  const dLat = radius / 110540;
  const dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const [x0, y0] = lngLatToTile(lng - dLng, lat + dLat, z);
  const [x1, y1] = lngLatToTile(lng + dLng, lat - dLat, z);
  const out = [];
  for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) out.push({ z, x, y });
  }
  return out;
}

// The closest few, with the same car park only once.
export function rankParking(places, dest, { mode = 'car', radius = PARKING_RADIUS_M } = {}) {
  const out = [];
  const near = places
    .filter((p) => isParking(p, mode))
    .map((p) => ({ id: p.id, name: p.name || '', lng: p.lng, lat: p.lat, distance: haversine([p.lng, p.lat], [dest.lng, dest.lat]) }))
    .filter((p) => p.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
  for (const p of near) {
    const twin = out.find((q) => haversine([q.lng, q.lat], [p.lng, p.lat]) < (p.name && p.name === q.name ? 80 : 25));
    if (!twin) out.push(p);
    if (out.length === MAX_SHOWN) break;
  }
  return out;
}

export async function findParking(dest, { mode, signal, fetchImpl = (...a) => fetch(...a), tileUrl = CONFIG.poiTiles, radius = PARKING_RADIUS_M } = {}) {
  const tiles = tilesAround(dest.lng, dest.lat, radius);
  let read = 0;
  const places = [];
  await Promise.all(tiles.map(async (tile) => {
    try {
      const buffer = await within(TILE_WAIT_MS, signal, async (s) => {
        const r = await fetchImpl(tileAddress(tileUrl, tile), { signal: s });
        if (r.status === 404 || r.status === 204) return new ArrayBuffer(0);
        if (!r.ok) throw new Error(`tile ${r.status}`);
        return r.arrayBuffer();
      });
      places.push(...readPlaces(buffer, tile));
      read++;
    } catch { /* the rest may still answer */ }
  }));
  if (!read) throw new Error('no tiles');
  return rankParking(places, dest, { mode, radius });
}
