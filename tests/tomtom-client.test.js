import test from 'node:test';
import assert from 'node:assert/strict';
import { evCar, mergeResults, placeLimits, planCharging, searchAddresses } from '../js/tomtom.js';
import { fasterSaving, isoTime, throughPoints } from '../js/traffic.js';
import { DRIVING_BELOW, FLOW_COLOURS, INCIDENTS, flowFilter, flowPaint } from '../js/traffic-map.js';
import { fetchRoutes } from '../js/routing.js';
import { prepareTrip } from '../js/routing.js';
import { pointAt } from '../js/motion.js';
import { altTrip, cityTrip } from './helpers/fixtures.js';
import { haversine, limitAt } from './helpers/geo-limit.js';

test('TomTom\'s speed limits are placed on the route, in order', () => {
  const r = prepareTrip(cityTrip());
  const limits = placeLimits(r, [
    { from: pointAt(r, 0), to: pointAt(r, 800), limit: 60 },
    { from: pointAt(r, 800), to: pointAt(r, 2000), limit: 80 },
    { from: [101.9, 3.3], to: [101.91, 3.3], limit: 110 },        // somewhere else entirely
  ]);
  assert.deepEqual(limits.map((l) => [Math.round(l.from / 10) * 10, Math.round(l.to / 10) * 10, l.limit]), [[0, 800, 60], [800, 2000, 80]]);
  assert.equal(limitAt(limits, 500), 60);
  assert.equal(limitAt(limits, 1500), 80);
  assert.equal(limitAt(limits, 2500), null);
});

test('addresses go first when the search looks like one, and nothing shows twice', () => {
  const named = [{ name: 'Suria KLCC', lng: 101.712, lat: 3.158 }, { name: 'SS 2 Mall', lng: 101.62, lat: 3.11 }];
  const addresses = [{ name: '12 Jalan SS 2/24', lng: 101.6205, lat: 3.1101 }, { name: 'Suria KLCC', lng: 101.7121, lat: 3.1581 }];
  assert.deepEqual(mergeResults(named, addresses, '12 jalan ss2/24').map((p) => p.name), ['12 Jalan SS 2/24', 'Suria KLCC', 'SS 2 Mall']);
  assert.deepEqual(mergeResults(named, addresses, 'klcc').map((p) => p.name), ['Suria KLCC', 'SS 2 Mall', '12 Jalan SS 2/24']);
  assert.deepEqual(mergeResults(named, addresses, 'Taman Tun').map((p) => p.name)[0], '12 Jalan SS 2/24');
});

test('an electric car\'s battery comes from its range and use', () => {
  assert.deepEqual(evCar({ kind: 'ev', range: 410, consumption: 14.7, level: 35 }), { battery: 60.3, level: 35, consumption: 14.7 });
  assert.equal(evCar({ kind: 'petrol', range: 600, consumption: 6 }), null);
  assert.equal(evCar({ kind: 'ev', range: 410 }), null, 'needs both figures');
  assert.equal(evCar({ kind: 'ev', range: 410, consumption: 14.7, level: 0 }).level, 1);
});

test('charging and addresses are asked of Pintu\'s server', async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(url.includes('/ev') ? { stops: [], arrive: 40 } : { places: [{ name: 'X', lng: 1, lat: 2 }] }), { status: 200 });
  };
  const plan = await planCharging({ from: { lng: 101.7, lat: 3.1 }, to: { lng: 103.7, lat: 1.5 }, stops: [{ lng: 102.2, lat: 2.2 }], car: { battery: 60, level: 50, consumption: 15 } }, { fetchImpl, server: 'https://pintu.test' });
  assert.equal(plan.arrive, 40);
  assert.equal(seen[0].url, 'https://pintu.test/ev');
  assert.deepEqual(JSON.parse(seen[0].init.body).points, [[101.7, 3.1], [102.2, 2.2], [103.7, 1.5]]);
  const found = await searchAddresses('12 jalan ss2', { lat: 3.1, lng: 101.6 }, { fetchImpl, server: 'https://pintu.test' });
  assert.equal(new URL(seen[1].url).searchParams.get('lat'), '3.1000');
  assert.deepEqual(found, [{ name: 'X', detail: '', lng: 1, lat: 2, country: 'MY', address: true }]);
});

test('a quicker way is offered only when it saves enough', () => {
  const better = { travel: 600, path: [[0, 0], [1, 1]] };
  assert.equal(fasterSaving({ travel: 1000, better }), 400);
  assert.equal(fasterSaving({ travel: 700, better }), 0, 'under three minutes');
  assert.equal(fasterSaving({ travel: 6000, better: { ...better, travel: 5700 } }), 0, 'a small share of a long trip');
  assert.equal(fasterSaving({ travel: 1000, better: null }), 0);
  assert.equal(fasterSaving(null), 0);
});

test('points along the quicker way, each facing along the road', () => {
  const r = prepareTrip(altTrip());
  const pts = throughPoints(r.coords, 8);
  assert.equal(pts.length, 8);
  for (const p of pts) assert.ok(Number.isFinite(p.heading) && p.heading >= 0 && p.heading < 360);
  assert.ok(haversine([pts[0].lng, pts[0].lat], r.coords[0]) > 400, 'not right at the start');
  assert.ok(haversine([pts[7].lng, pts[7].lat], r.coords[r.coords.length - 1]) > 200, 'nor at the end');
  assert.deepEqual(throughPoints([[101.7, 3.15], [101.701, 3.15]]), [], 'too short to bother');
});

test('the route planner is asked to pass through them without stopping', async () => {
  let body = null;
  const fetchImpl = async (url, init) => {
    body = JSON.parse(init?.body || decodeURIComponent(new URL(url).searchParams.get('json')));
    return new Response(JSON.stringify({ trip: cityTrip() }), { status: 200 });
  };
  await fetchRoutes({ from: { lng: 101.7, lat: 3.15 }, to: { lng: 101.718, lat: 3.16 }, through: [{ lng: 101.71, lat: 3.15, heading: 92 }], mode: 'car', alternates: 2 }, { fetchImpl, providers: [{ name: 't', url: 'https://route.test' }] });
  assert.deepEqual(body.locations.map((l) => l.type), ['break', 'through', 'break']);
  assert.equal(body.locations[1].heading, 92);
  assert.equal(body.alternates, undefined, 'one fixed way, so no alternatives');
});

test('arrival times go to TomTom to the second, in UTC', () => {
  assert.equal(isoTime(new Date('2026-11-09T01:00:00.123Z')), '2026-11-09T01:00:00Z');
});

test('traffic colours: slower is redder, and driving shows only the slow parts', () => {
  assert.deepEqual(FLOW_COLOURS.map((c) => c[0]), [0.25, 0.5, 0.75, Infinity]);
  const paint = flowPaint();
  assert.equal(paint['line-color'][0], 'case');
  assert.deepEqual(flowFilter(false), ['all']);
  assert.match(JSON.stringify(flowFilter(true)), new RegExp(`"<",.*${DRIVING_BELOW}`));
  assert.deepEqual(Object.keys(INCIDENTS).map(Number), [1, 3, 7, 8, 9, 11, 14]);
});
