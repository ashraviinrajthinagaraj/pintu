import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteError, distanceAfter, fetchRoutes, parseResponse, prepareTrip, resetRouting, timeBetween } from '../js/routing.js';
import { P, altTrip, buildTrip, cityTrip, multiLeg } from './helpers/fixtures.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const from = { lat: 3.15, lng: 101.7 }, to = { lat: 3.16, lng: 101.718 };
const providers = [
  { name: 'stadia', url: 'https://a.test/route', method: 'POST' },
  { name: 'fossgis', url: 'https://b.test/route', method: 'GET' },
];

test('reads the main route and alternatives', () => {
  const routes = parseResponse({ trip: cityTrip(), alternates: [{ trip: altTrip() }] });
  assert.equal(routes.length, 2);
  assert.equal(routes[1].hasToll, true);
  assert.equal(routes[0].hasToll, false);
  assert.ok(routes[0].length > 2000);
  assert.deepEqual(routes[0].via.slice(0, 1), ['Jalan Tun Razak']);
  assert.equal(routes[0].maneuvers[1].beginDist > 1000, true);
  assert.equal(routes[0].maneuvers.at(-1).timeFromHere, 0);
});

test('ignores malformed trips', () => {
  assert.equal(prepareTrip({ legs: [] }), null);
  assert.equal(prepareTrip({ legs: [{ shape: '', maneuvers: [] }] }), null);
  assert.deepEqual(parseResponse({}), []);
});

test('uses the first service when it answers, sending the right request', async () => {
  resetRouting();
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return json({ trip: cityTrip() }); };
  const routes = await fetchRoutes({ from, to, mode: 'car', avoidTolls: true, alternates: 2 }, { fetchImpl, providers });
  assert.equal(routes[0].provider, 'stadia');
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.costing, 'auto');
  assert.equal(body.alternates, 2);
  assert.deepEqual(body.costing_options, { auto: { use_tolls: 0 } });
  assert.deepEqual(body.locations[0], { lat: 3.15, lon: 101.7, type: 'break' });
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
});

test('motorcycles use their own costing and never send toll options', async () => {
  resetRouting();
  let body;
  const fetchImpl = async (url, init) => { body = JSON.parse(init.body); return json({ trip: cityTrip() }); };
  await fetchRoutes({ from, to, mode: 'motorcycle', avoidTolls: true }, { fetchImpl, providers });
  assert.equal(body.costing, 'motorcycle');
  assert.equal(body.costing_options, undefined);
});

test('reroutes keep your direction of travel', async () => {
  resetRouting();
  let body;
  const fetchImpl = async (url, init) => { body = JSON.parse(init.body); return json({ trip: cityTrip() }); };
  await fetchRoutes({ from, to, mode: 'car', heading: 91.6 }, { fetchImpl, providers });
  assert.equal(body.locations[0].heading, 92);
  assert.equal(body.locations[0].heading_tolerance, 45);
  assert.equal(body.alternates, undefined);
});

test('falls back when the first service has not been set up, and stops asking it', async () => {
  resetRouting();
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return url.startsWith('https://a.test') ? json({ error: 'nope' }, 401) : json({ trip: cityTrip() });
  };
  const first = await fetchRoutes({ from, to, mode: 'car' }, { fetchImpl, providers });
  assert.equal(first[0].provider, 'fossgis');
  assert.match(urls[1], /^https:\/\/b\.test\/route\?json=%7B/);
  const decoded = JSON.parse(decodeURIComponent(urls[1].split('json=')[1]));
  assert.equal(decoded.costing, 'auto');
  urls.length = 0;
  await fetchRoutes({ from, to, mode: 'car' }, { fetchImpl, providers });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /b\.test/);
});

test('falls back on network failure and on a busy server', async () => {
  for (const fail of [async () => { throw new TypeError('Failed to fetch'); }, async () => json({}, 429), async () => json({}, 503)]) {
    resetRouting();
    const fetchImpl = async (url, i) => (url.startsWith('https://a.test') ? fail() : json({ trip: cityTrip() }));
    const r = await fetchRoutes({ from, to, mode: 'car' }, { fetchImpl, providers });
    assert.equal(r[0].provider, 'fossgis');
  }
});

test('explains failure in categories the app can act on', async () => {
  resetRouting();
  await assert.rejects(
    fetchRoutes({ from, to, mode: 'car' }, { fetchImpl: async () => { throw new TypeError('x'); }, providers }),
    (e) => e instanceof RouteError && e.code === 'offline',
  );
  resetRouting();
  await assert.rejects(
    fetchRoutes({ from, to, mode: 'car' }, { fetchImpl: async () => json({}, 503), providers }),
    (e) => e.code === 'busy',
  );
  resetRouting();
  await assert.rejects(
    fetchRoutes({ from, to, mode: 'car' }, { fetchImpl: async () => json({ error_code: 442, error: 'No path' }, 400), providers }),
    (e) => e.code === 'no_route',
  );
  resetRouting();
  await assert.rejects(
    fetchRoutes({ from, to, mode: 'car' }, { fetchImpl: async () => json({ error_code: 154, error: 'too long' }, 400), providers }),
    (e) => e.code === 'too_far',
  );
});

test('no route from one server does not ask the next', async () => {
  resetRouting();
  let n = 0;
  const fetchImpl = async () => { n++; return json({ error_code: 442 }, 400); };
  await assert.rejects(fetchRoutes({ from, to, mode: 'car' }, { fetchImpl, providers }));
  assert.equal(n, 1);
});

test('keeps at least a second between requests to the same server', async () => {
  resetRouting();
  const times = [];
  const fetchImpl = async () => { times.push(Date.now()); return json({ trip: cityTrip() }); };
  await fetchRoutes({ from, to, mode: 'car' }, { fetchImpl, providers });
  await fetchRoutes({ from, to, mode: 'car' }, { fetchImpl, providers });
  assert.ok(times[1] - times[0] >= 1100, String(times[1] - times[0]));
});

test('cancelling stops the search', async () => {
  resetRouting();
  const ctrl = new AbortController();
  const fetchImpl = (url, init) => new Promise((_, rej) => {
    init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
  });
  const p = fetchRoutes({ from, to, mode: 'car', signal: ctrl.signal }, { fetchImpl, providers });
  setTimeout(() => ctrl.abort(), 20);
  await assert.rejects(p, (e) => e.code === 'cancelled');
});

test('asks for lane data', async () => {
  resetRouting();
  let body;
  const fetchImpl = async (u, init) => { body = JSON.parse(init.body); return json({ trip: cityTrip() }); };
  await fetchRoutes({ from, to, mode: 'car' }, { fetchImpl, providers });
  assert.equal(body.turn_lanes, true);
});

test('stops become extra points, with no alternatives requested', async () => {
  resetRouting();
  let body;
  const fetchImpl = async (u, init) => { body = JSON.parse(init.body); return json({ trip: cityTrip() }); };
  await fetchRoutes({ from, to, stops: [{ lat: 3.155, lng: 101.71 }], mode: 'car', alternates: 2 }, { fetchImpl, providers });
  assert.equal(body.locations.length, 3);
  assert.deepEqual(body.locations[1], { lat: 3.155, lon: 101.71, type: 'break' });
  assert.equal(body.alternates, undefined);
});

test('joins a multi-stop trip into one line', () => {
  const trip = multiLeg();
  const r = prepareTrip(trip);
  const legA = prepareTrip({ legs: [trip.legs[0]], summary: trip.legs[0].summary });
  const legB = prepareTrip({ legs: [trip.legs[1]], summary: trip.legs[1].summary });
  assert.equal(r.coords.length, legA.coords.length + legB.coords.length - 1);
  assert.ok(Math.abs(r.length - (legA.length + legB.length)) < 1);
  const stops = r.maneuvers.filter((m) => m.isStop);
  assert.equal(stops.length, 1);
  assert.ok(Math.abs(stops[0].beginDist - legA.length) < 1);
  // The second leg's turn lands at the right place on the joined line.
  const after = r.maneuvers.filter((m) => m.beginDist > legA.length + 1);
  assert.ok(Math.abs(after[0].beginDist - (legA.length + legB.maneuvers[1].beginDist)) < 1);
  assert.equal(r.maneuvers.at(-1).isStop, false);
  assert.ok(Math.abs(r.maneuvers[0].timeFromHere - r.time) < 1);
});

test('driving time between two points', () => {
  const r = prepareTrip(cityTrip());
  assert.ok(Math.abs(timeBetween(r, 0, r.length) - r.time) < 0.01);
  assert.equal(timeBetween(r, 500, 500), 0);
  const firstLeg = r.maneuvers[0];
  assert.ok(Math.abs(timeBetween(r, 0, r.maneuvers[1].beginDist) - firstLeg.time) < 0.01);
  assert.equal(timeBetween(r, 1000, 500), 0);
});

test('position after a given time', () => {
  const r = prepareTrip(cityTrip());
  const half = distanceAfter(r, 0, r.time / 2);
  assert.ok(Math.abs(timeBetween(r, 0, half) - r.time / 2) < 1);
  assert.ok(Math.abs(distanceAfter(r, 0, r.time * 2) - r.length) < 1);
});
