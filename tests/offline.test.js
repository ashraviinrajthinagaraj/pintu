import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ROUTE_TILES, canSaveMap, routeTiles, saveRouteMap } from '../js/offline.js';
import { prepareTrip } from '../js/routing.js';
import { buildTrip, cityTrip, P } from './helpers/fixtures.js';

const long = () => prepareTrip(buildTrip(P.a, [
  { to: [101.95, 3.15], type: 1, street: 'E8', kph: 100 },
  { to: [102.2, 3.0], type: 9, street: 'E8', kph: 100 },
]));

test('the map along a route: close up along the road, and wider views too', () => {
  const tiles = routeTiles(long());
  const at = (z) => tiles.filter((t) => t.z === z).length;
  assert.ok(at(14) > 20 && at(12) > 3 && at(10) >= 1, JSON.stringify([at(14), at(12), at(10)]));
  assert.equal(new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`)).size, tiles.length, 'each once');
  assert.ok(tiles.length <= MAX_ROUTE_TILES);
  // Nearest first, so a short signal still saves the next stretch.
  assert.deepEqual(tiles[0], routeTiles(prepareTrip(cityTrip()))[0]);
});

test('not on data saver, and not offline', () => {
  assert.equal(canSaveMap({ onLine: true, connection: { saveData: false } }), true);
  assert.equal(canSaveMap({ onLine: true, connection: { saveData: true } }), false);
  assert.equal(canSaveMap({ onLine: false }), false);
  assert.equal(canSaveMap({}), true);
});

test('fetches each tile once, a few at a time, and counts what it saved', async () => {
  const asked = [];
  let open = 0, most = 0;
  const fetchImpl = async (url) => {
    asked.push(url);
    open++; most = Math.max(most, open);
    await new Promise((r) => setTimeout(r, 1));
    open--;
    return new Response(new Uint8Array(1000), { status: 200 });
  };
  const r = prepareTrip(cityTrip());
  const result = await saveRouteMap(r, 'https://tiles.test/{z}/{x}/{y}.pbf', { fetchImpl });
  assert.equal(result.saved, result.tiles);
  assert.equal(result.bytes, result.tiles * 1000);
  assert.equal(new Set(asked).size, asked.length);
  assert.ok(most <= 3);
  assert.match(asked[0], /^https:\/\/tiles\.test\/14\/\d+\/\d+\.pbf$/);
});

test('gives up quietly with no signal, and stops when the trip ends', async () => {
  let calls = 0;
  const failing = async () => { calls++; throw new Error('offline'); };
  const r = long();
  const result = await saveRouteMap(r, 'https://tiles.test/{z}/{x}/{y}.pbf', { fetchImpl: failing });
  assert.equal(result.saved, 0);
  assert.ok(result.stopped);
  assert.ok(calls < 15, `${calls} tries`);

  const ctrl = new AbortController();
  let n = 0;
  const slow = async (url, { signal }) => {
    if (++n === 5) ctrl.abort();
    if (signal.aborted) throw new Error('aborted');
    return new Response(new Uint8Array(10));
  };
  const cut = await saveRouteMap(r, 'https://tiles.test/{z}/{x}/{y}.pbf', { fetchImpl: slow, signal: ctrl.signal });
  assert.ok(cut.stopped && cut.saved < 8);
});
