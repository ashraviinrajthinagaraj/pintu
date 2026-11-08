import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTrip } from '../js/routing.js';
import { P, cityTrip } from './helpers/fixtures.js';
import { pointAt } from '../js/motion.js';
import { bearing } from '../js/geo.js';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { ASK_AFTER_M, LOOK_AHEAD_M, justPassed, reportAhead, reportBox, reportsOnRoute } = await import('../js/road-reports.js');

const route = () => prepareTrip(cityTrip());

test('asks only for the area the next stretch of road runs through', () => {
  const r = route();
  const box = reportBox(r, 0).split(',').map(Number);
  assert.equal(box.length, 4);
  const [w, s, e, n] = box;
  assert.ok(w < e && s < n);
  assert.ok(e - w <= 1.9 && n - s <= 1.9, 'small enough for the server');
  for (const [lng, lat] of r.coords) {
    assert.ok(lng >= w && lng <= e && lat >= s && lat <= n, 'the whole road ahead is inside');
  }
  assert.ok(LOOK_AHEAD_M >= 10000);
});

test('places reports on your road, on your side of it, in order', () => {
  const r = route();
  const at = (s) => { const [lng, lat] = pointAt(r, s); return { lng, lat }; };
  const way = (s) => bearing(pointAt(r, s), pointAt(r, s + 20));
  const reports = [
    { id: 1, kind: 'police', ...at(1200), heading: way(1200) },
    { id: 2, kind: 'crash', ...at(400), heading: null },
    { id: 3, kind: 'hazard', ...at(800), heading: (way(800) + 180) % 360 }, // the other carriageway
    { id: 4, kind: 'jam', lng: P.a[0] + 0.05, lat: P.a[1] + 0.05 },           // somewhere else
    { id: 5, kind: 'aliens', ...at(500) },
    { id: 6, kind: 'police', ...at(1220), heading: way(1220) },               // the same one again
  ];
  const placed = reportsOnRoute(r, reports);
  assert.deepEqual(placed.map((x) => x.id), [2, 1]);
  assert.ok(Math.abs(placed[1].along - 1200) < 5);
});

test('warns ahead at a distance that suits the speed, and asks once you have passed', () => {
  const placed = [{ id: 7, kind: 'police', along: 2000 }];
  assert.equal(reportAhead(placed, 1000, 10), null, '1 km away in town');
  assert.ok(reportAhead(placed, 1650, 10), '350 m away');
  assert.ok(reportAhead(placed, 1150, 30), 'further ahead at highway speed');
  assert.equal(reportAhead(placed, 2100, 10), null, 'behind you');
  const asked = new Set();
  assert.equal(justPassed(placed, 2000 + ASK_AFTER_M - 1, asked), null);
  assert.equal(justPassed(placed, 2000 + ASK_AFTER_M + 5, asked).id, 7);
  asked.add(7);
  assert.equal(justPassed(placed, 2000 + ASK_AFTER_M + 5, asked), null, 'only once');
  assert.equal(justPassed([{ id: 8, along: 100 }], 2000, new Set()), null, 'long gone');
});
