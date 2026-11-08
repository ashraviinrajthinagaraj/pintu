// Keeps the map of the route on the phone, so a stretch with no signal (a
// highway through the hills, the interior of Sabah or Sarawak) still has a
// map. When a trip starts, the tiles along it are fetched quietly, a few at a
// time; the app's offline store keeps whatever the map loads.
import { tileAddress, tilesAlongRoute } from './tiles.js';

// Close up along the road, and a wider view now and then for zooming out.
const LEVELS = [
  { z: 14, radius: 350 },
  { z: 12, radius: 1500 },
  { z: 10, radius: 6000 },
];
export const MAX_ROUTE_TILES = 900;
const AT_ONCE = 3;

export function routeTiles(route, { from = 0, max = MAX_ROUTE_TILES } = {}) {
  const out = [];
  for (const { z, radius } of LEVELS) {
    const room = max - out.length;
    if (room <= 0) break;
    out.push(...tilesAlongRoute(route, from, route.length, radius, { z, max: room }));
  }
  return out;
}

// Whether it's sensible to use data on this now.
export function canSaveMap(nav = globalThis.navigator) {
  if (nav?.onLine === false) return false;
  if (nav?.connection?.saveData) return false;
  return true;
}

// Fetches each tile once; the service worker keeps them. Stops if asked to,
// or after a run of failures, which means no signal anyway.
export async function saveRouteMap(route, template, { from = 0, signal, fetchImpl = (...a) => fetch(...a), onDone } = {}) {
  const tiles = routeTiles(route, { from });
  let i = 0, saved = 0, bytes = 0, failedInRow = 0;
  const next = async () => {
    while (i < tiles.length && !signal?.aborted && failedInRow < 8) {
      const url = tileAddress(template, tiles[i++]);
      try {
        const res = await fetchImpl(url, { signal });
        if (!res.ok && res.status !== 204) throw new Error(String(res.status));
        bytes += (await res.arrayBuffer()).byteLength;
        saved++;
        failedInRow = 0;
      } catch {
        if (signal?.aborted) return;
        failedInRow++;
      }
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, next));
  const result = { tiles: tiles.length, saved, bytes, stopped: !!signal?.aborted || failedInRow >= 8 };
  onDone?.(result);
  return result;
}
