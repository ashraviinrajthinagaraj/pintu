import test from 'node:test';
import assert from 'node:assert/strict';
import { JAM_NOTICE_M, delayAhead, fetchTraffic, jamAhead, placeTraffic, tracePoints } from '../js/traffic.js';
import { prepareTrip } from '../js/routing.js';
import { pointAt } from '../js/motion.js';
import { haversine } from '../js/geo.js';
import { buildTrip, cityTrip, P } from './helpers/fixtures.js';

const long = () => prepareTrip(buildTrip(P.a, [
  { to: [101.95, 3.15], type: 1, street: 'E8', kph: 100 },
  { to: [102.2, 3.0], type: 9, street: 'E8', kph: 100 },
]));

test('sends the rest of the route, thinned to fit, from where you are to the end', () => {
  const r = long();
  const pts = tracePoints(r, 5000, 300);
  assert.ok(pts.length <= 300 && pts.length > 50, String(pts.length));
  assert.ok(haversine(pts[0], pointAt(r, 5000)) < 2);
  assert.ok(haversine(pts[pts.length - 1], r.coords[r.coords.length - 1]) < 2);
  // Evenly spread: no gap much bigger than the share each point gets.
  const gaps = pts.slice(1).map((p, i) => haversine(pts[i], p));
  assert.ok(Math.max(...gaps) < ((r.length - 5000) / 298) * 2.5, `biggest gap ${Math.max(...gaps)}`);
});

test('a short route keeps a point at least every so often, and its exact ends', () => {
  const r = prepareTrip(cityTrip());
  const pts = tracePoints(r, 0);
  assert.deepEqual(pts[0], r.coords[0]);
  assert.deepEqual(pts[pts.length - 1], r.coords[r.coords.length - 1]);
  const gaps = pts.slice(1, -1).map((p, i) => haversine(pts[i], p));
  assert.ok(Math.min(...gaps) >= 59, 'no crowding');
  assert.ok(Math.max(...gaps) < 200, 'no corner left far out');
});

test('slow stretches are placed on the route, and ones off it are left out', () => {
  const r = prepareTrip(cityTrip());
  const off = pointAt(r, 900);
  const t = placeTraffic(r, 0, { delay: 400, jams: [
    { from: pointAt(r, 1500), to: pointAt(r, 2100), delay: 300, speed: 9, kind: 'JAM' },
    { from: pointAt(r, 600), to: pointAt(r, 800), delay: 100, kind: 'ROAD_WORK' },
    { from: [off[0] + 0.01, off[1]], to: [off[0] + 0.012, off[1]], delay: 900, kind: 'JAM' },
  ] });
  assert.equal(t.delay, 400);
  assert.deepEqual(t.jams.map((j) => [Math.round(j.start / 10) * 10, Math.round(j.end / 10) * 10, j.kind]), [[600, 800, 'ROAD_WORK'], [1500, 2100, 'JAM']]);
});

test('the next jam worth mentioning, close enough, and how much of it is left', () => {
  const traffic = { jams: [
    { start: 1000, end: 1100, delay: 30, kind: 'JAM' },          // half a minute: not worth it
    { start: 13000, end: 14000, delay: 600, kind: 'JAM' },
    { start: 40000, end: 40500, delay: 0, kind: 'ROAD_CLOSURE' }, // a closure always is
  ] };
  assert.equal(jamAhead(traffic, 0), null, 'beyond reach, and the small one skipped');
  let near = jamAhead(traffic, 13000 - JAM_NOTICE_M + 1);
  assert.equal(near.jam.start, 13000);
  assert.equal(near.inside, false);
  near = jamAhead(traffic, 13500);
  assert.deepEqual([near.inside, near.ahead, near.left, near.delay], [true, 0, 500, 300]);
  assert.equal(jamAhead(traffic, 14000), null, 'through it');
  assert.equal(jamAhead(traffic, 35000).jam.kind, 'ROAD_CLOSURE');
  assert.equal(jamAhead(null, 0), null);
});

test('the time traffic still adds, counting only what is ahead', () => {
  const traffic = { jams: [{ start: 1000, end: 2000, delay: 600 }, { start: 5000, end: 5200, delay: 120 }] };
  assert.equal(delayAhead(traffic, 0), 720);
  assert.equal(delayAhead(traffic, 1500), 420);
  assert.equal(delayAhead(traffic, 2000), 120);
  assert.equal(delayAhead(traffic, 6000), 0);
  assert.equal(delayAhead(null, 0), 0);
});

test('asks Pintu\'s server as plain text, so the page needn\'t ask permission first', async () => {
  const r = prepareTrip(cityTrip());
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ delay: 0, jams: [] }), { status: 200 });
  };
  const t = await fetchTraffic(r, 0, { fetchImpl, server: 'https://pintu.test' });
  assert.equal(seen.url, 'https://pintu.test/traffic');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['content-type'], 'text/plain');
  assert.deepEqual(JSON.parse(seen.init.body).points, tracePoints(r, 0));
  assert.deepEqual(t.jams, []);
});

test('a server with no key, or no server at all, is an error the app can recognise', async () => {
  const r = prepareTrip(cityTrip());
  const fetchImpl = async () => new Response(JSON.stringify({ error: 'no key' }), { status: 503 });
  await assert.rejects(fetchTraffic(r, 0, { fetchImpl, server: 'https://pintu.test' }), (e) => e.kind === 'no key' && e.status === 503);
  await assert.rejects(fetchTraffic(r, 0, { fetchImpl, server: null }), (e) => e.kind === 'no server');
});
