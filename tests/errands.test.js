import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STOPS, bestOrder, orderTime, suggestOrder } from '../js/errands.js';
import { fetchDriveTimes, resetRouting } from '../js/routing.js';

// Every order of 1…n, to check the quick way against the slow one.
function* orders(items) {
  if (items.length <= 1) { yield items; return; }
  for (let i = 0; i < items.length; i++) {
    for (const rest of orders([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest];
  }
}

// A city's worth of drive times: places on a plane, a little longer one way than the other.
function cityTimes(n, seed) {
  let x = seed;
  const rand = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const pts = Array.from({ length: n + 2 }, () => [rand() * 30, rand() * 30]);
  return pts.map((a, i) => pts.map((b, j) => (i === j ? 0 : Math.hypot(a[0] - b[0], a[1] - b[1]) * 60 + (i < j ? 30 : 0))));
}

test('the best order is the quickest of every order, start and end kept', () => {
  for (const n of [1, 2, 3, 5, 7]) {
    for (const seed of [1, 7, 42]) {
      const m = cityTimes(n, seed);
      const found = bestOrder(m);
      let slowest = Infinity;
      for (const o of orders(Array.from({ length: n }, (_, i) => i + 1))) slowest = Math.min(slowest, orderTime(m, o));
      assert.ok(Math.abs(found.time - slowest) < 1e-6, `${n} stops, seed ${seed}`);
      assert.equal(Math.abs(orderTime(m, found.order) - found.time) < 1e-6, true);
      assert.deepEqual([...found.order].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1));
    }
  }
  assert.equal(bestOrder(cityTimes(MAX_STOPS + 1, 3)), null, 'too many to try them all');
});

test('a quicker order is offered only when it saves enough; ways through matter', () => {
  // Along one road: start 0, end 10, the stops at 7 and 3 (in that order now).
  const line = (xs) => xs.map((a) => xs.map((b) => Math.abs(a - b) * 300));
  const slow = suggestOrder(line([0, 7, 3, 10]));
  assert.deepEqual(slow.order, [1, 0]);
  assert.equal(slow.saving, 2400);
  assert.equal(suggestOrder(line([0, 3, 7, 10])), null, 'already the best');
  // A minute saved isn't worth changing your plan for.
  assert.equal(suggestOrder(line([0, 5.1, 4.9, 10]).map((r) => r.map((v) => v / 10))), null);
  assert.equal(suggestOrder(line([0, 4, 10])), null, 'one stop has no order');
  // No way from one stop to the next (an island): never chosen.
  const m = line([0, 7, 3, 10]);
  m[2][1] = null;
  assert.equal(suggestOrder(m), null);
});

test('drive times between places come from the route server, as a table', async () => {
  resetRouting();
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    const body = JSON.parse(new URL(url).searchParams.get('json'));
    const rows = body.sources.map((_, i) => body.targets.map((_, j) => ({ from_index: i, to_index: j, time: i === j ? 0 : (i === 2 && j === 0 ? null : 60 * (i + j)) })).reverse());
    return new Response(JSON.stringify({ sources_to_targets: rows }), { status: 200 });
  };
  const providers = [{ name: 'test', matrixUrl: 'https://route.example/sources_to_targets', method: 'GET' }];
  const pts = [{ lat: 3.1, lng: 101.6 }, { lat: 3.2, lng: 101.7 }, { lat: 3.3, lng: 101.8 }];
  const times = await fetchDriveTimes(pts, { fetchImpl, providers, avoidTolls: true });
  assert.deepEqual(times, [[0, 60, 120], [60, 0, 180], [null, 180, 0]]);
  const body = JSON.parse(new URL(asked[0]).searchParams.get('json'));
  assert.equal(body.costing, 'auto');
  assert.deepEqual(body.costing_options, { auto: { use_tolls: 0 } });
  assert.deepEqual(body.sources[1], { lat: 3.2, lon: 101.7 });
  // No server that can: said so.
  await assert.rejects(fetchDriveTimes(pts, { fetchImpl, providers: [{ name: 'x', url: 'u' }] }));
});
